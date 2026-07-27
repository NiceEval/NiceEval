# Source 目录

Source 是 `.niceeval` 的查询层：把 NiceEval 的 Sample 或 AttemptEvidence 计算成可序列化事实投影。
Component 只消费 Content，不认识 Sample、Record 或 artifact，也不能在 renderer 里再次取数。

```ts
type SourceInput = Sample | AttemptEvidence;

interface Source<Input extends SourceInput, Content> {
  readonly name: string;
  compute(input: Input): Promise<Content>;
}

function defineSource<Input extends SourceInput, Content>(
  definition: Source<Input, Content>,
): Source<Input, Content>;
```

`defineSource` 保留传入对象的同一引用，只提供类型推导与定义期反馈；它不注册、不缓存。
缓存属于一次 page resolve，同一个 Source 对象与 input 引用在该 page 内只计算一次。

Source 可以读取 Record 与 artifact、计算 Measure、聚合 Dataset、投影证据和返回已记录的 diagnostics。
它不能请求外部 API、接收任意业务对象、选择首页 KPI、生成本地化 warning 文案，或产生颜色、label
和布局。外部业务数据直接走 Component 的 `data` 形态；`source` 明确表示从 NiceEval 记录取数。

## 官方目录

官方 Source 从 `niceeval/report` 的 `sources` 对象按领域发现，不把二三十个名字平铺在包顶层：

| 入口 | 产出 | 常用 Component |
|---|---|---|
| `sources.entity.experiments` | experiment 行，下钻到 eval 与 attempt | `Table` |
| `sources.entity.evals` | eval 行，下钻到 attempt | `Table` |
| `sources.entity.attempts` | attempt 行 | `Table` |
| `sources.measure.rows(...)` | 本次选择的 Dimension + Measure 组成的 Dataset | `Table` / `Chart` / 自定义 Component |
| `sources.measure.matrix(...)` | 两个维度的交叉格 | `Table` |
| `sources.measure.scoreboard(...)` | 固定题集的成绩与分科 | `Table` |
| `sources.measure.delta(...)` | 同一道题在若干条件上的读数与差值 | `Table` |
| `sources.measure.stability(...)` | 一道题跨 Run 的稳定性 | `Table` |
| `sources.sample.snapshot` | 范围、判定、覆盖、来源与读取期 Issue | `SampleSummary` / `SampleNotices` |
| `sources.sample.traces` | Sample 中各 attempt 的执行瀑布 | `Waterfall` |
| `sources.run.diagnostics` | 已持久化的 Run 诊断事实 | `RunNotices` |
| `sources.attempt.snapshot` | attempt 身份、判定、得分、耗时、用量、成本与错误事实 | `AttemptSummary` / `AttemptNotices` |
| `sources.attempt.diagnostics` | 已持久化的 lifecycle 诊断事实 | `AttemptNotices` |
| `sources.attempt.assertions` | 断言条目与给分记录 | `Table` |
| `sources.attempt.source` | 带证据标注的 eval 源码 | `SourceView` |
| `sources.attempt.conversation` | 分轮事件流与失败命令 | `Conversation` |
| `sources.attempt.timeline` | runner phases 与关联 spans | `Waterfall` |
| `sources.attempt.trace` | 原始 OTel span 树 | `Waterfall` |
| `sources.attempt.diff` | 文件变化与 patch | `DiffView` |

使用者先选领域目录，再在该目录里发现 Source。目录只组织导出，不改变 Source 的值身份；
`sources.entity.experiments` 可以直接复用、比较引用或传给多个 page。

范围级 Source 统一输入 `Sample`，历史 Source 读取 `sample.historyAttempts`；attempt 目录显式输入
`AttemptEvidence`。attempt-input page 省略组件 `input` 时，管线注入当前 evidence；输入种类与 page
不匹配时按完整用户反馈报错，不从 Sample 猜历史，也不从 Record 临时重读 evidence。

## Snapshot

Snapshot 是中性的事实集合，不暗示首页要展示哪些 KPI，也不生成呈现文案或 action。
`SampleIssue` 由读取 / 选择过程从记录结构检测，不写入 `.niceeval`：

