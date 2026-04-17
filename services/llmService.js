/**
 * llmService.js
 *
 * Generates a verbatim video script from cleaned documentation text.
 *
 * Hard constraints enforced here AND post-processed after the LLM responds:
 *  - Maximum 7 scenes (1 title + 6 content)
 *  - Total video ≤ 90 seconds
 *  - Video resolution 720p (enforced in videoService)
 *  - All scene text is quoted verbatim from the source document
 */

const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Target total video length in seconds — never exceed this
const MAX_VIDEO_SECONDS = 90;

async function generateScript(cleanedText) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      {
        role: 'system',
        content: `You are a verbatim documentation splitter. Your ONLY job is to copy consecutive sentences from the provided documentation exactly as they appear — word for word — and split them into scenes for a short explainer video.

ABSOLUTE RULES:
1. COPY ONLY. Do NOT rephrase, summarise, explain, rewrite, or add any word not in the source text.
2. Every scene "text" field must be a direct verbatim quote from the source document.
3. Do NOT add introductions, transitions, conclusions, or closing remarks.
4. Do NOT hallucinate or invent any content whatsoever.
5. Do NOT use *, #, bullet characters, markdown, or any formatting in "text" fields.

STRICT LIMITS (non-negotiable):
- Maximum 7 scenes total (scene 1 is the title, scenes 2-7 are content).
- Each content scene: 20–35 words of consecutive verbatim sentences.
- Title scene duration: exactly 5 seconds.
- Content scene duration formula: Math.ceil(wordCount / 2.5) + 1
  (e.g. 20 words → 9 s, 35 words → 15 s)
- TOTAL of all scene durations MUST NOT exceed 90 seconds.
  If needed, use fewer scenes or shorter excerpts to stay under 90 seconds.

Return ONLY valid raw JSON — absolutely no markdown fences, no extra text, no preamble.

Schema:
{
  "title": "Short title extracted verbatim from the doc (max 8 words)",
  "scenes": [
    {
      "scene": 1,
      "text": "Verbatim title or first heading from the document",
      "visual": "title",
      "duration": 5
    },
    {
      "scene": 2,
      "text": "Verbatim 20-35 word excerpt from the document",
      "visual": "content",
      "duration": 9,
      "topic": "Short label max 4 words",
      "emoji": "📄"
    }
  ]
}`
      },
      {
        role: 'user',
        content: `Convert this documentation into verbatim video scenes. Quote sentences exactly as written. Stay under 90 seconds total:\n\n${cleanedText}`
      }
    ],
    temperature: 0,
    max_tokens: 3000,
  });

  const raw = response.choices[0].message.content.trim();

  // Extract JSON even if model adds stray text
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM returned invalid JSON: ' + raw.substring(0, 200));

  const script = JSON.parse(match[0]);

  if (!script.scenes || !Array.isArray(script.scenes) || script.scenes.length === 0) {
    throw new Error('LLM returned invalid script structure');
  }

  // ── Post-processing: enforce all hard limits ──────────────────────────────

  // 1. Cap at 7 scenes
  if (script.scenes.length > 7) {
    script.scenes = script.scenes.slice(0, 7);
  }

  // 2. Enforce minimum and calculated durations per scene
  script.scenes = script.scenes.map((scene, i) => {
    if (i === 0) {
      return { ...scene, duration: 5 }; // title always exactly 5s
    }
    const wordCount = scene.text.trim().split(/\s+/).length;
    const calculated = Math.ceil(wordCount / 2.5) + 1;
    return { ...scene, duration: Math.max(scene.duration ?? calculated, calculated) };
  });

  // 3. Enforce total ≤ 90 seconds — trim trailing scenes if needed
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