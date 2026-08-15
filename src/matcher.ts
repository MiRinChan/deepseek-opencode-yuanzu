export interface ModelRef {
  providerID: string
  modelID: string
}

const BUILTIN_DEEPSEEK_V4_PRO = /^deepseek(?:-|\/)v4(?:-1)?-pro$/

export function normalizeModelID(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._\s:]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "")
}

function rawCandidates(model: ModelRef): string[] {
  const modelID = model.modelID.trim()
  const providerID = model.providerID.trim()
  const leaf = modelID.split("/").at(-1) ?? modelID
  return [...new Set([modelID, leaf, `${providerID}/${modelID}`])]
}

function normalizedCandidates(model: ModelRef): string[] {
  return rawCandidates(model).map(normalizeModelID)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function customPatternMatches(pattern: string, model: ModelRef): boolean {
  if (pattern.startsWith("regex:")) {
    const source = pattern.slice("regex:".length)
    if (!source) throw new TypeError("[dsv4-anchor] regex model pattern cannot be empty")
    const expression = new RegExp(source, "i")
    return rawCandidates(model).some((candidate) => expression.test(candidate))
  }

  const normalizedPattern = normalizeModelID(pattern.startsWith("glob:") ? pattern.slice("glob:".length) : pattern)
  if (!normalizedPattern) throw new TypeError("[dsv4-anchor] model pattern cannot be empty")
  const candidates = normalizedCandidates(model)
  if (!normalizedPattern.includes("*") && !normalizedPattern.includes("?")) {
    return candidates.includes(normalizedPattern)
  }

  const source = escapeRegex(normalizedPattern).replace(/\\\*/g, ".*").replace(/\\\?/g, ".")
  const expression = new RegExp(`^${source}$`)
  return candidates.some((candidate) => expression.test(candidate))
}

export function isDeepSeekV4Pro(model: ModelRef): boolean {
  return normalizedCandidates(model).some((candidate) => BUILTIN_DEEPSEEK_V4_PRO.test(candidate))
}

export function createModelMatcher(additionalPatterns: readonly string[]): (model: ModelRef) => boolean {
  // Compile/validate regex patterns during plugin initialization, not halfway
  // through a live request.
  for (const pattern of additionalPatterns) {
    if (pattern.startsWith("regex:")) void customPatternMatches(pattern, { providerID: "", modelID: "validation" })
  }
  return (model) => isDeepSeekV4Pro(model) || additionalPatterns.some((pattern) => customPatternMatches(pattern, model))
}
