import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import test from "node:test"

import { createAnchorHooks } from "../src/index.js"
import { dependencies, fullCatalog, sendChatMessage, targetModel, transformRequest } from "./helpers.js"

interface CapturedRequest {
  system: string[]
  tools: Array<{ name: string; marker: string }>
}

test("sanitized provider payload shows two tools then the untouched full catalog", async () => {
  const captured: CapturedRequest[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      captured.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as CapturedRequest)
      response.writeHead(200, { "content-type": "application/json" })
      response.end('{"ok":true}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("capture server did not expose a TCP address")
    const endpoint = `http://127.0.0.1:${address.port}/provider`
    const hooks = createAnchorHooks(undefined, dependencies())
    const sessionID = "session-provider-capture"
    await sendChatMessage(hooks, sessionID, targetModel)

    const send = async (): Promise<void> => {
      const system = ["OpenCode native persona\nAGENTS context\nskill catalog"]
      const tools = fullCatalog()
      await transformRequest(hooks, sessionID, targetModel, system, tools)
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          system,
          tools: Object.entries(tools).map(([name, definition]) => ({ name, ...definition })),
        }),
      })
      assert.equal(response.status, 200)
    }

    await send()
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID, callID: "call-provider-fails" },
      { args: { command: "false" } },
    )
    await send()

    const fixture = JSON.parse(
      await readFile(new URL("../../test/fixtures/provider-tools.sanitized.json", import.meta.url), "utf8"),
    ) as CapturedRequest[]
    assert.deepEqual(captured, fixture)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
