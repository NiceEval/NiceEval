# Cases

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [DECISION](DECISION.md)

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| T1 | 一个 Feature 与什么相关？ | `feature list` 输出的精确 Feature ID | `feature show` 按 Use Case 列出测试，并列出直接子功能、Roadmap/Design/Engineering、current promotions 与 test regressions |
| T2 | 一份测试守护什么？ | `test list` 输出的 E2E test/spec path | `test show` 列出唯一 owner anchor、唯一产品契约、所属 Features 与全部 canonical regressions |
| T3 | 没有自动化是否是错误？ | 一个没有 owner 的 Use Case | 显示空测试集合并成功退出，不创建 coverage finding |
| T4 | 跨 Feature Journey 怎样反查？ | 一个拥有 `composes` 的跨 Feature Use Case | 每个被组合 Feature 都能反查该 Use Case 及其 owner/test |
| T5 | 怎样创建文档？ | kind、slug、title 与所选页面 | 只从模板 manifest 创建最小 package，更新生成区并返回精确 receipt |
| T6 | Roadmap 怎样采用？ | Roadmap、目标 Feature 与绑定 digest 的 adoption manifest | 强引用与结构化 promotions 一致迁移，legacy Memory 不变，外部普通链接只报告候选 |
| T7 | 中断或并发时读到什么？ | 任一 mutation phase 中断，或读取期间 generation 变化 | 恢复到完整旧/新状态；读命令重试或具名失败，不返回混合 Snapshot |
| T8 | legacy Memory 怎样显示？ | 被 `regression:` 显式引用的无结构化 frontmatter 文件 | 显示 `legacy/unstructured`，不推断 Bug 状态，也不满足 Problem-only gate |
| T9 | Design 怎样表达已选方案？ | 一个定稿 Design | README 有且只有一个 `selectedPlan`，目标是直接包含的 `design-plan` |
