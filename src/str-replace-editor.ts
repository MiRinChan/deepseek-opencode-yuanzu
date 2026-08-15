import path from "node:path"

import type { OpenCodeTool } from "./bash.js"
import { compatibleInputSchema } from "./tool-schema.js"

const MAX_OUTPUT_CHARS = 16_000
const TRUNCATED_MESSAGE =
  "<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>"

export const STR_REPLACE_EDITOR_DESCRIPTION = `Custom editing tool for viewing, creating and editing files
* State is persistent across command calls and discussions with the user
* If \`path\` is a file, \`view\` displays the result of applying \`cat -n\`. If \`path\` is a directory, \`view\` lists non-hidden files and directories up to 2 levels deep
* The \`create\` command cannot be used if the specified \`path\` already exists as a file
* If a \`command\` generates a long output, it will be truncated and marked with \`<response clipped>\`

Notes for using the \`str_replace\` command:
* The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
* If the \`old_str\` parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context in \`old_str\` to make it unique
* The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\``

export const STR_REPLACE_EDITOR_SCHEMA = {
  type: "object",
  properties: {
    command: {
      type: "string",
      enum: ["view", "create", "str_replace", "insert"],
      description: "The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.",
    },
    path: {
      type: "string",
      description: "Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`.",
    },
    file_text: {
      type: "string",
      description: "Required parameter of `create` command, with the content of the file to be created.",
    },
    insert_line: {
      type: "integer",
      description:
        "Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`.",
    },
    new_str: {
      type: "string",
      description:
        "Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert.",
    },
    old_str: {
      type: "string",
      description: "Required parameter of `str_replace` command containing the string in `path` to replace.",
    },
    view_range: {
      type: "array",
      items: { type: "integer" },
      description:
        "Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.",
    },
  },
  required: ["command", "path"],
} as const

type Display =
  | {
      type: "directory"
      path: string
      entries: string[]
      offset: number
      totalEntries: number
      truncated: boolean
    }
  | {
      type: "file"
      path: string
      text: string
      lineStart: number
      lineEnd: number
      totalLines: number
      truncated: boolean
    }

interface ToolResult {
  title?: string
  output?: string
  metadata?: { display?: Display; [key: string]: unknown }
  [key: string]: unknown
}

function result(value: unknown): ToolResult {
  if (!value || typeof value !== "object") throw new Error("OpenCode tool returned an invalid result")
  return value as ToolResult
}

function display(value: unknown): Display {
  const native = result(value).metadata?.display
  if (!native) throw new Error("OpenCode read did not return text/directory display metadata")
  return native
}

function replaceOutput(value: unknown, output: string, fallbackTitle: string): ToolResult {
  const native = result(value)
  return { ...native, title: native.title ?? fallbackTitle, output }
}

function requireAbsolute(filePath: string): void {
  if (filePath.trim().length === 0) throw new Error("path must be a non-empty string")
  if (!path.isAbsolute(filePath)) {
    throw new Error(
      `The path ${filePath} is not an absolute path, it should start with \`/\`. Maybe you meant /${filePath}?`,
    )
  }
}

function requiredString(
  value: unknown,
  parameter: string,
  command: string,
  allowEmpty = true,
): string {
  if (typeof value !== "string") {
    throw new Error(`Parameter \`${parameter}\` is required for command: ${command}`)
  }
  if (!allowEmpty && value.length === 0) {
    throw new Error(`Parameter \`${parameter}\` is empty for command: ${command}`)
  }
  return value
}

function maybeTruncate(content: string): string {
  return content.length <= MAX_OUTPUT_CHARS
    ? content
    : content.slice(0, MAX_OUTPUT_CHARS) + TRUNCATED_MESSAGE
}

async function readFile(
  execute: NonNullable<OpenCodeTool["execute"]>,
  filePath: string,
  context: unknown,
): Promise<{ content: string; totalLines: number; native: ToolResult }> {
  let offset = 1
  let content = ""
  let totalLines = 0
  let first: ToolResult | undefined
  while (true) {
    const value = await execute({ filePath, offset, limit: 2_000 }, context)
    const native = result(value)
    first ??= native
    const shown = display(native)
    if (shown.type !== "file") throw new Error(`The path ${filePath} is not a regular file`)
    if (content.length > 0 && shown.text.length > 0) content += "\n"
    content += shown.text
    totalLines = shown.totalLines
    if (!shown.truncated || shown.lineEnd < offset) break
    offset = shown.lineEnd + 1
  }
  return { content, totalLines, native: first ?? {} }
}

