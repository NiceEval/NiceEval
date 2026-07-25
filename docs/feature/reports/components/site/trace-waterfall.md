# `TraceWaterfall`

每个 attempt 一行的执行时间瀑布，用 canonical OTel 字段显示被测 agent 的原始 span（agent / model / tool）。行内只画顶层 span 摘要；完整瀑布与 runner 时间树的组合视图由 [`AttemptTimeline`](../attempt-detail/README.md#公开区块集) 详情组件承担，本组件不复制它。

```ts
interface TraceSpanSummary {
  name: string;
  kind: "agent" | "model" | "tool" | "other";
  startOffsetMs: number;
  durationMs: number;
  failed: boolean;
}

interface TraceWaterfallRow {
  experimentId: string;
  evalId: string;
  locator: AttemptLocator;
  /** trace.json 缺失或为空时 null；行照常出现，证据位置如实显示缺失，不猜值。 */
  durationMs: number | null;
  /** 顶层 span 摘要，按 startOffsetMs 升序。 */
  spans: readonly TraceSpanSummary[];
}

function traceWaterfallData(input: ReportInput): Promise<readonly TraceWaterfallRow[]>;

type TraceWaterfallProps = ComponentProps<readonly TraceWaterfallRow[], {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

- web 面：一行一个 attempt，静态渲染顶层 span 分解条（失败 span 带失败标记），行链接到 attempt 详情；排序、缩放是渐进增强。
- text 面：一行一个 attempt——locator、总耗时、span 计数与失败标记，行尾给出可复制的 `niceeval show @<locator> --timing` 下钻命令。attempt 有选择器，所以 text 面可折成带命令的索引，不倾倒逐 span 明细。
- 只画被测 agent 的原始 span；runner 生命周期节点不进 trace 事实（[Architecture · 事实与看法](../../architecture.md#事实与看法)），组合视图归 attempt 详情。

```tsx
<TraceWaterfall />
```

## 相关阅读

- [站点组件](README.md) —— 这一族为什么不收结构子节点。
