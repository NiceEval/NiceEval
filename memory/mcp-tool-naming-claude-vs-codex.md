# claude-code 与 codex 的 MCP 工具规范名不一样(`mcp__x__y` vs `x.y`)

**现象**：同一个 MCP server(`@modelcontextprotocol/server-everything`,工具 `get-sum`)分别挂给
`claudeCodeAgent` 和 `codexAgent`,`t.calledTool(name, …)` 要用不同的 `name` 才能命中——沿用
claude-sdk 项目里"MCP 命名空间不抹平"的既有共识(`docs/e2e-ci.md` 第 2 节),但两个原生 CLI
adapter 各自的具体格式没人验证过,实测结果如下。

**根因**：两家 CLI 的原始事件形状不同,niceeval 解析器按各自协议原样映射:
- claude-code:transcript 里 `tool_use.name` 直接是 `mcp__<server>__<tool>`(双下划线命名空间,
  CLI 自己拼的),niceeval 的 claude-code 解析器原样透传成 `originalName`。
- codex:`--json` 输出的 item 类型是 `mcp_tool_call`,带独立的 `server` / `tool` 字段
  (`{"server":"e2e","tool":"get-sum",...}`);`src/o11y/parsers/codex.ts` 的 `mcp_tool_call`
  分支把两者拼成 `${server}.${tool}`(点分隔)当 `originalName`——**不是** `mcp__e2e__get-sum`。

实测(Docker 沙箱,两家都配 `{ name: "e2e", command: "npx", args: ["-y",
"@modelcontextprotocol/server-everything"] }`,提示词"用 MCP 工具算 100+23"):
claude-code 的 tool_use 是 `mcp__e2e__get-sum`;codex `--json` 的
`mcp_tool_call.server="e2e"`、`.tool="get-sum"`,niceeval 解析后 `originalName` 是 `e2e.get-sum`。

**修法**：MCP 工具名进 `AgentProfile.mcpToolName`,由各项目的 `profile.ts` 各自声明真实值,
断言逻辑(`e2e/shared/evals.ts` 的 `mcpTool(p)` / `mcpAbsent(p)`)只读 profile,不猜格式。
适用场景:任何要断言"MCP 工具被调用"的沙箱型 agent eval,尤其是想把 claude-code 和 codex
的 MCP 覆盖写成一份共享 factory 时。
