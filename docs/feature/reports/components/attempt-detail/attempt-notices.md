# `AttemptNotices`

`AttemptNotices` 回答「这次 attempt 有没有基础设施问题」。它把 snapshot 中的 error 与
persisted attempt diagnostics 交给 [`notices` 口径目录](../README.md#口径目录noticesfixprompts)
分类成 `Callouts` 的分组条目，与 [`SampleNotices`](../summaries/sample-notices.md)、
[`RunNotices`](../summaries/run-notices.md) 同构，全文是：

```tsx
export const AttemptNotices = defineComposition(async (_props, ctx) => {
  const [snapshot, diagnostics] = await Promise.all([
    ctx.resolve(sources.attempt.snapshot),
    ctx.resolve(sources.attempt.diagnostics),
  ]);
  return <Callouts data={notices.attempt(snapshot, diagnostics)} />;
});
```

```tsx
<AttemptNotices />
```

`notices.attempt` 是 `notices` 目录的 attempt 入口，纯函数：

```ts
interface Notices {
  attempt(
    snapshot: AttemptSnapshot,
    diagnostics: readonly DiagnosticRecord[] | null,
  ): readonly CalloutGroup[];
}
```

分类同步、确定，不读取 evidence，也不改写 diagnostic。Snapshot error 与 persisted diagnostic
是事实；Notice 决定分组、可见性、本地化文案与 action。未知 diagnostic code 回退显示原始
detail，不猜 action。呈现（汇总行恒可见、详情折叠、text 面不折叠、空集零输出）遵循
[`Callouts`](../primitives/callouts.md) 原语。

## 相关阅读

- [Attempt 详情](README.md) —— 公开区块集与 page 输入形态。
- [`AttemptAssessment`](attempt-assessment.md) —— 把本组件摆在断言区块前的组合件。
- [`Callouts`](../primitives/callouts.md) —— 分组、折叠与两面渲染的通用显示形状。
