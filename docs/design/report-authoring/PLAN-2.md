# 方案 2：通用原语 + 类型化数据源（推荐）

**相关文档**：[README](README.md) · [GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) ·
[PLAN-3](PLAN-3.md) · [PLAN-4](PLAN-4.md) · [DECISION](DECISION.md)

---

## 方案

作者面切成两半：**原语**说这份数据画成什么形状，**数据源**说这份数据怎么算。
领域知识全部住在数据源里，所以同一个 `Table` 既画实验对比，
也画成绩单和稳定性矩阵。

上面再放一层**组合组件**，把常见装配打成一个名字，
保留 [PLAN-1](PLAN-1.md) 的一行入口体验。

```tsx
<SampleOverview />
```

它展开成的树是公开的，作者照抄下来逐块改：

```tsx
<Col>
  <Grid source={sampleSummary()} />
  <Chart source={qualityCost} legend tooltip />
  <Table source={experimentRows} filter />
</Col>
```

---

## 五级改法，一级比一级深

作者的需求越具体，往下走一级，不换组件也不等库。

### 一级：换选项

```tsx
<Table
  source={measureRows({
    rows: "experiment",
    measures: [endToEndPassRate, costUSD],
  })}
  evals="security/"
  filter
/>
```

`evals` 在聚合**之前**收窄题集，所以它必须是选项：
聚合发生在 `compute()` 内部，事后用普通 JavaScript 无法从聚合值还原题级过滤。
逐实体成行的 `experimentRows` 不消费这个选项；需要自选读数与题集时使用 `measureRows()`。

### 二级：换列

```tsx
const byAgent = measureRows({
  rows: "agent",
  measures: [endToEndPassRate, costUSD],
});

<Table source={byAgent} filter>
  <Column dataKey="agent" />
  <Column dataKey="cost-usd" header={{ en: "Spend", "zh-CN": "花费" }} />
  <Column dataKey="pass-rate" />
</Table>
```

写了 `<Column>` 就覆盖数据源的默认列，不换组件。
一组列可以直接 `map` 出来，因为结构节点位置按声明顺序展平数组与 Fragment：

```tsx
<Table source={byAgent}>
  {measures.map((m) => <Column key={m.name} dataKey={m.name} />)}
  {showCost && <Column dataKey="cost" />}
</Table>
```

### 三级：换维度与读数

```tsx
const byMemory = measureRows({
  rows: ["agent", label("memory")],
  measures: [endToEndPassRate, taskPassRate, costUSD],
  sort: endToEndPassRate,
});

<Table source={byMemory} filter />
```

维度数组解析为复合维度，成员显示键以 ` · ` 连接。
它在收维度的每个位置都合法，所以同一个 `["agent", label("memory")]`
既能投影成表格的行，也能投影成图表的轴。

### 四级：自定义读数

```ts
export const changedLines = defineMeasure({
  name: "changed-lines",
  label: { en: "Changed lines", "zh-CN": "改动行数" },
  unit: "lines",
  better: "lower",
  where: (attempt) => attempt.result.verdict === "passed",
  async value(attempt) {
    const diff = await attempt.diff();
    if (!diff) return null;
    return Object.keys(diff.files)
      .reduce((sum, path) => sum + (diff.get(path) ?? "").split("\n").length, 0);
  },
  aggregate: { perEval: "min", acrossEvals: "mean" },
});
```

这段代码里作者写的是**一次 attempt 的值**，聚合方向是两个字符串。
两级聚合的层数不由作者的代码结构决定，所以少写一层拿不到错数字。
`null` 是「测不了」，`0` 是「测得为零」，两者在聚合与覆盖率上的待遇不同。

### 五级：自己写一个数据源

`source` 不是二维数组，也不是一个只有 key 的索引。它是「输入怎样变成可序列化 Content」的
类型化协议；不同原语要求不同的 Content。`Table` 使用的 `RowSource` 返回带稳定行身份的
`TableContent`，一行的 `cells` 再按列 key 索引：

