# 外壳与多页

报告外壳只保留宿主必须在 plan 前读取的静态声明。
页面内容、页脚、页头链接和团队署名都是 ReportNode 组合。

## 普通页 shorthand

普通页面可使用唯一 shorthand：同时省略 `instanceId` 与 `route`，但它的 data 仍必须在 plan 中列出：

```tsx
export default defineReport({
  plan({ sample }) {
    const rows = aggregate(sample, {
      id: "experiment-summary",
      by: ["experiment"],
      measures: { passRate },
      unavailable: "exclude",
    });

    return {
      pages: [
        {
          id: "report",
          title: "Report",
          data: { rows },
          render({ rows }) {
            return <Table rows={rows} />;
          },
        },
      ],
    };
  },
});
```

executor 在执行任何 request 前把该页规范化为
`instanceId: "report"`、`route: { pathname: "/report", parameters: {} }` 与
`navigation: true`。shorthand id 只接受 Library 规定的 slug；只省略 instanceId 或只省略 route
都不是另一种写法，而是 `report-plan-invalid`。`rows` 是完整 `AggregateData`，Table 不把
unavailable 当成空表。

## 多页形状

`ReportDefinition`、`ReportParameterSchema`、`LocalizedText`、`HeadTag`、`ReportPlanInput` 与 `ReportPlan` 的唯一完整形状见 [Reports Library](../library.md#reportdefinitionrequest-与-reportdata)。本页不另立近似接口。

pages 是 plan 返回的非空有序列表，数组顺序就是导航顺序。
page id 不得重复；数字样式的 id 仍按数组位置导航，不做数值排序。
`ReportPlan.pages` 的作者项是 `ReportPageInput`。executor 先把每项构造成字段完整的
`PlannedPage`，再做 target 与 route 去重；ReportExportPlan 中只写完整 `ReportPlannedPage`。

## 完整示例

```tsx
export default defineReport({
  title: "Security evals",
  plan({ sample }) {
    const performance = aggregate(sample, {
      id: "performance",
      by: ["agent"],
      measures: { passRate, costUSD },
      unavailable: "exclude",
    });

    return {
      pages: [
        {
          id: "overview",
          title: "Overview",
          data: { performance },
          render({ performance }) {
            return <Table rows={performance} />;
          },
        },
        ...attemptDetailPages(sample, { projector: attemptDetails }),
      ],
    };
  },
});
```

plan 先枚举 overview 和全部 Attempt detail instance，再由 executor 统一求 data。
每个 instance 的 render 只运行一次，text 与 web 读取同一树。
overview 使用普通页 shorthand；`attemptDetailPages()` 产生的每一项都必须显式携带 instanceId 与
route，因为同一个 page id 对应多个 Sample membership。两种 authoring 形状不会在 executor 之后并存。

## 外壳字段穷尽

| 字段 | 宿主必须提前读取的原因 |
|---|---|
| `parameters` | 校验、默认值和 JCS identity |
| `title` | 浏览器标题与 show 索引标题 |
| `theme` | 主题有独立装载链 |
| `dimensionPins` | 固定视觉身份 |
| `head` | 文档 head 不在报告树中 |
| `plan` | 枚举页面与所有 data dependency |

除此之外没有外壳槽位。
组件资产随 renderer 声明，站点级字体、SEO 与埋点才进入 `head`。

## `head`

`head` 只接受白名单中的静态标签和属性。
它的本地资产位于冻结 module graph 内，导出时按内容哈希复制。
head 脚本只能增强宿主，不能取得 Record 数据或改写 Metrics。

## `dimensionPins`

`dimensionPins` 把已计划 group 的值钉在固定视觉槽位：

```ts
type DimensionPins = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;
```

固定只影响呈现，不改变 Sample、Calculation、MetricValue 或 evidence。
未固定值按同一 page instance 的已交付 keyset 分配，不能为此执行其他页面。

## 跨页复用

跨页内容是 render 对已交付 data 的普通高阶函数：

```tsx
const withFooter = <Data extends ReportJsonObject>(
  render: (data: Readonly<Data>) => ReportNode,
) => (data: Readonly<Data>) => (
  <Stack>
    {render(data)}
    {footerNote}
  </Stack>
);
```

它不能追加 Projector request 或读取新的 Store。

## 相关阅读

- [Library](../library.md) —— ReportDefinition 与 parameter schema。
- [Architecture](../architecture.md) —— plan、executor 与页面 identity。
- [主题](theme.md) —— Theme 的装载和分发。
