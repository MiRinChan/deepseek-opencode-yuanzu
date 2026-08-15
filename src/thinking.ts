export const DEFAULT_THINKING_REPLACEMENTS: readonly string[] = ["I will", "We will", "Let's"]

export interface ThinkingRewriteOptions {
  replacements?: readonly string[]
  random?: () => number
}

/**
 * Replace every case-insensitive word-boundary "Let me" in a thinking chain
 * with a randomly chosen replacement. A lowercase "let me" keeps the leading
 * character lowercased so mid-sentence text stays in case.
 */
export function rewriteThinkingText(text: string, options: ThinkingRewriteOptions = {}): string {
  const replacements = options.replacements ?? DEFAULT_THINKING_REPLACEMENTS
  if (replacements.length === 0) return text
  const random = options.random ?? Math.random
  return text.replace(/\blet me\b/gi, (match) => {
    const choice = replacements[Math.min(replacements.length - 1, Math.floor(random() * replacements.length))]
    if (choice === undefined) return match
    const code = match.charCodeAt(0)
    const lowercased = code >= 0x61 && code <= 0x7a
    return lowercased ? choice.charAt(0).toLowerCase() + choice.slice(1) : choice
  })
}
