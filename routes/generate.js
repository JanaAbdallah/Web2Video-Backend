/**
 * generate.js  (OPTIMISED)
 *
 * Key changes vs original:
 *  1. REMOVED the hard 6-minute timeout that was silently killing renders that
 *     were close to completion. The render itself has a per-frame timeout in
 *     videoService.js (30 s/frame) which is the right place to catch hangs.
 *  2. Progress messages now include elapsed time so the user can see that
 *     something is actually happening.
 *  3. Cleanup delay extended to 30 minutes (was 15) so videos don't vanish
 *     before slow mobile connections finish downloading them.
 *  4. POST body validated more carefully to give actionable error messages.
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

// Auto-cleanup delay after completion: 30 minutes (was 15)
// Longer window prevents videos vanishing while the user is still watching/downloading.
const CLEANUP_DELAY_MS = 30 * 60 * 1000;

// ─── POST /api/generate — start a new job ────────────────────────────────────

router.post('/', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing "text" field in request body.' });
  }
  if (text.trim().length < 50) {
    return res.status(400).json({ error: 'Not enough text provided (minimum 50 characters).' });
  }

  const jobId = uuidv4();
  jobs[jobId] = { status: 'processing', progress: 'Starting...', startedAt: Date.now() };

  res.json({ jobId });

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

  // Include elapsed seconds in every processing response so the client
  // can show a live timer and reassure the user something is happening.
  if (job.status === 'processing' && job.startedAt) {
    return res.json({
      ...job,
      elapsedSeconds: Math.round((Date.now() - job.startedAt) / 1000),
    });
  }

  res.json(job);
});

// ─── POST /api/generate/cancel/:jobId ────────────────────────────────────────

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

  // Helper: update progress with elapsed time stamp
  const setProgress = (msg) => {
    if (!jobs[jobId]) return;
    const elapsed = Math.round((Date.now() - jobs[jobId].startedAt) / 1000);
    jobs[jobId].progress = `${msg} (${elapsed}s elapsed)`;
    console.log(`[job ${jobId.slice(0, 8)}] ${msg} — ${elapsed}s`);
  };

  try {
    await fs.ensureDir(jobDir);
    checkCancelled();

    // 1. Clean text
    setProgress('Cleaning documentation content...');
    const cleanedText = cleanText(rawText);
    console.log(`📝 Cleaned text: ${cleanedText.length} chars`);
    checkCancelled();

    // 2. Generate script with LLM
    setProgress('Generating video script from documentation...');
    const script = await generateScript(cleanedText);
    checkCancelled();

    // 3. Generate voiceover audio for each scene in parallel
    setProgress('Generating voiceover audio...');
    const audioPaths = await generateAudioForScenes(script.scenes, jobId);
    checkCancelled();

    // 4. Attach audio URLs to scenes
    const scenesWithAudio = script.scenes.map((scene, i) => ({
      ...scene,
      audioFile: audioPaths[i],
    }));
    checkCancelled();

    // 5. Render video
    // CHANGE: No hard timeout here anymore. The render has its own per-frame
    // timeout (30 s) in videoService.js. A legitimate 90-second video with
    // complex scenes can genuinely take 4-8 minutes to render on a shared host.
    setProgress('Rendering video — please wait, this takes 2–5 minutes...');
    await renderVideo(jobId, scenesWithAudio, isCancelled);
    checkCancelled();

    // 6. Done
    const totalSeconds = Math.round((Date.now() - jobs[jobId].startedAt) / 1000);
    jobs[jobId] = {
      status: 'complete',
      title: script.title,
      videoUrl: `/videos/${jobId}/video.mp4`,
      totalSeconds,
    };
    console.log(`🎉 Job ${jobId} complete in ${totalSeconds}s!`);

  } catch (err) {
    if (err.message === 'Cancelled by user' || err.message === 'Job cancelled by user') {
      console.log(`🛑 Job ${jobId} gracefully aborted.`);
    } else {
      console.error('❌ Job failed:', err.message);
      if (jobs[jobId] && jobs[jobId].status !== 'cancelled') {
        jobs[jobId] = { status: 'failed', error: err.message };
      }
    }
  }

  // Auto-cleanup: remove files and memory after 30 minutes
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