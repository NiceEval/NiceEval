# `SampleNotices`

`SampleNotices` 回答「这份 Sample 的数字可不可信」：解释 `SampleSnapshot` 中的覆盖、来源与
读取期 Issue。它是组合组件，与 [`RunNotices`](run-notices.md)、
[`AttemptNotices`](../attempt-detail/attempt-notices.md) 同构——Source 返回事实，
[`notices` 口径目录](../README.md#口径目录noticesfixprompts)把事实同步、确定地解释成读者
可行动的 Notice，再交给 [`Callouts`](../primitives/callouts.md) 呈现，全文是：

```tsx
export const SampleNotices = defineComposition(async (_props, ctx) => {
  const snapshot = await ctx.resolve(sources.sample.snapshot);
  return <Callouts data={notices.sample(snapshot)} />;
});
```

```tsx
<SampleNotices />
```

`notices.sample` 是 `notices` 目录的 Sample 入口，纯函数：

```ts
interface Notices {
  sample(snapshot: SampleSnapshot): readonly CalloutGroup[];
}
```

它不读取 Sample、Record 或 artifact，不请求外部服务，也不改变 snapshot。
同一份 snapshot 必须得到同一组条目。它把 `SampleIssue.kind + fields` 映射为本地化
message / command；未收尾 Run、不可读落盘等建议可以随 NiceEval 版本演进，不污染历史记录。
coverage 缺口若能落到实体行，仍由占位行和时效标记承担，不重复产生 Issue。

Notice 的严重度、文案和 action 都是当前产品解释，不写回 `.niceeval`，也不伪装成
persisted diagnostic。呈现（汇总行恒可见、详情折叠、text 面不折叠、空集零输出）遵循
`Callouts` 原语。

自有 React 页面没有 resolve 阶段，先算 snapshot 再走 `Callouts` 的 data 形态：

```tsx
const snapshot = await sources.sample.snapshot.compute(sample);
<Callouts data={notices.sample(snapshot)} />
```

## 相关阅读

- [Source · Snapshot](../sources/README.md#snapshot) —— 本组件消费的中性事实。
- [`RunNotices`](run-notices.md) —— 组合 snapshot 与持久化 Run diagnostics 的同构组合组件。
- [`Callouts`](../primitives/callouts.md) —— 分组、折叠与两面渲染的通用显示形状。
