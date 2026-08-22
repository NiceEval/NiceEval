# PLAN-2：React component library 为公共核心

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md)

## 解决的问题

本方案发布一套可直接 import 的 React benchmark components。组件内部取得 Analysis 数据，用户只负责把组件放进自己的 React 或 Astro 页面。

CLI 与 Insight 仍独立。网页公共面以 React props 和 provider 为稳定 ABI。

## 核心心智

```text
Record → Analysis → BenchmarkProvider
                       ├─ BenchmarkTable
                       ├─ BenchmarkChart
                       └─ EvidenceLink
```

```tsx
import {
  BenchmarkProvider,
  BenchmarkTable,
  QualityCostChart,
} from "@niceeval/react";

export function Results() {
  return (
    <BenchmarkProvider source="/api/niceeval">
      <QualityCostChart />
      <BenchmarkTable />
    </BenchmarkProvider>
  );
}
```

## 数据与交互

Provider 需要拥有 fetch、selection、revision、loading 与 error。组件还要决定排序、Evidence route、缺失显示、键盘行为和图表输入。

即使所有组件都允许 `className` 和 render props，用户仍先经过 NiceEval 的 component data model。使用另一种图表库时，需要从 Provider 再导出 raw data escape hatch。

## 静态与动态

静态站必须把 Provider 预加载数据序列化成 hydration props，或在浏览器启动后 fetch。动态站则由 Provider 访问用户 server。

两种模式会推动 Provider 同时承担 Bundle transport、URL、缓存、鉴权与 revision。React 组件随后成为事实上的网页 host。

## CLI 与 Insight

CLI 可以独立使用 AnalysisMaterializer。Insight 也可以拥有自己的第一方 UI。

但公共 React Provider 为了复用，很容易被 Insight 反向采用。Insight 的需求随后会扩大公共 ABI，带入 trace、router、theme 与私有错误状态。

## Cases

| Case | 结果 |
|---|---|
| C1–C5 | CLI 与 Insight 可以另行兑现。 |
| C6 | React / Astro 可用，但任意图表与完全自定义结构仍需逃生数据面。 |
| C7 | Provider 必须固定 HTTP 与缓存协议。 |
| C8 | React 最方便，但 Astro hydration 仍由用户 wrapper 决定。 |
| C9–C11 | 必须把 Bundle、blob、identity 与参数化继续写入 Provider。 |
| C12 | raw data escape hatch 会变成真正的稳定核心。 |

## 代价

- React 进入所有 benchmark consumer 的依赖边界；
- Provider 必然吸收 fetch、selection、revision、路由和统计约束；
- Table、Chart 与 Evidence 组件会重新形成旧 Report 的公共 UI 平台；
- 用户的页面所有权仍受 NiceEval component model 约束。

本方案满足组件开箱即用，却违背 G5、G6、G10 与 G14。
