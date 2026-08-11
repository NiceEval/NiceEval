# 复用 Sandbox 内切换 Git commit —— Design Decision

**相关文档**：[Goals](GOALS.md) · [Limits](LIMITS.md) · [Cases](CASES.md) · [Decision](DECISION.md)

同一题组的多道 Eval 经常来自同一个 GitHub repository，只是 base commit 不同。
本设计比较每题重新 clone、直接复用上一题 `.git`，以及在同一 Sandbox 内保留一个 repository seed 三种方案。

- [PLAN-1：每题重新 clone](PLAN-1/README.md)
- [PLAN-2：直接复用上一题 `.git`](PLAN-2/README.md)
- [PLAN-3：组级 repository seed](PLAN-3/README.md)

目标契约落在 [分组 Sandbox 复用](../../roadmap/sandbox-reuse-groups/README.md)。
本目录只保存为什么选择“组级 repository + 每题 commit”的理由。
