# PLAN-3：Framework-neutral data-only

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md)

## 解决的问题

本方案只发布 `BenchmarkBundleDefinition`、`BenchmarkBundle`、materializer、codec 与 reader。用户用任何框架、图表库或 server runtime 消费数据，NiceEval 不发布网页组件。

CLI、Insight 和 Bundle 都使用同一 AnalysisMaterializer。

## 核心心智

```text
Record → AnalysisMaterializer
           ├─ query / show
           ├─ InsightRevision
           └─ BenchmarkBundle → user code
```

```ts
import { openBundle } from "niceeval/benchmark";

const bundle = await openBundle({ manifest, read });
const frame = await bundle.resource("quality-by-model");

renderWithAnyChartLibrary(frame);
```

## Bundle contract

Bundle 使用内容寻址 manifest 与具名 resource。资源只有 `semantic-frame`、`domain-view` 与 `blob`，并完整保留 comparability、alignment、MetricValue、issues、refs 与 provenance。

静态与动态都调用同一个 materializer。动态模式仍由用户 server 交付完整 Bundle，不存在 NiceEval HTTP query server。

## CLI 与 Insight

`niceeval query` 暴露稳定 discovery/query/explain 协议；`show` 只做人读快速查看。Insight 固定在一个 InsightRevision 内按需读取，Record 变化只提示刷新。

三者共享 materializer 与 closed codec，不共享 transport 或呈现。

## Cases

| Case | 结果 |
|---|---|
| C1–C7 | 完整兑现。 |
| C8 | 用户必须自己实现 React revision coherence、resource hook 与 MetricValue 可访问性。 |
| C9–C12 | 完整兑现。 |

## 优势

- framework-neutral 边界最干净；
- 静态、动态、CLI 与非网页 consumer 都读同一数据协议；
- NiceEval 不拥有用户页面、hydration、路由或样式；
- React 不进入 core dependency。

## 代价

React 用户会重复实现 Bundle context、异步资源一致性与完整度展示。不同项目也可能各自错误折叠 `MetricValue`、遗漏 Evidence，或把混合 BundleIdentity 的资源放到同一个页面。

本方案满足全部正确性目标，是可接受的第二选择。它在 C8 的重复成本上弱于 PLAN-4。
