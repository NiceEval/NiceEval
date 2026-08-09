# Sample —— 参考方案

这一层说明固定选择为何是独立对象，而不是 Record reader 或报告组件的隐含行为。

## 可复现的数据切片

数据分析系统常把一次筛选当作后续图表的隐形输入。
NiceEval 把它写成固定 Sample：非空、canonical 排序的 source Graph 集合、canonical selector、成员、分母和 provenance 同时存在。
这使同一份选择可以被报告、审计和交付复用，而不会随着源 Store 的 head 漂移。

固定选择不等于任何结构相似的 object 都可信。runtime brand、canonical structure/order、不变量与 digest
由 Sample 的同一个 validator 复核。
外部消费者取得伪造或变造值时使用 `SampleValidationError`。Reports 只在自己的 typed failure 外层保留
这个 cause，而不重建字段级验证或把它解释成空样本。

## 版本化 membership

软件配置管理中的 revision 不只保存内容，还要保存「这个版本采用了哪些输入」。
RunContribution 的 slot 采用同一思想：Attempt 保持 origin，Run revision 只通过明确的 contribution 引用它。
严格线性 adopted revision 让每个 slot 在固定 Graph 中只有一个 current 值。

## 可验证的跨 Store 交付

内容寻址包系统会把 source object 的 bytes 与 proof 一起交付，而不是把远端对象当成本地可变引用。
SampleBundle 的分页 `RecordEvidenceProofIndexV1` 采用这一界限：event、object、Claim 与 authenticated absence 共用一种离线 proof 入口，归档 bytes 保持 inert，不把源节点激活成 Bundle 自己的图。
它能验证 source `RecordGraphRef`，却不会把源 Store 的活动图带进目标 Store。

Store capability 与 proof owner 也保持同一界限。
SampleBundleStore 只有 create/open 能取得 runtime brand；wrapper close 与已经取得的 child retain 相互独立。
source 读取和 proof closure 失败分别直接保留 `RecordSourceError` 与
`RecordEvidenceProofError`；固定 membership/proof prerequisite 的 lazy read 直接保留
`RecordReadError`。它们都不由 Sample 发明另一套包装错误。

## 相关阅读

- [Library](../library.md) —— 固定选择、冲突策略和 Sample Bundle。
- [Record 的参考方案](../../record/reference/README.md) —— 不可变事实图的出处。
- [Reports 的参考方案](../../reports/reference/README.md) —— 已计划呈现如何消费 Sample。
