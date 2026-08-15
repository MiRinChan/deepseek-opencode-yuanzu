# Upstream hook required

## Conclusion

OpenCode `dev` at `4643e65ad6334de3e4e68dedc201d5fbb828c9fe` cannot implement the required two-stage tool catalog as a pure external plugin:

```text
request #1: bash + read
first tool call
request #2 in the same user turn: full native catalog
```

The missing capability is a per-LLM-request atomic system/tool transform. A tools-only hook would solve catalog promotion, but an atomic hook also prevents a plugin from having to retain and correlate `experimental.chat.system.transform` output across concurrent requests.

## Source evidence

Current public hooks are declared in [`packages/plugin/src/index.ts`](https://github.com/anomalyco/opencode/blob/4643e65ad6334de3e4e68dedc201d5fbb828c9fe/packages/plugin/src/index.ts). Relevant hooks include:

- `chat.message`
- `chat.params`
- `chat.headers`
- `experimental.chat.messages.transform`
- `experimental.chat.system.transform`
- `tool.execute.before` / `tool.execute.after`
- `event`

There is no tools/request transform.

OpenCode's [`LLMRequestPrep.prepare()`](https://github.com/anomalyco/opencode/blob/4643e65ad6334de3e4e68dedc201d5fbb828c9fe/packages/opencode/src/session/llm/request.ts) calls `resolveTools(input)`. That function filters only through the durable current `UserMessage.tools` map and permission rules, then the resulting record becomes `Prepared.tools` for both provider runtimes.

The agent loop in [`session/prompt.ts`](https://github.com/anomalyco/opencode/blob/4643e65ad6334de3e4e68dedc201d5fbb828c9fe/packages/opencode/src/session/prompt.ts) resolves the current native/MCP/plugin catalog again on every loop, but it reuses the same last user message during a user turn.

Therefore:

- disabling tools in `chat.message` works for request #1;
- the disabled map persists on the same user message;
- request #2 remains restricted;
- `tool.execute.before` can mark promotion but cannot update the prepared catalog or persisted message;
- `event` is observer-only;
- the SDK exposes message GET, while session update only covers session metadata, not replacing a persisted user message's tool map.

## Rejected alternatives

### Session/user tool map mutation

There is no public message-update API. Sending another prompt creates another user turn and violates the no-hidden-turn requirement.

### Permission mutation

Writing deny/allow rules would mutate durable security state, interact with agent/global rule ordering and risk widening or narrowing permissions. It is not a catalog transform and is intentionally not used.

### Tool wrappers or a single multiplexing tool

They would not preserve OpenCode's actual `bash`/`read` definitions and would create a parallel executor. This violates the project scope.

### HTTP proxy/MITM

Explicitly out of scope and unnecessary once the request preparation seam exists.

## Minimal API

The included patch adds this hook to the existing `Hooks` interface:

```ts
"experimental.chat.request.transform"?: (
  input: {
    sessionID: string
    agent: string
    model: Model
    provider: ProviderContext
    message: UserMessage
  },
  output: {
    system: string[]
    tools: Record<string, any>
  },
) => Promise<void>
```

The runtime invokes it in `LLMRequestPrep.prepare()` after the existing system transform and with the output of permission/user-message tool filtering, before system messages/provider instructions and provider-specific tool schema changes are constructed:

```ts
const request = yield* input.plugin.trigger(
  "experimental.chat.request.transform",
  {
    sessionID: input.sessionID,
    agent: input.agent.name,
    model: input.model,
    provider: input.provider,
    message: input.user,
  },
  { system, tools: resolveTools(input) },
)
```

This location has the required properties:

- runs once per actual LLM request, including the second request in one user turn;
- receives the assembled system and live native catalog after permission filtering in one call;
- affects both AI SDK and native runtime paths through `Prepared.tools`;
- promoted plugins can leave the record untouched, preserving future and third-party tools;
- no session permissions or provider requests are rewritten outside OpenCode.

## Patch

Apply [patches/opencode-tools-transform.patch](../patches/opencode-tools-transform.patch):

```bash
git apply --check /path/to/opencode-tools-transform.patch
git apply /path/to/opencode-tools-transform.patch
```

The patch changes two files and was validated with `git apply --reverse --check` plus `git diff --check` against the cited OpenCode commit.

The plugin defines the extra hook structurally so it still compiles against the current npm `@opencode-ai/plugin` package. An unpatched OpenCode ignores that property. The plugin does not separately register `experimental.chat.system.transform`, making the unpatched runtime model-visible no-op rather than a partial implementation.
