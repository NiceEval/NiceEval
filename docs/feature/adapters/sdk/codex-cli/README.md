# Codex CLI

使用 `codexAgent` 在 Sandbox 中自动准备并运行 Codex CLI。

## 自动准备官方 Codex CLI

`codexAgent()` 自带官方 Codex CLI 安装层。作者只选择 Agent，不需要在 Eval、Experiment 或题目 fixture 中重复写安装脚本。
每条 Attempt 进入 Agent 前，Adapter 检查 sandbox 内的 Codex CLI 是否满足锁定版本；缺失时准备并安装与目标平台匹配的 OpenAI 官方发行包，随后确认 CLI 已可用。

这条准备路径不依赖题目网络，也不要求任务镜像自带 Node 或 npm。Prebuilt environment 中已有相同版本时，检查会直接命中；预装是加速路径，不是正确性的前提。

它不在题目 Sandbox 内执行 `curl -fsSL https://chatgpt.com/codex/install.sh | sh`。评测需要锁定版本、可校验 npm tarball 和不受题面网络影响的安装；Adapter 在宿主准备对应平台的官方 `@openai/codex` 发行包，再上传、解压并链接原生 CLI。

Human live 面板会依次显示 `checking Codex CLI <version>`、`installing official OpenAI Codex CLI <version>` 与 `Codex CLI <version> ready`。这是 Codex Adapter 声明的短期进度，不进入 JSON、落盘结果或 Sandbox 身份。

安装过程属于 Agent 层，而不是 Sandbox layer 的 `prepare()`。后者只放题目或实验自身的运行依赖，例如系统包、数据、预热和内部工具。完整的身份、平台与失败归属契约见 [Agent Ensure](../../architecture/agent-ensure.md)。

```ts
import { codexAgent } from "niceeval/adapter";

const agent = codexAgent({
  skills: [{ kind: "repo", source: "acme/codex-skills", ref: "v2" }],
  mcpServers: [
    { name: "browser", command: "npx", args: ["-y", "server"] },
    // 远程 Streamable HTTP 端点:写 url,headers 逐字进请求头
    { name: "team-memory", url: "https://mem.example.com/mcp/", headers: { Authorization: `Bearer ${process.env.MEM_API_KEY}` } },
  ],
  plugins: [{
    // name 必须等于 acme/codex-plugins 仓库 manifest 里声明的 name,不是随意起的别名
    marketplace: { name: "acme-plugins", source: "acme/codex-plugins", ref: "v2", sparse: [".agents", "plugins/repo-map"] },
    name: "repo-map",
  }],
  // 安装全部完成后按序跑的用户脚本(如插件自带的 setup 脚本),见 Adapter · 安装后运行脚本
  postSetup: [async (sandbox) => { await sandbox.runShell("python ~/.codex/plugins/repo-map/scripts/setup.py"); }],
});
```

stdio 形态的 MCP 写成 `[mcp_servers.<name>]` 的 `command`/`args`/`env`；HTTP 形态写 `url`，`headers` 进 `[mcp_servers.<name>.http_headers]` 子表。
`marketplace.sparse` 列出 sparse 拉取的路径，每个元素生成一个 `--sparse <path>`（codex 的 `--sparse` 必须带路径参数、可重复），大仓库只拉插件所需路径；省略或空数组即全量 clone。
它只影响拉取速度，不影响装出来的内容，manifest 不记它。

鉴权与路由有两个字段：`apiKey` 是代理 / OpenAI API key，省略时读 `CODEX_API_KEY` env var；`baseUrl` 是 OpenAI 兼容代理端点（如 `https://s2a.example.com/v1`），省略时读 `CODEX_BASE_URL`。
模型选择不在这里——它归 experiment 的 `model` 维度。

## Agent 进程 env var

`env` 为每次 Codex CLI 进程追加 env var。首轮 `codex exec` 与后续 `codex exec resume` 使用同一份声明；Codex 启动的 Session Hook、MCP 动态 header 与命令子进程都从该进程继承。

```ts
const memorySpace = "memorybench-nowledge";
const agent = codexAgent({
  env: { NMEM_SPACE: memorySpace },
});
```

env var 只经 Sandbox 命令 options 注入，不拼进 shell 文本，也不进入安装 manifest。Adapter 把全部声明值按潜在敏感值登记；timing、execution 与错误证据落盘前会脱敏。
`CODEX_API_KEY` 仍由 `apiKey` 或宿主同名 env var 提供，Adapter 的鉴权值替换 `env` 里的同名键。

