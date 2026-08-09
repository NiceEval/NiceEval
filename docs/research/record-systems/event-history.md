# 事件历史、判断与读模型

> 观察日期：2026-08-09
>
> 观察对象：Datomic、KurrentDB 26.1、Temporal、Apache Flink stable 文档与 OpenTelemetry 规范
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 研究判断

Datomic 最接近“不可变事实与固定历史 basis”，KurrentDB 最接近“权威历史与可重建 Projection 分离”。
Temporal、Flink 和 OpenTelemetry 只提供局部先例，不能直接映射为 Record。

这五个系统都没有 NiceEval Claim 的直接同类。
Temporal Command 是行动请求，Flink watermark 是进度启发，OpenTelemetry Event 是发生项，Span Status 是摘要。
KurrentDB 可以保存“某判断发生”的 event，仍不会自动固定 evaluator identity 和实际 evidence basis。

## 一手材料

### Datomic

- [Datomic Introduction](https://docs.datomic.com/)
- [Transaction Model](https://docs.datomic.com/transactions/model.html)
- [Transaction Data Reference](https://docs.datomic.com/transactions/transaction-data-reference.html)
- [Database Filters](https://docs.datomic.com/reference/filters.html)
- [Changing Schema](https://docs.datomic.com/schema/schema-change.html)
- [Schema Data Reference](https://docs.datomic.com/schema/schema-reference.html)
- [Excision](https://docs.datomic.com/operation/excision.html)

### KurrentDB

- [Core concepts](https://docs.kurrent.io/getting-started/concepts)
- [Event streams](https://docs.kurrent.io/server/v25.0/features/streams)
- [Appending events with optimistic concurrency](https://docs.kurrent.io/clients/node/v1.1/appending-events)
- [Projection introduction](https://docs.kurrent.io/server/v26.1/features/projections/intro)
- [Projection Engine V2](https://docs.kurrent.io/server/v26.1/features/projections/engine-v2)

### Temporal、Flink 与 OpenTelemetry

- [Temporal Event History](https://docs.temporal.io/encyclopedia/event-history)
- [Temporal Workflow Definition and determinism](https://docs.temporal.io/workflow-definition)
- [Temporal Continue-As-New](https://docs.temporal.io/workflow-execution/continue-as-new)
- [Flink Streaming Analytics](https://nightlies.apache.org/flink/flink-docs-stable/docs/learn-flink/streaming_analytics/)
- [Flink Fault Tolerance](https://nightlies.apache.org/flink/flink-docs-stable/docs/learn-flink/fault_tolerance/)
- [Flink Savepoints](https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/state/savepoints/)
- [Flink State Schema Evolution](https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/fault-tolerance/serialization/schema_evolution/)
- [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)
- [OpenTelemetry Events](https://opentelemetry.io/docs/specs/semconv/general/events/)
- [OpenTelemetry Schemas](https://opentelemetry.io/docs/specs/otel/schemas/)
- [OpenTelemetry Telemetry Stability](https://opentelemetry.io/docs/specs/otel/telemetry-stability/)
- [OTLP Specification](https://opentelemetry.io/docs/specs/otlp/)

## 精确筛选

| 系统 | 保留原因 | 与 NiceEval 的核心差异 | Claim 直接同类 |
|---|---|---|---|
| Datomic | immutable datom、历史 basis、`as-of` 与追加式纠错 | 当前 schema 可以改变历史读取解释；没有自动 evidence trace | 无 |
| KurrentDB | event history 与 Projection/read model 分离 | Projection 是带 checkpoint 且可能写事件的持续子系统 | 无 |
| Temporal | Event History replay 与长期代码兼容 | 历史服务于继续执行；Command 不是判断 | 无 |
| Flink | event time、watermark、late data 与重触发 | 依赖可重新读取的外部 source；checkpoint 不是事实根 | 无 |
| OpenTelemetry | occurred/observed time、schema identity、instrumentation API | 可采样、丢弃或重复；没有 durable revision | 无 |

Kafka 没有单列。
它能补充 append log 和 consumer offset 的先例，却不会增加 Claim、basis、late-data policy 或固定读模型方面的新证据。

## Datomic：不可变事实和固定 basis

Datomic 把数据库建模为 immutable datom 的集合。
transaction 只增加 assertion 或 retraction，并在完全有序的 transaction history 中形成新的 database value。
`basisT`、`as-of`、`since` 和 `history` 让读者明确选择时间边界。

transaction 自身也是可查询 entity，可以保存应用、用户、目的或事件 producer 等 provenance。
Datomic 对 excision 的说明还指出，错误旧事实可能已经影响历史决策；很多场景应保留当时 basis，再追加纠正。

这与 Record 的相似点很强：

- `RecordGraphRef` 像显式 database basis，固定后不随 head 前进。
- 迟到或纠错事实追加新 revision，旧 revision 继续产生旧读结果。
- “事实后来被纠正”和“当时的判断从未发生”是两回事。

### Datomic 的反例更重要

Datomic 时间旅行不会把 schema 一起倒回。
历史 database value 仍按当前 basis 的 schema 解释；cardinality 变化甚至可以改变历史 entity lookup 的返回形态。

NiceEval 应拒绝这种漂移。
旧 Record revision 的 payload 应继续由原 media type 和原 bytes 标识。
新 reader 可以理解或明确返回 unsupported，不能用当前 schema 重新解释旧对象。

Datomic 还允许 `:db/noHistory` 放弃部分属性历史，并提供系统外的 excision。
它的 immutable history 因而是默认数据模型，不是无条件永久重开保证。

### Datomic 仍不是 Claim 系统

transaction provenance 不等于 evaluator identity，database basis 也不等于精确 `basedOn`。
query engine 不会自动持久化某次判断实际读取的 datom 集合。

Datomic 证明了“保留历史决策的 basis”是成熟需求。
它没有提供 NiceEval Claim 的 evaluator、value、tracked basis 和 verification 两轴。

## KurrentDB：History 与 Projection 分离

KurrentDB 把已发生的状态改变保存为 stream 中的 event。
event 在写入后保持不变，stream revision 与全局 position 按追加建立。
writer 可以用 expected revision 做 optimistic concurrency，避免并发追加发生 lost update。

Projection 持续消费 event，保存 checkpoint/state，并可输出新的 event stream。
reset 会删除 checkpoint 或派生输出，再从历史开头重建。

这是最直接的 History–Projection 分离先例。
它同时展示了 NiceEval 不应复制的部分：

- Kurrent Projection 是持续运行的运维子系统，不是固定 GraphRef 上的纯读取函数。
- Projection 可以拥有输出 stream，NiceEval Projector 不能写回 Record。
- checkpoint format 会随 engine 变化，持久派生状态形成迁移负担。
- system Projection 产生写放大，并占用 leader 的 CPU 与 IO。

NiceEval 把 Projection 设计为可删除、按需重算的 cache，可以避开这类长期迁移。
memo identity 则必须绑定 GraphRef、Projector version、reader capability 与规范参数。

### KurrentDB 的 late data 与 retention

stream position 由 append 顺序决定，旧 event 不能原地插入或重排。
迟到业务事实只能稍后 append，并在 payload 或 metadata 中携带 occurred time。
如何重算 event-time 分组或 read model 由应用 Projection 负责。

stream metadata 可以设置 age/count retention，也支持 soft delete、hard delete 和 scavenging。
Projection link 在原 event 被删除后可能失效。
这说明 event sourcing 并不自动提供永久、完整的证据闭包。

KurrentDB 可以保存名为 `JudgmentMade` 的 event。
它只证明“判断发生”，不会自动保存 evaluator version、实际读取的 event 集合，或 basis 是否仍可验证。

## Temporal：为了继续执行而 replay

Temporal Event History 是 Workflow Execution 的 durable log。
Workflow code 产生 Command，Temporal Service 把相应 Event 写入历史；Worker 崩溃后 replay 历史，重建执行状态。

相同 Workflow code 在相同历史位置必须产生兼容 Command。
网络、数据库和 LLM 调用等非确定操作要放入 Activity。
长期运行的 Workflow 还需要 Worker Versioning 或 patching 维持 replay compatibility。

这些机制适合借鉴为 reader/Projector 从持久事件重建状态的测试。
它们不是 NiceEval Claim：

- Command 请求安排 Activity、timer 或其它动作，不是 evaluator 对事实的判断。
- evidence relation 隐含在 workflow code 和 event sequence 中。
- 没有 evaluator identity、判断 value 和显式 `basedOn` 集合。

Temporal 也给历史规模设限。
Continue-As-New 会把相关 state 传给一个新 Run ID 和新 Event History，以免单条历史无限增长或妨碍代码升级。

这提供了成本警告，却不适合作为 Record 的默认分段。
NiceEval receipt、Sample 和 Report 需要固定同一个可验证 revision，不能让 history rollover 隐式切断证据链。

## Flink：late data policy，不是事实根

Flink 明确区分 event time、ingestion time 与 processing time。
watermark 表示系统认为某个 event-time 之前的数据大致已经到齐，是延迟和完整度之间的策略折中。

event-time 聚合区间越过 watermark 后收到的数据成为 late event。
系统可以丢弃、送到 side output，或在 allowed lateness 内重新触发并更新结果。

Flink checkpoint 保存 source offset 和 operator state。
恢复依赖 source 可以重新读取，再次执行 processing graph。
savepoint 的兼容还受稳定 operator ID、state backend 和 serializer schema 限制。

因此 Flink 不拥有原始事实根。
watermark 也不是 completeness proof，更不是 Claim：

- 它没有枚举 evaluator 实际读取的证据。
- 迟到数据可能直接推翻现有聚合结果。
- 它没有 evaluator identity、version 或判断 value。

NiceEval 应吸收 occurred、observed、append order 分离，以及 Live freshness 的表达。
权威 Record 不能默认丢弃 late fact，也不能让 watermark 关闭历史纠正。

## OpenTelemetry：schema 演进的现实警告

OpenTelemetry LogRecord 同时提供 `Timestamp` 和 `ObservedTimestamp`。
前者表达事件发生时间，后者表达收集系统观察到它的时间。
Event 是有规范名称的 LogRecord，用于发生项、状态变化或时间点结果。

Telemetry Schema 使用带版本的 immutable schema URL，并描述 consumer 侧转换。
这正面承认 producer 和 consumer 会以不同速度升级。

不过 schema 转换能力刻意有限。
OpenTelemetry 当前稳定性文档还对“依靠 schema transformation 保持 telemetry stability”设有 moratorium。
这是一条非常直接的反例：版本化 schema 能隔离变化，却不能保证任意变化都可安全自动迁移。

OTLP 和 SDK 也允许 retry、duplicate、partial success、sampling 或 queue drop。
收到的 OTel event 可以成为 NiceEval Observation，未收到不能证明没有发生。

### OTel 不是 Claim

- Event 表达发生项，属于 Observation。
- Span Status 是可更新的摘要，不携带 evaluator identity 或 basis。
- Span Link 表达 telemetry relation，不表示“这个判断依据这些证据”。

最值得吸收的是 API 分层。
instrumentation 或 bridge 隐藏 OTLP envelope，应用作者使用惯用的 typed API。
NiceEval Adapter 同样应拿到已绑定 emitter，而不是每次手写 stream binding、sequence 和 scope。

## Claim 的最终判断

若某外部概念要算 Claim 的直接同类，至少要同时固定：

1. 这是判断，不是行动请求或“判断发生”的事件。
2. evaluator identity、version 与可选 model。
3. 判断 value。
4. 指向具体历史 revision 的 evidence basis。
5. 旧 Claim 不被原地替换，并分别表达 value availability 与 basis verification。

五个系统均未同时满足。
Datomic 最接近问题背景，KurrentDB event 可以承载序列化结果，二者都没有框架自动追踪的 Claim 语义。

因此，Claim 应描述为 NiceEval 自己的领域组合。
它不是从 event sourcing、workflow 或 telemetry 中直接复制出的通用名词。

## 对上层 API 的启发

- 读取入口接收明确 GraphRef，不把 implicit latest 传入长任务。
- Adapter 自动生成 Observation envelope，作者只调用 typed event action。
- evaluator 只返回领域判断，框架补 evaluator identity、time、scope 与 tracked basis。
- late fact 使用补充事实和 adoption revision 的高层动作，不要求用户构造 stream revision。
- Projector cache 完全内部化，任何版本不兼容都允许删除重建。
- occurred time、observed time 和 append order 分字段，不能由一个 timestamp 同时承担。
- freshness 和 watermark 只进入 Live 或 Projection，不进入历史 Claim 的 evidence 语义。
