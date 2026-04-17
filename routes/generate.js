/**
 * generate.js
 *
 * API routes for video generation jobs.
 *
 * Design decisions:
 * - Jobs are in-memory only (no DB, no disk state beyond the render output).
 * - Jobs auto-cleanup after 15 minutes (video files + memory).
 * - A hard 6-minute render timeout kills any stuck job.
 * - No cross-request state is persisted — every client session is independent.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const { cleanText } = require('../utils/textCleaner');
const { generateScript } = require('../services/llmService');
const { generateAudioForScenes } = require('../services/ttsService');
const { renderVideo } = require('../services/videoService');

// In-memory job store
const jobs = {};

// Hard render timeout: 6 minutes (360 000 ms)
const RENDER_TIMEOUT_MS = 6 * 60 * 1000;

// Auto-cleanup delay after completion: 15 minutes
const CLEANUP_DELAY_MS = 15 * 60 * 1000;

// ─── POST /api/generate — start a new job ────────────────────────────────────

router.post('/', async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim().length < 50) {
    return res.status(400).json({ error: 'Not enough text provided (minimum 50 characters)' });
  }

  const jobId = uuidv4();
  jobs[jobId] = { status: 'processing', progress: 'Starting...' };

  res.json({ jobId });

  // Fire-and-forget async job
  processJob(jobId, text).catch((err) => {
    console.error('❌ Job failed:', err.message);
    if (jobs[jobId] && jobs[jobId].status !== 'cancelled') {
      jobs[jobId] = { status: 'failed', error: err.message };
    }
  });
});

// ─── GET /api/generate/status/:jobId — poll status ───────────────────────────

router.get('/status/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ─── POST /api/generate/cancel/:jobId — cancel a running job ─────────────────

router.post('/cancel/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  if (jobs[jobId]) {
    jobs[jobId].status = 'cancelled';
    console.log(`🛑 Job ${jobId} cancelled by client.`);
  }
  res.json({ success: true });
});

// ─── Core job processor ───────────────────────────────────────────────────────

async function processJob(jobId, rawText) {
  const jobDir = path.join(__dirname, '../outputs', jobId);

  const isCancelled = () => jobs[jobId]?.status === 'cancelled';
  const checkCancelled = () => {
    if (isCancelled()) throw new Error('Cancelled by user');
  };

  // Set a hard 6-minute timeout to prevent zombie renders
  const timeoutHandle = setTimeout(() => {
    if (jobs[jobId] && jobs[jobId].status === 'processing') {
      console.warn(`⏰ Job ${jobId} timed out after 6 minutes — marking as failed.`);
      jobs[jobId] = { status: 'failed', error: 'Render timed out after 6 minutes. Try a shorter page.' };
    }
  }, RENDER_TIMEOUT_MS);

  try {
    await fs.ensureDir(jobDir);
    checkCancelled();

    // 1. Clean text
    jobs[jobId].progress = 'Cleaning documentation content...';
    const cleanedText = cleanText(rawText);
    console.log(`📝 Cleaned text: ${cleanedText.length} chars`);
    checkCancelled();

    // 2. Generate script with LLM
    jobs[jobId].progress = 'Generating video script from documentation...';
    const script = await generateScript(cleanedText);
    checkCancelled();

    // 3. Generate voiceover audio for each scene in parallel
    jobs[jobId].progress = 'Generating voiceover audio...';
    const audioPaths = await generateAudioForScenes(script.scenes, jobId);
    checkCancelled();

    // 4. Attach audio URLs to scenes
    const scenesWithAudio = script.scenes.map((scene, i) => ({
      ...scene,
      audioFile: audioPaths[i],
    }));
    checkCancelled();

    // 5. Render video
    jobs[jobId].progress = 'Rendering video (up to 6 minutes)...';
    await renderVideo(jobId, scenesWithAudio, isCancelled);
    checkCancelled();

    // 6. Done
    clearTimeout(timeoutHandle);
    jobs[jobId] = {
      status: 'complete',
      title: script.title,
      videoUrl: `/videos/${jobId}/video.mp4`,
    };
    console.log(`🎉 Job ${jobId} complete!`);

  } catch (err) {
    clearTimeout(timeoutHandle);

    if (err.message === 'Cancelled by user' || err.message === 'Job cancelled by user') {
      console.log(`🛑 Job ${jobId} gracefully aborted.`);
    } else {
      console.error('❌ Job failed:', err.message);
      if (jobs[jobId] && jobs[jobId].status !== 'cancelled') {
        jobs[jobId] = { status: 'failed', error: err.message };
      }
    }
  }

  // Auto-cleanup: remove files and memory after 15 minutes
  setTimeout(async () => {
    try {
      if (await fs.pathExists(jobDir)) {
        await fs.remove(jobDir);
        console.log(`🧹 Cleaned up job ${jobId}.`);
      }
      delete jobs[jobId];
    } catch (err) {
      console.error(`❌ Cleanup failed for job ${jobId}:`, err.message);
    }
  }, CLEANUP_DELAY_MS);
}

module.exports = router;