function validateViewRange(range: unknown, totalLines: number): [number, number] | undefined {
  if (range === undefined) return undefined
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger)) {
    throw new Error("Invalid `view_range`. It should be a list of two integers.")
  }
  const initial = range[0] as number
  const final = range[1] as number
  const harnessLineCount = Math.max(totalLines, 1)
  if (initial < 1 || initial > harnessLineCount) {
    throw new Error(
      `Invalid \`view_range\`: [${range.join(", ")}]. Its first element \`${initial}\` should be within the range of lines of the file: [1, ${harnessLineCount}]`,
    )
  }
  if (final > harnessLineCount) {
    throw new Error(
      `Invalid \`view_range\`: [${range.join(", ")}]. Its second element \`${final}\` should be smaller than the number of lines in the file: \`${harnessLineCount}\``,
    )
  }
  if (final !== -1 && final < initial) {
    throw new Error(
      `Invalid \`view_range\`: [${range.join(", ")}]. Its second element \`${final}\` should be larger or equal than its first \`${initial}\``,
    )
  }
  return [initial, final]
}

function formatFileView(filePath: string, content: string, totalLines: number, range: unknown): string {
  const lines = content.split("\n")
  const checked = validateViewRange(range, totalLines)
  const initial = checked?.[0] ?? 1
  const final = checked?.[1]
  const selected = checked ? (final === -1 ? lines.slice(initial - 1) : lines.slice(initial - 1, final)) : lines
  let prompt = `Here's the content of ${filePath} with line numbers (which has a total of ${Math.max(totalLines, 1)} lines)`
  if (checked) prompt += ` with view_range=[${initial}, ${final}]`
  const numbered = selected
    .map((line, index) => `${String(initial + index).padStart(6, " ")}  ${line}`)
    .join("\n")
  return maybeTruncate(`${prompt}:\n${numbered}\n`)
}

async function readDirectory(
  execute: NonNullable<OpenCodeTool["execute"]>,
  directory: string,
  context: unknown,
): Promise<{ entries: string[]; native: ToolResult }> {
  let offset = 1
  const entries: string[] = []
  let first: ToolResult | undefined
  while (true) {
    const value = await execute({ filePath: directory, offset, limit: 2_000 }, context)
    const native = result(value)
    first ??= native
    const shown = display(native)
    if (shown.type !== "directory") throw new Error(`The path ${directory} is not a directory`)
    entries.push(...shown.entries)
    if (!shown.truncated || shown.entries.length === 0) break
    offset += shown.entries.length
  }
  return { entries, native: first ?? {} }
}

async function formatDirectoryView(
  execute: NonNullable<OpenCodeTool["execute"]>,
  directory: string,
  context: unknown,
): Promise<{ output: string; native: ToolResult }> {
  const rows = [`d\t${directory}`]
  let root: ToolResult | undefined
  const visit = async (current: string, depth: number): Promise<void> => {
    const listing = await readDirectory(execute, current, context)
    root ??= listing.native
    for (const entry of listing.entries) {
      const name = entry.endsWith("/") ? entry.slice(0, -1) : entry
      if (name.startsWith(".") || name === "node_modules" || name === "__pycache__") continue
      const directoryEntry = entry.endsWith("/")
      const absolute = path.join(current, name)
      rows.push(`${directoryEntry ? "d" : "f"}\t${absolute}`)
      if (directoryEntry && depth < 2) await visit(absolute, depth + 1)
    }
  }
  await visit(directory, 1)
  rows.sort((left, right) => {
    const leftPath = left.slice(left.indexOf("\t") + 1)
    const rightPath = right.slice(right.indexOf("\t") + 1)
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0
  })
  const listing = maybeTruncate(`${rows.join("\n")}\n`)
  return {
    native: root ?? {},
    output: `Here're the files and directories up to 2 levels deep in ${directory}, excluding hidden items, node_modules, and Python cache directories:\n${listing}\n`,
  }
}

