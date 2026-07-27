# `SampleNotices`

`SampleNotices` 解释 `SampleSnapshot` 中的覆盖、来源与读取期 Issue。它是 Component，不是 Source：
`sources.sample.snapshot` 返回事实，本组件把事实同步、确定地解释成读者可行动的 Notice。

```tsx
<SampleNotices source={sources.sample.snapshot} />

const snapshot = await sources.sample.snapshot.compute(sample);
<SampleNotices data={snapshot} />
```

```ts
interface Notice {
  code: string;
  severity: "info" | "warning" | "error";
  title: LocalizedText;
  detail?: LocalizedText;
  locator?: AttemptLocator;
  command?: string;
}

function findSampleIssues(snapshot: SampleSnapshot): readonly Notice[];
```

`findSampleIssues()` 是纯函数：不读取 Sample、Record 或 artifact，不请求外部服务，也不改变 snapshot。
同一份 snapshot 与 locale 必须得到同一组 Notice。它把 `SampleIssue.kind + fields` 映射为本地化
title / detail / action；未收尾 Run、不可读落盘等建议可以随 NiceEval 版本演进，不污染历史记录。
coverage 缺口若能落到实体行，仍由占位行和时效标记承担，不重复产生 Issue。

```ts
export const SampleNotices = defineComponent<SampleSnapshot>({
  text(snapshot, _options, ctx) {
    return renderNoticesText(findSampleIssues(snapshot), ctx);
  },
  web(snapshot, _options, ctx) {
    return renderNoticesWeb(findSampleIssues(snapshot), ctx);
  },
});
```

`renderNoticesText` / `renderNoticesWeb` 是与 `Callouts` 共用的纯 renderer，不是报告树节点。Component
已经进入某一渲染面后，不再返回 `<Callouts>` 报告组件。

web 面以原生 `<details>` 渐进折叠，summary 恒显示数量与最高严重度；text 面不折叠，完整输出标题、
detail 与 command。空 Notice 集两面零输出。Notice 的严重度、文案和 action 都是当前产品解释，
不写回 `.niceeval`，也不伪装成 persisted diagnostic。

## 相关阅读

- [Source · Snapshot](../sources/README.md#snapshot) —— 本组件消费的中性事实。
- [`RunNotices`](run-diagnostics.md) —— 组合 snapshot 与持久化 Run diagnostics。
- [`Callouts`](../primitives/callouts.md) —— 手工准备 Notice data 时使用的通用显示形状。
