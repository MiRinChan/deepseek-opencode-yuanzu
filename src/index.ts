import type {
  Hooks,
  Plugin,
  PluginInput,
  PluginOptions,
  ProviderContext,
} from "@opencode-ai/plugin"
import type { Model, UserMessage } from "@opencode-ai/sdk"

import { parseConfig } from "./config.js"
import { createModelMatcher, type ModelRef } from "./matcher.js"
import { prefixMinimalPersona, replaceWithBootstrapSystem } from "./prompt.js"
import {
  SessionState,
  type AnchorEvent,
  type HistoryMessage,
  type Phase,
  type PromotionSignal,
} from "./state.js"

export { DEFAULT_CONFIG, parseConfig } from "./config.js"
export type { AnchorConfig, PersonaAfterPromotion, PromoteOn } from "./config.js"
export { createModelMatcher, isDeepSeekV4Pro, normalizeModelID } from "./matcher.js"
export type { ModelRef } from "./matcher.js"
export { MINIMAL_PERSONA } from "./prompt.js"
export type { Phase } from "./state.js"

type ToolCatalog = Record<string, unknown>

export interface RequestTransformInput {
  sessionID: string
  agent: string
  model: Model
  provider: ProviderContext
  message: UserMessage
}

export interface RequestTransformOutput {
  system: string[]
  tools: ToolCatalog
}

export type AnchorHooks = Hooks & {
  "experimental.chat.request.transform"?: (
    input: RequestTransformInput,
    output: RequestTransformOutput,
  ) => Promise<void>
}

export interface AnchorDependencies {
  loadHistory(sessionID: string): Promise<HistoryMessage[]>
  log?(line: string): void
}

function modelRef(model: Model): ModelRef {
  return { providerID: model.providerID, modelID: model.id }
}

function logToken(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "?").slice(0, 120)
}

export function createAnchorHooks(
  rawOptions: PluginOptions | undefined,
  dependencies: AnchorDependencies,
): AnchorHooks {
  const config = parseConfig(rawOptions)
  const matches = createModelMatcher(config.models)
  const logger = dependencies.log ?? console.error
  const debug = (message: string): void => {
    if (config.debug) logger(`[dsv4-anchor] ${message}`)
  }

  const state = new SessionState({
    loadHistory: dependencies.loadHistory,
    matches,
    promoteOn: config.promoteOn,
    onPromotion(sessionID: string, signal: PromotionSignal) {
      debug(`session=${logToken(sessionID)} promotion signal=${signal}`)
      debug(`session=${logToken(sessionID)} phase=promoted`)
    },
    onHistoryUnavailable(sessionID: string) {
      debug(`session=${logToken(sessionID)} history=unavailable fallback=process-memory`)
    },
  })

  if (!config.enabled) return {}

  const hooks: AnchorHooks = {
    async "chat.message"(input, output) {
      if (!input.model) return
      const model = { providerID: input.model.providerID, modelID: input.model.modelID }
      const phase = await state.beginRequest(input.sessionID, model, output.message.system)
      if (phase !== "normal") {
        debug(`session=${logToken(input.sessionID)} model=${logToken(model.modelID)} phase=${phase}`)
      }
    },

    async "experimental.chat.request.transform"(input, output) {
      const model = modelRef(input.model)
      const phase = await state.beginRequest(input.sessionID, model, input.message.system)
      if (phase === "normal") return

      debug(`session=${logToken(input.sessionID)} model=${logToken(model.modelID)} phase=${phase}`)
      if (phase === "bootstrap") {
        replaceWithBootstrapSystem(output.system, state.explicitUserSystem(input.sessionID))
      } else if (config.personaAfterPromotion === "minimal") {
        prefixMinimalPersona(output.system)
      }

      if (phase === "bootstrap") {
        const allowed = new Set(config.bootstrapTools)
        for (const toolID of Object.keys(output.tools)) {
          if (!allowed.has(toolID)) delete output.tools[toolID]
        }
        const visible = Object.keys(output.tools).sort()
        const missing = config.bootstrapTools.filter((toolID) => !(toolID in output.tools))
        debug(
          `session=${logToken(input.sessionID)} request tools=${visible.map(logToken).join(",") || "<none>"}`,
        )
        if (missing.length > 0) {
          debug(`session=${logToken(input.sessionID)} request missing=${missing.map(logToken).join(",")}`)
        }
        return
      }

      debug(`session=${logToken(input.sessionID)} request tools=<full:${Object.keys(output.tools).length}>`)
    },

    async "tool.execute.before"(input) {
      state.promote(input.sessionID, "tool-call")
    },

    async event({ event }) {
      state.observeEvent(event as AnchorEvent)
    },

    async dispose() {
      state.clear()
    },
  }

  return hooks
}

function historyLoader(input: PluginInput): (sessionID: string) => Promise<HistoryMessage[]> {
  return async (sessionID) => {
    const response = await input.client.session.messages({
      path: { id: sessionID },
      query: { directory: input.directory },
    })
    if (response.error) throw new Error("OpenCode session history request failed")
    return (response.data ?? []) as HistoryMessage[]
  }
}

export const DeepSeekV4Anchor: Plugin = async (input, options) =>
  createAnchorHooks(options, { loadHistory: historyLoader(input) })

export default DeepSeekV4Anchor