function matchCount(content: string, search: string): number {
  let count = 0
  let offset = 0
  while (true) {
    const match = content.indexOf(search, offset)
    if (match < 0) return count
    count++
    offset = match + search.length
  }
}

/** Adapt permission-filtered OpenCode filesystem tools behind Minimal's editor. */
export function createStrReplaceEditorTool(tools: Record<string, OpenCodeTool>): OpenCodeTool | undefined {
  const read = tools.read
  const edit = tools.edit
  const write = tools.write
  if (!read?.execute || !edit?.execute || !write?.execute) return undefined
  const readExecute = read.execute
  const editExecute = edit.execute
  const writeExecute = write.execute

  return {
    description: STR_REPLACE_EDITOR_DESCRIPTION,
    inputSchema: compatibleInputSchema(read.inputSchema, STR_REPLACE_EDITOR_SCHEMA),
    async execute(args, context) {
      const command = requiredString(args.command, "command", "str_replace_editor", false)
      const filePath = requiredString(args.path, "path", command, false)
      requireAbsolute(filePath)

      if (command === "view") {
        const initial = await readExecute({ filePath, offset: 1, limit: 2_000 }, context)
        const shown = display(initial)
        if (shown.type === "directory") {
          if (args.view_range !== undefined) {
            throw new Error("The `view_range` parameter is not allowed when `path` points to a directory.")
          }
          const viewed = await formatDirectoryView(readExecute, filePath, context)
          return replaceOutput(viewed.native, viewed.output, filePath)
        }
        const viewed = await readFile(readExecute, filePath, context)
        return replaceOutput(
          viewed.native,
          formatFileView(filePath, viewed.content, viewed.totalLines, args.view_range),
          filePath,
        )
      }

      if (command === "create") {
        const content = requiredString(args.file_text, "file_text", "create")
        // OpenCode rejects empty -> empty as a no-op before reaching its
        // create-if-absent branch. Use a native edit placeholder so an empty
        // Harness create remains create-only and never falls back to the
        // overwrite-capable write tool.
        const native =
          content.length === 0
            ? await (async () => {
                await editExecute({ filePath, oldString: "", newString: "\n" }, context)
                return await editExecute({ filePath, oldString: "\n", newString: "" }, context)
              })()
            : await editExecute({ filePath, oldString: "", newString: content }, context)
        return replaceOutput(native, `New file created successfully at: ${filePath}`, filePath)
      }

      if (command === "str_replace") {
        const oldString = requiredString(args.old_str, "old_str", "str_replace", false)
        const newString = args.new_str === undefined ? "" : requiredString(args.new_str, "new_str", "str_replace")
        const before = await readFile(readExecute, filePath, context)
        const matches = matchCount(before.content, oldString)
        if (matches === 0) {
          throw new Error(
            `No replacement was performed, old_str \`${oldString}\` did not appear verbatim in ${filePath}.`,
          )
        }
        if (matches > 1) {
          throw new Error(
            `No replacement was performed. Multiple occurrences of old_str \`${oldString}\` in ${filePath}. Please ensure it is unique`,
          )
        }
        const native = await editExecute({ filePath, oldString, newString }, context)
        return replaceOutput(native, `The file ${filePath} has been edited successfully.`, filePath)
      }

      if (command === "insert") {
        if (args.insert_line === undefined) {
          throw new Error("Parameter `insert_line` is required for command: insert")
        }
        const insertLine = args.insert_line
        const newString = requiredString(args.new_str, "new_str", "insert")
        const before = await readFile(readExecute, filePath, context)
        const lines = before.content.split("\n")
        if (!Number.isInteger(insertLine) || (insertLine as number) < 0 || (insertLine as number) > lines.length) {
          throw new Error(
            `Invalid \`insert_line\` parameter: ${String(insertLine)}. It should be within the range of lines of the file: [0, ${lines.length}]`,
          )
        }
        const after = [
          ...lines.slice(0, insertLine as number),
          ...newString.split("\n"),
          ...lines.slice(insertLine as number),
        ].join("\n")
        const native =
          before.content.length === 0
            ? await writeExecute({ filePath, content: after }, context)
            : await editExecute({ filePath, oldString: before.content, newString: after }, context)
        return replaceOutput(native, `The file ${filePath} has been edited successfully.`, filePath)
      }

      throw new Error(`Unknown str_replace_editor command: ${command}`)
    },
  }
}
