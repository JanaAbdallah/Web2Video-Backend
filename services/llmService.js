/**
 * llmService.js  (OPTIMISED)
 *
 * Key changes vs original:
 *  1. Max scenes reduced: 5 total (1 title + 4 content) instead of 7.
 *     The render time scales linearly with scene count. 5 scenes → 50–70 s
 *     video, which renders in ~2–3 min. 7 scenes → 90 s video → 5–7 min render.
 *  2. Max video seconds reduced: 70 s (was 90 s). Keeps quality high while
 *     cutting render time by ~25%.
 *  3. Content scene word target lowered: 15–25 words (was 20–35). Shorter
 *     narration = shorter audio = fewer frames = faster render.
 *  4. Duration formula tightened so durations don't get inflated.
 *  5. System prompt trimmed to reduce first-token latency on Groq.
 *  6. `max_tokens` reduced from 3000 → 1500 (5 scenes × 100 tokens is plenty).
 */

const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MAX_SCENES = 5;           // 1 title + 4 content  (was 7)
const MAX_VIDEO_SECONDS = 70;   // hard cap in seconds   (was 90)

async function generateScript(cleanedText) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      {
        role: 'system',
        content: `You are a verbatim documentation splitter. Copy sentences from the provided text exactly as written and split them into scenes for a short video.

RULES (non-negotiable):
1. COPY ONLY — never rephrase, summarise, or add any word not in the source.
2. Every "text" field must be a direct verbatim quote from the source.
3. No introductions, transitions, conclusions, or added commentary.
4. No *, #, bullets, markdown, or formatting in any "text" field.

LIMITS:
- Maximum ${MAX_SCENES} scenes total (scene 1 = title, scenes 2–${MAX_SCENES} = content).
- Each content scene: 15–25 verbatim words.
- Title scene duration: exactly 5 seconds.
- Content scene duration = Math.ceil(wordCount / 2.5) + 1 (e.g. 15 words → 7 s).
- TOTAL of all durations MUST NOT exceed ${MAX_VIDEO_SECONDS} seconds.

Return ONLY valid raw JSON, no markdown fences.

Schema:
{
  "title": "Short verbatim title (max 8 words)",
  "scenes": [
    { "scene": 1, "text": "Verbatim title from doc", "visual": "title", "duration": 5 },
    { "scene": 2, "text": "Verbatim 15-25 word excerpt", "visual": "content", "duration": 7, "topic": "Max 4 words", "emoji": "📄" }
  ]
}`
      },
      {
        role: 'user',
        content: `Split this into verbatim video scenes. Max ${MAX_SCENES} scenes, max ${MAX_VIDEO_SECONDS}s total:\n\n${cleanedText}`
      }
    ],
    temperature: 0,
    max_tokens: 1500,  // was 3000 — 5 scenes needs far less
  });

  const raw = response.choices[0].message.content.trim();

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM returned invalid JSON: ' + raw.substring(0, 200));

  const script = JSON.parse(match[0]);

  if (!script.scenes || !Array.isArray(script.scenes) || script.scenes.length === 0) {
    throw new Error('LLM returned invalid script structure');
  }

  // ── Post-processing: enforce all hard limits ──────────────────────────────

  // 1. Cap at MAX_SCENES
  if (script.scenes.length > MAX_SCENES) {
    script.scenes = script.scenes.slice(0, MAX_SCENES);
  }

  // 2. Enforce calculated durations per scene
  script.scenes = script.scenes.map((scene, i) => {
    if (i === 0) return { ...scene, duration: 5 }; // title always 5 s
    const wordCount = scene.text.trim().split(/\s+/).length;
    const calculated = Math.ceil(wordCount / 2.5) + 1;
    return { ...scene, duration: Math.max(scene.duration ?? calculated, calculated) };
  });

  // 3. Enforce total ≤ MAX_VIDEO_SECONDS — trim trailing scenes if needed
  let total = 0;
  const trimmedScenes = [];
  for (const scene of script.scenes) {
    if (total + scene.duration > MAX_VIDEO_SECONDS) break;
    trimmedScenes.push(scene);
    total += scene.duration;
  }

  // Always keep at least title + 1 content scene
  if (trimmedScenes.length < 2 && script.scenes.length >= 2) {
    trimmedScenes.push(script.scenes[1]);
  }

  script.scenes = trimmedScenes;

  console.log(
    `📋 Script: "${script.title}" — ${script.scenes.length} scenes — ` +
    `~${script.scenes.reduce((s, sc) => s + sc.duration, 0)}s total`
  );

  return script;
}

module.exports = { generateScript };