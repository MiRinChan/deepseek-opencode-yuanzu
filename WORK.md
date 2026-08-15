# Working notes

本文面向维护者，记录插件的设计约束、上游补丁边界、构建方式和验证要求。用户安装与配置见 [README.md](README.md)。

## 行为契约

插件只负责六件事：

```text
detect target model
  -> choose per-session phase
  -> apply Minimal-aligned system
  -> narrow the first request's native tool catalog
  -> observe a durable signal and restore native behavior
  -> rewrite thinking: Let me -> I will / We will / Let's
```

它不是 agent runtime、permission layer、provider proxy 或 tool executor。非目标模型必须完全透传；没有 request-hook 补丁的 OpenCode 必须保持 model-visible no-op。

## 请求生命周期

```text
                    non-target model
NORMAL  ---------------------------------------------> native OpenCode
  |
  | DeepSeek V4 Pro
  v
BOOTSTRAP -- durable tool/assistant signal ----------> PROMOTED
  |                                                     |
  | Minimal system                                      | native catalog
  | Minimal catalog: bash/str_replace_editor             | dynamic context
  v                                                     v
provider request #1                              provider request #2+
```

扩展点调用顺序：

1. `chat.message` 获取真实 `providerID`/`modelID`，并通过只读 session messages API hydrate 历史状态。
2. 补丁增加的 `experimental.chat.request.transform` 在每次真实 LLM request 上原子接收 assembled system 与 permission-filtered tools；显式标记的 title/summary small-model 辅助请求直接透传。
3. bootstrap 阶段从 permission-filtered 原生工具构造 Minimal schema 适配器，替换 system，再删除其余 key。
4. `message.part.updated` 与 `tool.execute.before` 观察 durable tool call；completed assistant message 可作为 text-only promotion 信号。
5. `experimental.reasoning.transform` 在每条 reasoning part 流式结束后、提交到 store 前获得整段文本，`rewriteThinking` 配置开启时改写其中的 `Let me`。
6. `experimental.chat.messages.transform` 在每次 LLM 请求前改写目标模型历史消息中的 reasoning part，只影响上传载荷，不改本地存储。
7. 下一次 loop 重新解析当前完整目录；promoted 阶段不修改 tools。
8. `session.deleted` 和 `dispose` 清理进程内状态。

原子 hook 很重要：system 数组无需跨 hook 缓存和配对；未打补丁时 hook 不会被调用，也就不会出现 Minimal system 配完整工具目录的半成品状态。

## 状态与恢复

状态按 `sessionID` 隔离：

```ts
type Phase = "bootstrap" | "promoted"
```

hydrate 只考虑目标模型的 assistant history：

- durable tool part 是 `tool-call` 信号；
- 带 `time.completed` 的 assistant message 是 `assistant-message` 信号；
- 未完成的空 assistant placeholder 不算；
- GPT、Claude、Flash 等历史不会消耗首次 DeepSeek bootstrap。

历史加载按 session memoize。读取失败只退化为进程内状态，并且仅在 debug 模式记录。

## System 与工具目录

Bootstrap assembled system 被替换为：

```text
You are a helpful software engineer assistant.
[optional explicit UserMessage.system]
```

真实 conversation messages、附件和 user system 不会被过滤。插件不使用缺少 session/model 输入的 `experimental.chat.messages.transform`。

Promotion 后：

- `personaAfterPromotion: "original"` 完全透传原生 system；
- `personaAfterPromotion: "minimal"` 在原生 system 前置 Minimal persona，以保留动态 AGENTS、workspace、MCP 和 skill context。由于 hook 没有暴露 persona/context 分段，后续原生 persona 仍会存在。

OpenCode 先应用 permission 与 `UserMessage.tools` 规则，再把目录交给 request transform。Bootstrap 只对原对象做交集删除：

```text
full_catalog -> delete non-bootstrap keys -> {bash, read}
```

`bash` 复用原生 execute，只替换模型可见 description/schema；`str_replace_editor` 的四个命令委托给原生 `read/edit/write`。任一 backing tool 被权限过滤时请求会 fail closed，插件不会绕过权限或另建执行器。Promotion 后完全不触碰目录，所以 OpenCode 新工具、MCP 工具和其他插件工具会自然恢复。

## 模型匹配

内置 matcher 规范化大小写、`.`、`_` 与 provider/model 路径，并要求 DeepSeek + V4/V4.1 + Pro family token。它故意拒绝 Flash、V3、R1，以及其他 provider 下的裸 `v4-pro`。

额外规则扩展而不替换内置 matcher：

