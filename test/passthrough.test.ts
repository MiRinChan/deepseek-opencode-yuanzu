import assert from "node:assert/strict"
import test from "node:test"

import { createAnchorHooks } from "../src/index.js"
import {
  claudeModel,
  dependencies,
  flashModel,
  fullCatalog,
  gptModel,
  sendChatMessage,
  targetModel,
  transformRequest,
} from "./helpers.js"

for (const [name, model] of [
  ["GPT", gptModel],
  ["Claude", claudeModel],
  ["DeepSeek V4 Flash", flashModel],
] as const) {
  test(`${name} request is a model-visible no-op`, async () => {
    const hooks = createAnchorHooks(undefined, dependencies())
    const tools = fullCatalog()
    const originalTools = { ...tools }
    const system = ["native system", "AGENTS"]

    await sendChatMessage(hooks, `session-${name}`, model)
    await transformRequest(hooks, `session-${name}`, model, system, tools)

    assert.deepEqual(system, ["native system", "AGENTS"])
    assert.deepEqual(tools, originalTools)
  })
}

test("disabled plugin registers no hooks", () => {
  assert.deepEqual(createAnchorHooks({ enabled: false }, dependencies()), {})
})

test("unpatched OpenCode has no separately registered system transform", () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  assert.equal(hooks["experimental.chat.system.transform"], undefined)
})

test("OpenCode auxiliary small-model requests are transparent", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  const system = ["native small-model system"]
  const tools = fullCatalog()
  await hooks["experimental.chat.request.transform"]?.(
    {
      sessionID: "session-small",
      agent: "build",
      small: true,
      model: targetModel,
      provider: { source: "config", info: {} as never, options: {} },
      message: {} as never,
    },
    { system, tools },
  )
  assert.deepEqual(system, ["native small-model system"])
  assert.equal(Object.keys(tools).length, Object.keys(fullCatalog()).length)
})
