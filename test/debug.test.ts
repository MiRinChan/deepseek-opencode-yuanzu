import assert from "node:assert/strict"
import test from "node:test"

import { createAnchorHooks } from "../src/index.js"
import { dependencies, fullCatalog, sendChatMessage, targetModel, transformRequest } from "./helpers.js"

test("debug logging is control-safe and excludes prompts and tool arguments", async () => {
  const lines: string[] = []
  const hooks = createAnchorHooks({ debug: true }, { ...dependencies(), log: (line) => lines.push(line) })
  const sessionID = "session\nforged-line"

  await sendChatMessage(hooks, sessionID, targetModel)
  await transformRequest(hooks, sessionID, targetModel, ["PROMPT_SECRET"], fullCatalog())
  await hooks["tool.execute.before"]?.(
    { tool: "bash", sessionID, callID: "call-secret" },
    { args: { command: "ARGUMENT_SECRET" } },
  )

  assert.ok(lines.length > 0)
  assert.equal(lines.some((line) => line.includes("\n")), false)
  assert.equal(lines.some((line) => line.includes("PROMPT_SECRET")), false)
  assert.equal(lines.some((line) => line.includes("ARGUMENT_SECRET")), false)
  assert.equal(lines.some((line) => line.includes("call-secret")), false)
})
