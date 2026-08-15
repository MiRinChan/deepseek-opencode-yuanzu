import type { PluginOptions } from "@opencode-ai/plugin"

export type PersonaAfterPromotion = "minimal" | "original"
export type PromoteOn = "either" | "tool-call" | "assistant-message"

export interface AnchorConfig {
  enabled: boolean
  models: string[]
  bootstrapTools: string[]
  personaAfterPromotion: PersonaAfterPromotion
  promoteOn: PromoteOn
  debug: boolean
}

export const DEFAULT_CONFIG: Readonly<AnchorConfig> = Object.freeze({
  enabled: true,
  models: ["deepseek-v4-pro"],
  bootstrapTools: ["bash", "str_replace_editor"],
  personaAfterPromotion: "minimal",
  promoteOn: "either",
  debug: false,
})

function booleanOption(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== "boolean") throw new TypeError(`[dsv4-anchor] ${name} must be a boolean`)
  return value
}

function stringArrayOption(value: unknown, fallback: readonly string[], name: string): string[] {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new TypeError(`[dsv4-anchor] ${name} must be an array of non-empty strings`)
  }
  return [...new Set(value.map((item) => item.trim()))]
}

function enumOption<T extends string>(
  value: unknown,
  fallback: T,
  allowed: readonly T[],
  name: string,
): T {
  if (value === undefined) return fallback
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`[dsv4-anchor] ${name} must be one of ${allowed.join(", ")}`)
  }
  return value as T
}

export function parseConfig(options: PluginOptions | undefined): AnchorConfig {
  const input = options ?? {}
  const bootstrapTools = stringArrayOption(input.bootstrapTools, DEFAULT_CONFIG.bootstrapTools, "bootstrapTools")
  if (bootstrapTools.length === 0) {
    throw new TypeError("[dsv4-anchor] bootstrapTools must contain at least one tool ID")
  }

  return {
    enabled: booleanOption(input.enabled, DEFAULT_CONFIG.enabled, "enabled"),
    models: stringArrayOption(input.models, DEFAULT_CONFIG.models, "models"),
    bootstrapTools,
    personaAfterPromotion: enumOption(
      input.personaAfterPromotion,
      DEFAULT_CONFIG.personaAfterPromotion,
      ["minimal", "original"],
      "personaAfterPromotion",
    ),
    promoteOn: enumOption(
      input.promoteOn,
      DEFAULT_CONFIG.promoteOn,
      ["either", "tool-call", "assistant-message"],
      "promoteOn",
    ),
    debug: booleanOption(input.debug, DEFAULT_CONFIG.debug, "debug"),
  }
}
