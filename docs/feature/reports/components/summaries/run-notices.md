# `RunNotices`

`RunNotices` 回答「这批 Run 的执行过程有没有问题」，是默认报告对运行事实的产品解释。它同时读取
SampleSnapshot 与 persisted diagnostics，交给 [`notices` 口径目录](../README.md#口径目录noticesfixprompts)
分类成 `Callouts` 的分组条目，全文是：

```tsx
export const RunNotices = defineComposition(async (_props, ctx) => {
  const [snapshot, diagnostics] = await Promise.all([
    ctx.resolve(sources.sample.snapshot),
    ctx.resolve(sources.run.diagnostics),
  ]);

  return <Callouts data={notices.run(snapshot, diagnostics)} />;
});
```

```tsx
<RunNotices />
```

`notices.run` 是 `notices` 目录的 Run 入口，纯函数：

```ts
interface Notices {
  run(
    snapshot: SampleSnapshot,
    diagnostics: RunDiagnosticsContent,
  ): readonly CalloutGroup[];
}
```

它决定哪些 observation 可见、怎样按 experiment 与 Run 分组，以及当前 locale 的
title / detail / action。原始 level、code、detail、data、count 与来源身份保留在
Notice 的证据细节中；未知 code 回退显示 detail，不猜 action。这些决定不属于 Source，
也不写回记录。呈现（汇总行恒可见、详情折叠、text 面不折叠、空集零输出）遵循
[`Callouts`](../primitives/callouts.md) 原语。

## 相关阅读

- [`sources.run.diagnostics`](../sources/run-diagnostics.md) —— 本组件消费的中性运行事实。
- [`SampleNotices`](sample-notices.md) —— 只解释 SampleSnapshot 的同构组合组件。
- [`Callouts`](../primitives/callouts.md) —— 分组、折叠与两面渲染的通用显示形状。
