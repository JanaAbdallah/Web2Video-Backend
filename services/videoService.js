const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition, makeCancelSignal } = require('@remotion/renderer');
const path = require('path');
const fs = require('fs-extra');
const chromium = require('@sparticuz/chromium');
const mp3Duration = require('mp3-duration');
const os = require('os');

const ENTRY_POINT = path.join(__dirname, '../remotion-src/index.ts');

// ─── Cached singletons (computed once, reused forever) ────────────────────────

let cachedBundleUrl = null;
let cachedExecutablePath = null;   // executablePath() is slow (~200ms) — cache it

// ─── Warm-up: call this from server.js on boot ───────────────────────────────

async function warmUp() {
  try {
    // Run both in parallel — shaves ~30s off the first real request
    [cachedBundleUrl, cachedExecutablePath] = await Promise.all([
      _buildBundle(),
      chromium.executablePath(),
    ]);
    console.log('🔥 Remotion warm-up complete. Bundle and Chromium ready.');
  } catch (err) {
    console.error('⚠️  Warm-up failed (will retry on first request):', err.message);
  }
}

async function _buildBundle() {
  console.log('📦 Bundling Remotion project...');
  const url = await bundle({
    entryPoint: ENTRY_POINT,
    webpackOverride: (config) => config,
  });
  console.log('✅ Bundle ready:', url);
  return url;
}

async function getBundleUrl() {
  if (!cachedBundleUrl) cachedBundleUrl = await _buildBundle();
  return cachedBundleUrl;
}

async function getExecutablePath() {
  if (!cachedExecutablePath) cachedExecutablePath = await chromium.executablePath();
  return cachedExecutablePath;
}

// ─── Audio duration helper ────────────────────────────────────────────────────

async function estimateAudioDuration(filePath) {
  try {
    const durationSeconds = await mp3Duration(filePath);
    return Math.ceil(durationSeconds * 10) / 10;
  } catch (err) {
    console.warn(`⚠️  Could not estimate audio duration for ${filePath}:`, err.message);
    return null;
  }
}

// ─── Main render function ─────────────────────────────────────────────────────

async function renderVideo(jobId, scenesWithAudio, checkCancelled) {
  const outputPath = path.join(__dirname, '../outputs', jobId, 'video.mp4');
  const fps = 24;

  // ── 1. Measure all audio durations in parallel (was sequential before) ──────
  console.log('🔍 Measuring audio durations...');
  const scenesWithDurations = await Promise.all(
    scenesWithAudio.map(async (scene, i) => {
      if (!scene.audioFile) return scene;
      const localPath = path.join(__dirname, '../outputs', jobId, `scene-${i}.mp3`);
      const audioDuration = await estimateAudioDuration(localPath);
      if (audioDuration) {
        console.log(`  Scene ${i + 1}: audio = ${audioDuration}s (LLM said ${scene.duration}s)`);
      }
      return { ...scene, audioDuration };
    })
  );

  // ── 2. Compute total frames ──────────────────────────────────────────────────
  const totalDurationSeconds = scenesWithDurations.reduce((sum, scene) => {
    const effective = scene.audioDuration ? scene.audioDuration + 0.5 : scene.duration;
    return sum + effective;
  }, 0);
  const totalFrames = Math.round(totalDurationSeconds * fps);

  // ── 3. Resolve bundle + chromium (from cache) ────────────────────────────────
  const [serveUrl, executablePath] = await Promise.all([
    getBundleUrl(),
    getExecutablePath(),
  ]);

  const chromiumOptions = {
    args: [
      ...chromium.args,
      '--disable-dev-shm-usage',   // avoids /dev/shm exhaustion in containers
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    headless: chromium.headless,
  };

  // ── 4. Select composition ─────────────────────────────────────────────────────
  const composition = await selectComposition({
    serveUrl,
    id: 'MainVideo',
    inputProps: { scenes: scenesWithDurations },
    chromiumOptions,
    browserExecutable: executablePath,
  });

  composition.durationInFrames = totalFrames;
  composition.fps = fps;

  // ── 5. Determine concurrency ──────────────────────────────────────────────────
  // Use (CPUs - 1) so the OS stays responsive, floor at 2, cap at 8.
  const cpuCount = os.cpus().length;
  const concurrency = Math.min(Math.max(cpuCount - 1, 2), 8);

  console.log(
    `🎬 Rendering ${totalFrames} frames (${totalDurationSeconds.toFixed(1)}s, ` +
    `${scenesWithDurations.length} scenes) at ${fps} FPS with concurrency=${concurrency}...`
  );

  // ── 6. Set up cancellation ────────────────────────────────────────────────────
  const { cancelSignal, cancel } = makeCancelSignal();
  const cancelPoller = setInterval(() => {
    if (checkCancelled?.()) {
      console.log('\n🛑 Cancel signal fired — stopping Remotion renderer...');
      cancel();
      clearInterval(cancelPoller);
    }
  }, 500);

  // ── 7. Render ─────────────────────────────────────────────────────────────────
  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',

      // KEY OPTIMISATION 1: render multiple frames simultaneously
      concurrency,

      // KEY OPTIMISATION 2: much faster x264 encoding with negligible quality loss at 720p
      // 'veryfast' is ~3× faster than the default 'medium'; try 'ultrafast' if still too slow
      x264Preset: 'veryfast',

      outputLocation: outputPath,
      inputProps: { scenes: scenesWithDurations },
      chromiumOptions,
      browserExecutable: executablePath,
      cancelSignal,
      onProgress: ({ progress }) => {
        process.stdout.write(`\r  Render progress: ${Math.round(progress * 100)}%`);
      },
    });
  } catch (err) {
    const isTargetClosed = err.message?.includes('Target closed') || err.message?.includes('ProtocolError');
    const isCancelled   = err.message?.includes('Cancelled') || err.message?.includes('cancel');
    if (isTargetClosed || isCancelled) throw new Error('Cancelled by user');
    throw err;
  } finally {
    clearInterval(cancelPoller);
  }

  console.log('\n✅ Video rendered:', outputPath);
  return outputPath;
}

module.exports = { renderVideo, warmUp };