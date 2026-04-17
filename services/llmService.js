const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateScript(cleanedText) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      {
        role: 'system',
        content: `You are a verbatim text splitter. Your ONLY job is to copy consecutive sentences from the provided text exactly as they appear — word for word — and split them into scenes for a video.

ABSOLUTE RULES:
1. COPY ONLY. Do NOT rephrase, summarize, explain, or add any word that is not in the source text.
2. Every scene's "text" field must be a direct, verbatim quote from the source document.
3. Do NOT add introductions, transitions, or closing remarks.
4. Do NOT hallucinate or invent any content.

Return ONLY valid raw JSON — no markdown fences, no extra text.
Schema:
{
  "title": "Short title extracted verbatim from the text (max 8 words)",
  "scenes": [
    {
      "scene": 1,
      "text": "Verbatim sentence(s) from the document",
      "visual": "title",
      "duration": 5
    },
    {
      "scene": 2,
      "text": "Verbatim sentence(s) from the document",
      "visual": "content",
      "duration": 8,
      "topic": "Short label (max 4 words) describing this excerpt",
      "emoji": "📄"
    }
  ]
}

Rules:
- Scene 1 must have visual = "title" — use the document title or first heading as its text.
- All other scenes must have visual = "content" with a "topic" label and "emoji".
- Each scene text: 20–40 words of consecutive verbatim sentences from the source.
- Duration formula: Math.ceil(wordCount / 2.2) + 2  (e.g. 20 words → 11s, 40 words → 20s)
- Title scene duration: 5 seconds. Minimum content scene duration: 8 seconds.
- Do NOT use *, #, or bullet characters in "text" fields.
- STRICT LIMIT: Maximum 5 scenes total.`
      },
      {
        role: 'user',
        content: `Split this document into verbatim scenes. Quote sentences exactly as written:\n\n${cleanedText}`
      }
    ],
    temperature: 0,      // zero temperature = deterministic, no creative drift
    max_tokens: 4000,
  });

  const raw = response.choices[0].message.content.trim();

  // Safely extract JSON even if the model adds stray text
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM returned invalid JSON: ' + raw.substring(0, 200));

  const script = JSON.parse(match[0]);

  if (!script.scenes || !Array.isArray(script.scenes) || script.scenes.length === 0) {
    throw new Error('LLM returned invalid script structure');
  }

  // Safety net: enforce minimum durations so audio is never cut off
  script.scenes = script.scenes.map((scene, i) => {
    if (i === 0) return { ...scene, duration: Math.max(scene.duration ?? 5, 5) };
    const wordCount = scene.text.trim().split(/\s+/).length;
    const minDuration = Math.ceil(wordCount / 2.2) + 2;
    return { ...scene, duration: Math.max(scene.duration ?? minDuration, minDuration) };
  });

  return script;
}

module.exports = { generateScript };