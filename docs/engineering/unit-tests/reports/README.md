# Reports 的测试架构

契约来源：[Reports](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、[Library](../../../feature/reports/library.md)、[Show](../../../feature/reports/show.md) 和 [View](../../../feature/reports/view.md)。Reports 必须先证明计算口径，再证明 text/web 两个面没有改写计算结果；视觉 snapshot 处于最后一层。用例登记在 [cases.md](cases.md)。

## 计算 fixture 要有区分力

通过率 fixture 应让几种常见错误算法得到不同答案：

```ts
const scope = reportScopeFixture({
  experiments: [{
    id: "compare/codex",
    evals: [
      // 题 a：题内 2/3
      { id: "a", attempts: ["passed", "failed", "passed"] },
      // 题 b：题内 1
      { id: "b", attempts: ["passed"] },
      // 题 c：执行未形成可信判定；端到端记 0，条件任务通过率不计
      { id: "c", attempts: ["errored"] },
      // skipped 不进入有效样本，但保留在 total
      { id: "d", attempts: ["skipped"] },
    ],
  }],
})
```

这个 fixture 中：

- 默认端到端成功率是 `(2/3 + 1 + 0) / 3 = 5/9`。
- 条件任务通过率排除 errored，得到 `(2/3 + 1) / 2 = 5/6`。
- 端到端 attempt 平铺是 `3/5`。
- 先把每题折成"任一轮通过"再计票是 `2/3`。

这些值必须彼此不同，测试才能发现排除 error、平铺 attempt 或先折叠 verdict 等错误算法。各题 attempt 数必须不同，否则两级聚合与平铺可能恰好相等。

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

## 测试次序：先 data，再双面，最后窄快照

1. **`*Data` 计算的事实**：数值、覆盖率、排序、缺失行为，全部数据级断言。
2. **text/web 双面同源**：两面显示同一份终值与 warning，不逐字比较。
3. **窄快照**：只锁短小、稳定、评审者能读懂的布局或完整错误反馈。

计算与格式化分别可断言（`value` 与 `display` 独立），不从渲染字符串反推计算正确。

## Attempt 详情组件族的观察面

Attempt 详情（`AttemptSummary` 等 11 个叶子 + `AttemptAssessment` / `AttemptDetail` 两个组合，物理位置见 [source-map](../../../source-map.md)）与其它报告组件同属确定性渲染语义，归单元层，不进 E2E（分层判据见[测试体系总览](../../testing/README.md)）。观察面是 React 静态 render 出的 DOM 结构事实，不是浏览器截图：

- **纯渲染，注入数据**：`attempt*Data(evidence)` 只做同步/纯派生，不读文件、不 fetch；测试直接构造 `AttemptEvidence` fixture 或调用 `attempt*Data`，再对 `data` 形态组件 render，不需要（也不能）mock fetch——这些组件从不 fetch。
- **折叠态用原生 `<details>` 表达**：默认展开与否就是标记上的 `open` 属性（报告 web 面 `EvalList` 的既有纪律），静态 `renderToStaticMarkup` 即可断言默认态与展开内容，不需要浏览器事件模拟；需要 JS 交互才能表达的折叠设计，先回到设计层改成 `<details>` 能表达的形态。
- **断言结构事实**：区块存在与相对顺序、默认展开 / 折叠、计数、expected / received 文本、源码锚的指向。不断言 class 列表、内联样式或像素表现。
- **text/web 不逐字比较**：两面共享同一份 `data`，断言两面显示同一份 verdict / 计数 / 引用即可，不要求文本长度或视觉结构相同（text 面允许折成摘要 + 证据命令）。
- **样式回归不属于本层**：遮罩透明、滚动裁剪一类视觉问题 DOM 断言拦不住，踩到记 memory 台账（先例：[codeview-perline-hidden-scrollbar-clips-text](../../../../memory/codeview-perline-hidden-scrollbar-clips-text.md)）；改动这些组件的样式后需要 `pnpm run build:report`，改动 view 壳 / dialog 摆放后需要 `pnpm run view:build`。
