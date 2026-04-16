const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateScript(cleanedText) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      {
        role: 'system',
        content: `You are a video script writer. Given webpage content, create a deep, comprehensive educational video script that covers the document in its entirety. Do NOT skip information and do NOT summarize it as brief highlights. Every concept deserves its own detailed scene.

STRICT RULE: You MUST rely ONLY on the provided text. Do NOT hallucinate, invent, or add ANY outside facts that are not explicitly stated in the source document.

Return ONLY valid raw JSON — no markdown fences, no extra text, nothing else.
Schema:
{
  "title": "Short video title (max 8 words)",
  "scenes": [
    {
      "scene": 1,
      "text": "Narration text, max 40 words, clear and simple",
      "visual": "title",
      "duration": 5
    },
    {
      "scene": 2,
      "text": "Narration text, max 40 words, clear and simple",
      "visual": "content",
      "duration": 8,
      "topic": "Key Concept",
      "emoji": "💡"
    }
  ]
}

Rules:
- Scene 1 must have visual = "title" (it's the intro card)
- All other scenes must have visual = "content" and MUST include a "topic" (max 4 words) and a relevant "emoji"
- Each text should be between 30 and 65 words to provide deep explanations, rather than rapid bullet points — it will be spoken out loud
- IMPORTANT: Duration must be long enough for the text to be spoken at a natural pace.
  Use this formula: duration = Math.ceil(wordCount / 2.2) + 2
  Examples: 30 words = 16s, 40 words = 20s, 60 words = 29s
- Title scene duration: 5 seconds
- Minimum content scene duration: 12 seconds
- Do NOT use symbols like *, #, or bullet points in text
- Make it educational, conversational, and thorough
- COVER THE ENTIRE DOCUMENT — use as many scenes as needed (up to 30 scenes)`
      },
      {
        role: 'user',
        content: `Create a comprehensive video script covering ALL the key information in this document:\n\n${cleanedText}`
      }
    ],
    temperature: 0.6,
    max_tokens: 4000,
  });

  const raw = response.choices[0].message.content.trim();

  // Safely extract JSON even if model adds extra text
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM returned invalid JSON: ' + raw.substring(0, 200));

  const script = JSON.parse(match[0]);

  if (!script.scenes || !Array.isArray(script.scenes) || script.scenes.length === 0) {
    throw new Error('LLM returned invalid script structure');
  }

  // Safety net: enforce minimum durations based on word count
  // so audio never gets cut off regardless of what the LLM returned
  script.   scenes = script.scenes.map((scene, i) => {
    if (i === 0) return { ...scene, duration: Math.max(scene.duration, 5) }; // title
    const wordCount = scene.text.trim().split(/\s+/).length;
    const minDuration = Math.ceil(wordCount / 2.2) + 2;
    return { ...scene, duration: Math.max(scene.duration, minDuration) };
  });

  return script;
}

module.exports = { generateScript };
