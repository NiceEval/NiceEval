# 默认报告比较当前 Scope，不建实验组

**最终裁决（2026-07-19）**：默认报告不再建立实验组，直接比较当前 Scope。每个 experiment 的 eval 集以快照 `ExperimentRunInfo.selectedEvalIds` 为准；路径只负责 experimentId 和 CLI 前缀选择。需要子集时收窄 Scope，不给 experiment 增加分组配置。

**同日撤销的中间方案**：曾考虑新增 `comparisonGroup` 字段，但它重复了 Scope 的职责，并给每个 experiment 增加额外心智负担，因此未进入最终契约。

**已废弃裁决（2026-07-15）**：曾要求 `niceeval show` / `view` 按 experiment id 的完整父目录分区。2026-07-19 裁决已完整取代它；父目录不再具有比较语义。

**当时的背景**：旧契约曾把“文件夹 = 一组可对比实验”写成正式规则，旧 View 也使用 `GroupSelector`。这套隐式分组现已取消。

**取代原因**：目录同时承担源码组织、id 和比较边界，嵌套后语义不清；显式 `comparisonGroup` 又过重。最终只保留两个已有事实：Scope 决定看哪些 experiment，`selectedEvalIds` 决定每个 experiment 跑过哪些 eval。

**实现护栏**：`ExperimentComparison` 对宿主 Scope 只计算一份 summary、scatter 与 list；web/text 不得另设组选择器。不同 experiment 的 eval 集由各自 `selectedEvalIds` 决定，未选择项不补成失败。设计单一归属见 `docs/feature/reports/architecture.md`。
