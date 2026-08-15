import assert from "node:assert/strict"
import test from "node:test"

import { createAnchorHooks, MINIMAL_PERSONA } from "../src/index.js"
import { dependencies, fullCatalog, sendChatMessage, targetModel, transformRequest } from "./helpers.js"

test("bootstrap exposes exactly native bash and read definitions", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  const tools = fullCatalog()
  const bash = tools.bash
  const read = tools.read
  const system = ["OpenCode native agent prompt", "workspace instructions"]

  await sendChatMessage(hooks, "session-bootstrap", targetModel)
  await hooks["experimental.chat.request.transform"]?.(
    {
      sessionID: "session-bootstrap",
      agent: "build",
      model: targetModel,
      provider: { source: "config", info: {} as never, options: {} },
      message: {} as never,
    },
    { system, tools },
  )

  assert.deepEqual(Object.keys(tools).sort(), ["bash", "read"])
  assert.equal(tools.bash, bash)
  assert.equal(tools.read, read)
  assert.deepEqual(system, [MINIMAL_PERSONA])
})

test("bootstrap retains explicit user system content but removes automatic system scaffold", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  const tools = fullCatalog()
  const system = ["native persona\nAGENTS content\nskill catalog"]

  await sendChatMessage(hooks, "session-user-system", targetModel, "Explicit user-supplied system content")
  await transformRequest(hooks, "session-user-system", targetModel, system, tools)

  assert.deepEqual(system, [MINIMAL_PERSONA, "Explicit user-supplied system content"])
})

test("bootstrap tool IDs are configurable without manufacturing unavailable tools", async () => {
  const hooks = createAnchorHooks({ bootstrapTools: ["shell", "read"] }, dependencies())
  const tools = { shell: { real: true }, read: { real: true }, edit: { real: true } }
  await sendChatMessage(hooks, "session-custom-tools", targetModel)
  await transformRequest(hooks, "session-custom-tools", targetModel, ["native"], tools)
  assert.deepEqual(Object.keys(tools).sort(), ["read", "shell"])
})

test("invalid configuration fails at plugin initialization", () => {
  assert.throws(() => createAnchorHooks({ promoteOn: "later" }, dependencies()), /promoteOn/)
  assert.throws(() => createAnchorHooks({ bootstrapTools: [] }, dependencies()), /bootstrapTools/)
})