```ts
interface SampleSnapshot {
  scope: {
    experiments: number;
    evals: number;
    attempts: number;
    runs: number;
  };
  verdicts: {
    evals: VerdictCounts;
    attempts: VerdictCounts;
  };
  coverage: CoverageCounts;
  provenance: SampleProvenance;
  issues: readonly SampleIssue[];
}

interface AttemptSnapshot {
  locator: AttemptLocator;
  verdict: Verdict;
  points?: number;
  possiblePoints?: number;
  durationMs?: number;
  turns?: number;
  toolCalls?: number;
  usage?: Usage;
  costUSD?: number;
  error?: AttemptError;
}
```

`SampleSummary` 决定默认报告展示哪些 snapshot 字段与 Measure。`SampleNotices` 把结构化 Issue 映射为
当前 locale 的 Notice 与 action；两者都不属于 Source。runner / adapter 已经落盘的 diagnostics
仍是事实，所以
`sources.run.diagnostics` 与 `sources.attempt.diagnostics` 保留。

## TableContent

表格的默认字段集合属于事实投影，与 rows 一起由 Source 产生。字段集合可能依赖题型或已解析数据，
因此不另设第二套列协议：

```ts
interface TableContent<RowValue extends Row = Row> {
  columns: readonly ColumnSpec[];
  rows: readonly RowValue[];
}

interface ColumnSpec {
  /** 对应 Row.cells 的稳定字段身份。 */
  key: string;
  unit?: string;
  better?: "higher" | "lower";
}

interface Row {
  /** 稳定行身份，不是数组位置。 */
  key: string;
  /** Column.dataKey 按这里的键取格子。 */
  cells: Readonly<Record<string, Cell>>;
  subRows?: readonly Row[];
  variant?: "normal" | "placeholder";
}
```

`TableContent` 不用 `Cell[][]`，因为列顺序不是数据身份。`columns` 只声明字段身份、默认顺序与
数值语义，不携带本地化表头或布局；作者写 `<Column>` 时只覆盖本次 Table 的字段选择与呈现，
不改写 Content。

## 写一个 Source

下面的 Source 按 agent 产生预算表。`spend` 使用 `measure` Cell，保留有效样本数、覆盖总数与全部
attempt 引用：

```tsx
import { defineSource, type MeasureCell, type Row, type TableContent } from "niceeval/report";

interface BudgetRow extends Row {
  cells: {
    agent: { kind: "text"; text: string };
    spend: { kind: "measure"; measure: MeasureCell };
  };
}

export const budgets = defineSource<Sample, TableContent<BudgetRow>>({
  name: "budgets",
  async compute(sample) {
    const rows = await computeBudgetByAgent(sample);
    return {
      columns: [
        { key: "agent" },
        { key: "spend", unit: "USD", better: "lower" },
      ],
      rows: rows.map(({ agent, spend }) => ({
        key: agent,
        cells: {
          agent: { kind: "text", text: agent },
          spend: { kind: "measure", measure: spend },
        },
      })),
    };
  },
});
```

```tsx
<Table source={budgets}>
  <Column dataKey="agent" header={{ en: "Agent", "zh-CN": "Agent" }} />
  <Column dataKey="spend" header={{ en: "Spend", "zh-CN": "花费" }} />
</Table>

<Table source={budgets}>
  <Column dataKey="agent" />
  <Column dataKey="spend" header={{ en: "Budget used", "zh-CN": "已用预算" }} />
</Table>
```

需要加工时显式计算，再走 `data` 形态；默认列仍随 Content 保留：

```tsx
const content = await budgets.compute(sample);
const rows = content.rows.filter((row) => row.cells.spend.measure.value !== null);

return <Table data={{ ...content, rows }} />;
```

三条纪律：

- 聚合、排序和默认字段选择只发生在 `compute()`；renderer 不重新计算。
- 官方读数折成 `measure` Cell，不能压成丢失 `samples` / `total` / `refs` 的字符串。
- `compute()` 的 Content 必须可序列化；Source 自己可以读取输入句柄，Content 不能携带句柄。

## 相关阅读

- [组件树](../README.md) —— Source、Component 与进阶呈现管线。
- [`Table`](../primitives/table.md) —— source / data 两种用法与列覆盖。
- [读数与维度](../../library/measures.md) —— `Measure`、`Dimension` 与聚合口径。
- [Record](../../../record/library.md) —— `Sample`、`AttemptEvidence` 与身份键去重。
