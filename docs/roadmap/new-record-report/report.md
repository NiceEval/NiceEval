# ⑥ Report 组合层

```text
┌────────────────────────────────────┐
│ Report = 可执行报告配方            │
└────────────────────────────────────┘
```

## 心智模型

Report 回答“查询、页面与组件怎样组织，才能让人看懂一次或多次运行”。Report 是在 frozen Sample 上执行一次的 TypeScript 配方，不是持久数据库，也不是另一组持久事实。

Report execution 完成后，只留下闭合语义树。callback、Promise、Sample capability、执行引擎与 Record handle 都不会进入 renderer。

## 解决的问题

- 为一次或多次运行选择共同 frozen Sample。
- 调用 typed Analysis query。
- 组织 Summary、Table、Chart、Trace 与 Evidence。
- 建立 Page、PageFamily、route 与稳定下钻目标。
- 隔离 Page failure。
- 为 terminal、Web 与 static 生成同一棵闭合语义树。

## ReportSample

Report 作者获得受限 `ReportSample`：

```ts
interface ReportSample {
  readonly identity: ReportSampleIdentity;
  readonly selection: ReportSelectionSummary;
  readonly problems: readonly ReportSampleProblem[];
  readonly coverage: ReportSampleCoverage;
}
```

它没有 `runs`、`attempts`、`events`、Record path、projection 或 migration capability。需要新总体、成员表或关系时，Analysis package 必须先发布 Population、Dimension、Measure 或 Relation。

## Query API

```ts
declare function aggregate<By extends Dimensions, Values extends Measures>(
  sample: ReportSample,
  options: {
    readonly by: By;
    readonly values: Values;
  },
): Promise<readonly AggregateRow<By, Values>[]>;
```

```ts
const rows = await aggregate(sample, {
  by: { model, condition },
  values: { passRate, latency },
});
```

每行包含完整 grouping coordinate、稳定 row key 和 `MetricValue`。callback 可以依据 closed rows 选择布局、显示顺序和后续组件，但不能从处理后的数组重新计算 Measure。

## Page API

```ts
interface PageDefinition {
  readonly id: string;
  readonly route: string;
  readonly title: LocalizedText;
  readonly render: (context: {
    readonly sample: ReportSample;
    readonly params: Readonly<Record<string, string>>;
  }) => ReportNode | Promise<ReportNode>;
}

declare function definePage(
  definition: PageDefinition,
): PageDefinition;
```

PageFamily 的 key 必须来自 Analysis 发布的 stable identity Dimension。route 不能使用数组 index、显示 label 或模糊时间匹配。

## Report API

```ts
interface ReportDefinition {
  readonly id: string;
  readonly pages: readonly (PageDefinition | PageFamilyDefinition)[];
}

declare function defineReport(
  definition: ReportDefinition,
): ReportDefinition;
```

完整组合示例：

```tsx
const overview = definePage({
  id: "overview",
  route: "/",
  title: "实验概览",

  render: async ({ sample }) => {
    const rows = await aggregate(sample, {
      by: { model },
      values: { passRate, latency },
    });

    return (
      <Stack>
        <Bars points={rows} x={model} y={passRate} />
        <Table rows={rows} columns={[model, passRate, latency]} />
      </Stack>
    );
  },
});

export default defineReport({
  id: "experiment-report",
  pages: [overview, attemptPageFamily],
});
```

## Closed Report Tree

Report execution 的唯一输出是闭合语义树：

```ts
interface ClosedReportTree {
  readonly report: ReportIdentity;
  readonly sample: ReportSampleIdentity;
  readonly pages: readonly ClosedPage[];
  readonly routes: readonly ClosedRoute[];
  readonly problems: readonly ReportProblem[];
  readonly provenance: ReportProvenance;
}
```

领域组件的 opaque target 已经按身份查找并形成 closed `DomainView`。Evidence preview 已经按 exact refs 闭合为有界内容或明确问题。

## Execution 保证

1. 每个 Page 或 component instance 在一次 execution 中最多执行一次。
2. 每次 `aggregate()` 编译本次有限 field DAG，不预跑整个 Report。
3. 同一次 execution 按 Sample 与 exact field identity 缓存。
4. 只执行请求的 Page；一个 Page 失败不使其它 Page 失去执行能力。
5. static export 在一次 execution 中枚举目标 Pages，并共享 exact field cache。
6. execution 完成后，renderer 只能得到 `ClosedReportTree`。

## 禁止跨出的边界

- 不枚举 raw Run、Attempt、Event 或 Attachment。
- 不打开另一个 Record root，也不改变 frozen selection。
- 不写 SQL 查询 Record 物理表。
- 不保存新的权威比较表或 Report schema。
- 不允许 renderer 重新执行 callback、Query 或领域 projection。
