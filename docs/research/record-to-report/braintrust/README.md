# Braintrust：以 Trace 为共同语言的观测、标注与实验系统

> 研究截点：2026-08-14
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约。本文先按 Braintrust 自己的产品边界叙述；仅在末尾映射 NiceEval。

## 产品是什么

Braintrust 把自己定义为 agent/AI 应用的 active observability 与 evaluation 平台。它的原生工作流不是一次性的“跑 benchmark”，而是 **Instrument → Observe → Annotate → Evaluate → Deploy** 的反馈环。生产请求先成为 trace，团队从 logs 中过滤、复核并构造 dataset。随后团队用 dataset 跑 experiment，再把验证过的 prompt、model 或代码部署回生产。[官方 workflow](https://www.braintrust.dev/docs/workflow)

用户面对的是同一套 trace/span 数据在不同容器中的连续使用：

- production traffic 写进 project logs；
- 一个离线 test case 的执行写进 experiment；
- 有价值的 production trace 可以复制或引用进 dataset；
- scorer、classifier 与 reviewer 的判断仍以 span 或对目标 span 的 feedback 出现；
- prompt 自身有版本，并把所用 prompt id/version 作为 provenance 带回运行 span。

Braintrust 对 evaluation 的核心心智模型是 **Data + Task + Scorers/Classifiers → Experiment**。每个 test case 是一条 trace：根 `eval` span 包含 input/expected/final scores，`task` span 包住被测应用代码，LLM、tool、score 等 span 继续嵌套。[Evaluate 概览](https://www.braintrust.dev/docs/evaluate)；[Trace anatomy](https://www.braintrust.dev/docs/instrument)

官方文档把 experiment 称为 immutable、comparable record；准确理解应是“正常工作流把每次 run 当作不可变比较点”。公开 API/SDK 仍允许 patch/delete Experiment、以 `update: true` 继续同名 Experiment，以及 merge/update 已有 event，所以它不是存储层强制封存对象。具体证据见 [execution.md](execution.md) 与 [schema-and-migration.md](schema-and-migration.md)。

## 原生对象总图

```text
Organization
└─ Project
   ├─ Project logs ── Trace ── Span/Event
   ├─ Experiment ──── Trace ── Span/Event
   │  ├─ base experiment reference
   │  ├─ dataset id + resolved dataset version
   │  └─ saved parameters id + version / git metadata
   ├─ Dataset ─────── DatasetEvent rows
   │  ├─ DatasetSnapshot ──> concrete xact_id
   │  └─ EnvironmentObject ─> concrete xact_id
   ├─ Prompt ──────── versioned Prompt row
   │                    └─ provenance on an execution Span
   └─ View ───────── saved search/display configuration

Span/Event ── origin/ObjectReference ──> source row in logs, experiment,
                                        dataset, prompt, function, or session
Feedback ──────────────────────────────> target Span/Event
```

这里最容易混淆的边界是：`ExperimentEvent` / `DatasetEvent` 是 API 的持久 row 名称；`Span` 是 SDK 与 UI 对执行单元的称呼；`Trace` 不是另一个顶层 API resource，而是共享 `root_span_id`、由 `span_parents` 连接的一组 span。`id` 才是可查找的一条 span row 的标识，`span_id` 是构树字段。[官方 ID 说明](https://www.braintrust.dev/docs/observe/filter#identify-spans-and-traces)

## 研究页导航

- [layers.md](layers.md)：Braintrust 自己的 control plane、data plane、API、Brainstore、resource 与 owner/依赖关系。
- [execution.md](execution.md)：`bt eval` 到 SDK scheduler、span 写入、flush、summary、进程完成与 partial/retry/resume。
- [storage.md](storage.md)：公开 type/class、event envelope、版本历史、物理存储、持久派生值、index 与本地 cache。
- [reading-and-comparison.md](reading-and-comparison.md)：历史重开、BTQL/SQL、filter/group/align/compare、缺测与 UI/CLI render。
- [schema-and-migration.md](schema-and-migration.md)：对象版本、wire version、兼容 reader、自托管数据库/WAL/Terraform 升级，以及未公开边界。

## 与 NiceEval 的相似、差异与可吸收约束

相似点是：两者都需要可重开的历史 run、稳定 case identity、可追溯 source data、原始判断与聚合结果并存，以及 compare 时对齐同一输入。

差异更关键：Braintrust 的统一原语是 **versioned span/event log + queryable trace**，Experiment、Dataset 与 Logs 共用它。它没有 NiceEval 的 Record→Analysis→Report 三段对象，也没有公开的 run-completion resource。Braintrust 的 report 更像对同一历史 log 的保存视图、query shape、summary 与 comparison projection。

可吸收的约束是：

- source row reference 必须带容器、row id，必要时再带版本；不能只保留展示链接；
- dataset selector 可以是易读的 snapshot/environment，但执行必须固化它所指的 concrete version；
- compare alignment key 必须可配置，未对齐与未评分必须在 UI 中保留为空，不能当作 0；
- aggregate、diff、cost propagation 与 comparison grade 应可重算，不能取代原始 span、score/review span 和 audit history；
- “CLI 已退出”不等于“服务端对象已封存”；若 NiceEval 需要完成语义，必须有公开、持久、可查询的 completion protocol；
- append-only history 的 restore 应追加补偿写而不是改写旧历史；本地 cache、query index 与权威数据也必须在契约上分开。
