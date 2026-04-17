const fs = require('fs-extra');
const googleTTS = require('google-tts-api');
const path = require('path');

async function generateAudioForScene(text, outputPath) {
  try {
    const results = await googleTTS.getAllAudioBase64(text, {
      lang: 'en',
      slow: false,
      host: 'https://translate.google.com',
      splitPunct: ',.?',
    });

    const buffers = results.map(r => Buffer.from(r.base64, 'base64'));
    const finalBuffer = Buffer.concat(buffers);

    await fs.writeFile(outputPath, finalBuffer);
    return outputPath;
  } catch (err) {
    throw new Error(`Free Google TTS failed: ${err.message}`);
  }
}

async function generateAudioForScenes(scenes, jobId) {
  const jobDir = path.join(__dirname, '../outputs', jobId);
  const audioPaths = [];

  // Use the same port as server.js — default 3008 (was wrongly 3001 before)
  const port = process.env.PORT || 3008;

  for (let i = 0; i < scenes.length; i++) {
    const filePath = path.join(jobDir, `scene-${i}.mp3`);
    console.log(`🎙️  Generating audio for scene ${i + 1}/${scenes.length}...`);
    await generateAudioForScene(scenes[i].text, filePath);
    // Return as HTTP URL so Remotion's headless browser can fetch it
    audioPaths.push(`http://localhost:${port}/videos/${jobId}/scene-${i}.mp3`);
  }

  return audioPaths;
}

module.exports = { generateAudioForScenes };