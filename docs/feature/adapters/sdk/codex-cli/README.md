# Codex CLI

使用 `codexAgent` 在 Sandbox 中安装并运行 Codex CLI。

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
它只影响拉取速度，不影响装出来的内容，manifest 不记录它。

接入两个字段：`apiKey` 是代理 / OpenAI API key，省略时读 `CODEX_API_KEY` 环境变量；`baseUrl` 是 OpenAI 兼容代理端点（如 `https://s2a.example.com/v1`），省略时读 `CODEX_BASE_URL`。
模型选择不在这里——它归 experiment 的 `model` 维度。

`configFile` 是运行 niceeval 的机器上的本地路径，不是 Sandbox 内路径；它相对本地项目根解析，指向一份完整的 Codex `config.toml`：

```ts
const agent = codexAgent({
  configFile: "configs/codex/no-web.toml",
});
```

项目根是执行 niceeval 时包含 `niceeval.config.ts` 的当前工作目录，不是当前 Eval 或 Experiment 文件的目录。
字段只接受项目根内的相对路径。
`configs/codex/no-web.toml` 与 `./configs/codex/no-web.toml` 合法；包含 `..` 的路径、绝对路径、`~` 路径和解析后逃出项目根的符号链接都在 setup 阶段报错。

文件内容直接使用 Codex 官方 TOML；例如 `web_search = "disabled"` 关闭内置联网检索。
Adapter 从本地读取文件后上传到隔离的 Codex 配置目录，原样替换其中原本为空的用户级 `~/.codex/config.toml`；它不继承宿主机配置，也不解析后重写。
Adapter 的模型、provider 路由、MCP 表和 OTel 导出通过独立生成层或 CLI 参数叠加；项目自己的 `.codex/config.toml` 仍按 Codex 官方优先级加载。

保留键是 `model`、`model_provider`、`model_providers`、`model_reasoning_effort`、`mcp_servers` 与 `otel`——出现在文件里 setup 报错并点名冲突键。
MCP（含远程 HTTP server）走 factory 的 `mcpServers` 字段，不写进 `configFile`。
文件原始字节的 SHA-256 进入安装 checkpoint key；manifest 只记录项目相对路径和 SHA-256，不保存正文。
secret 走环境变量，不写进配置文件。

Codex Adapter 把 Skills 写到可发现目录并提供稳定发现指引；不能假设存在与 Claude Code Skill Tool 相同的自动加载事件。
验证 Skill 使用时检查读取行为或 Skill 特有结果。

行为轨来自 `codex exec --json` 的结构化 stdout，session ID 来自 thread started 事件；工具调用优先按显式 call ID 配对。
实际模型可能被网关改写，需要时从 Codex session 侧写读取，不能只信请求参数。

## 执行信任姿态

`codex exec` 一律以 `--json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --dangerously-bypass-hook-trust` 运行，首轮与 `codex exec resume` 续轮相同。
hook 信任 bypass 与审批 bypass 属同一信任层级：沙箱运行是 headless 的，codex 对非 managed 来源 hook 的交互式信任确认永远无人应答，不 bypass 时这些 hook 被静默跳过且零报错——插件依赖的注入/捕获行为整体失效而无任何征兆。
沙箱里的每个 hook 来源都由实验配置显式声明（`plugins`、`postSetup`、`configFile`），声明即审计，因此不设开关。
`bypass_hook_trust` 是 runtime-only 参数，`config.toml` 写不了，只能进 exec 命令行。

## 预制环境

Adapter 的必填 ensure 用 PATH 上 `codex` 的精确版本作 probe；预装命中即快速返回，未命中时由 identity 匹配的 Installer 安装锁定版本并复检。
`setup` 只写本 Attempt 的鉴权、原生配置与扩展。预装只是快速路径，不是正确性前提。
E2B 官方 `codex` template 与 NiceEval 公共模板 `correctroads-default-team/niceeval-codex`（CI 钉 release tag）都是可用起点；构建项目自己的镜像/模板见 [Sandbox · 预制环境](../../../sandbox/library/prebuilt-environments.md)。

Codex 原生 Plugin 使用 Codex 专属 factory 字段。
Codex SDK 的服务接入是另一种形态，见 [Codex SDK](../codex-sdk/README.md)。
