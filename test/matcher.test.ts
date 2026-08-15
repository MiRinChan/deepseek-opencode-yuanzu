import assert from "node:assert/strict"
import test from "node:test"

import { createModelMatcher, isDeepSeekV4Pro, normalizeModelID } from "../src/matcher.js"

test("normalizes common provider model spellings", () => {
  assert.equal(normalizeModelID("  DeepSeek_V4.1_Pro  "), "deepseek-v4-1-pro")
  assert.equal(normalizeModelID("deepseek//DeepSeek-V4-Pro"), "deepseek/deepseek-v4-pro")
})

test("built-in matcher accepts DeepSeek V4 Pro aliases across providers", () => {
  const matches = [
    { providerID: "deepseek", modelID: "deepseek-v4-pro" },
    { providerID: "openrouter", modelID: "deepseek/deepseek-v4-pro" },
    { providerID: "gateway", modelID: "DeepSeek-V4-Pro" },
    { providerID: "deepseek", modelID: "v4-pro" },
    { providerID: "volcengine", modelID: "deepseek-v4.1-pro" },
  ]
  for (const model of matches) assert.equal(isDeepSeekV4Pro(model), true, JSON.stringify(model))
})

test("built-in matcher does not hit adjacent DeepSeek families", () => {
  const misses = [
    { providerID: "deepseek", modelID: "deepseek-v4-flash" },
    { providerID: "deepseek", modelID: "deepseek-v3-pro" },
    { providerID: "deepseek", modelID: "deepseek-r1" },
    { providerID: "other", modelID: "v4-pro" },
    { providerID: "deepseek", modelID: "deepseek-v4" },
  ]
  for (const model of misses) assert.equal(isDeepSeekV4Pro(model), false, JSON.stringify(model))
})

test("additional exact, glob, and regex patterns are opt-in", () => {
  const matcher = createModelMatcher(["custom-anchor", "glob:lab-*-pro", "regex:^vendor/.+-anchor$"])
  assert.equal(matcher({ providerID: "any", modelID: "custom-anchor" }), true)
  assert.equal(matcher({ providerID: "any", modelID: "lab-v5-pro" }), true)
  assert.equal(matcher({ providerID: "vendor", modelID: "next-anchor" }), true)
  assert.equal(matcher({ providerID: "vendor", modelID: "next-flash" }), false)
})

test("invalid regex is rejected during matcher creation", () => {
  assert.throws(() => createModelMatcher(["regex:["]), /Invalid regular expression/)
})
