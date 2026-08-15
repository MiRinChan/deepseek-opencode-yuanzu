import assert from "node:assert/strict"
import test from "node:test"

import { createMinimalBashTool, MINIMAL_BASH_DESCRIPTION, MINIMAL_BASH_SCHEMA } from "../src/bash.js"
import {
  createStrReplaceEditorTool,
  STR_REPLACE_EDITOR_DESCRIPTION,
  STR_REPLACE_EDITOR_SCHEMA,
} from "../src/str-replace-editor.js"

function filesystemTools(files: Map<string, string>) {
  const edits: Record<string, unknown>[] = []
  const writes: Record<string, unknown>[] = []
  return {
    edits,
    writes,
    tools: {
      read: {
        async execute(args: Record<string, unknown>) {
          const filePath = args.filePath as string
          const content = files.get(filePath)
          if (content === undefined) throw new Error(`File not found: ${filePath}`)
          const lines = content.split("\n")
          const offset = (args.offset as number | undefined) ?? 1
          const limit = (args.limit as number | undefined) ?? 2_000
          const selected = lines.slice(offset - 1, offset - 1 + limit)
          return {
            title: filePath,
            output: "native read output",
            metadata: {
              display: {
                type: "file",
                path: filePath,
                text: selected.join("\n"),
                lineStart: offset,
                lineEnd: offset + selected.length - 1,
                totalLines: lines.length,
                truncated: offset - 1 + selected.length < lines.length,
              },
            },
          }
        },
      },
      edit: {
        async execute(args: Record<string, unknown>) {
          edits.push(args)
          const filePath = args.filePath as string
          const oldString = args.oldString as string
          const newString = args.newString as string
          const before = files.get(filePath)
          if (oldString === "") {
            if (before !== undefined) throw new Error("existing file")
            files.set(filePath, newString)
          } else {
            if (before === undefined) throw new Error("missing file")
            const first = before.indexOf(oldString)
            if (first < 0 || before.indexOf(oldString, first + oldString.length) >= 0) {
              throw new Error("replacement is not unique")
            }
            files.set(filePath, before.slice(0, first) + newString + before.slice(first + oldString.length))
          }
          return { title: filePath, output: "native edit output", metadata: { permission: "edit" } }
        },
      },
      write: {
        async execute(args: Record<string, unknown>) {
          writes.push(args)
          files.set(args.filePath as string, args.content as string)
          return { title: args.filePath as string, output: "native write output", metadata: { permission: "edit" } }
        },
      },
    },
  }
}

test("Minimal bash keeps native execution but replaces the provider-visible contract", async () => {
  const calls: Record<string, unknown>[] = []
  const native = {
    description: "OpenCode bash",
    inputSchema: { jsonSchema: { native: true } },
    async execute(args: Record<string, unknown>) {
      calls.push(args)
      return { output: "ok" }
    },
  }
  const bash = createMinimalBashTool({ bash: native })
  assert.ok(bash)
  assert.equal(bash.description, MINIMAL_BASH_DESCRIPTION)
  assert.deepEqual((bash.inputSchema as { jsonSchema: unknown }).jsonSchema, MINIMAL_BASH_SCHEMA)
  await bash.execute?.({ command: "pwd" }, {})
  assert.equal(bash.execute, native.execute)
  assert.deepEqual(calls, [{ command: "pwd" }])
})

test("Minimal editor implements all four advertised commands through native permissioned tools", async () => {
  const files = new Map<string, string>([
    ["/repo/a.txt", "one\ntwo"],
    ["/repo/empty.txt", ""],
  ])
  const backing = filesystemTools(files)
  const editor = createStrReplaceEditorTool(backing.tools)
  assert.ok(editor?.execute)
  assert.equal(editor.description, STR_REPLACE_EDITOR_DESCRIPTION)
  assert.deepEqual(editor.inputSchema, STR_REPLACE_EDITOR_SCHEMA)

  const viewed = (await editor.execute({ command: "view", path: "/repo/a.txt", view_range: [2, -1] }, {})) as {
    output: string
  }
  assert.equal(
    viewed.output,
    "Here's the content of /repo/a.txt with line numbers (which has a total of 2 lines) with view_range=[2, -1]:\n     2  two\n",
  )

  const created = (await editor.execute(
    { command: "create", path: "/repo/new.txt", file_text: "new" },
    {},
  )) as { output: string }
  assert.equal(files.get("/repo/new.txt"), "new")
  assert.equal(created.output, "New file created successfully at: /repo/new.txt")
  assert.deepEqual(backing.edits.at(-1), {
    filePath: "/repo/new.txt",
    oldString: "",
    newString: "new",
  })

  await editor.execute({ command: "create", path: "/repo/created-empty.txt", file_text: "" }, {})
  assert.equal(files.get("/repo/created-empty.txt"), "")
  assert.deepEqual(backing.edits.slice(-2), [
    { filePath: "/repo/created-empty.txt", oldString: "", newString: "\n" },
    { filePath: "/repo/created-empty.txt", oldString: "\n", newString: "" },
  ])

  await editor.execute({ command: "str_replace", path: "/repo/a.txt", old_str: "two", new_str: "second" }, {})
  assert.equal(files.get("/repo/a.txt"), "one\nsecond")

  await editor.execute({ command: "insert", path: "/repo/a.txt", insert_line: 1, new_str: "middle" }, {})
  assert.equal(files.get("/repo/a.txt"), "one\nmiddle\nsecond")

  await editor.execute({ command: "insert", path: "/repo/empty.txt", insert_line: 0, new_str: "first" }, {})
  assert.equal(files.get("/repo/empty.txt"), "first\n")
  assert.deepEqual(backing.writes.at(-1), { filePath: "/repo/empty.txt", content: "first\n" })
})

test("Minimal editor rejects non-unique replacements before invoking native edit", async () => {
  const files = new Map([["/repo/repeated.txt", "same\nsame"]])
  const backing = filesystemTools(files)
  const editor = createStrReplaceEditorTool(backing.tools)
  assert.ok(editor?.execute)
  await assert.rejects(
    async () => await editor.execute?.({ command: "str_replace", path: "/repo/repeated.txt", old_str: "same" }, {}),
    /Multiple occurrences/,
  )
  assert.equal(backing.edits.length, 0)
})
