import { compatibleInputSchema } from "./tool-schema.js"

export const MINIMAL_BASH_DESCRIPTION = `Run commands in a bash shell
* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.
* You don't have access to the internet via this tool.
* You do have access to a mirror of common linux and python packages via apt and pip.
* State is persistent across command calls and discussions with the user.
* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.
* Please avoid commands that may produce a very large amount of output.
* Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.`

export const MINIMAL_BASH_SCHEMA = {
  type: "object",
  properties: {
    command: {
      type: "string",
      description: "The bash command to run. Relative path is preferred in the command.",
    },
  },
  required: ["command"],
} as const

export interface OpenCodeTool {
  description?: string
  inputSchema?: unknown
  execute?: (args: Record<string, unknown>, context: unknown) => unknown
  [key: string]: unknown
}

/** Keep OpenCode's native bash execution and permissions behind Minimal's API. */
export function createMinimalBashTool(tools: Record<string, OpenCodeTool>): OpenCodeTool | undefined {
  const bash = tools.bash
  if (!bash?.execute) return undefined
  return {
    ...bash,
    description: MINIMAL_BASH_DESCRIPTION,
    inputSchema: compatibleInputSchema(bash.inputSchema, MINIMAL_BASH_SCHEMA),
  }
}
