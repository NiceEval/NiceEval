# PLAN-6（推荐）：静态 Analysis fields + descriptor components

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [DECISION](../DECISION.md)

## 裁决形状

保留 PLAN-5 的静态 Page、closed `ReportExecution` 与统一 renderer 内核，但不再把 projection、input manifest、Calculation
registration 和 branded constructor 暴露给 Report 作者。作者面恢复到“选维度与读数，再交给显示形状”的业务心智：

```text
AnalysisPopulation
  ├─ Dimension
  └─ Measure
       ↓
aggregate({ by, values }) → static ReportData
       ↓
Bars / Table / Scatter / pure component
       ↓
Page / PageFamily → closed semantic tree
```

```tsx
const performance = aggregate({
  by: { agent },
  values: { passRate, costUSD },
});

const overview = {
  id: "overview",
  route: "/",
  render: () => (
    <>
      <Scatter points={performance} x="costUSD" y="passRate" />
      <Table rows={performance} />
    </>
  ),
};

export default defineReport({
  id: "quality",
  pages: [overview, attemptDetailsPageFamily],
  evidence: { attempt: attemptDetailsPageFamily },
});
```

`aggregate()` 返回 typed declaration，不返回 Promise 或普通数组。Page 与 component callback 只建立 descriptor；作者不
取得 Sample、reader、projection、Effect 或 runtime context。

## Analysis 承担口径

Analysis 的最小公开模型包含 nominal `AnalysisPopulation`、同 population 的 `Dimension`／`Measure`，以及显式
`AnalysisRelation`。direct executor 是 `analyze()`。Measure 静态声明 reduction stages、denominator policy、unit、
format、better 与 evidence policy。materialized `MetricValue` 才保存本次 value、state、observed／denominator、issues
与 refs。

`aggregate()` 只组合同一个 nominal population 的 fields。跨 population 对齐必须先由 Analysis SDK 用具名 relation
形成目标 population 上的新 field；Report 不 join、不自动寻路，也不定义业务 measure。

## 静态闭包

执行分成四段：

```text
descriptor definition
  → compile finite dependency closure
  → once-per-execution projection + Analysis materialization
  → PageFamily expansion + semantic tree closure
```

同一 projection 与 field-set materializer 在一次 execution 中至多执行一次。cycle、population mismatch 与 identity
collision 在 I/O 前拒绝。materialization 后的 row／route／render callback 只能消费 closed row，不能返回新的
`ReportData`。

这是一张“每次调用闭合”的有限 DAG，不是全程序、动态或可由 callback 扩张的查询 graph。

## 身份、证据与动态页

`ReportData` row 带 opaque `ReportRowKey`；aggregate key 由 nominal population identity 与完整 group coordinate 形成，
不受 measure、sort、limit 或 format 影响。图表和表格只用该 key，不回退数组 index，也不把一个显示 label 当作身份。

PageFamily 只出现在 `defineReport.pages`。它的 `target(key)` 绑定 family object identity；key 来自 stable identity
Dimension。默认 evidence 下钻只在单 ref、Report 显式声明唯一 family 且 instance 存在时形成。组件不会暗中增加 Page 或
projection。

## 扩展边界

- 业务事实：领域 SDK 在 Record 层增加 versioned adapter 与 producer API；
- 新分组或指标：Analysis 作者增加 population／relation／dimension／measure；
- 新页面或复合组件：Report 作者用 `aggregate()` 与现有 semantic primitives 组合；
- 新 host primitive：必须作为 NiceEval core 变更同时定义 terminal、Web 与 static face，不是普通 renderer plugin。

Report TSX 使用 NiceEval 自有 runtime。CLI loader 对 report 文件零配置；独立 `tsc`／编辑器使用 package 提供的 report
tsconfig preset 或 `jsxImportSource`。不引入 React ABI，也不允许 DOM intrinsic。

## 与 0.12.1 的关系

本方案恢复 0.12.1 的业务词汇、调用形状与可读性，不承诺行为兼容。明确不保留：

- `await aggregate(sample, ...)`；
- 把聚合结果当数组随意 `.map()`／`.toSorted()`；
- component 在 render 时通过 `ctx.scope` 追加数据读取；
- `point` 字段替换 row identity。

显示排序、截断和布局仍由组件 props 表达；改变 population、分母或公式则回到 Analysis field。

## 为什么替换 PLAN-5

PLAN-5 正确守住了 input closure 与 closed semantic tree，却把内部执行 plumbing 直接投影成作者概念。一个普通 GPU 表也
要声明 projection manifest、Calculation、completeness、状态分支、Page、branded id 与重复 registration，并手写
join／group／denominator。这不是业务报告作者应承担的复杂度。

PLAN-6 没有退回 render-time I/O。它在 PLAN-5 的静态内核之上增加 typed Analysis field 与 `ReportData` compiler，
把复杂度封回库内，同时恢复 `aggregate + Bars/Table` 的心智。

## 代价

- `ReportData` 不是普通数组；探索性任意 JavaScript 加工要变成 Analysis field 或 display-only component option；
- Analysis 有一张有限依赖 DAG，但只编译当前请求闭包；
- 自有 JSX runtime 需要独立 TypeScript 工具链采用 report preset；
- 普通用户不能注册全新的 visual primitive。

这些代价是执行前依赖闭包、一次投影、稳定 identity 与三种 renderer 同义的必要约束。