- 普通字符串：规范化后的 exact match；
- `glob:lab-*-pro`：glob；
- `regex:^vendor/.+-anchor$`：大小写不敏感正则。

只使用 hook 提供的 provider/model ID，不解析 UI 文本。

## 上游补丁

OpenCode `1.18.18` 的公开 API 没有逐 LLM request 的 tools/request transform，也没有改写 reasoning part 的 seam。仓库补丁修改：

- `packages/opencode/src/session/llm/request.ts`：在 provider preparation 前调用原子 transform，并让 system、messages、tools 与返回值都使用 transform 结果；
- `packages/opencode/src/session/processor.ts`：在 reasoning part 完成提交前调用 `experimental.reasoning.transform`，供插件改写最终思考链文本；
- `packages/plugin/src/index.ts`：声明两个实验性 hook 类型。

具体论证、被拒绝的替代方案和最小 API 见 [docs/UPSTREAM_HOOK_REQUIRED.md](docs/UPSTREAM_HOOK_REQUIRED.md)。

## Nix 打包

`overlays.default` 必须放在 `llm-agents.overlays.shared-nixpkgs` 后面。它：

1. 保留整个 `pkgs.llm-agents` namespace；
2. 复用 nixpkgs 的 source-built OpenCode derivation，并固定到已验证的 `1.18.18` 源码与 node modules；
3. 仅在 Nix sandbox 中应用 patch；
4. 用 `nix/plugin.nix` 构建插件；
5. 用 wrapper 的 `--set-default OPENCODE_CONFIG_CONTENT` 默认加载插件；
6. 只替换 `pkgs.llm-agents.opencode`，不改变顶层 `pkgs.opencode`。

版本 guard 必须保留。上游 OpenCode 或 `llm-agents.nix` 升级后，应先重新核对 patch context、源码 hash、node modules hash 和 provider request 行为，再更新支持版本。

## Debug 与安全边界

Debug 只输出 session/model token、phase、promotion signal 以及工具名/数量。禁止记录 API key、完整 prompt、工具参数、文件内容或 reasoning。

实现不得：

- 修改 DeepSeek API server 或加入代理/MITM；
- 伪造 reasoning，或根据自然语言文本 promotion；
- 修改 durable permission/approval 状态；
- 复制 OpenCode executor 或创建假工具；
- 缓存未打补丁 runtime 的 assembled system。

## 验证

项目声明了 Nix dev shell；一次性命令优先在其中运行：

```bash
nix develop --command bash -c 'npm test'
nix develop --command bash -c 'npm run typecheck'
nix develop --command bash -c 'npm run instrument'
nix develop --command bash -c 'OPENCODE_INTEGRATION_BIN=/path/to/patched/opencode npm run integration'
nix build .#plugin
nix build .#opencode
```

测试覆盖非目标透传、DeepSeek bootstrap、tool failure、text-only response、并发 session、model switching、durable resume 与 matcher 配置。

`npm run instrument` 是快速的 plugin-level payload harness。`npm run integration` 会启动真实 patched OpenCode 和本地 OpenAI-compatible provider，令第一次响应产生 `bash` 与 `str_replace_editor.create` tool call、验证 editor 的真实文件落盘，并直接断言 provider request #1 的完整 Minimal system/两工具 schema，以及同一 user turn 中 request #2 的原生完整目录。

版本更新至少检查：

```bash
git -C /path/to/opencode apply --check patches/opencode-tools-transform.patch
git -C /path/to/opencode apply --check patches/opencode-reasoning-transform.patch
git diff --check
```

两个补丁作用于不同文件区域，可独立或按顺序应用；`opencode-reasoning-transform.patch` 的 `plugin/src/index.ts` hunk 锚定在 `experimental.chat.system.transform` 之后，与 request-hook 补丁不相交。

## 已核对基线

2026-08-15 核对的上游快照：

| Repository | Commit |
|---|---|
| `anomalyco/opencode` (`dev`) | `4643e65ad6334de3e4e68dedc201d5fbb828c9fe` |
| `deepseek-ai/deepseek-harness` (`master`) | `47f943859bef60e4160492346772ded9b24f765a` |
| `xiaobright/dsh-anchored-standard` (`main`) | `f57a1bde2dbaba3039bdae8631f78a0cb3ae3ebe` |
| `xiaobright/modeltest` (`main`) | `04255b55f16c4439e538239fb9783070c4165081` |

DeepSeek Harness Minimal 使用完整 persona `You are a helpful software engineer assistant.` 和 `bash` + `str_replace_editor`。本项目复现这两个 provider-visible 契约，并把执行委托给 OpenCode 原生工具。
