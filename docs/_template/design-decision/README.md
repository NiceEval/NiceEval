# <决策主题名> —— Design Decision

这是 `docs/design/<name>/` 的决策外层模板。
复制本目录后,再把 [`../feature-design/`](../feature-design/README.md) 分别复制成 `PLAN-1/`、`PLAN-2/` 等候选。
每个 PLAN 都是完整 Feature Design Package,不得依赖另一 PLAN 才能成立。
写完删掉本说明段。

决策主题必须有 `GOALS.md`、`LIMITS.md`、至少一份 `PLAN-N/` 与 `DECISION.md`。
真实场景影响选型时保留 `CASES.md`;没有场景维度时删除它,并同步移除其它模板页的 Cases 导航。

**相关文档**:[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

一句话说明这个决策要解决什么问题,以及为什么值得摊开比较多个候选。
