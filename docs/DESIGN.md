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
| `xiaobright/dsh-anchored-standard` (`main`) | `6472c1c9431dcfd9072be23bff781b76fe7146c0` |
| `xiaobright/modeltest` (`main`) | `04255b55f16c4439e538239fb9783070c4165081` |

Current DeepSeek Harness Minimal uses the complete persona `You are a helpful software engineer assistant.` and exposes `bash` plus `str_replace_editor`. Anchored Standard demonstrates a two-stage scaffold using the host's shell/read equivalents. This plugin uses OpenCode's native `bash` and `read` IDs.

## Request lifecycle

```text
chat.message (once per new user message)
  capture providerID/modelID and explicit UserMessage.system
  hydrate promotion from read-only session history
        |
        v
experimental.chat.request.transform (new upstream hook, every LLM request)
  receives assembled system + permission-filtered native tools atomically
  calculate phase and apply the system transform
  bootstrap: delete every non-allowlisted key from native tools
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

The in-memory entry also records whether the latest request is a target model and the latest explicit user system string. Hydration uses `client.session.messages()` and considers only target-model assistant messages:

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

Conversation messages and file parts are never filtered. The plugin deliberately does not use `experimental.chat.messages.transform`, whose current input is `{}` and cannot be scoped by session/model.

### Promoted

`personaAfterPromotion: original` is exact native pass-through.

`personaAfterPromotion: minimal` prefixes the Minimal persona to the assembled native system. This preserves dynamic AGENTS/workspace/MCP/skill context, but OpenCode's existing persona remains later in the assembled string because the current hook does not expose prompt segments separately.

## Tool identity and permissions

OpenCode resolves native, MCP and plugin tools before LLM preparation. Its existing permission and `UserMessage.tools` rules filter that catalog first. The proposed hook receives that filtered record.

In bootstrap the plugin deletes non-allowlisted properties from the same record. It never reconstructs allowed definitions, so the API receives OpenCode's exact `bash` and `read` objects. It never adds a missing tool and therefore cannot bypass permission filtering.

In promoted phase the hook does not mutate `output.tools`. New OpenCode tools and user plugin tools are restored automatically.

## Promotion timing

`message.part.updated` observes the durable pending tool part produced by the model. `tool.execute.before` is a second signal immediately before execution. Promotion therefore does not depend on result success.

For `promoteOn: either`, a completed text-only assistant response also promotes the session so the next user message does not remain in bootstrap. No natural-language prefix or reasoning text is inspected.

## Instrumentation boundary

`test/provider-request.test.ts` is a plugin-level harness that serializes the post-hook system and tool definitions to an actual local HTTP endpoint. The sanitized fixture checks names at that boundary; it is not a full patched-OpenCode integration test. The OpenCode patch invokes the transform with `resolveTools()` output before provider message/tool construction, so both AI SDK and native LLM runtime later receive `request.system` and `request.tools`.