env value 不进入 carry 身份。`NMEM_SPACE` 这类会改变被测行为的非敏感值还要写进
`defineExperiment({ flags: { memorySpace }, ... })`，或写进所属 Plugin identity。token 与 API key
只放在私有 env 通道；单独轮换凭据不会让旧结果失效。

唯一的例外是 `PATH`：它是 Sandbox 受管变量，`env` 里出现 `PATH` 键在 `codexAgent()` 调用时同步报错，不留到 setup 才发现值被静默丢弃。需要扩展 PATH 时改用 Sandbox factory 的 `pathPrepend`（见 [Sandbox · PATH：受管变量与 pathPrepend](../../../sandbox/library.md#path受管变量与-pathprepend)）。

`configFile` 是运行 niceeval 的机器上的本地路径，不是 Sandbox 内路径；它相对本地项目根定位，指向一份完整的 Codex `config.toml`：

```ts
const agent = codexAgent({
  configFile: "configs/codex/no-web.toml",
});
```

项目根是执行 niceeval 时包含 `niceeval.config.ts` 的当前工作目录，不是当前 Eval 或 Experiment 文件的目录。
字段只接受项目根内的相对路径。
`configs/codex/no-web.toml` 与 `./configs/codex/no-web.toml` 合法；包含 `..` 的路径、绝对路径、`~` 路径和解开符号链接后逃出项目根的路径都在 setup 阶段报错。

文件内容直接使用 Codex 官方 TOML；例如 `web_search = "disabled"` 关闭内置联网检索。
Adapter 从本地读取文件后上传到隔离的 Codex 配置目录，原样替换其中原本为空的用户级 `~/.codex/config.toml`；它不继承宿主机配置，也不重新序列化。
Adapter 的模型、provider 路由、MCP 表和 OTel 导出通过独立生成层或 CLI 参数叠加；项目自己的 `.codex/config.toml` 仍按 Codex 官方优先级加载。

保留键是 `model`、`model_provider`、`model_providers`、`model_reasoning_effort`、`mcp_servers` 与 `otel`——出现在文件里 setup 报错并点名冲突键。
MCP（含远程 HTTP server）走 factory 的 `mcpServers` 字段，不写进 `configFile`。
文件原始字节的 SHA-256 进入安装 checkpoint key；manifest 只记项目相对路径和 SHA-256，不保存正文。
secret 走 env var，不写进配置文件。

Codex Adapter 把 Skills 写到可发现目录并提供稳定发现指引；不能假设存在与 Claude Code Skill Tool 相同的自动加载事件。
验证 Skill 使用时检查读取行为或 Skill 特有结果。

行为轨来自 `codex exec --json` 的结构化 stdout，session ID 来自 thread started 事件；工具调用优先按显式 call ID 配对。
实际模型可能被网关改写，需要时从 Codex session 侧写读取，不能只信请求参数。

## 执行信任姿态

`codex exec` 一律以 `--json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --dangerously-bypass-hook-trust` 运行，首轮与 `codex exec resume` 续轮相同。

hook 信任 bypass 与审批 bypass 属同一信任层级。沙箱运行是 headless 的，codex 对非 managed 出处的 hook 的交互式信任确认永远无人应答。

不 bypass 时，这些 hook 被静默跳过且零报错，插件依赖的注入和捕获行为会整体失效。

沙箱里的每个 hook 出处都由实验配置显式声明（`plugins`、`postSetup`、`configFile`），声明即审计，因此不设开关。
`bypass_hook_trust` 是 runtime-only 参数，`config.toml` 写不了，只能进 exec 命令行。

## Prebuilt environment

`codexAgent` 在 PATH 上检查 `codex` 的精确版本。预装命中会直接进入运行；未命中时，内置安装层自动准备锁定版本的官方发行包并确认安装结果。
`setup` 只写本 Attempt 的鉴权、原生配置与扩展。预装只是快速路径，不是正确性前提。
E2B 官方 `codex` template 与 NiceEval 公共模板 `correctroads-default-team/niceeval-codex`（CI 钉 release tag）都是可用起点；构建项目自己的镜像/模板见 [Sandbox · Prebuilt environment](../../../sandbox/library/prebuilt-environments.md)。

Codex 原生 Plugin 使用 Codex 专属 factory 字段。
Codex SDK 的服务接入是另一种形态，见 [Codex SDK](../codex-sdk/README.md)。
