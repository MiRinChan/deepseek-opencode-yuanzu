import assert from "node:assert/strict"
import test from "node:test"

test("plugin entry exposes only the default OpenCode plugin function", async () => {
  const entry = await import("../src/plugin-entry.js")

  assert.deepEqual(Object.keys(entry), ["default"])
  assert.equal(typeof entry.default, "function")
})
