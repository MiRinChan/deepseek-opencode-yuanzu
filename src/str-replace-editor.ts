/**
 * The DeepSeek Minimal editor schema. The schema is intentionally kept as a
 * plain JSON object because it is part of the model-visible first-request
 * contract, not an OpenCode-native tool definition.
 */
export const STR_REPLACE_EDITOR_SCHEMA = {
  type: "object",
  properties: {
    command: {
      description: "The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`, `undo_edit`.",
      enum: ["view", "create", "str_replace", "insert", "undo_edit"],
      type: "string",
    },
    path: {
      description:
        "Absolute path to file or directory. On Unix/Linux/Mac use paths starting with `/` (e.g., `/workspace/file.py`). On Windows use Windows-style absolute paths (e.g., `C:\\workspace\\file.py`).",
      type: "string",
    },
    file_text: {
      description: "Required parameter of `create` command, with the content of the file to be created.",
      type: "string",
    },
    old_str: {
      description: "Required parameter of `str_replace` command containing the string in `path` to replace.",
      type: "string",
    },
    new_str: {
      description:
        "Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert.",
      type: "string",
    },
    insert_line: {
      description: "Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`.",
      type: "integer",
    },
    view_range: {
      description:
        "Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show the indicated lines. Indexing at 1 to start. Setting [start_line, -1] shows all lines from start_line to the end of the file.",
      items: { type: "integer" },
      type: "array",
    },
  },
  required: ["command", "path"],
} as const

type Tool = {
  description?: string
  inputSchema?: unknown
  parameters?: unknown
  execute?: (args: Record<string, unknown>, context: unknown) => unknown
}

function compatibleInputSchema(nativeSchema: unknown): unknown {
  if (!nativeSchema || typeof nativeSchema !== "object") return STR_REPLACE_EDITOR_SCHEMA
  const schema = Object.create(nativeSchema) as Record<string, unknown>
  Object.defineProperty(schema, "jsonSchema", {
    configurable: true,
    enumerable: true,
    get: () => STR_REPLACE_EDITOR_SCHEMA,
  })
  return schema
}

/** Adapt OpenCode's native filesystem tools behind the Minimal editor name. */
export function createStrReplaceEditorTool(tools: Record<string, Tool>): Tool | undefined {
  const read = tools.read
  const edit = tools.edit
  const write = tools.write
  if (!read?.execute) return undefined
  const readExecute = read.execute

  return {
    description:
      "Custom editing tool for viewing, creating and editing files in plain-text format\n* State is persistent across tool calls and discussions\n* If `path` is a file, `view` displays the result of applying `cat -n`. If `path` is a directory, `view` lists non-hidden files and directories up to 2 levels deep\n* The `create` command cannot be used if the specified `path` already exists as a file\n* If a `command` generates a long output, it will be truncated and marked with `<response clipped>`\n* The `undo_edit` command will revert the last edit operation on the file at `path`\nNotes on the `str_replace` command:\n* The `old_str` parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!\n* If the `old_str` parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context to make it unique\n* The `new_str` parameter should contain the edited lines that should replace the `old_str`\n",
    inputSchema: compatibleInputSchema(read.inputSchema),
    async execute(args, context) {
      const command = args.command
      const filePath = args.path
      if (typeof command !== "string" || typeof filePath !== "string") {
        throw new Error("str_replace_editor requires command and path")
      }

      if (command === "view") {
        const range = Array.isArray(args.view_range) ? args.view_range : undefined
        const start = typeof range?.[0] === "number" ? range[0] : undefined
        const end = typeof range?.[1] === "number" ? range[1] : undefined
        return readExecute(
          { filePath, ...(start !== undefined ? { offset: start } : {}), ...(end !== undefined && end !== -1 && start !== undefined ? { limit: end - start + 1 } : {}) },
          context,
        )
      }

      if (command === "create") {
        if (!write?.execute) throw new Error("OpenCode write tool is unavailable for str_replace_editor create")
        return write.execute({ filePath, content: args.file_text ?? "" }, context)
      }

      if (command === "str_replace") {
        if (!edit?.execute) throw new Error("OpenCode edit tool is unavailable for str_replace_editor str_replace")
        return edit.execute({ filePath, oldString: args.old_str ?? "", newString: args.new_str ?? "" }, context)
      }

      if (command === "insert") {
        throw new Error("str_replace_editor insert is not supported by the OpenCode adapter")
      }
      if (command === "undo_edit") {
        throw new Error("str_replace_editor undo_edit is not supported by the OpenCode adapter")
      }
      throw new Error(`Unknown str_replace_editor command: ${command}`)
    },
  }
}
