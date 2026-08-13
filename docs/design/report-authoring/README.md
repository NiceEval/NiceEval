# 报告作者面：组件粒度与取数形态

**相关文档**：[GOALS](GOALS.md) ·[LIMITS](LIMITS.md) ·[PLAN-1](PLAN-1/README.md) ·[PLAN-2](PLAN-2/README.md) ·[PLAN-3](PLAN-3/README.md) ·[PLAN-4](PLAN-4/README.md) ·[PLAN-5](PLAN-5/README.md) ·[DECISION](DECISION.md)

写一份自定义报告的人先撞上两个选择，这里把它们摊开比较。

- **组件多通用。**
  给作者一个 `Table` 加一批数据源，还是给他 `ExperimentTable`、`Scoreboard` 这样一批具名视图。
- **数据怎么来。**
  作者在 TypeScript 里声明读数与维度，还是直接写 SQL 查一张结果表。

两条轴不独立。
专用组件把取数封在自己内部，作者看不见取数形态。
所以「SQL 还是数据源」这个问题只在通用原语那一格里成立。

| | 类型化数据源 | SQL 查询 |
|---|---|---|
| 通用原语 | [PLAN-2](PLAN-2/README.md) | [PLAN-3](PLAN-3/README.md) |
| 专用组件 | [PLAN-1](PLAN-1/README.md) | 与 PLAN-1 同格：取数不进作者视野 |

[PLAN-4](PLAN-4/README.md) 是双轨：类型化数据源作默认，SQL 作逃生舱。
[PLAN-5](PLAN-5/README.md)（推荐）保留通用原语与类型化聚合，但把取数和组合收敛成普通函数与普通结果值。

这层选择值得单独比较，因为它一旦定下就写进每一份用户报告文件。
改读数口径只动库，改作者面要动所有人的报告。

## 同一个问题的五种写法

问题：**按 agent 看通过率与成本，通过率高的排前面。**

PLAN-1，一个具名组件加两个 props：

```tsx
export default defineReport(
  <AgentTable measures={["passRate", "cost"]} sort="passRate" />,
);
```

PLAN-2，通用 `Table` 加一个声明维度与读数的数据源：

```tsx
export default defineReport(
  <Table
    source={sources.measure.rows({
      dimensions: ["agent"],
      measures: [passRate, costUSD],
      sort: passRate,
    })}
  />,
);
```

PLAN-3，通用 `Table` 加一段 SQL：

```tsx
export default defineReport(
  <Table source={sql`
    with per_eval as (
      select agent, experiment_id, eval_id,
             avg(passed) as v, sum(cost_usd) as c
      from attempts
      group by 1, 2, 3
    )
    select agent, avg(v) as pass_rate, sum(c) as cost
    from per_eval
    group by agent
    order by pass_rate desc
  `} />,
);
```

PLAN-4，默认写法同 PLAN-2，官方数据源答不了时才落到 SQL：

```tsx
<Table source={sources.measure.rows({ dimensions: ["agent"], measures: [passRate, costUSD] })} />
<Table source={sql`select … from attempts …`} />
```

PLAN-5，用静态 input、普通 Calculation 与 Page 组合：

```ts
import { Either } from "effect";

const performance = defineCalculation({
  id: Either.getOrThrow(reportComponentId("performance")),
  inputs: reportInputs({ verdicts, usage }),
  completeness: "allow-partial",
  calculate: ({ sample, inputs }) => derivePerformance(sample, inputs),
});

const overview = definePage({
  id: Either.getOrThrow(reportComponentId("overview")),
  route: Either.getOrThrow(reportRoute("/")),
  calculations: { performance },
  render: ({ calculations }) => renderPerformance(calculations.performance),
});
```

五段代码的差别不在长度，在于**谁承担了容易写错的那部分**。

| 写法 | 谁决定两级聚合 | 谁保住证据下钻 | 谁给数值语义与显示文案 |
|---|---|---|---|
| PLAN-1 | 组件 | 组件 | 组件 |
| PLAN-2 | `Measure.perEval` / `acrossEvals` | Source 折 `Cell` 时 | Measure 声明数值语义，Component 声明文案 |
| PLAN-3 | 作者的 `group by` 层数 | 作者的 `array_agg` | 查询旁边的第二张表 |
| PLAN-4 | 两者各一份 | 数据源必然、SQL 可选 | 两者各一份 |
| PLAN-5 | reusable pure Calculation function | 具名结果值的 refs 与 Sample-aligned rows | Calculation value 声明数值语义，semantic block 声明文案 |

PLAN-3 那段 SQL 少写一层 `with per_eval`，得到的仍是一个像通过率的数，只是重试多的题悄悄拿到了更大权重。
这类错误没有类型系统拦得住。

## 接着读哪一篇

- 要求与判据：[GOALS](GOALS.md)。
- 三个候选项各自的现状与硬约束：[LIMITS](LIMITS.md)。
- 逐个方案的完整写法与代价：[PLAN-1](PLAN-1/README.md) 到 [PLAN-5](PLAN-5/README.md)。
- 裁决与否决理由：[DECISION](DECISION.md)。
- 定稿后的产品契约：[Reports · 组件树](../../feature/reports/README.md)。
