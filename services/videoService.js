const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition } = require('@remotion/renderer');
const path = require('path');
const fs = require('fs-extra');
const chromium = require('@sparticuz/chromium');

const ENTRY_POINT = path.join(__dirname, '../remotion-src/index.ts');

// Cache the bundle URL after first build (avoids re-bundling every request)
let cachedBundleUrl = null;

async function getBundleUrl() {
  if (cachedBundleUrl) return cachedBundleUrl;

  console.log('📦 Bundling Remotion project (first time only, takes ~30s)...');
  cachedBundleUrl = await bundle({
    entryPoint: ENTRY_POINT,
    webpackOverride: (config) => config,
  });
  console.log('✅ Bundle ready:', cachedBundleUrl);
  return cachedBundleUrl;
}

/**
 * Estimate audio duration from an MP3 file's byte size.
 * Formula: bytes / (bitrate_kbps * 125) = seconds
 * ElevenLabs outputs ~128kbps MP3s, so we use 128 * 125 = 16000 bytes/sec.
 * This is an estimate — accurate within ~5% which is enough to set scene length.
 */
async function estimateAudioDuration(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const bytes = stats.size;
    const bitrateKbps = 128; // ElevenLabs default
    const durationSeconds = bytes / (bitrateKbps * 125);
    return Math.ceil(durationSeconds * 10) / 10; // round up to 1 decimal
  } catch (err) {
    console.warn(`⚠️  Could not estimate audio duration for ${filePath}:`, err.message);
    return null;
  }
}

async function renderVideo(jobId, scenesWithAudio) {
  const outputPath = path.join(__dirname, '../outputs', jobId, 'video.mp4');

  const fps = 30;

  // Measure actual audio duration for each scene and inject it
  console.log('🔍 Measuring audio durations...');
  const scenesWithDurations = await Promise.all(
    scenesWithAudio.map(async (scene, i) => {
      if (!scene.audioFile) return scene;

      // audioFile is an HTTP URL like http://localhost:3001/videos/{jobId}/scene-0.mp3
      // Convert to local file path for fs.stat
      const localPath = path.join(__dirname, '../outputs', jobId, `scene-${i}.mp3`);
      const audioDuration = await estimateAudioDuration(localPath);

      if (audioDuration) {
        console.log(`  Scene ${i + 1}: audio = ${audioDuration}s (LLM said ${scene.duration}s)`);
      }

      return { ...scene, audioDuration };
    })
  );

  // Total duration = sum of effective scene durations (audio duration + 0.5s padding, or LLM duration)
  const totalDurationSeconds = scenesWithDurations.reduce((sum, scene) => {
    const effective = scene.audioDuration ? scene.audioDuration + 0.5 : scene.duration;
    return sum + effective;
  }, 0);

  const totalFrames = Math.round(totalDurationSeconds * fps);

  const serveUrl = await getBundleUrl();

  const executablePath = await chromium.executablePath();
  const chromiumOptions = {
    executablePath,
    args: chromium.args,
    headless: chromium.headless,
  };

  const composition = await selectComposition({
    serveUrl,
    id: 'MainVideo',
    inputProps: { scenes: scenesWithDurations },
    chromiumOptions
  });

  // Override computed duration with our actual scene total
  composition.durationInFrames = totalFrames;

  console.log(`🎬 Rendering ${totalFrames} frames (${totalDurationSeconds.toFixed(1)}s across ${scenesWithDurations.length} scenes)...`);

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps: { scenes: scenesWithDurations },
    chromiumOptions,
    onProgress: ({ progress }) => {
      process.stdout.write(`\r  Render progress: ${Math.round(progress * 100)}%`);
    },
  });

  console.log('\n✅ Video rendered:', outputPath);
  return outputPath;
}

module.exports = { renderVideo };