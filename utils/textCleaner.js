function cleanText(rawText) {
  const maxChars = Number(process.env.SCRIPT_SOURCE_MAX_CHARS || 6000);
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

  // Keep source text bounded so script generation stays fast and within token budgets.
  if (cleaned.length > maxChars) {
    cleaned = cleaned.substring(0, maxChars) + '...';
  }

  return cleaned;
}

module.exports = { cleanText };
