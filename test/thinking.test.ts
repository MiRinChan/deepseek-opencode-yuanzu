import assert from "node:assert/strict"
import test from "node:test"

import type { Message, Part } from "@opencode-ai/sdk"

import { createAnchorHooks, rewriteThinkingText } from "../src/index.js"
import { dependencies, flashModel, gptModel, targetModel } from "./helpers.js"

function constantRandom(value: number): () => number {
  return () => value
}

test("replaces every boundary-separated Let me with one random choice", () => {
  const text = "Let me check. Let me see the file, then let me run it."
  const rewritten = rewriteThinkingText(text, { random: constantRandom(0) })
  assert.equal(rewritten, "I will check. I will see the file, then i will run it.")
})

test("does not match inside larger words", () => {
  const rewritten = rewriteThinkingText("letter and wallet meet let me", { random: constantRandom(0) })
  assert.equal(rewritten, "letter and wallet meet i will")
})

test("distributes choices across occurrences when random varies", () => {
  let calls = 0
  const rewritten = rewriteThinkingText("Let me a. Let me b. Let me c.", {
    random: () => (calls++ % 3) / 3,
  })
  assert.equal(rewritten, "I will a. We will b. Let's c.")
})

test("preserves lowercase let me leading case", () => {
  assert.equal(rewriteThinkingText("let me go", { random: constantRandom(2 / 3) }), "let's go")
})

test("honors custom replacements", () => {
  assert.equal(
    rewriteThinkingText("Let me do it", { replacements: ["Gonna"], random: constantRandom(0) }),
    "Gonna do it",
  )
})

test("empty replacements leave text untouched", () => {
  assert.equal(rewriteThinkingText("Let me stay", { replacements: [] }), "Let me stay")
})

test("no Let me leaves text untouched", () => {
  const text = "Inspect the module and run the tests."
  assert.equal(rewriteThinkingText(text, { random: constantRandom(0) }), text)
})

test("default replacements are I will / We will / Let's", () => {
  const rewritten = rewriteThinkingText("Let me check", { random: constantRandom(1 / 3) })
  assert.ok(["I will check", "We will check", "Let's check"].includes(rewritten))
})

test("thinking rewrite only applies to matching models when enabled", async () => {
  const hooks = createAnchorHooks({ rewriteThinking: true }, dependencies())
  const output = { text: "Let me inspect the stack." }
  await hooks["experimental.reasoning.transform"]?.(
    { sessionID: "s", messageID: "m", partID: "p", model: targetModel },
    output,
  )
  assert.ok(["I will inspect the stack.", "We will inspect the stack.", "Let's inspect the stack."].includes(output.text))
})

test("thinking rewrite is off by default", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  const output = { text: "Let me inspect the stack." }
  await hooks["experimental.reasoning.transform"]?.(
    { sessionID: "s", messageID: "m", partID: "p", model: targetModel },
    output,
  )
  assert.equal(output.text, "Let me inspect the stack.")
})

for (const [name, model] of [
  ["GPT", gptModel],
  ["DeepSeek V4 Flash", flashModel],
] as const) {
  test(`thinking rewrite skips ${name}`, async () => {
    const hooks = createAnchorHooks({ rewriteThinking: true }, dependencies())
    const output = { text: "Let me inspect the stack." }
    await hooks["experimental.reasoning.transform"]?.(
      { sessionID: "s", messageID: "m", partID: "p", model },
      output,
    )
    assert.equal(output.text, "Let me inspect the stack.")
  })
}

test("empty thinkingReplacements disables rewriting", async () => {
  const hooks = createAnchorHooks({ rewriteThinking: true, thinkingReplacements: [] }, dependencies())
  const output = { text: "Let me inspect." }
  await hooks["experimental.reasoning.transform"]?.(
    { sessionID: "s", messageID: "m", partID: "p", model: targetModel },
    output,
  )
  assert.equal(output.text, "Let me inspect.")
})

function assistantMessages(
  model: { providerID: string; modelID: string },
  reasoning: string[],
  text = "Assistant reply.",
) {
  return {
    messages: [
      {
        info: { role: "assistant", providerID: model.providerID, modelID: model.modelID },
        parts: [
          ...reasoning.map((r) => ({ type: "reasoning" as const, text: r })),
          { type: "text" as const, text },
        ],
      },
      {
        info: { role: "user" as const, providerID: model.providerID, modelID: model.modelID },
        parts: [{ type: "text" as const, text: "Question" }],
      },
    ] as unknown as { info: Message; parts: Part[] }[],
  }
}

test("upload transform rewrites reasoning in target-model history", async () => {
  const hooks = createAnchorHooks({ rewriteThinking: true }, dependencies())
  const { messages } = assistantMessages(
    { providerID: "opencode-go", modelID: "deepseek-v4-pro" },
    ["Let me inspect the stack.", "Let me then run it"],
  )
  await hooks["experimental.chat.messages.transform"]?.({}, { messages })
  const reasoning = messages[0]!.parts.filter((p) => p.type === "reasoning")
  const first = reasoning[0] as { type: "reasoning"; text: string } | undefined
  const second = reasoning[1] as { type: "reasoning"; text: string } | undefined
  assert.ok(first)
  assert.ok(second)
  assert.ok(!/\blet me\b/i.test(first.text))
  assert.ok(!/\blet me\b/i.test(second.text))
  for (const choice of [first, second]) {
    assert.ok(["I will", "We will", "Let's"].some((prefix) => choice.text.startsWith(prefix)))
  }
})

test("upload transform leaves non-target model history untouched", async () => {
  const hooks = createAnchorHooks({ rewriteThinking: true }, dependencies())
  const { messages } = assistantMessages({ providerID: "openai", modelID: "gpt-5.4" }, [
    "Let me inspect the stack.",
  ])
  await hooks["experimental.chat.messages.transform"]?.({}, { messages })
  assert.equal((messages[0]!.parts[0] as { text: string }).text, "Let me inspect the stack.")
})

test("upload transform is off by default and leaves text parts untouched", async () => {
  const hooks = createAnchorHooks(undefined, dependencies())
  const { messages } = assistantMessages(
    { providerID: "opencode-go", modelID: "deepseek-v4-pro" },
    ["Let me inspect."],
    "Let me answer in the reply text.",
  )
  await hooks["experimental.chat.messages.transform"]?.({}, { messages })
  assert.equal((messages[0]!.parts[0] as { text: string }).text, "Let me inspect.")
  assert.equal((messages[0]!.parts[1] as { text: string }).text, "Let me answer in the reply text.")
})
