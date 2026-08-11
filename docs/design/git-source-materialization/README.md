# Git repository 安全交付 —— Design Decision

**相关文档**：[Goals](GOALS.md) · [Limits](LIMITS.md) · [Cases](CASES.md) · [Decision](DECISION.md)

多道 Eval 可以来自同一个 Git repository，却必须从不同 commit 开始，并且不能看到各自 commit 之后的对象。
这个决策比较四种复用 Git 下载的方式，裁决哪些状态留在宿主，哪些材料可以进入 Sandbox，以及失败后如何维持题间隔离。

## 候选

- [PLAN-1：Sandbox 内完整 mirror](PLAN-1/README.md)
- [PLAN-2：共享对象库](PLAN-2/README.md)
- [PLAN-3：单一 repository cache entry](PLAN-3/README.md)
- [PLAN-4：SourcePool 与 SourceProjection（推荐）](PLAN-4/README.md)

最终产品契约归 [Provider Cache 生命周期](../../roadmap/materialization-cache/README.md)。
本目录保存候选比较与选型理由，不作为作者调用面的单源。
