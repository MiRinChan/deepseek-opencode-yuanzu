# Deepseek Opencode 元祖版

> npm/package slug: `opencode-deepseek-v4-anchor`

一个面向 OpenCode 的 **DeepSeek V4 Pro harness anchoring** 插件。它在目标模型的首个请求上提供 DSH/RL-aligned bootstrap scaffold，并在首个持久 promotion 信号后恢复 OpenCode 原生能力。

这个项目不声称存在“隐藏模式”。现有实验只表明 DeepSeek V4 Pro 对 agent harness / scaffold 敏感；它们不能证明所有任务都会提升。

> [!IMPORTANT]
> 截至 OpenCode `v1.18.18`（以及核对时的 `dev` 提交 `4643e65`），公开插件 API 缺少逐 LLM request 的原子 system/tool transform。完整功能需要应用仓库内的最小上游补丁。未应用补丁时，OpenCode 不会调用该额外 hook，本插件保持 model-visible no-op。详见 [docs/UPSTREAM_HOOK_REQUIRED.md](docs/UPSTREAM_HOOK_REQUIRED.md)。

## 解决什么问题

用户照常启动 `opencode` 并选择 DeepSeek V4 Pro。插件自动完成：

1. 首个目标请求使用完整 Minimal persona：`You are a helpful software engineer assistant.`
2. 移除首轮 assembled system 中 OpenCode 自动注入的默认 persona、AGENTS/workspace、skill catalog 等 system scaffold；保留真实 conversation messages、文件附件和显式 user system。
3. 将 OpenCode 已经解析并经过权限过滤的真实工具目录缩窄为 `bash`、`read`，不创建假工具。
4. 首个 durable tool call（无论执行成功或失败）或首个 completed assistant message 后 promotion。
5. 同一 user turn 的下一次 LLM request 不再修改工具目录，因此原生工具、MCP 工具和其他插件工具全部自动恢复。

GPT、Claude、DeepSeek V4 Flash、V3、R1 等非目标模型不会被修改。

## 工作原理

```text
                    model != DeepSeek V4 Pro
NORMAL  ----------------------------------------------> native OpenCode
  |
  | target model
  v
BOOTSTRAP -- durable tool call / assistant message --> PROMOTED
  |                                                     |
  | Minimal system                                      | native full catalog
  | native catalog filtered to bash/read                | native dynamic context
  v                                                     v
provider request #1                              provider request #2+
```

插件使用原生目录的交集操作：

```text
bootstrap: full_catalog -> delete non-bootstrap keys -> {bash, read}
promoted:  full_catalog -> untouched
```

它不会硬编码“完整工具列表”，也不会改变 OpenCode permission rules。

使用的 OpenCode 扩展点：

- `chat.message`：获取真实 `providerID`/`modelID`，缓存用户显式 system，并触发只读 history hydration。
- `experimental.chat.request.transform`：本仓库补丁提供的逐请求原子 hook；同时处理 system 与 permission-filtered tool catalog。
- `event`：观察 durable assistant/tool part 和 session deletion。
- `tool.execute.before`：在执行结果产生前保证 tool-call promotion。
- `dispose`：清理进程内状态。

插件不注册 `chat.params`、`chat.headers`、`experimental.chat.messages.transform` 或 provider hook。

官方 DeepSeek Harness 当前 Minimal preset 使用 `bash` + `str_replace_editor`。本项目按 OpenCode 的真实工具 ID 和 Anchored Standard 实验映射为 `bash` + `read`；OpenCode 源码中的 shell ID 确认为 `bash`，read ID 为 `read`。

更完整的调用顺序和状态恢复逻辑见 [docs/DESIGN.md](docs/DESIGN.md)。

## 安装

### 1. 构建插件

```bash
git clone https://github.com/MiRinChan/deepseek-opencode-yuanzu.git opencode-deepseek-v4-anchor
cd opencode-deepseek-v4-anchor
npm install
npm test
npm run typecheck
npm run build
```

### 2. 给当前 OpenCode 源码应用最小 hook patch

```bash
git -C /path/to/opencode apply --check \
  /path/to/opencode-deepseek-v4-anchor/patches/opencode-tools-transform.patch
git -C /path/to/opencode apply \
  /path/to/opencode-deepseek-v4-anchor/patches/opencode-tools-transform.patch
```

然后按 OpenCode 上游说明构建/安装该源码。补丁只增加一个原子的实验性 request hook，不维护 OpenCode fork。

### 3. 配置 OpenCode

