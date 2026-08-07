# Table 作者语法示例

本页集中展示 [Report Chart Kernel Roadmap](../README.md) 的目标 Table API。
完整类型、装载校验、row derivation 与无 JavaScript 契约以 [Architecture](../architecture.md#table-controller) 为准。

## 最短写法

Table 直接接已经计算完成的普通 rows：

```tsx
import { Table } from "niceeval/report";

const performance = [
  { agent: "codex", passRate: 0.92, costUSD: 12.4 },
  { agent: "opencode", passRate: 0.86, costUSD: 8.7 },
] as const;

export function PerformanceTable() {
  return <Table rows={performance} />;
}
```

省略 `columns` 时按第一行的稳定字段顺序显示。
不传 `search` 或 `sort` 就不建立对应浏览状态，也不输出无用 controller payload。

## 自定义列、搜索与排序

列 shorthand 是 field 名；对象形态只补充该 field 的显示与浏览规则：

```tsx
import { Table } from "niceeval/report";

type Status = "errored" | "failed" | "passed";

const statusRank: Readonly<Record<Status, number>> = {
  errored: 0,
  failed: 1,
  passed: 2,
};

const performance: readonly {
  agent: string;
  costUSD: number;
  passRate: number;
  status: Status;
}[] = [
  { agent: "codex", costUSD: 12.4, passRate: 0.92, status: "passed" },
  { agent: "opencode", costUSD: 8.7, passRate: 0.86, status: "failed" },
];

export function SearchablePerformanceTable() {
  return (
    <Table
      rows={performance}
      columns={[
        "agent",
        {
          field: "costUSD",
          header: { en: "Spend", "zh-CN": "花费" },
        },
        "passRate",
        {
          field: "status",
          searchable: false,
          sortValue: (status) => statusRank[status],
        },
      ]}
      search={{
        label: { en: "Filter performance", "zh-CN": "筛选表现" },
        placeholder: { en: "Agent or value", "zh-CN": "Agent 或数值" },
      }}
      sort={{ field: "passRate", direction: "desc" }}
    />
  );
}
```

`sort={true}` 只启用可排序表头，首屏保持 rows 声明顺序。
对象形态同时规定 text、无 JavaScript web 与增强首帧的顺序。
`sortValue(value)` 是构建期纯投影，不接收整行，也不会进入浏览器 payload。

## 同构 nested rows

branch 与 leaf 可以是自然的 discriminated union。
branch 用一个字段持有同类型 child rows，Table 用 `subRows` 选择该字段：

```tsx
import { Table } from "niceeval/report";

type ResultRow =
  | {
      kind: "group";
      name: string;
      passRate: number | null;
      children: readonly ResultRow[];
    }
  | {
      kind: "result";
      name: string;
      passRate: number | null;
    };

const results: readonly ResultRow[] = [
  {
    kind: "group",
    name: "coding",
    passRate: 0.82,
    children: [
      { kind: "result", name: "repo-edit", passRate: 0.9 },
      { kind: "result", name: "debug", passRate: 0.74 },
    ],
  },
  {
    kind: "group",
    name: "reasoning",
    passRate: 0.88,
    children: [
      { kind: "result", name: "planning", passRate: 0.88 },
    ],
  },
];

export function ResultTreeTable() {
  return (
    <Table
      rows={results}
      subRows="children"
      columns={[
        { field: "name", header: { en: "Result", "zh-CN": "结果" } },
        "passRate",
      ]}
      search
      sort={{ field: "passRate", direction: "desc" }}
    />
  );
}
```

`children` 不成为可见列，也不能用于 `sort.field`。
所有层级共享同一组可见 columns；显式 columns 只能选择每种 row variant 都存在的字段。
`children` absent、null、undefined 或空数组都表示 leaf。

层级排序只递归重排每组 siblings，parent 不会和 descendants 混排。
搜索只显示直接命中的 rows 与它们的 ancestors；parent 命中不会顺带显示未命中的 subtree。
搜索期间结果临时全部展开并隐藏折叠按钮，清空 query 后恢复搜索前状态。

初始状态总是全部展开。
折叠只属于当前 Table 实例；API 不要求 `rowKey`，也不公开 `expanded` 或 `onExpandedChange`。
页面重新装载或组件 remount 后回到全部展开。

## 先统一映射输入

`subRows` 是 field selector，不是 TanStack 风格的 `getSubRows(row)` callback。
映射输入的字段不一致时，先用普通函数整理成 Table 需要的同构 rows：

```tsx
type ApiNode = {
  title: string;
  score?: number;
  nodes?: readonly ApiNode[];
};

type ReportRow = {
  name: string;
  score: number | null;
  children?: readonly ReportRow[];
};

const apiNodes: readonly ApiNode[] = [
  {
    title: "coding",
    score: 0.82,
    nodes: [{ title: "repo-edit", score: 0.9 }],
  },
];

function toReportRow(node: ApiNode): ReportRow {
  return {
    name: node.title,
    score: node.score ?? null,
    ...(node.nodes === undefined
      ? {}
      : { children: node.nodes.map(toReportRow) }),
  };
}

const rows = apiNodes.map(toReportRow);

<Table rows={rows} subRows="children" columns={["name", "score"]} />;
```

数据整理仍发生在 page render 中。
Table renderer 不取数、不重新聚合，也不通过 accessor callback 隐藏评测口径。

## 不同 schema 的子表

任意 detail panel 或不同 schema 的 child table 不属于这个 primitive：

```tsx
<Section title="Experiment summary">
  <Table rows={experimentRows} />
  <Table rows={attemptRows} />
</Section>
```

不提供以下写法：

```tsx
// 不存在：只能表达 web，无法自动产生诚实的 text 面。
<Table
  rows={rows}
  getSubRows={(row) => row.children}
  renderSubComponent={(row) => <AttemptTable row={row} />}
/>
```

需要逐 row 的任意详情内容时，使用同时定义 text/web 的组合组件；不要把 React callback 作为 Table renderer 参数传入。
