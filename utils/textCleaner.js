function cleanText(rawText) {
  let cleaned = rawText
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')          // collapse spaces
    .replace(/\n{3,}/g, '\n\n')        // max 2 newlines
    .replace(/https?:\/\/\S+/g, '')    // remove URLs
    .trim();

  // Remove common non-content phrases
  const noise = [
    /accept (all )?cookies?/gi,
    /privacy policy/gi,
    /terms of (service|use)/gi,
    /sign (in|up|out)/gi,
    /log(in| in|out| out)/gi,
    /subscribe (now|today)?/gi,
  ];
  noise.forEach(pattern => { cleaned = cleaned.replace(pattern, ''); });

  // Raised from 4000 → 12000 chars so full-page documents aren't truncated.
  // Groq's llama-3.3-70b supports a large context window, so this is safe.
  if (cleaned.length > 12000) {
    cleaned = cleaned.substring(0, 12000) + '...';
  }

  return cleaned;
}

module.exports = { cleanText };