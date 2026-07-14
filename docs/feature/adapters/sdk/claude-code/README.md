# Claude Code

使用 `claudeCodeAgent` 在 Sandbox 中安装并运行 Claude Code CLI。

```ts
import { claudeCodeAgent } from "niceeval/adapter";

const agent = claudeCodeAgent({
  skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
  mcpServers: [{ name: "browser", command: "npx", args: ["-y", "server"] }],
  plugins: [{
    // name 必须等于 acme/claude-plugins 仓库 manifest 里声明的 name,不是随意起的别名
    marketplace: { name: "acme-plugins", source: "acme/claude-plugins", ref: "v1.3.0" },
    name: "safe-shell",
  }],
});
```

`skills`、`mcpServers` 和 Claude Code 原生 `plugins` 均在 setup 阶段安装。Marketplace 连接不代表启用其中所有插件，每项必须显式给出 Plugin 名。

Adapter 用 Claude Code transcript JSONL 取得消息、thinking、工具、usage 和 session ID，按 `tool_use.id` / `tool_result.tool_use_id` 配对。Skill Tool 调用归一为 `skill.loaded`。会话通过原生 resume ID 续接。

Claude Code 的原生 OTel 内容默认可能脱敏；行为断言仍以 transcript 为准，OTel 只用于 trace。

## 预制环境

Adapter 的 setup 检测 PATH 上的 `claude`：预装命中即跳过安装，缺失时回退 npm 全局安装——预装只是快速路径，不是正确性前提。E2B 官方 `claude` template 与 NiceEval 公共模板 `correctroads-default-team/niceeval-claude-code`（CI 钉 release tag）都是可用起点；构建项目自己的镜像/模板见 [Sandbox · 预制环境](../../../sandbox/library/prebuilt-environments.md)。

Claude Agent SDK 的服务接入是另一种形态，见 [Claude Agent SDK](../claude-agent-sdk/README.md)。
