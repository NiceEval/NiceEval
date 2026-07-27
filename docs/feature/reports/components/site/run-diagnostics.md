# `sources.run.diagnostics` 与 `RunNotices`

runner / adapter diagnostic 是已经记录在 `.niceeval` 中的运行事实，因此保留普通 Source：

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

`RunNotices` 是默认报告的产品解释。它同时读取 SampleSnapshot 与 persisted diagnostics，再把两类事实
分类成 `CalloutsContent`：

```tsx
export const RunNotices = defineComposition(async (_props, ctx) => {
  const [snapshot, diagnostics] = await Promise.all([
    ctx.resolve(sources.sample.snapshot),
    ctx.resolve(sources.run.diagnostics),
  ]);

  return <Callouts data={classifyRunIssues(snapshot, diagnostics)} />;
});
```

`classifyRunIssues()` 是纯函数。它决定哪些 observation 可见、怎样按 experiment 与 Run 分组，
以及当前 locale 的 title / detail / action。原始 level、code、detail、data、count 与来源身份保留在
Notice 的证据细节中；未知 code 回退显示 detail，不猜 action。这些决定不属于 Source，也不写回记录。

web 面的汇总行恒可见，详情用原生 `<details>`；text 面不折叠。空结果两面零输出。

## 相关阅读

- [`SampleNotices`](sample-warnings.md) —— 只解释 SampleSnapshot 的单 Source Component。
- [Source 目录](../sources/README.md) —— persisted diagnostic 与 Notice 的边界。
