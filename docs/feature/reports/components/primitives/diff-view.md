# `DiffView`

`DiffView` 接收已生成的文件差异值：

```tsx
<DiffView files={files} />
```

路径、状态、行数、二进制标记、patch、basedOn 与 unavailable causes 都来自 Diff Projector 的 ReportData entry。
组件不读取 evidence、重新计算 patch 或把缺失解释成零个文件。

## 值形状

```ts
type DiffChange = "added" | "modified" | "deleted";

type DiffLineKind = "context" | "added" | "removed";

interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
  readonly oldLine?: number;
  readonly newLine?: number;
}

interface DiffFileWindow {
  readonly oldStart: number;
  readonly newStart: number;
  readonly lines: readonly DiffLine[];
}

interface DiffFile {
  path: string;
  change: DiffChange;
  added: number;
  removed: number;
  windows: readonly DiffFileWindow[];
  elided?: { reason: "binary" | "oversized-text" };
}
```

`DiffChange`、`DiffLineKind`、`DiffLine`、`DiffFileWindow` 与 `DiffFile` 的唯一 owner 是本页；它们是已经 materialize 的 ReportData 值，不是 Record event schema。

patch 按 Projector 已建立的 change interval 显示，不由 renderer 合成跨区间 patch。
web 面按路径树折叠，text 面输出同一数据的文件摘要；预算只改变内联密度。

## 相关阅读

- [Attempt diff](../attempt-detail/attempt-diff.md) —— Projection、available 与 unavailable。
- [`--diff`](../../show/diff.md) —— 终端 target。
