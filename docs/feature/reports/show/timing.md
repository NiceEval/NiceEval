# `--timing`：Attempt 的统一时间树

`--timing` 是 Attempt detail 的时间树 target。
它在 ReportPlan 中声明 timing Projector，再把 executor 已交付的 `EvidenceValue<TimingTree>` 交给 text 与 web renderer。

renderer 不读取 Record event、trace、Sandbox 或任何原始文件；它只显示已建立的节点、basedOn、verification 与不可用原因。

## 两档密度

```sh
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --timing
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --timing=full
```

默认 target 显示有界诊断树：保留 lifecycle 边界、失败路径、最慢节点和首尾时序样本，并在省略位置报告准确的节点数与失败数。
`full` 显示同一份 Projection 的全部可用节点；它不触发额外 evidence 读取。

`--json` 使用 full 的节点集合，但仍只输出同一 Plan 已生成的 data。

## 节点与证据

TimingTree 可以含 Runner phase、命令、Turn、Activity 与已关联 telemetry span。
节点的顺序、父子关系、耗时和错误状态由 Projector 从固定 Graph 形成。
未知 producer key 以已交付 label 呈现；renderer 不识别 shell 文本或 event 名来猜类别。

命令、Turn 或 telemetry evidence 缺少时，树中的对应节点保留 unavailable EvidenceValue。
limited 与 unverified 状态同样原样显示，不能被 full 模式掩盖。

## 边界

- budget 只影响显示密度，不影响 Sample、Projection、coverage 或 evidence closure。
- text、web 和 JSON 不各自重建时间树。
- exporter 无法复制一个源 Record 中已有的时间依据时，整个 Report artifact 导出失败；它不是时间树里的普通 unavailable。
- 脱敏和采集预算在 Record 事实边界完成；renderer 不尝试恢复或猜测值。

## 相关阅读

- [Attempt details](../components/attempt-detail/README.md) —— 时间树所在的详情页面。
- [Architecture](../architecture.md#结果值) —— EvidenceValue 与 verification。
- [show](../show.md) —— target 选择。
