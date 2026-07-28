# `sources.run.diagnostics`

runner / adapter diagnostic 是已经记录在 `.niceeval` 中的运行事实，因此是普通 Source：

```ts
interface RunDiagnosticsItem {
  experimentId: string;
  startedAt: string;
  diagnostics: readonly DiagnosticRecord[];
}

type RunDiagnosticsContent = readonly RunDiagnosticsItem[];

declare const diagnostics: Source<Sample, RunDiagnosticsContent>;
```

`sources.run.diagnostics` 只投影 diagnostics 非空的真实 Run，不跨 Run 合并记录。diagnostic 保存
code / phase / level / detail / data / count 等 observation，不保存最终用户文案或 action。输出按
experiment id 字典序排列，同一实验内按 `startedAt` 从新到旧排列。

哪些 observation 可见、怎样分组、当前 locale 的文案与 action，都是消费侧的产品解释，
归 [`RunNotices`](../summaries/run-notices.md)，不属于本 Source。

## 相关阅读

- [`RunNotices`](../summaries/run-notices.md) —— 组合 snapshot 与本 Source 的默认报告区块。
- [Source 目录](README.md) —— persisted diagnostic 与 Notice 的边界。
