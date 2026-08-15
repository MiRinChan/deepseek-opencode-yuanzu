import assert from "node:assert/strict"
import test from "node:test"

import {
  createAnchorHooks,
  MINIMAL_BASH_DESCRIPTION,
  MINIMAL_BASH_SCHEMA,
  MINIMAL_PERSONA,
  STR_REPLACE_EDITOR_DESCRIPTION,
  STR_REPLACE_EDITOR_SCHEMA,
} from "../src/index.js"
import { dependencies, fullCatalog, sendChatMessage, targetModel, transformRequest } from "./helpers.js"

test("bootstrap exposes the current Harness Minimal tool catalog and schemas", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  const tools = fullCatalog()
  const bash = tools.bash
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

  assert.deepEqual(Object.keys(tools).sort(), ["bash", "str_replace_editor"])
  assert.notEqual(tools.bash, bash)
  assert.equal(tools.bash?.execute, bash?.execute)
  assert.equal((tools.bash as { description?: string }).description, MINIMAL_BASH_DESCRIPTION)
  assert.deepEqual((tools.bash as { inputSchema?: unknown }).inputSchema, MINIMAL_BASH_SCHEMA)
  const editor = (tools as Record<string, unknown>).str_replace_editor
  assert.ok(editor)
  assert.equal((editor as { description?: string }).description, STR_REPLACE_EDITOR_DESCRIPTION)
  assert.deepEqual((editor as { inputSchema?: unknown }).inputSchema, STR_REPLACE_EDITOR_SCHEMA)
  const schema = (editor as { inputSchema: { properties: { command: { enum: string[] } } } }).inputSchema
  assert.deepEqual(schema.properties.command.enum, ["view", "create", "str_replace", "insert"])
  assert.deepEqual(system, [MINIMAL_PERSONA])
})

test("bootstrap retains explicit user system content but removes automatic system scaffold", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  const tools = fullCatalog()
  const system = ["native persona\nAGENTS content\nskill catalog"]

  await sendChatMessage(hooks, "session-user-system", targetModel, "Explicit user-supplied system content")
  await transformRequest(
    hooks,
    "session-user-system",
    targetModel,
    system,
    tools,
    "Explicit user-supplied system content",
  )

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

test("bootstrap fails closed when permission filtering removed a required native tool", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  await assert.rejects(
    transformRequest(
      hooks,
      "session-missing-write",
      targetModel,
      ["native"],
      {
        bash: { execute: async () => ({}) },
        read: { execute: async () => ({}) },
        edit: { execute: async () => ({}) },
      },
    ),
    /cannot assemble Minimal bootstrap tools: str_replace_editor unavailable/,
  )
})
