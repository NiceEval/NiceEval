# 方案 1：具名专用组件

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md) · [PLAN-4](PLAN-4.md) · [DECISION](DECISION.md)

---

## 方案

一个视图一个具名组件。取数、聚合、默认列与两面渲染全封在组件里，作者按名字挑组件，用 props 调形状。

```tsx
import {
  Col,
  CostQualityScatter,
  ExperimentTable,
  FlakyEvalMatrix,
  Scoreboard,
  Section,
  defineReport,
} from "niceeval/report";

export default defineReport(
  <Col>
    <Section title="总览">
      <ExperimentTable sort="passRate" showCost showDuration />
      <CostQualityScatter groupBy="agent" />
    </Section>
    <Section title="固定题集">
      <Scoreboard questions={sweBenchLite} weights={{ security: 2 }} />
    </Section>
    <Section title="稳定性">
      <FlakyEvalMatrix runs={20} threshold={0.8} />
    </Section>
  </Col>,
);
```

作者面到此为止。组件内部长这样：

```tsx
export const ExperimentTable = defineComponent(
  async (props: ExperimentTableProps, ctx) => {
    const rows = await aggregateExperiments(ctx.sample, props);
    return { text: renderExperimentText(rows, props), web: <ExperimentTableWeb rows={rows} /> };
  },
);
```

每加一个视图就重复一次这三件事：一段聚合、一个 text 渲染面、一个 web 渲染面。

---

## 优势

- **需求 8、10 满足得最直接。** 名字即意图，新作者不学 `Measure` 与 `Dimension` 就能出一页可读的报告。
- **默认值调得最细。** 每个组件独占自己的默认列、默认排序与默认呈现，不必迁就别的视图。
- **文档形态最好写。** 一个组件一页 props 表，读者不必先建立分层心智。
- **公开面最小。** 库不必导出 `Measure`、`Cell`、`RowSource` 这些中间类型。

---

## 缺点

- **需求 9 落空。** 想在实验对比表里加一列自定义读数，唯一的路径是库里加一个 prop。作者被卡住时没有绕过组件的写法。
- **组件数按乘法增长。** 「按 agent 分组」与「按记忆机制分组」是同一件事的两个投影。做成两个组件是重复，做成一个 `groupBy` prop 就已经在走向 PLAN-2 的维度概念，只是没有类型背书。
- **需求 10 迟早破。** `ExperimentTable` 的 `sort` 收列 key，`CostQualityScatter` 的 `sort` 收读数名。同名参数在两个组件里语义不同，没有任何机制会拦住这种分叉。
- **需求 11 靠纪律维持。** 每个组件自己算聚合，「实验对比表里的通过率」与「散点 y 轴的通过率」是两段代码，两段代码迟早给出两个数。
- **两面渲染的工程量线性增长。** 每个新组件要写两个渲染面并各自实现降级，这正是 [Sphinx 那类系统的固有病](../../feature/reports/reference/README.md)：第三方组件常常只实现一面。
- **需求 15 无从谈起。** 组件集合没有闭合判据，「这个数据画出来长得不一样」永远是加组件的充分理由。

---

## 数据流

```text
Sample ──▶ <ExperimentTable>  ──┬── 自己的聚合 ──┬── text 面
                                │               └── web 面
       ──▶ <CostQualityScatter> ─┴── 自己的聚合 ──┬── text 面
                                                └── web 面
```

每个组件是一条独立的竖线。没有横向共用的计算层，所以「同一个读数在两处同值」不是结构保证，是约定。

---

## 验收

1. **加一列自定义读数**：作者能在不改库的前提下，给实验对比表加一列「改动行数」。本方案做不到。
2. **两处同值**：摘要里的通过率与散点 y 轴的通过率取自同一次计算。本方案不保证。
3. **换一个分组维度**：把「按 agent」改成「按记忆机制」不换组件。本方案要看该组件是否恰好留了 prop。

**反指标**：给若干组件补上 `groupBy`、`measures`、`sort` 三个 props 之后，它看起来解决了上面三条。此时组件已经退化成 PLAN-2 的数据源，只是参数是字符串而不是类型化对象，拼错要到运行时才发现。

---

## 与其它方案的关系

- **vs [PLAN-2](PLAN-2.md)**：同一份能力的两种切法。本方案把领域知识与渲染绑在一个组件里，PLAN-2 把它们切成数据源与原语。PLAN-2 的组合组件保留了本方案的入口体验：`SampleOverview` 与 `AttemptDetail` 就是具名的默认装配，区别是它们只装配公开原语，没有私有渲染面。
- **vs [PLAN-3](PLAN-3.md)**：两个极端。本方案不给作者任何取数自由，PLAN-3 给全部自由。两者都不满足「默认正确、需要时可改」。
