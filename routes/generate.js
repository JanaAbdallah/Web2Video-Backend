const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const { cleanText } = require('../utils/textCleaner');
const { generateScript } = require('../services/llmService');
const { generateAudioForScenes } = require('../services/ttsService');
const { renderVideo } = require('../services/videoService');

// In-memory job store (fine for MVP)
const jobs = {};

// POST /api/generate — kick off async job, return jobId immediately
router.post('/', async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim().length < 50) {
    return res.status(400).json({ error: 'Not enough text provided (minimum 50 characters)' });
  }

  const jobId = uuidv4();
  jobs[jobId] = { status: 'processing', progress: 'Starting...' };

  res.json({ jobId });

  // Run async — don't await
  processJob(jobId, text).catch((err) => {
    console.error('❌ Job failed:', err.message);
    jobs[jobId] = { status: 'failed', error: err.message };
  });
});

// GET /api/generate/status/:jobId — poll for status
router.get('/status/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// POST /api/generate/cancel/:jobId — gracefully halt processing
router.post('/cancel/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  if (jobs[jobId]) {
    jobs[jobId].status = 'cancelled';
    console.log(`🛑 Job ${jobId} cancellation requested by client.`);
  }
  res.json({ success: true });
});

async function processJob(jobId, rawText) {
  const jobDir = path.join(__dirname, '../outputs', jobId);
  
  const checkCancelled = () => {
    if (jobs[jobId]?.status === 'cancelled') throw new Error('Cancelled by user');
  };

  try {
    await fs.ensureDir(jobDir);
    checkCancelled();

    // 1. Clean text
    jobs[jobId].progress = 'Cleaning page content...';
    const cleanedText = cleanText(rawText);
    console.log(`📝 Cleaned text: ${cleanedText.length} chars`);
    checkCancelled();

    // 2. Generate script with LLM
    jobs[jobId].progress = 'Generating video script with AI...';
    const script = await generateScript(cleanedText);
    console.log(`📋 Script: "${script.title}" — ${script.scenes.length} scenes`);
    checkCancelled();

    // 3. Generate voiceover audio for each scene
    jobs[jobId].progress = 'Generating voiceover audio...';
    const audioPaths = await generateAudioForScenes(script.scenes, jobId);
    checkCancelled();

    // 4. Attach audio URLs to scenes
    const scenesWithAudio = script.scenes.map((scene, i) => ({
      ...scene,
      audioFile: audioPaths[i],
    }));
    checkCancelled();

    // 5. Render video with Remotion
    jobs[jobId].progress = 'Rendering video (this takes 1-3 minutes)...';
    await renderVideo(jobId, scenesWithAudio, () => jobs[jobId]?.status === 'cancelled');
    checkCancelled();

    // 6. Done!
    jobs[jobId] = {
      status: 'complete',
      title: script.title,
      videoUrl: `/videos/${jobId}/video.mp4`,
    };

    console.log(`🎉 Job ${jobId} complete!`);
  } catch (err) {
    if (err.message === 'Cancelled by user' || err.message === 'Job cancelled by user') {
      console.log(`🛑 Job ${jobId} gracefully aborted to save CPU.`);
    } else {
      console.error('❌ Job failed:', err.message);
      if (jobs[jobId]) jobs[jobId] = { status: 'failed', error: err.message };
    }
  }
  
  // 7. Auto-cleanup disk and memory after 15 minutes
  setTimeout(async () => {
    try {
      if (await fs.pathExists(jobDir)) {
        await fs.remove(jobDir);
        console.log(`🧹 Securely erased job ${jobId} files to save disk space.`);
      }
      delete jobs[jobId];
    } catch (err) {
      console.error(`❌ Failed to clean up job ${jobId}:`, err.message);
    }
  }, 15 * 60 * 1000);
}

module.exports = router;