# `--diff`：核对 agent 实际改动

`--diff` 是 Attempt detail 的 Diff target。
plan 声明 Diff Projector，executor 交付 `EvidenceValue<readonly DiffFile[]>`，text 与 web 显示同一份结果。

```sh
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --diff
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --diff=src/example.ts
```

默认输出文件摘要：状态、增删行数、已建立的 change window 与完整 AttemptRef。
路径模式是规范化 target 参数，必须对应 Plan 已枚举的 Diff data；它不会在命令执行时扫描工作目录。

patch 按 Projector 已建立的 change interval 分段显示，不合成跨区间 patch。
二进制或预算省略的内容保留明确状态和 causes，不能假装没有改动。

源 Record 没有 workspace-change evidence 时，Diff target 显示 unavailable。
源 Record 中已有、但 export 无法复制或验证时，导出失败而不是显示普通缺失。

## 相关阅读

- [Attempt diff](../components/attempt-detail/attempt-diff.md) —— Diff Projection。
- [`DiffView`](../components/primitives/diff-view.md) —— web 面。
- [show](../show.md) —— target 选择。