```ts
interface DataSource<Content, Input = Sample> {
  name: string;
  compute(input: Input): Promise<Content>;
}

interface RowSource<RowValue extends Row, Input = ReportInput>
  extends DataSource<TableContent<RowValue>, Input> {
  columns(rows: readonly RowValue[]): readonly ColumnSpec[];
}

interface TableContent<RowValue extends Row = Row> {
  rows: readonly RowValue[];
}

interface Row {
  key: string;
  cells: Readonly<Record<string, Cell>>;
  subRows?: readonly Row[];
  variant?: "normal" | "placeholder";
}
```

作者实现的接口与官方数据源相同。下面这份 source 按 agent 产生一行；聚合数字使用
`measure` Cell，而不是压成字符串：

```tsx
import type { Row, RowSource } from "niceeval/report";

interface BudgetRow extends Row {
  cells: {
    agent: { kind: "text"; text: string };
    spend: { kind: "measure"; measure: MeasureCell };
  };
}

export const budgetRows: RowSource<BudgetRow> = {
  name: "budget-rows",
  async compute(sample) {
    const budgets = await computeBudgetByAgent(sample);
    return {
      rows: budgets.map(({ agent, spend }) => ({
        key: agent,
        cells: {
          agent: { kind: "text", text: agent },
          spend: { kind: "measure", measure: spend },
        },
      })),
    };
  },
  columns: (_rows) => [
    { key: "agent", label: { en: "Agent", "zh-CN": "Agent" } },
    { key: "spend", label: { en: "Spend", "zh-CN": "花费" }, unit: "USD" },
  ],
};
```

默认投影直接使用 `columns()`；写 `<Column>` 时只覆盖列选择、顺序与呈现，不改变 rows：

```tsx
<Table source={budgetRows} />

<Table source={budgetRows}>
  <Column dataKey="agent" />
  <Column dataKey="spend" header={{ en: "Budget used", "zh-CN": "已用预算" }} />
</Table>
```

`Row.key` 是稳定的行身份，`Column.dataKey` 对应 `Row.cells` 的键。`columns()` 收已解析的行，
所以「列随数据变」的判断也住在数据源里。
实验对比表的主读数列按题型构成在通过率与总分之间切换，就是这么做的。

这条边界把职责分开：source 决定 rows、Cell 语义与默认 columns；`Table` 只投影 Content，
不重新分组、聚合或创造 row。接口与 Content 校验保证形状，自定义 `compute()` 的计算正确性
仍由作者负责。

---

## 取数与加工分开

需要过滤、截断或自定义排序时，先 `compute()` 再把结果交给原语的 `data` 形态：

```tsx
export const CostliestAttempts = defineComponent(
  async ({ limit = 10 }: { limit?: number }, ctx) => {
    const content = await attemptRows.compute(ctx.sample);
    const rows = [...content.rows]
      .sort((a, b) => Number(b.cells.cost.value) - Number(a.cells.cost.value))
      .slice(0, limit);

    return <Table data={{ ...content, rows }} filter />;
  },
);
```

`source` 形态与「先手工 `compute()` 再传 `data`」严格等价，
所以作者不必在两条路径之间做选择，只在需要加工时才多写一行。

同一份声明被多个 page 消费时，直接复用同一个类型化 source 值。page 仍写完整对象，
不引入字符串绑定或第二套注册表：

```tsx
export default defineReport({
  pages: [
    { id: "overview", title: "Overview", content: <Table source={byAgent} /> },
    { id: "detail", title: "Detail", content: <Table source={byAgent} filter /> },
  ],
});
```

自有 React 页面吃同一批数据源，只是自己调 `compute()`：

```tsx
const [summary, table] = await Promise.all([
  sampleSummary().compute(sample),
  byAgent.compute(sample),
]);

return <><Grid data={summary} /><Table data={table} filter /></>;
```

浏览器包因此只需要 `niceeval/report/react` 的纯渲染面，不含记录根与磁盘读取。

---

## 原语要多通用：三问定位

原语集合封闭，加一个能力时先判断它属于哪层：

