# 参考页生成器:TSDoc 里带引号的 URL 字面量会生成嵌套引号乱码

## 现象

在公开 Config 字段的 TSDoc 里写带引号的 URL 示例（如 `url: "https://…/mcp/"`），
`pnpm docs:reference` 生成的 `builtin-agents.mdx` 区块里出现引号嵌进 code span 的乱码：
`url: "`https://…/mcp/"`,`（反引号在 `https` 前开、在 `/mcp/"` 后关，闭合引号被包进代码段）。
2026-07-17 给 `ClaudeCodeConfig.mcpServers` 补 Streamable HTTP 形态说明时踩到。

## 根因

生成器为 MDX 安全会把裸 URL 自动包进反引号，但它按 URL 边界切分、不感知外层已有的
成对引号，于是字符串字面量的闭合引号被卷进 code span。

## 修法

TSDoc 注释里不要写带引号的 URL 字面量示例；用文字描述字段（「Streamable HTTP 形态写
url(可带 headers)」），或去掉引号只保留域名占位。落点：`src/agents/claude-code.ts`
的 `mcpServers` TSDoc 改写后重新 `pnpm docs:reference`。适用于所有进生成区块的 TSDoc。
