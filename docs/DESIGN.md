# Design

## Goals and non-goals

The plugin owns only five decisions:

```text
detect model
  -> choose per-session phase
  -> apply Minimal-aligned model-facing system
  -> narrow the first request's native tool surface
  -> observe a durable signal and stop touching the native catalog
```

It is not an agent runtime, permission layer, provider proxy, or tool executor.

## Verified upstream baseline

The design was checked against these default-branch commits on 2026-08-15:

| Repository | Commit |
|---|---|
| `anomalyco/opencode` (`dev`) | `4643e65ad6334de3e4e68dedc201d5fbb828c9fe` |
| `deepseek-ai/deepseek-harness` (`master`) | `47f943859bef60e4160492346772ded9b24f765a` |
| `xiaobright/dsh-anchored-standard` (`main`) | `f57a1bde2dbaba3039bdae8631f78a0cb3ae3ebe` |
| `xiaobright/modeltest` (`main`) | `04255b55f16c4439e538239fb9783070c4165081` |

Current DeepSeek Harness Minimal uses the complete persona `You are a helpful software engineer assistant.` and exposes `bash` plus `str_replace_editor`. The plugin reproduces those provider-visible names, descriptions and JSON Schemas. Execution stays behind OpenCode's permission-filtered native `bash`, `read`, `edit` and `write` implementations.

## Request lifecycle

```text
chat.message (once per new user message)
  capture providerID/modelID
  hydrate promotion from read-only session history
        |
        v
experimental.chat.request.transform (new upstream hook, every LLM request)
  receives assembled system + permission-filtered native tools atomically
  ignores explicitly marked auxiliary small-model requests
  calculate phase and apply the system transform
  bootstrap: install Minimal schema adapters, then delete every other key
  promoted: leave tools untouched
        |
        v
OpenCode provider preparation / streamText
        |
        v
message.part.updated(tool) and tool.execute.before
  set session phase=promoted before execution outcome
        |
        v
next loop resolves the current native catalog again
experimental.chat.request.transform leaves tools untouched
```

An atomic hook matters: no system array has to be retained or paired with a later hook. On an unpatched OpenCode, `experimental.chat.request.transform` is never invoked, so the plugin cannot accidentally send Minimal system with a full tool catalog.

## State and durable recovery

Each `sessionID` has an independent entry:

```ts
type Phase = "bootstrap" | "promoted"
```

The in-memory entry also records whether the latest request is a target model. Hydration uses `client.session.messages()` and considers only target-model assistant messages:

- a target assistant tool part is a durable `tool-call` signal;
- a target assistant with `time.completed` is a durable `assistant-message` signal;
- an incomplete assistant placeholder is ignored;
- GPT/Claude/Flash history does not consume the first DeepSeek bootstrap.

The loader is memoized per session. Sessions can run concurrently without a global phase boolean. `session.deleted` removes local state.

## Model matching

The built-in matcher normalizes case and common separators but requires the DeepSeek + V4/V4.1 + Pro family tokens. It intentionally rejects Flash, V3 and R1. Provider ID and model ID are both considered, so gateways do not need a special provider allowlist.

Additional exact/glob/regex patterns extend rather than replace the built-in matcher.

## System handling

### Bootstrap

The assembled OpenCode system is replaced in place with:

```text
You are a helpful software engineer assistant.
[optional explicit UserMessage.system]
```

The explicit system value is read from the current request's `UserMessage`, never cached from an earlier model or recovered from unrelated history. Conversation messages and file parts are never filtered. The plugin deliberately does not use `experimental.chat.messages.transform`, whose current input is `{}` and cannot be scoped by session/model.

### Promoted

`personaAfterPromotion: original` is exact native pass-through.

`personaAfterPromotion: minimal` prefixes the Minimal persona to the assembled native system. This preserves dynamic AGENTS/workspace/MCP/skill context, but OpenCode's existing persona remains later in the assembled string because the current hook does not expose prompt segments separately.

## Tool identity and permissions

OpenCode resolves native, MCP and plugin tools before LLM preparation. Its existing permission and `UserMessage.tools` rules filter that catalog first. The proposed hook receives that filtered record.

In bootstrap the plugin first constructs two thin model-facing adapters from that already-filtered record:

- `bash` keeps the native OpenCode execute function and replaces only its description/input schema with the current Harness Minimal contract;
- `str_replace_editor` maps `view`, `create`, `str_replace` and `insert` to the available native `read`, `edit` and `write` execute functions, preserving their permission checks and result metadata.

It then deletes every other property. If `bash`, `read`, `edit` or `write` was removed by permission filtering, the request fails closed instead of exposing a partial or widened catalog. `create` uses native `edit`'s create-if-absent path; `str_replace` prechecks one exact literal match; `insert` reads the complete native display then delegates the mutation.

In promoted phase the hook does not mutate `output.tools`. New OpenCode tools and user plugin tools are restored automatically.

## Promotion timing

`message.part.updated` observes the durable pending tool part produced by the model. `tool.execute.before` is a second signal immediately before execution. Promotion therefore does not depend on result success.

For `promoteOn: either`, a completed text-only assistant response also promotes the session so the next user message does not remain in bootstrap. No natural-language prefix or reasoning text is inspected.

## Instrumentation boundary

`test/provider-request.test.ts` is a fast plugin-level payload harness. `test/opencode-provider-integration.test.ts` starts the Nix-built patched OpenCode with a local OpenAI-compatible provider, returns real `bash` and `str_replace_editor.create` tool calls, verifies the editor changed the filesystem through OpenCode, and inspects the two actual HTTP request bodies. It proves request #1 has the complete Minimal system and exact two schemas, while request #2 in the same user turn contains the untouched full OpenCode catalog.
