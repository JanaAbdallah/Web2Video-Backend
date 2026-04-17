/**
 * textCleaner.js
 *
 * Cleans raw page text extracted from documentation pages.
 * Removes UI chrome noise and normalises whitespace.
 * Keeps a generous char budget so the LLM has enough context to
 * build a faithful verbatim script from the full document.
 */

function cleanText(rawText) {
  // Allow up to ~8 000 chars of source material.
  // At ~5 chars/word that's ~1 600 words — plenty for a 90-second video
  // while staying well within LLM context budgets.
  const maxChars = Number(process.env.SCRIPT_SOURCE_MAX_CHARS || 8000);

  let cleaned = rawText
    // Normalise whitespace
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    // Strip URLs
    .replace(/https?:\/\/\S+/g, '')
    // Strip email addresses
    .replace(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi, '')
    // Strip lone numbers that are just line numbers / page counters
    .replace(/^\s*\d+\s*$/gm, '')
    .trim();

  // Remove common website-chrome / cookie-banner phrases
  const noisePatterns = [
    /accept\s+(all\s+)?cookies?/gi,
    /privacy\s+policy/gi,
    /terms\s+of\s+(service|use)/gi,
    /sign\s+(in|up|out)/gi,
    /log\s*(in|out)/gi,
    /subscribe\s*(now|today|free)?/gi,
    /newsletter/gi,
    /cookie\s+(settings?|preferences?)/gi,
    /we\s+use\s+cookies/gi,
    /\bGDPR\b/gi,
    /all\s+rights\s+reserved/gi,
    /copyright\s+©?/gi,
    /skip\s+to\s+(main\s+)?content/gi,
    /table\s+of\s+contents/gi,
    /on\s+this\s+page/gi,
    /in\s+this\s+(article|section|doc)/gi,
    /\bTweet\b/gi,
    /\bShare\b/gi,
    /\bLike\b/gi,
  ];

  noisePatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });

  // Remove lines that look like navigation labels (very short, all-caps or title case single words)
  cleaned = cleaned
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (t.length === 0) return true;         // keep blank separators
      if (t.length < 4) return false;           // drop 1-3 char lines
      if (/^\W+$/.test(t)) return false;        // drop punctuation-only lines
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Cap length
  if (cleaned.length > maxChars) {
    // Try to cut at a sentence boundary near the limit
    const cutoff = cleaned.lastIndexOf('.', maxChars);
    cleaned = (cutoff > maxChars * 0.8 ? cleaned.substring(0, cutoff + 1) : cleaned.substring(0, maxChars)) + '…';
  }

  return cleaned;
}

module.exports = { cleanText };