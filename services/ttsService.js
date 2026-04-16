const fs = require('fs-extra');
const googleTTS = require('google-tts-api');
const path = require('path');

async function generateAudioForScene(text, outputPath) {
  try {
    // google-tts-api intelligently chunks long sentences, bypassing character limits
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

  for (let i = 0; i < scenes.length; i++) {
    const filePath = path.join(jobDir, `scene-${i}.mp3`);
    console.log(`🎙️  Generating free audio for scene ${i + 1}/${scenes.length}...`);
    await generateAudioForScene(scenes[i].text, filePath);
    // Return as HTTP URL so Remotion's headless browser can access it
    audioPaths.push(`http://localhost:${process.env.PORT || 3001}/videos/${jobId}/scene-${i}.mp3`);
  }

  return audioPaths;
}

module.exports = { generateAudioForScenes };
