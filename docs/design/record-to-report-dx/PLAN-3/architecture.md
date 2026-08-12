# PLAN-3 Architecture

## Compiler pipeline

```text
open frozen Record + select Runs
             ↓
collect semantic Query objects
             ↓
validate relation ownership, grain, cycles and limits
             ↓
compile fields and relations to owner-local Attachment reads
             ↓
materialize exhaustive population and semantic rows
             ↓
apply filters, joins, grouping and measures
             ↓
render isolated consumers
             ↓
immutable ReportExecution
```

Public query operators形成 logical plan。Host 可以合并相同 physical reads，但只按 Query identity 缓存
semantic result；它不比较 callback source。

## Correctness boundary

Analysis 的 base Relation 固定 population identity；派生操作产生 managed semantic Query。Filter 与 join
产生 participation reasons，而不是直接丢行。
Measure 同时接收 rows 与 population，因此 coverage、denominator 和 evidence 不依赖组件或作者另算。

这比 PLAN-1 的普通 `derive()` 更强地约束统计正确性，也比 SQL 保留更多 typed semantics。代价是 public
DSL、generic types、planner diagnostics 与 extension contracts 都显著增加。

## Errors

Attachment 六态保存在 Field cells。Relation/Measure definition invalid 在 I/O 前汇总。Field projector
defect、measure defect 与 consumer defect 分别形成 query或consumer execution problem；无关 query 继续。

一个 relation join 无法建立时不会静默 drop row。结果包含 unmatched population、reason 与 evidence。

Base Relation 属于 Analysis；Field、filter、join、Measure 与 materialization 属于 Derivation。Query planner
是独立 runtime，而不是藏在 Report renderer 内的实现细节。因此 PLAN-3 使用四层责任拓扑，即使
`openAnalysis()` 与 `executeQuery()` 让作者只看到两个 convenience calls。

Typed expression 与 managed `map()` 只闭合 Record dependencies。Report module 仍是 trusted Node code，
技术上可以 import filesystem/network；host 不阻止这种 ambient I/O，参数收窄不是 security boundary。

## Official and custom parity

Built-in Report 只使用 public model、fields、measures 与 consumers。标准 Attempt page 没有 private relation、
locator reader 或 legacy evidence bridge。

## Record pressure

Semantic planner 不要求修改 durable Record。Member exact refs、originRunId 与 Attachments 足够构建内建
relations。

它仍无法在当前 `RecordAttachmentValue` 内选择性读取 blob。跨 owner subject identity migration 也超出
owner-local converter；这两点必须在 Record reader/migration 的独立设计中解决。
