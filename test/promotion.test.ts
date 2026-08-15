import assert from "node:assert/strict"
import test from "node:test"

import { createAnchorHooks, MINIMAL_PERSONA } from "../src/index.js"
import type { HistoryMessage } from "../src/state.js"
import {
  dependencies,
  fullCatalog,
  gptModel,
  sendChatMessage,
  targetModel,
  transformRequest,
} from "./helpers.js"

test("tool execution promotes before success or failure and request two gets full catalog", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  await sendChatMessage(hooks, "session-promotion", targetModel)

  const firstTools = fullCatalog()
  await transformRequest(hooks, "session-promotion", targetModel, ["native first"], firstTools)
  assert.deepEqual(Object.keys(firstTools).sort(), ["bash", "str_replace_editor"])

  await hooks["tool.execute.before"]?.(
    { tool: "bash", sessionID: "session-promotion", callID: "call-fails" },
    { args: { command: "false" } },
  )
  // No tool.execute.after: the simulated tool failed.

  const secondTools = fullCatalog()
  const secondSystem = ["native persona\nAGENTS\nskills"]
  await transformRequest(hooks, "session-promotion", targetModel, secondSystem, secondTools)
  assert.deepEqual(Object.keys(secondTools).sort(), Object.keys(fullCatalog()).sort())
  assert.match(secondSystem[0] ?? "", new RegExp(`^${MINIMAL_PERSONA.replaceAll(".", "\\.")}`))
  assert.match(secondSystem[0] ?? "", /AGENTS/)
})

test("personaAfterPromotion original preserves native promoted system", async () => {
  const hooks = createAnchorHooks({ personaAfterPromotion: "original" }, dependencies())
  await sendChatMessage(hooks, "session-original-persona", targetModel)
  await hooks["tool.execute.before"]?.(
    { tool: "read", sessionID: "session-original-persona", callID: "call-1" },
    { args: {} },
  )
  const system = ["native promoted system"]
  await transformRequest(hooks, "session-original-persona", targetModel, system, fullCatalog())
  assert.deepEqual(system, ["native promoted system"])
})

test("durable completed assistant message promotes text-only first response", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  await sendChatMessage(hooks, "session-text", targetModel)
  await hooks.event?.({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-1",
          sessionID: "session-text",
          role: "assistant",
          providerID: targetModel.providerID,
          modelID: targetModel.id,
          time: { completed: Date.now() },
        },
      },
    } as never,
  })

  const tools = fullCatalog()
  await transformRequest(hooks, "session-text", targetModel, ["native"], tools)
  assert.deepEqual(Object.keys(tools).sort(), Object.keys(fullCatalog()).sort())
})

test("live durable tool part promotes before tool execution", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  const sessionID = "session-live-tool"
  await sendChatMessage(hooks, sessionID, targetModel)
  await hooks.event?.({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-live-tool",
          sessionID,
          role: "assistant",
          providerID: targetModel.providerID,
          modelID: targetModel.id,
          time: { created: Date.now() },
        },
      },
    } as never,
  })
  await hooks.event?.({
    event: {
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          messageID: "assistant-live-tool",
          sessionID,
        },
      },
    } as never,
  })

  const tools = fullCatalog()
  await transformRequest(hooks, sessionID, targetModel, ["native"], tools)
  assert.equal(Object.keys(tools).length, Object.keys(fullCatalog()).length)
})

test("promoteOn tool-call keeps a text-only response in bootstrap", async () => {
  const hooks = createAnchorHooks({ promoteOn: "tool-call" }, dependencies())
  await sendChatMessage(hooks, "session-tool-only", targetModel)
  await hooks.event?.({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-2",
          sessionID: "session-tool-only",
          role: "assistant",
          providerID: targetModel.providerID,
          modelID: targetModel.id,
          time: { completed: Date.now() },
        },
      },
    } as never,
  })
  const tools = fullCatalog()
  await transformRequest(hooks, "session-tool-only", targetModel, ["native"], tools)
  assert.deepEqual(Object.keys(tools).sort(), ["bash", "str_replace_editor"])
})

test("promotion is isolated across concurrent sessions", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  await Promise.all([
    sendChatMessage(hooks, "session-a", targetModel),
    sendChatMessage(hooks, "session-b", targetModel),
  ])
  await hooks["tool.execute.before"]?.(
    { tool: "bash", sessionID: "session-a", callID: "call-a" },
    { args: {} },
  )

  const toolsA = fullCatalog()
  const toolsB = fullCatalog()
  await Promise.all([
    transformRequest(hooks, "session-a", targetModel, ["native-a"], toolsA),
    transformRequest(hooks, "session-b", targetModel, ["native-b"], toolsB),
  ])
  assert.equal(Object.keys(toolsA).length, Object.keys(fullCatalog()).length)
  assert.deepEqual(Object.keys(toolsB).sort(), ["bash", "str_replace_editor"])
})