在 OpenCode 配置的 `plugin` 数组中加入构建后的绝对 file URL：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "file:///absolute/path/opencode-deepseek-v4-anchor/dist/src/index.js",
      {
        "enabled": true,
        "models": ["deepseek-v4-pro"],
        "bootstrapTools": ["bash", "read"],
        "personaAfterPromotion": "minimal",
        "promoteOn": "either",
        "debug": false
      }
    ]
  ]
}
```

默认值就是上面的配置，安装后无需切换 agent/preset 或输入特殊 prompt。发布到 npm 后，file URL 可替换为包名 `opencode-deepseek-v4-anchor`。

## Nix：适配 `numtide/llm-agents.nix`

仓库提供 [`overlays.default`](nix/overlay.nix)，专门覆盖 `llm-agents.nix` 命名空间里的 `pkgs.llm-agents.opencode`。当前适配快照为：

- `numtide/llm-agents.nix`：`b4a645976fff76ef94dd60b7d4f9deaa216f40bd`
- `llm-agents.nix` 的 OpenCode：`1.18.18`
- `llm-agents.nix` 锁定的 nixpkgs 源码包基线：`1.18.16`，由本 overlay 用 nixpkgs 已验证哈希精确更新为 `1.18.18`

`llm-agents.nix` 自己的 OpenCode derivation 安装官方预编译二进制，不能用 `patches` 修改内嵌代码。因此本 overlay：

1. 保留 `llm-agents.overlays.shared-nixpkgs` 提供的整个 `pkgs.llm-agents` 命名空间；
2. 复用 `pkgs.opencode` 的源码构建逻辑，将 version、source 和 node_modules 固定输出更新到 `1.18.18`；
3. 仅在 Nix 构建沙盒内应用 [`patches/opencode-tools-transform.patch`](patches/opencode-tools-transform.patch)；
4. 用 Nix 构建本插件，并让包装后的 `opencode` 默认通过 `OPENCODE_CONFIG_CONTENT` 加载它；
5. 只替换 `pkgs.llm-agents.opencode`，不改变顶层 `pkgs.opencode` 或其他 llm-agents 包。

这不会修改 OpenCode 或 `llm-agents.nix` 的 checkout、Git 历史或工作树，也不维护 fork。Nix store 中的源码构建结果是不可变的。overlay 会检查 `llm-agents.nix` 的 OpenCode 是否仍是已验证的 `1.18.18`；版本变化时直接报错，避免把补丁悄悄应用到未知源码。

### 直接试用本仓库 flake

仓库当前为私有时，可使用 SSH flake URL，或先 clone 后使用本地路径：

```bash
nix run 'git+ssh://git@github.com/MiRinChan/deepseek-opencode-yuanzu.git#opencode'

