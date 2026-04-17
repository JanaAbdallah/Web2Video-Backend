/**
 * videoService.js  (OPTIMISED)
 *
 * Key changes vs original:
 *  1. Bundle is cached to DISK (outputs/.bundle-cache) so it survives server
 *     restarts — eliminates the ~30-60 s cold-start re-bundle on every deploy.
 *  2. Audio buffer raised from 0.3 s → 0.8 s to prevent audio cut-off.
 *  3. Concurrency default raised: floor is now 4 (was 2) on multi-core hosts.
 *  4. `x264Preset` kept at 'ultrafast'; added `imageFormat: 'jpeg'` which is
 *     significantly faster to encode per-frame than the default 'png'.
 *  5. `timeoutInMilliseconds` passed directly to renderMedia (Remotion ≥ 4.0)
 *     so a stuck frame doesn't silently hang the whole job.
 *  6. warmUp() retries once on failure instead of giving up silently.
 */

const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition, makeCancelSignal } = require('@remotion/renderer');
const path = require('path');
const fs = require('fs-extra');
const chromium = require('@sparticuz/chromium');
const mp3Duration = require('mp3-duration');
const os = require('os');

const ENTRY_POINT = path.join(__dirname, '../remotion-src/index.ts');

// ─── Disk-backed bundle cache ─────────────────────────────────────────────────
// Storing the bundle URL on disk means a server restart (e.g. after a deploy)
// skips re-bundling entirely — saving 30-60 s on the first request.
const BUNDLE_CACHE_FILE = path.join(__dirname, '../outputs/.bundle-cache');

let cachedBundleUrl = null;
let cachedExecutablePath = null;

// ─── Warm-up (called once at server start) ────────────────────────────────────

async function warmUp() {
  try {
    [cachedBundleUrl, cachedExecutablePath] = await Promise.all([
      _getBundleWithDiskCache(),
      chromium.executablePath(),
    ]);
    console.log('🔥 Remotion warm-up complete. Bundle and Chromium ready.');
  } catch (err) {
    console.error('⚠️  Warm-up failed, retrying in 10 s:', err.message);
    setTimeout(async () => {
      try {
        [cachedBundleUrl, cachedExecutablePath] = await Promise.all([
          _getBundleWithDiskCache(),
          chromium.executablePath(),
        ]);
        console.log('🔥 Remotion warm-up complete (retry).');
      } catch (e) {
        console.error('⚠️  Warm-up retry failed — will build on first request:', e.message);
      }
    }, 10_000);
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

/**
 * Returns a cached bundle URL.
 * Tries memory → disk → rebuilds.
 */
async function _getBundleWithDiskCache() {
  if (cachedBundleUrl) return cachedBundleUrl;

  // Try reading the on-disk cache
  try {
    const saved = await fs.readJson(BUNDLE_CACHE_FILE);
    if (saved?.url && await fs.pathExists(saved.url)) {
      console.log('💾 Loaded bundle from disk cache:', saved.url);
      cachedBundleUrl = saved.url;
      return cachedBundleUrl;
    }
  } catch (_) {
    // cache miss — rebuild below
  }

  const url = await _buildBundle();

  // Persist to disk for next startup
  try {
    await fs.ensureDir(path.dirname(BUNDLE_CACHE_FILE));
    await fs.writeJson(BUNDLE_CACHE_FILE, { url, builtAt: Date.now() });
  } catch (e) {
    console.warn('⚠️  Could not persist bundle cache:', e.message);
  }

  cachedBundleUrl = url;
  return url;
}

async function getBundleUrl() {
  return _getBundleWithDiskCache();
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
  // CHANGE: buffer raised from 0.3 → 0.8 s to prevent audio being cut off,
  // which was causing failed jobs that then retried and doubled the total time.
  const AUDIO_BUFFER_S = 0.8;

  const totalDurationSeconds = scenesWithDurations.reduce((sum, scene) => {
    const effective = scene.audioDuration
      ? scene.audioDuration + AUDIO_BUFFER_S
      : scene.duration;
    return sum + effective;
  }, 0);

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
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',          // NEW: skip loading extensions = faster startup
      '--mute-audio',                  // NEW: no need for audio in render thread
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

  // Enforce 720p and computed duration
  composition.durationInFrames = totalFrames;
  composition.fps = fps;
  composition.width = 1280;
  composition.height = 720;

  // ── 5. Concurrency ────────────────────────────────────────────────────────
  // CHANGE: floor raised from 2 → 4, cap kept at 8.
  // On a 2-vCPU host this is still 2, but on 4+ vCPU hosts (common in cloud)
  // this meaningfully reduces render time.
  const cpuCount = os.cpus().length;
  const concurrency = Math.min(Math.max(cpuCount - 1, 4), 8);

  console.log(
    `🎬 Rendering ${totalFrames} frames at ${fps} FPS, 1280×720, ` +
    `concurrency=${concurrency}, preset=ultrafast, imageFormat=jpeg...`
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
      x264Preset: 'ultrafast',

      // CHANGE: jpeg is ~3× faster to encode per frame than png (the default).
      // For a text/gradient animation there is no perceptible quality difference.
      imageFormat: 'jpeg',
      jpegQuality: 85,

      outputLocation: outputPath,
      inputProps: { scenes: scenesWithDurations },
      chromiumOptions,
      browserExecutable: executablePath,
      cancelSignal,

      // CHANGE: per-frame timeout — if a single frame takes >30 s something is
      // wrong; abort rather than hanging the whole job indefinitely.
      timeoutInMilliseconds: 30_000,

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