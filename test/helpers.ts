import type { Model, UserMessage } from "@opencode-ai/sdk"

import type { AnchorHooks, RequestTransformInput } from "../src/index.js"
import type { HistoryMessage } from "../src/state.js"

export const targetModel = {
  providerID: "gateway-a",
  id: "deepseek/deepseek-v4-pro",
} as unknown as Model

export const gptModel = { providerID: "openai", id: "gpt-5.4" } as unknown as Model
export const claudeModel = { providerID: "anthropic", id: "claude-sonnet-4-6" } as unknown as Model
export const flashModel = { providerID: "deepseek", id: "deepseek-v4-flash" } as unknown as Model

export function dependencies(history: Record<string, HistoryMessage[]> = {}) {
  return {
    loadHistory: async (sessionID: string) => history[sessionID] ?? [],
  }
}

export async function sendChatMessage(
  hooks: AnchorHooks,
  sessionID: string,
  model: Model,
  system?: string,
): Promise<void> {
  await hooks["chat.message"]?.(
    {
      sessionID,
      model: { providerID: model.providerID, modelID: model.id },
    },
    {
      message: { system } as unknown as UserMessage,
      parts: [],
    },
  )
}

export async function transformRequest(
  hooks: AnchorHooks,
  sessionID: string,
  model: Model,
  system: string[],
  tools: Record<string, unknown>,
  userSystem?: string,
): Promise<void> {
  await hooks["experimental.chat.request.transform"]?.(
    {
      sessionID,
      agent: "build",
      model,
      provider: {
        source: "config",
        info: { id: model.providerID } as RequestTransformInput["provider"]["info"],
        options: {},
      },
      message: {
        sessionID,
        role: "user",
        model: { providerID: model.providerID, modelID: model.id },
        ...(userSystem === undefined ? {} : { system: userSystem }),
      } as unknown as UserMessage,
    },
    { system, tools },
  )
}

export function fullCatalog(): Record<string, { marker: string; execute?: (args: unknown, context: unknown) => unknown }> {
  const execute = async () => ({ title: "ok", output: "ok", metadata: {} })
  return {
    apply_patch: { marker: "apply_patch-definition", execute },
    bash: { marker: "bash-definition", execute },
    edit: { marker: "edit-definition", execute },
    read: { marker: "read-definition", execute },
    web_search: { marker: "web-definition", execute },
    write: { marker: "write-definition", execute },
  }
}