# 本地 checkout
nix run .#opencode
```

### NixOS / Home Manager flake

下面让主配置、`llm-agents.nix` 和本 overlay 共用同一份 pinned nixpkgs；overlay 顺序不能颠倒：

```nix
{
  inputs = {
    llm-agents.url = "github:numtide/llm-agents.nix";
    nixpkgs.follows = "llm-agents/nixpkgs";

    deepseek-opencode-anchor.url =
      "git+ssh://git@github.com/MiRinChan/deepseek-opencode-yuanzu.git";
    deepseek-opencode-anchor.inputs.llm-agents.follows = "llm-agents";
    deepseek-opencode-anchor.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    { nixpkgs, llm-agents, deepseek-opencode-anchor, ... }:
    {
      nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          ({ pkgs, ... }: {
            nixpkgs.overlays = [
              llm-agents.overlays.shared-nixpkgs
              deepseek-opencode-anchor.overlays.default
            ];

            environment.systemPackages = [
              pkgs.llm-agents.opencode
            ];
          })
        ];
      };
    };
}
```

Home Manager 独立配置同样把两个 overlay 按上述顺序放进 `nixpkgs.overlays`，再安装 `pkgs.llm-agents.opencode`。

overlay 使用 `--set-default OPENCODE_CONFIG_CONTENT`，因此不会覆盖用户已经显式设置的同名环境变量。如果你自己设置了 `OPENCODE_CONFIG_CONTENT`，请把插件 spec 合并进已有 JSON；Nix 包把可用的完整 spec 暴露为：

```nix
pkgs.llm-agents.opencode.pluginSpecifier
```

可独立构建：

```bash
nix build .#plugin
nix build .#opencode
```

覆盖后的 OpenCode 从源码构建，不能复用 `llm-agents.nix` 官方预编译 OpenCode 的 Numtide cache 路径；首次构建会明显更久。

## 自动模型检测

内置 matcher 会规范化大小写、`.`、`_`、provider/model 路径，并严格识别：

- `deepseek-v4-pro`
- `deepseek/deepseek-v4-pro`
- `DeepSeek-V4-Pro`
- `deepseek-v4.1-pro`
- provider 为 `deepseek`、model ID 为 `v4-pro`

它不会命中 V4 Flash、V3、R1 或其他厂商的裸 `v4-pro`。

`models` 是额外匹配规则，不会关闭内置安全规则：

- 普通字符串：规范化后的 exact match
- `glob:lab-*-pro`：glob
- `regex:^vendor/.+-anchor$`：大小写不敏感正则

模型检测只使用 hook 中的 `providerID` / `modelID`，不解析 UI 文本。

## Promotion

默认 `promoteOn: "either"`：

- `tool-call`：`message.part.updated` 中出现目标 assistant 的 durable tool part，或 `tool.execute.before` 触发。后者保证工具失败也 promotion。
- `assistant-message`：目标 assistant message 已带 `time.completed`，避免创建请求前的空 assistant 占位消息误触发。

也可单独选择 `"tool-call"` 或 `"assistant-message"`。

状态按 `sessionID` 隔离。启动/恢复时插件通过 OpenCode SDK 的只读 session messages API 推导历史 promotion；读取失败时退化为进程内状态，并仅在 debug 模式记录该限制。模型切换到非目标模型时完全透传；此前没有目标 assistant durable 信号的 GPT → DeepSeek 切换仍会进入 bootstrap。

## Promotion 后 persona

- `"minimal"`（默认）：在完整原生 assembled system 前置 Minimal persona，从而恢复 AGENTS/workspace/skills 等动态 context。由于当前 system hook 不暴露 persona/context 分段，原生 persona 仍存在于后续内容中；这是非破坏性最佳实现。
- `"original"`：promotion 后不修改 system，完全恢复 OpenCode 原生 persona 和动态 context。

Bootstrap system 则会被完整替换为 Minimal persona，并在存在时追加用户显式提供的 `UserMessage.system`。

## Debug

设置 `"debug": true` 后会输出：

```text
[dsv4-anchor] session=abc model=deepseek-v4-pro phase=bootstrap
[dsv4-anchor] session=abc request tools=bash,read
[dsv4-anchor] session=abc promotion signal=tool-call
[dsv4-anchor] session=abc phase=promoted
[dsv4-anchor] session=abc request tools=<full:17>
```

日志不会打印 API key、完整 prompt、工具参数、文件内容或 reasoning。

## 测试和 provider payload instrumentation

```bash
npm test
npm run typecheck
npm run instrument
```

测试覆盖非目标透传、DeepSeek bootstrap、tool failure、text-only response、multi-session、model switching、durable resume 和配置 matcher。

`npm run instrument` 是 plugin-level payload harness：它启动本地 HTTP capture server，将 request hook 处理后的 payload 真正序列化并发送到 capture endpoint，再与 [sanitized fixture](test/fixtures/provider-tools.sanitized.json) 对比。request #1 只有 `bash/read`，promotion 后 request #2 是未修改的完整输入目录。它不启动完整 OpenCode runtime、不调用真实 provider，也不含 credential；补丁则把同一 hook 放在 OpenCode provider message/tool preparation 之前。

## 已知限制

- 当前 OpenCode 必须应用 [最小 tools transform patch](patches/opencode-tools-transform.patch)；官方 hook 合并前，预编译稳定版无法完成核心能力。
- Nix overlay 会在构建沙盒中完成该 patch；当前只支持并严格检查 `llm-agents.nix` 的 OpenCode `1.18.18`。覆盖包是源码构建，首次构建不会命中原预编译包缓存。
- `experimental.chat.messages.transform` 没有 `sessionID`/model 输入，本插件不使用它删除消息，以免并发 session 串扰或误删真实 history。极少数以 synthetic conversation message 形式注入的自动 context 可能仍可见；assembled system scaffold 会被移除。
- `personaAfterPromotion: "minimal"` 只能前置 Minimal persona，无法从 assembled string 中安全删除原生 persona 而保留动态 context。
- 如果权限或 agent 配置本来隐藏了 `bash`/`read`，插件不会越权重新添加；首轮目录将是允许目录与 `bootstrapTools` 的交集，并在 debug 日志报告 missing ID。
- Durable 恢复依赖 SDK session messages GET；不可用时只保留当前 OpenCode 进程内状态。

## 安全说明

- 不修改 DeepSeek API server，不运行代理/MITM，不拦截凭据。
- 不伪造 reasoning，不根据自然语言文本决定 promotion。
- 不写 session permission，不绕过 OpenCode 的 permission/approval 控制。
- 不复制或替换 OpenCode 工具 executor；保留真实 tool definition 对象。
- 非目标模型和未打 request-hook 补丁的 OpenCode 保持 model-visible no-op；插件不会缓存未打补丁 runtime 的 assembled system。

## 参考资料

- [anomalyco/opencode](https://github.com/anomalyco/opencode) — plugin hooks、session loop、LLM request preparation 与工具目录来源
- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — 官方 Minimal persona 与 harness scaffold
- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard) — 两阶段 Anchored Standard 实验
- [xiaobright/modeltest](https://github.com/xiaobright/modeltest) — 相关 scaffold/harness sensitivity 实验与边界

上游核对快照：OpenCode `4643e65`、DeepSeek Harness `47f9438`、dsh-anchored-standard `6472c1c`、modeltest `04255b5`（2026-08-15）。
