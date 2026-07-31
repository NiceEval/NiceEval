# 设计决策文档

这里记录需要对比多个候选方案、并给出选型结论的架构 / 技术决策——不是产品功能契约，功能契约见 [Feature](../feature/README.md)。

典型场景：换一个底层组件、在多种架构之间选型、要不要引入一个新依赖。
判断标准是"有没有值得摊开比较的候选项"；只有一种做法、没有分歧的技术细节直接写进 `architecture.md` 或对应功能页，不建这里的子目录。

## 结构

一个决策主题一个子目录，按下面顺序展开：

- `GOALS.md`：这个决策要达到什么、不达到什么，只写目标不写方案。
- `LIMITS.md`：候选共同面对的现状约束和外部事实，不下结论。
- `CASES.md`：真实场景影响选型时，定义方案中立的输入、验收结果与稳定 Case ID。
- `PLAN-N/`：每个候选方案一份自包含 Feature Design Package，编号从 1 递增。
  `README.md` 必备，Library、CLI、Architecture、Lifecycle 与 Use Case 按候选形态选用。
  被采纳的那份标题标注"（推荐）"。
- `DECISION.md`：综合 `GOALS.md` 与 `LIMITS.md` 后的最终结论，包括为什么否决其它候选项。

新开决策主题时,先复制 [Design Decision](../_template/design-decision/README.md) 外层。
每新增一个 PLAN,再复制同目录下唯一的 [Feature Design Package](../_template/feature-design/README.md)。

每个 PLAN 必须独立给出完整调用面、架构、生命周期与错误语义。
候选之间可以比较差异,不能用"未说明部分继承 PLAN-X"提供必需契约。
根 `CASES.md` 只定义共同问题;`PLAN-N/use-case/` 只展示本候选怎样兑现对应 Case ID。

## 和 Feature / Roadmap 的边界

`feature/` 与 `roadmap/` 写产品最终要满足的目标状态，不描述实现进度。
这里的文档写的是选型过程本身——候选项的现状、取舍和结论都是一次性的决策记录，定稿后不需要重写成目标状态；决策改变时新增 `PLAN-N/` 或更新 `DECISION.md`，不回改旧版本的结论。

选型落地后，产品要满足的契约仍然要写回 `feature/` 或对应设计页；这里只保留"为什么选它"。

子目录清单见 [`docs/README.md`](../README.md)。
