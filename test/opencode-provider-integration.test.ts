import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"

import {
  MINIMAL_BASH_DESCRIPTION,
  MINIMAL_BASH_SCHEMA,
  MINIMAL_PERSONA,
  STR_REPLACE_EDITOR_DESCRIPTION,
  STR_REPLACE_EDITOR_SCHEMA,
} from "../src/index.js"

interface ProviderTool {
  type: string
  function: {
    name: string
    description?: string
    parameters?: unknown
  }
}

interface ProviderRequest {
  messages?: Array<{ role?: string; content?: unknown }>
  tools?: ProviderTool[]
}

function stream(response: import("node:http").ServerResponse, chunks: unknown[]): void {
  const payload = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`),
    "data: [DONE]",
    "",
    "",
  ].join("\n\n")
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(payload)
}

function textResponse(response: import("node:http").ServerResponse, content: string): void {
  stream(response, [
    {
      id: "chatcmpl-text",
      object: "chat.completion.chunk",
      created: 0,
      model: "deepseek-v4-pro",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id: "chatcmpl-text",
      object: "chat.completion.chunk",
      created: 0,
      model: "deepseek-v4-pro",
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    },
    {
      id: "chatcmpl-text",
      object: "chat.completion.chunk",
      created: 0,
      model: "deepseek-v4-pro",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ])
}

const opencode = process.env.OPENCODE_INTEGRATION_BIN

test(
  "patched OpenCode sends Minimal request one and its untouched full catalog on request two",
  { skip: opencode ? false : "set OPENCODE_INTEGRATION_BIN to the patched OpenCode executable", timeout: 45_000 },
  async () => {
    assert.ok(opencode)
    const root = await mkdtemp(path.join(tmpdir(), "dsv4-anchor-integration-"))
    const editorFixture = path.join(root, "created-by-editor.txt")
    const requests: ProviderRequest[] = []
    let toolRequests = 0
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProviderRequest
        if (body.tools && body.tools.length > 0) {
          requests.push(body)
          toolRequests++
          if (toolRequests === 1) {
            stream(response, [
              {
                id: "chatcmpl-tool",
                object: "chat.completion.chunk",
                created: 0,
                model: "deepseek-v4-pro",
                choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
              },
              {
                id: "chatcmpl-tool",
                object: "chat.completion.chunk",
                created: 0,
                model: "deepseek-v4-pro",
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_bootstrap_bash",
                          type: "function",
                          function: { name: "bash", arguments: '{"command":"pwd"}' },
                        },
                        {
                          index: 1,
                          id: "call_bootstrap_editor",
                          type: "function",
                          function: {
                            name: "str_replace_editor",
                            arguments: JSON.stringify({
                              command: "create",
                              path: editorFixture,
                              file_text: "editor-ok\n",
                            }),
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              },
              {
                id: "chatcmpl-tool",
                object: "chat.completion.chunk",
                created: 0,
                model: "deepseek-v4-pro",
                choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
              },
            ])
            return
          }
        }
        textResponse(response, toolRequests > 0 ? "done" : "integration session")
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

    try {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("capture server has no TCP address")
      const pluginPath = fileURLToPath(new URL("../src/plugin-entry.js", import.meta.url))
      const config = {
        plugin: [[pathToFileURL(pluginPath).href, { debug: false }]],
        provider: {
          capture: {
            name: "Capture",
            id: "capture",
            env: [],
            npm: "@ai-sdk/openai-compatible",
            models: {
              "deepseek-v4-pro": {
                id: "deepseek-v4-pro",
                name: "DeepSeek V4 Pro",
                attachment: false,
                reasoning: false,
                temperature: false,
                tool_call: true,
                release_date: "2025-01-01",
                limit: { context: 100_000, output: 10_000 },
                cost: { input: 0, output: 0 },
                options: {},
              },
            },
            options: {
              apiKey: "sanitized-test-key",
              baseURL: `http://127.0.0.1:${address.port}/v1`,
            },
          },
        },
      }
      const child = spawn(
        opencode,
        [
          "run",
          "--model",
          "capture/deepseek-v4-pro",
          "--dir",
          root,
          "--format",
          "json",
          "--auto",
          "Use bash once, then finish.",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            XDG_CACHE_HOME: path.join(root, "cache"),
            XDG_CONFIG_HOME: path.join(root, "config"),
            XDG_DATA_HOME: path.join(root, "data"),
            XDG_STATE_HOME: path.join(root, "state"),
            OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")))
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")))
      const [exitCode] = (await once(child, "exit")) as [number | null]
      assert.equal(exitCode, 0, `OpenCode failed\nstdout:\n${stdout}\nstderr:\n${stderr}`)
      assert.equal(await readFile(editorFixture, "utf8"), "editor-ok\n")

      assert.equal(requests.length, 2, `expected two tool-bearing provider requests, got ${requests.length}`)
      const first = requests[0]
      const second = requests[1]
      assert.ok(first && second)
      const firstSystem = first.messages?.filter((message) => message.role === "system")
      assert.deepEqual(firstSystem, [{ role: "system", content: MINIMAL_PERSONA }])
      assert.ok(
        first.messages?.some(
          (message) => message.role === "user" && JSON.stringify(message.content).includes("Use bash once"),
        ),
        "the real user message was not preserved in request one",
      )

      const firstTools = Object.fromEntries((first.tools ?? []).map((tool) => [tool.function.name, tool.function]))
      assert.deepEqual(Object.keys(firstTools).sort(), ["bash", "str_replace_editor"])
      assert.equal(firstTools.bash?.description, MINIMAL_BASH_DESCRIPTION)
      assert.deepEqual(firstTools.bash?.parameters, MINIMAL_BASH_SCHEMA)
      assert.equal(firstTools.str_replace_editor?.description, STR_REPLACE_EDITOR_DESCRIPTION)
      assert.deepEqual(firstTools.str_replace_editor?.parameters, STR_REPLACE_EDITOR_SCHEMA)

      const secondNames = (second.tools ?? []).map((tool) => tool.function.name)
      assert.ok(secondNames.length > 2, `request two did not restore the full catalog: ${secondNames.join(",")}`)
      assert.ok(secondNames.includes("bash"))
      assert.ok(secondNames.includes("read"))
      assert.ok(secondNames.includes("edit"))
      assert.ok(secondNames.includes("write"))
      assert.ok(!secondNames.includes("str_replace_editor"), "promoted catalog was not left native")
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
