# 完整示例

本页按任务索引 Reports 的 plan/data/render 写法。
API 穷尽形状只在 [Library](../library.md) 定义。

## 质量与成本

```tsx
export default defineReport({
  plan({ sample }) {
    const performance = aggregate(sample, {
      id: "quality-cost",
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
            return (
              <Col>
                <Scatter points={performance} x="costUSD" y="passRate" />
                <Table rows={performance} />
              </Col>
            );
          },
        },
      ],
    };
  },
});
```

同一份 executor 结果交给图和表；两面 renderer 共享相同的组件树。这里的 `performance` 是完整
`AggregateData`（`EvidenceValue<AggregateResult>`），不是 rows 数组。两个组件在 available 时读取
`value.rows` / `value.coverage`，在 unavailable 时原样显示 causes 与 basedOn。

`overview` 使用唯一的普通页 shorthand：同时省略 instanceId / route 时，executor 补成
`overview`、`/overview` 与空 parameters。参数化页不能用这个 shorthand。

## 失败清单

失败页在 plan 中声明 verdict Projector request 与只依赖该 request 的 failure Calculation。
它把 executor 已交付的 `AttemptDetailsData` 行传给 [`AttemptList`](../components/summaries/failure-list.md)，不在组件或 renderer 中重新读取 verdict。
过滤条件是 Calculation 的规范化输入，而不是任意 predicate callback。

## 自定义读数

```ts
const workspaceDiffRequest = projectorRequest({
  requestId: "workspace-diff",
  projector: workspaceDiff,
  input: { includeGenerated: false },
});

const changedLines = defineCalculation({
  namespace: "acme.checkout",
  name: "changed-lines",
  version: "1",
  requests: [workspaceDiffRequest],
  evaluate(input) {
    return mapEvidence(input.get(workspaceDiffRequest), (diff) =>
      countChangedLines(diff, input.member.attempt),
    );
  },
});
```

把它放进 `aggregate(...).measures`，并明确指定 rollup 的 unavailable policy。

## 报告旁复杂算法

成对差异、稳定性、固定题集成绩单与趋势都在计划后的纯函数中完成。
它们使用 MeasureCell、EvidenceValue、coverage 和 refs，最后通过 `metricValue()` 与 `evidenceRow()` 交出结果。

## 多页、React 与导出

- [构建多页报告](../use-case/构建报告/构建多页报告.md)
- [嵌入产品](../use-case/交付报告/嵌入产品.md)
- [接入外部业务数据](../use-case/构建报告/接入外部业务数据.md)
- [导出静态站](../use-case/交付报告/导出静态站.md)

## 相关阅读

- [外壳与多页](shell.md)
- [排版原语与自定义 renderer](layout.md)
- [计算函数、分组与读数值](measures.md)
