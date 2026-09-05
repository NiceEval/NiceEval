# niceeval Examples

修改 tier 目录或同步机制前，先读 [Tier Sync 契约](../docs/engineering/example-tier-sync/README.md) 与 [`memory/tier-sync-merge-tree-pitfalls.md`](../memory/tier-sync-merge-tree-pitfalls.md)。先检查，只在需要同步时应用：

```sh
pnpm examples:sync check
pnpm examples:sync apply [name]
```

文档和 README 中的示例链接必须指向真实目录。

`examples/zh/` 用相邻层展示同一应用的接入增量：

- `origin/<name>`：未接入 NiceEval 的普通应用，是 before 基线。
- `tier1/<name>`：在原应用上增加 Tier 1 无侵入接入。
- `tier2/<name>`：在 Tier 1 上增加 OTel 观测。
- `tier3/<name>`：在 Tier 2 上改造应用，暴露 Experiment flags。

接入语义以 [Origin 接入](../docs/origin-integration.md) 为准，层间复制与 overlay 边界以 [Tier Sync 契约](../docs/engineering/example-tier-sync/README.md) 为准。运行前置、环境变量和具体命令由各示例的 `README.md` 或 [`zh/origin/README.md`](zh/origin/README.md) 拥有。

## 当前目录

| 应用 | Origin | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|---|
| AI SDK v7 | [`origin/ai-sdk-v7`](zh/origin/ai-sdk-v7/) | [`tier1/ai-sdk-v7`](zh/tier1/ai-sdk-v7/) | [`tier2/ai-sdk-v7`](zh/tier2/ai-sdk-v7/) | [`tier3/ai-sdk-v7`](zh/tier3/ai-sdk-v7/) |
| Claude Agent SDK | [`origin/claude-sdk`](zh/origin/claude-sdk/) | [`tier1/claude-sdk`](zh/tier1/claude-sdk/) | — | [`tier3/claude-sdk`](zh/tier3/claude-sdk/) |
| Codex SDK | [`origin/codex-sdk`](zh/origin/codex-sdk/) | [`tier1/codex-sdk`](zh/tier1/codex-sdk/) | [`tier2/codex-sdk`](zh/tier2/codex-sdk/) | [`tier3/codex-sdk`](zh/tier3/codex-sdk/) |
| LangGraph | [`origin/langgraph`](zh/origin/langgraph/) | [`tier1/langgraph`](zh/tier1/langgraph/) | [`tier2/langgraph`](zh/tier2/langgraph/) | [`tier3/langgraph`](zh/tier3/langgraph/) |
| pi-agent-core | [`origin/pi-sdk`](zh/origin/pi-sdk/) | [`tier1/pi-sdk`](zh/tier1/pi-sdk/) | — | [`tier3/pi-sdk`](zh/tier3/pi-sdk/) |

[`zh/ai-sdk/`](zh/ai-sdk/) 是独立的 AI SDK v6 自定义 Adapter 示例，不属于上述同步链。表中的“—”表示仓库没有该应用的对应层；不应根据相邻层推导一个未签入的示例。

Claude Code Skill / Plugin 的编码任务评测示例位于独立仓库 [coding-agent-skill](https://github.com/CorrectRoadH/coding-agent-skill)。
