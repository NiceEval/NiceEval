# Reports 的单元测试

契约来源：[Reports](../../feature/reports/README.md)、[Architecture](../../feature/reports/architecture.md)、[Show](../../feature/reports/show.md) 和 [View](../../feature/reports/view.md)。Reports 必须先证明计算口径，再证明 text/web 两个面没有改写计算结果；视觉 snapshot 处于最后一层。

## 计算 fixture 要有区分力

通过率 fixture 应让几种常见错误算法得到不同答案：

```ts
const selection = reportSelectionFixture({
  experiments: [{
    id: "compare/codex",
    evals: [
      // 题 a：题内 2/3
      { id: "a", attempts: ["passed", "failed", "passed"] },
      // 题 b：题内 1
      { id: "b", attempts: ["passed"] },
      // skipped 不进入有效样本，但保留在 total
      { id: "c", attempts: ["skipped"] },
    ],
  }],
})
```

这个 fixture 中：

- 官方两级聚合是 `(2/3 + 1) / 2 = 5/6`。
- attempt 平铺是 `3/4`。
- 先把每题折成“任一轮通过”是 `2/2`。

三个值不同，测试才能发现错误复用了另一种口径。

## 示例：先测 `.data()` 的事实

```tsx
import { expect, it } from "vitest"
import { RunOverview } from "../../report/index.ts"

it("RunOverview 使用两级聚合并保留覆盖率", async () => {
  const data = await RunOverview.data(selection)

  expect(data.totals.passRate.value).toBeCloseTo(5 / 6)
  expect(data.totals.passRate.display).toBe("83.3%")
  expect(data.totals.passRate.samples).toBe(4)
  expect(data.totals.passRate.total).toBe(5)
})
```

不要先渲染字符串再从 `"83.3%"` 反推计算正确；计算与格式化应分别失败。

## MetricCell fixture

所有指标组件共享三种不能混淆的值：

```ts
const cells = {
  measuredZero: {
    value: 0,
    display: "0",
    samples: 2,
    total: 2,
    refs: ["@1aaaaaaa", "@1bbbbbbb"],
  },
  partial: {
    value: 0.5,
    display: "50%",
    samples: 1,
    total: 2,
    refs: ["@1aaaaaaa"],
  },
  missing: {
    value: null,
    display: "no data",
    samples: 0,
    total: 2,
    refs: [],
  },
} satisfies Record<string, MetricCell>
```

每个组件至少验证 `null` 不被显示成 `0`、partial 保留覆盖率、refs 没有被渲染前计算丢掉。

## 示例：text/web 两面同源

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { RunOverview } from "../../report/index.ts"
import { createTextContext, renderNodeToText } from "../../report/tree.ts"

it("text 与 web 显示同一个 MetricCell 终值和 warning", () => {
  const data = overviewDataFixture({
    passRate: cells.partial,
    warnings: ["snapshot is incomplete"],
  })

  const html = renderToStaticMarkup(<RunOverview data={data} />)
  const text = renderNodeToText(
    <RunOverview data={data} />,
    createTextContext({ width: 80 }),
  )

  for (const face of [html, text]) {
    expect(face).toContain("50%")
    expect(face).toContain("1/2")
    expect(face).toContain("snapshot is incomplete")
  }
})
```

这类测试不要求两个面 HTML/文本逐字相同；它证明两面保留同一实体、数值、覆盖率和警告。

## 示例：宿主等价

裸 `show` 和裸 `view` 应把同一个 Selection 交给同一个默认 Report definition。Fixture 在装载边界记录 definition 与 Selection：

```ts
it("show 与 view 的默认报告槽消费同一 Selection", async () => {
  const results = resultsFixtureWithPartialRerun()
  const show = await captureShowReportInput(results)
  const view = await captureViewReportInput(results)

  expect(show.definition).toBe(ExperimentComparison)
  expect(view.definition).toBe(ExperimentComparison)
  expect(show.selection).toEqual(view.selection)
})
```

不需要比较完整终端输出与完整 HTML；各宿主自己的导航壳和证据室并不相同。

## Snapshot 的使用边界

Snapshot 适合锁定：

- 一段短小、稳定、可由评审者读懂的终端布局。
- 报告树校验错误的完整用户反馈。
- 一个组件关键的空态或 warning 结构。

Snapshot 不适合锁定：

- 整页 HTML、全部 class、随机 locator 和时间戳。
- 本可直接断言的数值、排序和 refs。
- 计算 fixture 与渲染 fixture 混在一起的巨大输出。

## 不这样测

- 不把 Reports 整体当作“展示层”薄测；选择、去重、指标和聚合会静默给错答案。
- 不只测 React component 能 render；要验证它没有重算或丢失 `.data()` 的终值。
- 不用相同 attempt 数的题目验证两级聚合，因为它与平铺算法可能恰好相等。
- 不用 snapshot 代替 `null`、`0`、samples/total 和 refs 的精确断言。
