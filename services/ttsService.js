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
  const port = process.env.PORT || 3008;

  // KEY OPTIMISATION: generate all scenes in parallel instead of sequentially.
  // For 5 scenes this alone saves ~30-60 seconds depending on text length.
  console.log(`🎙️  Generating audio for ${scenes.length} scenes in parallel...`);

  const audioPaths = await Promise.all(
    scenes.map(async (scene, i) => {
      const filePath = path.join(jobDir, `scene-${i}.mp3`);
      await generateAudioForScene(scene.text, filePath);
      console.log(`  ✓ Scene ${i + 1}/${scenes.length} audio done`);
      // Return as HTTP URL so Remotion's headless browser can fetch it
      return `http://localhost:${port}/videos/${jobId}/scene-${i}.mp3`;
    })
  );

  return audioPaths;
}

module.exports = { generateAudioForScenes };