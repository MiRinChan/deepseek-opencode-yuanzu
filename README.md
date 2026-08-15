# Deepseek Opencode 元祖版

> npm package: `opencode-deepseek-v4-anchor`

为 OpenCode 的 DeepSeek V4 Pro 会话提供两阶段 harness：第一次模型请求严格暴露 Minimal persona 与 `bash`/`str_replace_editor`，出现首个可靠的 tool call 或完整 assistant message 后，自动恢复 OpenCode 的原生上下文和完整工具目录。

GPT、Claude、DeepSeek V4 Flash、V3、R1 等非目标模型保持原样。无需切换 agent、preset 或输入特殊 prompt。

> [!IMPORTANT]
> OpenCode `1.18.18` 的公开插件 API 还不能逐请求同时修改 system 和 tools，因此必须同时安装仓库内的最小补丁。只加载插件但不打补丁时，插件不会产生模型可见的变化。

## 安装

### Nix 用户（推荐）

仓库提供 `overlays.default`，用于替换 `pkgs.llm-agents.opencode`。它会在 Nix 构建中完成补丁、构建插件并默认加载插件，不修改 OpenCode checkout。

直接试用：

```bash
nix run .#opencode
```

在 NixOS 或 Home Manager flake 中使用：

```nix
{
  inputs = {
    llm-agents.url = "github:numtide/llm-agents.nix";
    nixpkgs.follows = "llm-agents/nixpkgs";

    deepseek-opencode-anchor.url =
      "github:MiRinChan/deepseek-opencode-yuanzu";
    deepseek-opencode-anchor.inputs.llm-agents.follows = "llm-agents";
    deepseek-opencode-anchor.inputs.nixpkgs.follows = "nixpkgs";
  };
}
```

按以下顺序加入 overlays，并继续安装原来的 `pkgs.llm-agents.opencode`：

```nix
nixpkgs.overlays = [
  inputs.llm-agents.overlays.shared-nixpkgs
  inputs.deepseek-opencode-anchor.overlays.default
];

environment.systemPackages = [ pkgs.llm-agents.opencode ];
```

Home Manager 的 `nixpkgs.overlays` 与 `home.packages` 写法相同。overlay 当前严格支持 OpenCode `1.18.18`；版本不匹配时会停止构建，避免把补丁应用到未知源码。

如果已经显式设置 `OPENCODE_CONFIG_CONTENT`，包装器不会覆盖它。此时需要把插件 spec 合并进已有 JSON；可通过以下属性取得完整 spec：

```nix
pkgs.llm-agents.opencode.pluginSpecifier
```

### 从源码安装

先构建并验证插件：

```bash
npm install
npm test
npm run typecheck
npm run build
```

再给 OpenCode `v1.18.18` 源码应用补丁并按上游方式重新构建：

```bash
git -C /path/to/opencode apply --check \
  /path/to/deepseek-opencode-yuanzu/patches/opencode-tools-transform.patch
git -C /path/to/opencode apply \
  /path/to/deepseek-opencode-yuanzu/patches/opencode-tools-transform.patch
```

最后在 OpenCode 配置中加载构建产物：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "file:///absolute/path/deepseek-opencode-yuanzu/dist/src/plugin-entry.js",
      {
        "enabled": true,
        "models": ["deepseek-v4-pro"],
        "bootstrapTools": ["bash", "str_replace_editor"],
        "personaAfterPromotion": "minimal",
        "promoteOn": "either",
        "debug": false
      }
    ]
  ]
}
```

## 配置

| 选项 | 默认值 | 用途 |
|---|---|---|
| `enabled` | `true` | 启用插件 |
| `models` | `["deepseek-v4-pro"]` | 增加 exact、`glob:` 或 `regex:` 匹配规则 |
| `bootstrapTools` | `["bash", "str_replace_editor"]` | 首次请求的 Minimal 工具 ID |
| `personaAfterPromotion` | `"minimal"` | promotion 后选择 `minimal` 前缀或 `original` 原样透传 |
| `promoteOn` | `"either"` | 选择 `either`、`tool-call` 或 `assistant-message` |
| `rewriteThinking` | `false` | 开启思考链改写：把 `Let me` 随机替换为 `thinkingReplacements` 之一 |
| `thinkingReplacements` | `["I will", "We will", "Let's"]` | 思考链改写用的候选项（可为空数组以禁用） |
| `debug` | `false` | 输出不含 prompt、工具参数和凭据的状态日志 |

内置检测会识别 `deepseek-v4-pro`、`deepseek/deepseek-v4-pro`、`DeepSeek-V4-Pro`、`deepseek-v4.1-pro`，以及 DeepSeek provider 下的 `v4-pro`。额外的 `models` 规则只会扩展匹配范围，不会关闭内置安全规则。

### 思考链改写

`rewriteThinking: true` 时，目标模型每条 assistant 消息的思考链（reasoning part）在提交时会被改写：所有 `Let me`（大小写不敏感、整词匹配）随机替换为 `thinkingReplacements` 中的一项，逐处独立随机；`let me` 开头小写时保持小写形式。这依赖同一组上游补丁里的 `experimental.reasoning.transform` hook。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "file:///absolute/path/deepseek-opencode-yuanzu/dist/src/plugin-entry.js",
      {
        "enabled": true,
        "models": ["deepseek-v4-pro"],
        "rewriteThinking": true,
        "thinkingReplacements": ["I will", "We will", "Let's"]
      }
    ]
  ]
}
```

## 已知限制

- 必须使用带仓库补丁的 OpenCode；官方合并等价 hook 后才可能只安装插件。
- 首次请求严格使用 `bash`/`str_replace_editor`；OpenCode 的 `read`/`write`/`edit` 仅作为执行适配，不会出现在 provider-visible 的首轮工具目录中。
- `bash` 的 provider-visible description/schema 与 Harness Minimal 一致，但底层仍是 OpenCode 的一次性 shell 进程；因此 `cd`、shell 变量等进程状态不会像 Harness persistent bash 那样跨调用保留。插件不会为追求这一点绕过 OpenCode 权限另建 shell runtime。
- `str_replace_editor` 的 schema 和四个命令与当前 Harness 对齐；执行委托给 OpenCode 原生工具，因此极长单行、二进制文件与格式化/LSP 后处理仍遵循 OpenCode 行为。
- `personaAfterPromotion: "minimal"` 会在原生 assembled system 前加 Minimal persona，但不会删除后面的原生 persona。
- `rewriteThinking` 在 reasoning 流式生成结束、part 提交时改写整段文本；生成过程中实时流出的原文不会逐 delta 改写，结束后会刷新为改写结果。
- 恢复历史 promotion 依赖 OpenCode 的只读 session messages API；不可用时退化为当前进程内状态。
- Nix 版本从源码构建 OpenCode，首次构建通常比官方预编译包更久。

## 开发与原理

状态机、hook 调用顺序、权限边界、Nix 打包方式和验证命令见 [WORK.md](WORK.md)。补丁为何必要见 [docs/UPSTREAM_HOOK_REQUIRED.md](docs/UPSTREAM_HOOK_REQUIRED.md)，更细的请求生命周期见 [docs/DESIGN.md](docs/DESIGN.md)。

本项目只说明 DeepSeek V4 Pro 对 agent harness/scaffold 的实验性敏感性，不声称存在“隐藏模式”，也不保证所有任务都会提升。

## 参考

- [anomalyco/opencode](https://github.com/anomalyco/opencode)
- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
- [xiaobright/modeltest](https://github.com/xiaobright/modeltest)
