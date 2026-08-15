import type { PromoteOn } from "./config.js"
import type { ModelRef } from "./matcher.js"

export type Phase = "bootstrap" | "promoted"
export type RequestPhase = Phase | "normal"
export type PromotionSignal = "tool-call" | "assistant-message"

export interface HistoryInfo {
  id: string
  sessionID: string
  role: "user" | "assistant"
  model?: { providerID: string; modelID: string }
  providerID?: string
  modelID?: string
  system?: string
  time?: { completed?: number }
}

export interface HistoryPart {
  type: string
  messageID: string
}

export interface HistoryMessage {
  info: HistoryInfo
  parts: HistoryPart[]
}

export interface AnchorEvent {
  type: string
  properties: Record<string, unknown>
}

interface Entry {
  phase: Phase
  activeTarget: boolean
  hydrated: boolean
  hydration?: Promise<void>
  explicitUserSystem?: string
}

export interface StateDependencies {
  loadHistory(sessionID: string): Promise<HistoryMessage[]>
  matches(model: ModelRef): boolean
  promoteOn: PromoteOn
  onPromotion?(sessionID: string, signal: PromotionSignal): void
  onHistoryUnavailable?(sessionID: string): void
}

function modelFromInfo(info: HistoryInfo): ModelRef | undefined {
  if (info.model) return info.model
  if (info.providerID && info.modelID) return { providerID: info.providerID, modelID: info.modelID }
  return undefined
}

function signalEnabled(mode: PromoteOn, signal: PromotionSignal): boolean {
  return mode === "either" || mode === signal
}

export class SessionState {
  readonly #entries = new Map<string, Entry>()
  readonly #assistantTargets = new Map<string, { sessionID: string; target: boolean }>()

  constructor(private readonly dependencies: StateDependencies) {}

  #entry(sessionID: string): Entry {
    const existing = this.#entries.get(sessionID)
    if (existing) return existing
    const created: Entry = { phase: "bootstrap", activeTarget: false, hydrated: false }
    this.#entries.set(sessionID, created)
    return created
  }

  async beginRequest(sessionID: string, model: ModelRef, explicitUserSystem?: string): Promise<RequestPhase> {
    const entry = this.#entry(sessionID)
    entry.activeTarget = this.dependencies.matches(model)
    if (explicitUserSystem !== undefined) entry.explicitUserSystem = explicitUserSystem
    if (!entry.activeTarget) return "normal"
    await this.#hydrate(sessionID, entry)
    return entry.phase
  }

  explicitUserSystem(sessionID: string): string | undefined {
    return this.#entries.get(sessionID)?.explicitUserSystem
  }

  promote(sessionID: string, signal: PromotionSignal): boolean {
    if (!signalEnabled(this.dependencies.promoteOn, signal)) return false
    const entry = this.#entries.get(sessionID)
    if (!entry?.activeTarget || entry.phase === "promoted") return false
    entry.phase = "promoted"
    this.#clearAssistantTargets(sessionID)
    this.dependencies.onPromotion?.(sessionID, signal)
    return true
  }

  observeEvent(event: AnchorEvent): void {
    if (event.type === "session.deleted") {
      const info = event.properties.info as { id?: string } | undefined
      const sessionID = (event.properties.sessionID as string | undefined) ?? info?.id
      if (sessionID) {
        this.#entries.delete(sessionID)
        this.#clearAssistantTargets(sessionID)
      }
      return
    }

    if (event.type === "message.updated") {
      const info = event.properties.info as HistoryInfo | undefined
      if (!info || info.role !== "assistant") return
      const model = modelFromInfo(info)
      const target = model ? this.dependencies.matches(model) : false
      if (!target) return
      const entry = this.#entry(info.sessionID)
      if (entry.phase === "promoted") return
      entry.activeTarget = true
      this.#assistantTargets.set(info.id, { sessionID: info.sessionID, target: true })
      if (info.time?.completed !== undefined && !this.promote(info.sessionID, "assistant-message")) {
        this.#assistantTargets.delete(info.id)
      }
      return
    }

    if (event.type === "message.part.updated") {
      const part = event.properties.part as (HistoryPart & { sessionID?: string }) | undefined
      if (!part?.sessionID || part.type !== "tool") return
      const assistant = this.#assistantTargets.get(part.messageID)
      if (!assistant?.target || assistant.sessionID !== part.sessionID) return
      const entry = this.#entry(part.sessionID)
      entry.activeTarget = true
      this.promote(part.sessionID, "tool-call")
    }
  }

  clear(): void {
    this.#entries.clear()
    this.#assistantTargets.clear()
  }

  #clearAssistantTargets(sessionID: string): void {
    for (const [messageID, assistant] of this.#assistantTargets) {
      if (assistant.sessionID === sessionID) this.#assistantTargets.delete(messageID)
    }
  }

  async #hydrate(sessionID: string, entry: Entry): Promise<void> {
    if (entry.hydrated) return
    if (!entry.hydration) {
      entry.hydration = this.#load(sessionID, entry)
        .then((loaded) => {
          entry.hydrated = loaded
        })
        .finally(() => {
          delete entry.hydration
        })
    }
    await entry.hydration
  }

  async #load(sessionID: string, entry: Entry): Promise<boolean> {
    let messages: HistoryMessage[]
    try {
      messages = await this.dependencies.loadHistory(sessionID)
    } catch {
      this.dependencies.onHistoryUnavailable?.(sessionID)
      return false
    }

    const targetAssistants = new Set<string>()
    for (const message of messages) {
      const info = message.info
      if (info.role === "user" && info.system !== undefined) entry.explicitUserSystem = info.system
      if (info.role !== "assistant") continue
      const model = modelFromInfo(info)
      const target = model ? this.dependencies.matches(model) : false
      if (!target) continue
      targetAssistants.add(info.id)
      if (info.time?.completed !== undefined && signalEnabled(this.dependencies.promoteOn, "assistant-message")) {
        entry.phase = "promoted"
      }
    }

    if (
      signalEnabled(this.dependencies.promoteOn, "tool-call") &&
      messages.some((message) =>
        message.parts.some((part) => part.type === "tool" && targetAssistants.has(part.messageID)),
      )
    ) {
      entry.phase = "promoted"
    }
    return true
  }
}
