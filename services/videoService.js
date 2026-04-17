/**
 * videoService.js
 *
 * Renders the final MP4 using Remotion.
 *
 * Hard constraints:
 *  - Output resolution: 1280×720 (720p) — never lower, never higher
 *  - x264 preset: ultrafast — fastest encode, negligible quality loss at 720p
 *  - Concurrency: auto-detected from CPUs, capped at 8
 *  - Total render target: ≤ 6 minutes (enforced by generate.js timeout)
 *  - Video duration: enforced upstream by llmService (≤ 90s)
 */

const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition, makeCancelSignal } = require('@remotion/renderer');
const path = require('path');
const fs = require('fs-extra');
const chromium = require('@sparticuz/chromium');
const mp3Duration = require('mp3-duration');
const os = require('os');

const ENTRY_POINT = path.join(__dirname, '../remotion-src/index.ts');

// ─── Singleton cache ──────────────────────────────────────────────────────────

let cachedBundleUrl = null;
let cachedExecutablePath = null;

// ─── Warm-up ──────────────────────────────────────────────────────────────────

async function warmUp() {
  try {
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

// ─── Audio duration ───────────────────────────────────────────────────────────

async function estimateAudioDuration(filePath) {
  try {
    const durationSeconds = await mp3Duration(filePath);
    return Math.ceil(durationSeconds * 10) / 10;
  } catch (err) {
    console.warn(`⚠️  Could not estimate audio duration for ${filePath}:`, err.message);
    return null;
  }
}

// ─── Main render ──────────────────────────────────────────────────────────────

async function renderVideo(jobId, scenesWithAudio, checkCancelled) {
  const outputPath = path.join(__dirname, '../outputs', jobId, 'video.mp4');
  const fps = 24;

  // ── 1. Measure audio durations in parallel ───────────────────────────────
  console.log('🔍 Measuring audio durations...');
  const scenesWithDurations = await Promise.all(
    scenesWithAudio.map(async (scene, i) => {
      if (!scene.audioFile) return scene;
      const localPath = path.join(__dirname, '../outputs', jobId, `scene-${i}.mp3`);
      const audioDuration = await estimateAudioDuration(localPath);
      if (audioDuration) {
        console.log(`  Scene ${i + 1}: audio = ${audioDuration}s`);
      }
      return { ...scene, audioDuration };
    })
  );

  // ── 2. Compute total frames ───────────────────────────────────────────────
  const totalDurationSeconds = scenesWithDurations.reduce((sum, scene) => {
    // Add 0.3s buffer after each audio clip so it never gets cut off
    const effective = scene.audioDuration ? scene.audioDuration + 0.3 : scene.duration;
    return sum + effective;
  }, 0);

  // Hard cap: clip to 90 seconds worth of frames if somehow over
  const cappedDuration = Math.min(totalDurationSeconds, 90);
  const totalFrames = Math.round(cappedDuration * fps);

  console.log(`  Total: ${cappedDuration.toFixed(1)}s → ${totalFrames} frames`);

  // ── 3. Resolve bundle + chromium ─────────────────────────────────────────
  const [serveUrl, executablePath] = await Promise.all([
    getBundleUrl(),
    getExecutablePath(),
  ]);

  const chromiumOptions = {
    args: [
      ...chromium.args,
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',                  // headless doesn't need GPU
      '--disable-software-rasterizer',
    ],
    headless: chromium.headless,
  };

  // ── 4. Select composition ─────────────────────────────────────────────────
  const composition = await selectComposition({
    serveUrl,
    id: 'MainVideo',
    inputProps: { scenes: scenesWithDurations },
    chromiumOptions,
    browserExecutable: executablePath,
  });

  // Enforce 720p and computed duration regardless of Root.tsx defaults
  composition.durationInFrames = totalFrames;
  composition.fps = fps;
  composition.width = 1280;   // 720p
  composition.height = 720;   // 720p

  // ── 5. Concurrency: (CPUs - 1), floor 2, cap 8 ───────────────────────────
  const cpuCount = os.cpus().length;
  const concurrency = Math.min(Math.max(cpuCount - 1, 2), 8);

  console.log(
    `🎬 Rendering ${totalFrames} frames at ${fps} FPS, 1280×720, ` +
    `concurrency=${concurrency}, preset=ultrafast...`
  );

  // ── 6. Cancellation ───────────────────────────────────────────────────────
  const { cancelSignal, cancel } = makeCancelSignal();
  const cancelPoller = setInterval(() => {
    if (checkCancelled?.()) {
      console.log('\n🛑 Cancel signal fired — stopping renderer...');
      cancel();
      clearInterval(cancelPoller);
    }
  }, 500);

  // ── 7. Render ─────────────────────────────────────────────────────────────
  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      concurrency,

      // 'ultrafast' is the fastest x264 preset — ~5× faster than default 'medium'.
      // At 720p the quality difference is imperceptible for a talking-head style video.
      x264Preset: 'ultrafast',

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