1. 要读磁盘，或要认识 `AttemptHandle`、读数、时效、覆盖吗 → 数据源。
2. 要看这一页**其它**组件的数据吗 → 管线。
3. 两个都不要 → 原语，而且大概率是已有原语的一个列或单元格类型。

这条判据拦住两类提案：给原语加一个领域字段，
以及让数据源去读主题色或终端宽度。
「某个数据源画出来长得不一样」不构成新增原语的理由——
形状相同、内容不同的东西共用一个原语，差异写进数据源的默认列。

组合组件走另一条纪律：它只装配已有原语，**不接受结构子节点**。
要改就不用它，直接把等价全文写进 `Col` 逐块增删。
这样「这份组合组件会渲染什么」永远只有一个答案。

---

## 优势

- **需求 1 到 4 由数据形状强制。** 两级聚合写在 `Measure.aggregate`，
  覆盖率与证据写在 `MeasureCell` 的必填字段。作者少写什么都不会得到错数字。
- **需求 5 到 7 有承重结构。** 「哪些 attempt 落进这一格」是数据源的领域判断，
  跟随格子而不是有效样本。
- **需求 11、12 由单源保证。** 图、表与摘要消费同一个 `Measure`，
  单位、方向与双语显示只声明一次。
- **需求 14 由公开接口保证。** `RowSource` 就是官方数据源用的那个类型。
- **需求 16、17 由分层保证。** 异步只在 `compute()` 里发生，
  渲染面吃普通可序列化数据，大 artifact 懒加载。
- **需求 9 由五级改法保证。** 每一级都不需要库先加一个 prop。

---

## 缺点

- **概念多一层。** 作者要同时理解原语、数据源与组合组件，
  以及 `source` 与 `data` 两种形态。这比 [PLAN-1](PLAN-1.md) 的一页 props 表难。
- **数据源目录会长大。** 一个能力一个具名数据源，
  目录的条目数随官方能力增长，读者要先在目录里找到自己的问题。
- **探索性提问要写代码。** 「每个 agent 上最差的三道题」
  要先 `compute()` 再用普通 JavaScript 排序截断，
  没有 [PLAN-3](PLAN-3.md) 里一句 SQL 那么直接。
- **中间形状是公开面。** `Cell`、`Row`、`ColumnSpec` 一旦导出就要维护，
  加一个单元格类型会波及所有原语的渲染契约。

---

## 数据流

```text
Sample ──▶ 数据源 compute() ──▶ 可序列化 Content ──┬── text 面
                                                └── web 面
             ▲                                    ▲
             │                                    │
        Measure / Dimension                    原语（封闭集合）
```

横向共用的计算层只有一处，所以「同一读数两处同值」是结构结果，不是约定。

---

## 验收

1. **加一列自定义读数**：`defineMeasure` 加进 `measures` 数组，不改库。
2. **两处同值**：摘要与散点消费同一个 `Measure`，
   删掉报告缓存后从原始结果重算得到同一个数。
3. **换分组维度**：`rows: "agent"` 改成 `rows: ["agent", label("memory")]`，
   组件不变。
4. **证据可达**：任一读数格能列出它覆盖的全部 attempt，
   包括读数为 `null` 的那几条。
5. **浏览器包干净**：自有 React 页面只 import `niceeval/report/react` 即可渲染。

**反指标**：数据源把 `MeasureCell` 压成字符串塞进文本格。
表面看数字一样，实际丢掉了有效样本数、覆盖总数与证据引用，
读者看到一个数却点不开它从哪几条 attempt 来。

---

## 与其它方案的关系

- **vs [PLAN-1](PLAN-1.md)**：组合组件保留了具名入口，
  代价是作者要往下走一级才能改默认。
- **vs [PLAN-3](PLAN-3.md)**：把「容易写错的部分」放在库里而不是作者手上。
  换来的是提问必须先落到某个数据源上。
- **vs [PLAN-4](PLAN-4.md)**：PLAN-4 是本方案加一条 SQL 旁路，
  区别只在要不要接受第二条口径入口。
