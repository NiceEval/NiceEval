# 决策

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md)

## 裁决

采纳 [PLAN-6](PLAN-6/README.md)。

作者面是“nominal Analysis fields + static `ReportData` + descriptor components + static Page／PageFamily”。

- Analysis SDK 在 `AnalysisPopulation` 上定义 `Dimension` 与 `Measure`；跨 population 必须先定义具名 relation。
- `aggregate({ by, values })` 只组合同一 population fields，返回 typed declaration，不返回 Promise 或普通数组。
- host 在 Page callback 前编译本次有限依赖闭包，每个 projection／field materializer 至多执行一次。
- `MetricValue` 保留 value、state、observed／denominator、issues、refs、unit、format 与 better；组件不重算口径。
- `ReportData` row 拥有与显示顺序无关的 opaque key；PageFamily target 绑定 family object identity。
- Page 与 component callback 只组合 descriptor／closed row，不取得 Sample、projection、reader、Effect 或 migration。
- custom component 只组合已有 semantic primitives；新增 primitive 必须同时定义 terminal、Web 与 static face。

## 不可能三角

任意 render-time I/O、执行前依赖闭包与零声明阶段不能同时成立。选择保留后两项，明确放弃第一项：

```text
descriptor definition
  → compile finite dependency closure
  → once-per-execution projection + Analysis materialization
  → PageFamily expansion + semantic tree closure
```

Report module 是可信代码而不是安全沙箱，但 NiceEval 作者 API 不授予 I/O capability。materialization callback 不能返回新
`ReportData` 或扩张依赖。

## 为什么替换 PLAN-5

PLAN-5 守住了 closed input 与 renderer 边界，却把内部 projection manifest、Calculation registration、completeness、
branded id、状态分支和重复 wiring 暴露给普通 Report 作者。GPU 一项指标就要手写 join、group、denominator、Page 与
semantic table，说明 host 的复杂度被转嫁给了每个 application。

PLAN-6 保留 PLAN-5 的执行内核，在其上增加 nominal fields 与 `ReportData` compiler。它恢复 0.12.1 的业务词汇、调用
形状与阅读成本，但不恢复 `await aggregate(sample, ...)`、普通数组加工或 `ctx.scope` 动态读取。

## 为什么仍否决其它方案

- PLAN-1 按领域问题增加组件，双面实现和 props 会随问题数增长。
- PLAN-2 允许 Source 自行 async compute，依赖无法在 Page 前闭合；Source／data 双入口也增加作者运行协议。
- PLAN-3 把两级聚合、coverage 与 refs 交还给每条 SQL。
- PLAN-4 让同一报告出现两套读取与计算入口，较弱路径会成为事实标准。
- PLAN-5 的底层模型继续作为内部实现材料；公共 Report 作者面采用 PLAN-6。

## 契约落点

- 五类角色与三层扩展边界：[Record → Analysis → Report Authoring](../../roadmap/record-analysis-report/authoring.md)。
- constructor、聚合算法、失败与 host 入口：[Record → Analysis → Report Library](../../roadmap/record-analysis-report/library.md)。
- dependency closure、identity 与路由：[Record → Analysis → Report Architecture](../../roadmap/record-analysis-report/architecture.md)。
- 完整官方／第三方语法：[Record → Analysis → Report Use Cases](../../roadmap/record-analysis-report/use-case/README.md)。

## 风险与明确牺牲

- `ReportData` 不是数组；任意数据加工要变成 Analysis field 或 display-only component option。
- Analysis 存在一张有限 DAG，但只编译当前请求；不是全程序、动态或 callback 可扩张的 graph。
- NiceEval 自有 JSX runtime 让 CLI 零配置，但独立 `tsc`／编辑器要使用 package report preset 或 `jsxImportSource`。
- 普通用户不能注册任意 visual primitive；这换来 terminal、Web 与 static 不会分裂。