test("durable target history recovers promotion after plugin restart", async () => {
  const history: HistoryMessage[] = [
    {
      info: {
        id: "assistant-durable",
        sessionID: "session-resume",
        role: "assistant",
        providerID: targetModel.providerID,
        modelID: targetModel.id,
      },
      parts: [{ type: "tool", messageID: "assistant-durable" }],
    },
  ]
  const hooks = createAnchorHooks(undefined, dependencies({ "session-resume": history }))
  await sendChatMessage(hooks, "session-resume", targetModel)
  const tools = fullCatalog()
  await transformRequest(hooks, "session-resume", targetModel, ["native"], tools)
  assert.equal(Object.keys(tools).length, Object.keys(fullCatalog()).length)
})

test("transient history failure is retried on the request hook", async () => {
  let attempts = 0
  const history: HistoryMessage[] = [
    {
      info: {
        id: "assistant-after-retry",
        sessionID: "session-history-retry",
        role: "assistant",
        providerID: targetModel.providerID,
        modelID: targetModel.id,
        time: { completed: 1 },
      },
      parts: [],
    },
  ]
  const hooks = createAnchorHooks(undefined, {
    async loadHistory() {
      attempts++
      if (attempts === 1) throw new Error("temporary history failure")
      return history
    },
  })

  await sendChatMessage(hooks, "session-history-retry", targetModel)
  const tools = fullCatalog()
  await transformRequest(hooks, "session-history-retry", targetModel, ["native"], tools)
  assert.equal(attempts, 2)
  assert.equal(Object.keys(tools).length, Object.keys(fullCatalog()).length)
})

test("session deletion prunes assistant routing state", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  const sessionID = "session-reused"
  await sendChatMessage(hooks, sessionID, targetModel)
  await hooks.event?.({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-before-delete",
          sessionID,
          role: "assistant",
          providerID: targetModel.providerID,
          modelID: targetModel.id,
          time: { created: 1 },
        },
      },
    } as never,
  })
  await hooks.event?.({
    event: { type: "session.deleted", properties: { info: { id: sessionID } } } as never,
  })
  await hooks.event?.({
    event: {
      type: "message.part.updated",
      properties: {
        part: { type: "tool", messageID: "assistant-before-delete", sessionID },
      },
    } as never,
  })

  await sendChatMessage(hooks, sessionID, targetModel)
  const tools = fullCatalog()
  await transformRequest(hooks, sessionID, targetModel, ["native"], tools)
  assert.deepEqual(Object.keys(tools).sort(), ["bash", "str_replace_editor"])
})

test("GPT history does not consume first DeepSeek bootstrap and switching back to GPT is transparent", async () => {
  const gptHistory: HistoryMessage[] = [
    {
      info: {
        id: "assistant-gpt",
        sessionID: "session-switch",
        role: "assistant",
        providerID: gptModel.providerID,
        modelID: gptModel.id,
        time: { completed: 1 },
      },
      parts: [],
    },
  ]
  const hooks = createAnchorHooks(undefined, dependencies({ "session-switch": gptHistory }))

  await sendChatMessage(hooks, "session-switch", targetModel)
  const deepseekTools = fullCatalog()
  await transformRequest(hooks, "session-switch", targetModel, ["native-deepseek"], deepseekTools)
  assert.deepEqual(Object.keys(deepseekTools).sort(), ["bash", "str_replace_editor"])

  await sendChatMessage(hooks, "session-switch", gptModel)
  const gptTools = fullCatalog()
  const gptSystem = ["native-gpt"]
  await transformRequest(hooks, "session-switch", gptModel, gptSystem, gptTools)
  assert.deepEqual(gptSystem, ["native-gpt"])
  assert.equal(Object.keys(gptTools).length, Object.keys(fullCatalog()).length)
})

test("a previous model's explicit system cannot leak into a DeepSeek bootstrap request", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  const sessionID = "session-system-switch"
  await sendChatMessage(hooks, sessionID, gptModel, "GPT-only system")
  await sendChatMessage(hooks, sessionID, targetModel)

  const system = ["OpenCode native prompt"]
  await transformRequest(hooks, sessionID, targetModel, system, fullCatalog())
  assert.deepEqual(system, [MINIMAL_PERSONA])
})
