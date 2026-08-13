# Decision

## 裁决

为 [Capture → Analysis → Report Roadmap](../../roadmap/record-analysis-report/README.md) 采纳
[PLAN-1](PLAN-1/README.md)：三种 factory 构造 `RecordProjection`，唯一公开执行入口是
`projectAnalysisSample({ sampleHandle, projection })`。

这是 Roadmap 目标的选型裁决。该方向被产品采用前，[Projection Feature](../../feature/projection/README.md) 仍是
唯一当前契约；Design Decision 不自行替换 Feature。

## 为什么选择 PLAN-1

- 普通 Analysis 脚本可以用 TypeScript / Effect 控制流按需决定下一次读取；
- 每个调用仍返回穷尽、closed、Sample-aligned 的 `ProjectedSample`；
- 所有调用复用同一个 `AnalysisSampleHandle` 绑定的 snapshot generation；
- `RecordProjection` declaration identity 可以服务 direct Analysis script 与 host 内部的 field executor；
- Report 只通过受限 `ReportSample` 请求 Analysis fields，不取得 projection declaration 或 reader。

## 为什么否决 PLAN-2

[PLAN-2](PLAN-2/README.md) 会把依赖节点、edge、graph brand、全图验证与调度变成通用作者协议。它能在 I/O 前闭合
任意官方 Analysis 图，但禁止 payload-dependent direct call。当前目标不需要用这套公共协议换取全局保证。

Report 的每次 `aggregate()` 会在 host 内部把所请求 Analysis fields 编译成有限执行闭包。这个 runtime-local DAG 不成为
Report 作者协议，也不会把任意 Analysis 程序变成公共 graph，因此不是 PLAN-2 的旁路实现。

## 契约落点

- 唯一 direct primitive 与 Report handoff：[Roadmap Library](../../roadmap/record-analysis-report/library.md)。
- snapshot 与三层边界：[Roadmap Architecture](../../roadmap/record-analysis-report/architecture.md)。
- 当前 direct API 的完整结果形状：[Projection Feature](../../feature/projection/library.md)。
