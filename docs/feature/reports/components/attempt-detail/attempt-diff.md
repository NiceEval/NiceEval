# Attempt diff

Diff 是参数化 Attempt detail page 在 plan 中声明的 Projection：

```ts
interface DiffProjection {
  attempt: AttemptRef;
  files: EvidenceValue<readonly DiffFile[]>;
}
```

`DiffProjection` 的唯一 owner 是本页；`AttemptRef` 与 `EvidenceValue` 由 [Record Library](../../../record/library.md#runcontribution-与-attempt-handle) owner，`DiffFile` 由 [`DiffView`](../primitives/diff-view.md#值形状) owner。

`DiffView` 只消费 `files` 已有的 available 或 unavailable 结果。
Attempt details、show diff target 与 JSON target 共享同一份 ReportData entry，不各自读取 workspace 证据。

## 差异从哪里来

Diff Projector 从 Record 中已经 snapshot 的 workspace-change evidence 构造文件级视图。
它的 `ProjectionReadContext` 跟踪每个读取对象、event 和 Claim，因此结果的 `basedOn` 能复核 provenance。

Projector 可以给出净状态、触碰区间与 patch 等纯显示值。
它不得在读取时扫描工作目录、运行 git、请求网络或依据当前 sandbox 状态猜差异。

## 可用性

缺少 workspace-change evidence 时，`files` 是 unavailable EvidenceValue，而不是空文件列表。
causes 保留「源 Record 未采集」「权限或 capability 不支持」「对象损坏」等全部已知原因。

源 Record 有 evidence、但 Report artifact 无法复制或验证它时，导出失败；该故障不能改写为普通的 unavailable 结果。

## 相关阅读

- [`DiffView`](../primitives/diff-view.md) —— 值形状、路径树与内联预算。
- [`show`](../../show.md) —— 终端 target。
- [Record Library](../../../record/library.md) —— Projector 的事实读取边界。
