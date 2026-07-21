# Reports 怎么测

契约来源：[Reports](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、[Library](../../../feature/reports/library.md)、[Show](../../../feature/reports/show.md)、[View](../../../feature/reports/view.md)、[Observability](../../../observability.md)。

单元层证明 Reports 的**数据语义**：`*Data` 计算函数、指标聚合口径、resolve 管线、报告定义的装载规范化与校验反馈。观察面全部是数据——计算结果、规范化结构、错误对象与文案。本篇的缝：构造 Scope / evidence fixture 作输入，测其上的计算与装载逻辑；缝的真实侧（真实产物上的出口与渲染）由 [E2E 功能域 · 报告与读面](../e2e/report.md)验收（[Fake 边界](README.md#fake-边界mock-什么测哪一层)）。渲染出来的终端排版、DOM 结构、双面比对、样式与交互不在本层，归 [E2E 功能域 · 报告与读面](../e2e/report.md)对真实运行的产物验收（先例台账：[codeview-perline-hidden-scrollbar-clips-text](../../../../memory/codeview-perline-hidden-scrollbar-clips-text.md)、[attempt-detail-components-shipped-without-styles](../../../../memory/attempt-detail-components-shipped-without-styles.md)——渲染缺陷在单元层的 DOM 断言下照样逃逸，只有真实产物上的验收拦得住）。

## Fixture 规范

**计算 fixture 要有区分力**：通过率 fixture 应让几种常见错误算法得到不同答案。

```ts
const scope = reportScopeFixture({
  experiments: [{
    id: "compare/codex",
    evals: [
      { id: "a", attempts: ["passed", "failed", "passed"] }, // 题内 2/3
      { id: "b", attempts: ["passed"] },                     // 题内 1
      { id: "c", attempts: ["errored"] },                    // 端到端记 0
      { id: "d", attempts: ["skipped"] },                    // 不进有效样本
    ],
  }],
})
```

这个 fixture 中端到端两级聚合 = 5/9、排除 errored 的条件口径 = 5/6、attempt 平铺 = 3/5、先折叠 verdict 再计票 = 2/3——四个值彼此不同，测试才能发现口径被换掉。各题 attempt 数必须不同，否则两级聚合与平铺可能恰好相等。

**MetricCell fixture** 共享三种不能混淆的值：measuredZero（value 0、有样本）、partial（有值、覆盖率不满）、missing（value null、零样本）。每个组件至少验证 `null` 不被显示成 `0`、partial 保留覆盖率、refs 没有被渲染前计算丢掉。

## 观察面：数据级断言

1. **`*Data` 计算的事实**：数值、覆盖率、排序、缺失行为，全部数据级断言。
2. **装载与 resolve**：`defineReport` 规范化、spec/data 等价、记忆化、非法输入的完整用户反馈——断言规范化结构与错误对象，不断言渲染结果。
3. **计算与格式化分别可断言**（`value` 与 `display` 独立），不从渲染字符串反推计算正确。

## 覆盖规范

- **指标聚合口径**：两级折叠与题目权重、默认通过率的 errored=0 口径、skipped 与 null/0 的语义分离、固定题集分母（notRun 与 unscorable 不合并）、跨快照按身份键去重、自定义指标的 where 与两级 aggregate、分组维度规则。每条口径都要有能与错误算法区分的 fixture。
- **MetricCell 与缺数据**：字段构成与序列化不丢值；`validate*Data` 递归到嵌套字段、报错带完整路径、结构错误恒转完整用户反馈不抛裸 TypeError；缺 artifact 时返回 null 不猜值。
- **数据计算函数（`*Data`）**：各组件 data 函数的选择、配对、排序、缺失与报错语义（selectedEvalIds 口径、pairsByFlag 配对边界、FailureList 等价、稀疏矩阵、单行摘要的字段瘦身、可比性冲突的完整反馈）；共享算法（最短唯一后缀）在消费方之间一致。
- **站点组件与内建报告**：`standard` 的构成与具名导出同引用、`defineReport({ extends })` 的外壳叠加与页列表同引用、组合组件与手写组合严格等价、数据派生（heroData、warning 分类）与渐进增强不改数据的不变量。
- **resolve 与组合组件**：spec/data 严格等价、`input` 缺省与覆盖、记忆化的等价判据、`ReportNode` 全集与非法节点的完整反馈、`ctx` 的构成、sibling 并行但输出保序、`defineComponent` 两种形态。
- **纯函数布局算法**：MetricScatter 点标签布局是 `chart-math` 纯几何函数，直接对函数断言标签框与点框的几何关系，不经 HTML；labels 维度与 series 归类的解析规则。
- **宿主装载等价**：裸 `show`/`view` 与 `--report` 在装载边界消费同一份 definition（同引用）与同规则选出的 Scope（深等）——不比较终端输出与 HTML，渲染面与进程级读面行为归 E2E。
- **Attempt 证据组件族**：`attempt*Data(evidence)` 纯派生零 IO、装配恰好一次；组合组件的展开树构成与二选一规则；spec 缺省取注入 evidence、错位使用的完整反馈；对话数据的分轮与容错。渲染出的 DOM、默认展开标记、染色与交互归 E2E；改动这些组件后需要 `pnpm run build:report`，改动 view 壳 / dialog 摆放后需要 `pnpm run view:build`。
- **外壳与页面装载**：三种声明形态归一到同一规范化产物、`content`/`pages`/`extends` 恰好其一、标题取值链、资产路径纪律与 head 白名单/转义/scheme 分流、page id 与 attempt-input page 的校验规则。全部以装载结果或错误对象为断言面。
- **o11y 数据派生**：`estimateCost` 的查价与缺失口径（未知 model 为 null 不猜、缺 usage 不记零成本）；`buildExecutionTree` 把标准事件流与 OTel span 合成执行树——骨架完整性、callId 精确合并、关联失败降级不猜、乱序/截断的占位、失败状态透传。

## 不这样测

- 不把 Reports 整体当作"展示层"薄测；选择、去重、指标和聚合会静默给错答案。
- 不在本层断言渲染产物——终端排版、DOM 结构与快照锁定的是呈现，归 [E2E 功能域 · 报告与读面](../e2e/report.md)对真实产物验收；本层观察数据。
- 不用相同 attempt 数的题目验证两级聚合，因为它与平铺算法可能恰好相等。
- 数值、排序、覆盖率和 refs 直接精确断言，不从渲染字符串反推。
