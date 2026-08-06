# 研究与迁移参考

本目录保存“为什么这样设计”的历史材料，不拥有目标 API，也不直接产生测试义务：

这些材料写于 PLAN-2 阶段，文中的 Behavior / proof、Recipe / World、DSL 等词保留研究现场，不代表最终实现。
阅读时按选定方案映射：用户侧 proof → Result / Journey，recipe / world → 场景 Repo 的 prepare 与隔离副本，
领域 DSL → 原生断言或局部机械 helper。最终裁决以本目录上层文档为准。

- [现行体系失效分析](current-system-gaps.md)
- [历史缺陷账本](bugs/README.md)
- [最近两天修复覆盖审计](bugs/recent-fixes-2026-08-04-to-05.md)

稳定契约回到上层 [README](../README.md)、[Architecture](../architecture.md)、[Portfolio](../portfolio.md)、
[E2E](../e2e/README.md)、[Unit](../unit/README.md)和 [Execution](../e2e/execution.md)。
