# ⑤ 组件层

```text
┌────────────────────────────────────┐
│ Component = 展示镜头与诊断仪器    │
└────────────────────────────────────┘
```

## 心智模型

组件回答“一份闭合结果应该怎样被观察”。组件不创造事实，不决定统计口径，也不打开 Record。它只把 `SemanticFrame` 或 `DomainView` 转成 semantic node。

组件分成中立组件和官方领域组件。两者都可以由 Report 作者组合，但数据合同不同。

## 中立组件

中立组件的心智模型是“通用展示镜头”。它们只理解 Dimension、Measure、row、field metadata 与交互语义，不理解 Run、Attempt、Trace 或 evaluator。

```text
SemanticFrame
   ├─ Summary
   ├─ Table
   ├─ Bars
   ├─ Line
   ├─ Scatter
   └─ Heatmap
```

API 通过 typed field key 选择编码：

```tsx
<Table
  rows={rows}
  columns={[model, task, passRate, latency]}
/>

<Bars
  points={rows}
  x={model}
  y={passRate}
  color={condition}
  sort={{ field: passRate, direction: "desc" }}
/>

<Scatter
  points={rows}
  x={latency}
  y={passRate}
  color={model}
/>
```

中立组件必须显示或保留 `MetricValue` 的 state、observed、denominator、issues 与 refs。作者不能手动乘百分比、拼 unit 或把 partial 当作 available。

## 官方领域组件

官方领域组件的心智模型是“NiceEval 提供的诊断仪器”。它们理解树、时序、运行身份、评价过程和 Evidence navigation。

```text
opaque target / exact refs
   ├─ TraceViewer
   ├─ AttemptTimeline
   ├─ ExperimentProgress
   └─ EvidenceDrilldown
```

Report 作者 API：

```tsx
<TraceViewer trace={traceRef} />

<AttemptTimeline attempt={attemptRef} />

<ExperimentProgress experiment={experimentRef} />

<EvidenceDrilldown refs={metric.refs} />
```

这些 props 只携带 opaque identity、exact refs 与显示选项。平台在 Report tree 闭合前按身份查找并形成对应 `DomainView`，renderer 不取得领域投影 capability。

## 自定义复合组件

Report package 可以定义复合组件：

```tsx
export const ModelLeaderboard = defineComponent(
  async (_props, { sample }) => {
    const rows = await aggregate(sample, {
      by: { model },
      values: { passRate, latency },
    });

    return <Bars points={rows} x={model} y={passRate} />;
  },
);
```

```ts
declare function defineComponent<Props>(
  render: (
    props: Props,
    context: { readonly sample: ReportSample },
  ) => ReportNode | Promise<ReportNode>,
): ReportComponent<Props>;
```

一个 component instance 在一次 `ReportExecution` 中最多执行一次。它只能返回内建 semantic primitives 或其它复合组件。

## Primitive 扩展边界

新增 host primitive 必须同时定义：

- 输入的闭合类型。
- terminal 语义。
- Web 语义。
- static 与无 JavaScript 降级语义。
- 键盘、焦点、精确值和 Evidence navigation。
- partial、empty、unsupported 与 failed 的呈现方式。

普通 Report package 不能注册 renderer plugin。只需要组合既有 primitive 的能力应写成复合组件，不扩大 host protocol。

## 禁止跨出的边界

- 不读取 Record、Artifact path 或旧 schema。
- 不执行 raw SQL 或任意事实查询。
- 不重新聚合 rows，也不缩小 denominator。
- 不把 display sort、limit 或 locale 变成业务口径。
- 不让 Web 组件拥有 terminal 与 static 无法表达的唯一结果语义。
