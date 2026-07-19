# Claude Code

使用 `claudeCodeAgent` 在 Sandbox 中安装并运行 Claude Code CLI。

```ts
import { claudeCodeAgent } from "niceeval/adapter";

const agent = claudeCodeAgent({
  skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
  mcpServers: [
    { name: "browser", command: "npx", args: ["-y", "server"] },
    // 远程 Streamable HTTP 端点:写 url,headers 逐字进请求头
    { name: "team-memory", url: "https://mem.example.com/mcp/", headers: { Authorization: `Bearer ${process.env.MEM_API_KEY}` } },
  ],
  plugins: [{
    // name 必须等于 acme/claude-plugins 仓库 manifest 里声明的 name,不是随意起的别名
    marketplace: { name: "acme-plugins", source: "acme/claude-plugins", ref: "v1.3.0" },
    name: "safe-shell",
  }],
});
```

`skills`、`mcpServers` 和 Claude Code 原生 `plugins` 均在 setup 阶段安装。Marketplace 连接不代表启用其中所有插件，每项必须显式给出 Plugin 名。MCP 的 stdio 形态写进用户级 `~/.claude.json` 的 `mcpServers` 条目；HTTP 形态写成 `{ "type": "http", "url": …, "headers": … }`。安装全部完成后要跑的用户脚本走 `postSetup` 钩子，见 [Adapter · 安装后运行脚本](../../library/coding-agent-extensions.md#安装后运行脚本postsetup)。

接入与成本三个字段：`apiKey` 是 Anthropic API key，省略时读 `ANTHROPIC_API_KEY` 环境变量；`baseUrl` 是自定义 API 端点（代理 / 内网网关），省略时读 `ANTHROPIC_BASE_URL`，两者都没有则用 Anthropic 官方端点；`maxTurns` 限制单次 send 最多跑几个 tool-use 轮次（透传 `--max-turns`），用于给 eval 成本设上限，省略时用 CLI 原生默认（无限制）。模型选择不在这里——它归 experiment 的 `model` 维度。

`settingsFile` 是运行 niceeval 的机器上的本地路径，不是 Sandbox 内路径；它相对本地项目根解析，指向一份完整的 Claude Code `settings.json`：

```ts
const agent = claudeCodeAgent({
  settingsFile: "configs/claude-code/no-web.json",
});
```

项目根是执行 niceeval 时包含 `niceeval.config.ts` 的当前工作目录，不是当前 Eval 或 Experiment 文件的目录。字段只接受项目根内的相对路径。`configs/claude-code/no-web.json` 与 `./configs/claude-code/no-web.json` 合法；包含 `..` 的路径、绝对路径、`~` 路径和解析后逃出项目根的符号链接都在 setup 阶段报错。

文件内容使用 Claude Code 官方 settings 词汇；例如 `{ "permissions": { "deny": ["WebSearch", "WebFetch"] } }` 关闭 WebSearch / WebFetch。Adapter 从本地读取文件后上传到隔离的 Claude 配置目录，原样替换其中原本为空的用户级 `~/.claude/settings.json`；它不继承宿主机配置，也不与它合并。项目自己的 `.claude/settings.json` / `.claude/settings.local.json` 仍按 Claude Code 官方优先级加载。

保留键是 `model` 与 `env`——模型选择归 experiment，鉴权与 OTel 导出归 Adapter——出现在文件里 setup 报错并点名冲突键。文件原始字节的 SHA-256 进入安装 checkpoint key；manifest 只记录项目相对路径和 SHA-256，不保存正文。secret 走环境变量，不写进配置文件。

Adapter 用 Claude Code transcript JSONL 取得消息、thinking、工具、usage 和 session ID，按 `tool_use.id` / `tool_result.tool_use_id` 配对。Skill Tool 调用归一为 `skill.loaded`。会话通过原生 resume ID 续接。

Claude Code 自己的 SessionStart / UserPromptSubmit hook 往模型上下文前置的附加文本，在 transcript 里以独立的 `hook_additional_context` 行出现（配对的 `hook_success` 行只是执行确认、不带上下文文本，不产生事件），归一为 `context.injected`，`source` 取该行的 `hookName`（如 `"SessionStart"`）。这条通路只归一「确实注入了文本」的行——hook 有没有执行、执行是否成功是被测 CLI 自己的生命周期，不是 niceeval 的[生命周期 Hook](../../../../runner.md#环境预置不进运行器但按顺序调它)，两者不要混着理解。

Claude Code 的原生 OTel 内容默认可能脱敏；行为断言仍以 transcript 为准，OTel 只用于 trace。

## 预制环境

Adapter 的 setup 检测 PATH 上的 `claude`：预装命中即跳过安装，缺失时回退 npm 全局安装——预装只是快速路径，不是正确性前提。E2B 官方 `claude` template 与 NiceEval 公共模板 `correctroads-default-team/niceeval-claude-code`（CI 钉 release tag）都是可用起点；构建项目自己的镜像/模板见 [Sandbox · 预制环境](../../../sandbox/library/prebuilt-environments.md)。

Claude Agent SDK 的服务接入是另一种形态，见 [Claude Agent SDK](../claude-agent-sdk/README.md)。
