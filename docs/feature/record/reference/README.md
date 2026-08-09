# Record 参考方案

本页登记 Record、Projector、typed-object graph 与证明链借鉴的外部先例。
目标契约以 [Architecture](../architecture.md) 和 [Library](../library.md) 为准。

## Projector 与 Projection

Event Sourcing 与 CQRS 软件使用 Projector 表达“从权威事件产生读模型的组件”。
NiceEval 借这个职责名称，但把它收窄成无持久副作用的按需读取函数。

| 软件 | 官方名称 | 实际语义 | NiceEval 采用 |
|---|---|---|---|
| Commanded + Ecto | `Projector` | event handler 事务性更新 SQL read model | 采用事件到读模型的职责名称 |
| Spatie Laravel Event Sourcing | `Projector` | 事件处理类写 Projection | 采用 Projector / Projection 区分 |
| Neos Event Sourced Content Repository | `Projector` | 确定函数产生 projection data model | 采用确定、无副作用约束 |
| Python `eventsourcing` | `projector_func` | 从 stored event 重建对象 | 采用按需重建心智 |
| Akka Projections | `Projection` | 带 offset 的持续消费进程 | 只参考 projection 家族词义 |
| KurrentDB | `Projection` | 持续运行、checkpoint、reset 与从事件重建状态 | 只参考可重入语义 |

一手资料：

- [Commanded：Creating a projector](https://hexdocs.pm/commanded_ecto_projections/usage.html)
- [Spatie：Creating projectors](https://spatie.be/docs/laravel-event-sourcing/v7/using-projectors/creating-and-configuring-projectors/)
- [Neos：How we understand Event Sourcing](https://docs.neos.io/guide/contributing-to-neos/event-sourced-content-repository/how-we-understand-event-sourcing)
- [Python eventsourcing：Application](https://eventsourcing.readthedocs.io/en/stable/topics/application.html)
- [Akka Projection overview](https://doc.akka.io/libraries/akka-projection/current/overview.html)
- [KurrentDB Projection introduction](https://docs.kurrent.io/server/v26.1/features/projections/intro)

NiceEval Projector 不维护 subscription、offset 或持久 read model。
它只能经 `ProjectionReadContext` 读取固定 RecordGraphRef，并由框架自动形成 basedOn。

```ts
const timing = defineAttemptProjector({
  id: {
    namespace: "niceeval",
    name: "timing",
    version: "1.0.0",
  },
  parameters: {
    schema: "niceeval.projector.timing-parameters/1",
    defaults: {},
    normalize(input = {}) {
      return normalizeExactObject(input, {
        defaults: {},
        fields: [],
      });
    },
  },
  dependencies: [],
  async projectNormalized(ctx, parameters) {
    const events = await ctx.events(
      { role: "lifecycle" },
      { schema: "niceeval.query.all/1", value: {} },
    );
    return buildTiming(events.value, parameters);
  },
});
```

这里的 `normalizeExactObject` 表示定义方执行的确定性完整校验：它拒绝未知字段、以
`defaults` 补齐值，并返回 `ProjectorParameterNormalization`。success 携带 JCS-safe plain object；
invalid 携带非空的结构化 issue。它不以 throw 或 validator text 表示输入错误。省略 `dependencies`
与写成空数组等价；示例显式写出空数组，说明 timing 没有 Projector object 依赖。

持续写外部 read model 的 processor 不是 NiceEval Projector：

```ts
on(event, async () => {
  await readModel.update(event);
  await offsetStore.commit(event.offset);
});
```

`EvidenceValue` 的 value / verification 两轴、tracked basedOn 与 adopted Attempt revision 是 NiceEval 的审计语义，不冒充这些软件的共同契约。

## typed-object graph

Record core 组合了多个成熟机制：

| 出处 | 借用 | 有意不照搬 |
|---|---|---|
| OCI Image Spec | `mediaType + digest + size` Descriptor、内容寻址 DAG | image、config 与 layer 业务语义 |
| Git object database | 不可变 object、mutable ref、历史 object 可达性 | 少量固定领域 object type 与 packfile |
| RFC 8785 JCS | 小型 JSON 索引的规范字节 | 大型 blob 与 NDJSON event |
| CloudEvents | 小 envelope 与独立 data schema | transport binding 与云事件业务语义 |
| OpenTelemetry Schema | 已发布 schema identity 不原地改义 | 通用 rename / migration engine |
| Protocol Buffers | schema 演进纪律与 field identity 不复用 | ProtoJSON 的 unknown-field round trip |

一手资料：

- [OCI Content Descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)
- [OCI Image Layout](https://github.com/opencontainers/image-spec/blob/main/image-layout.md)
- [Git data model](https://git-scm.com/docs/gitdatamodel)
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)
- [CloudEvents specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md)
- [OpenTelemetry schemas](https://opentelemetry.io/docs/specs/otel/schemas/)
- [Protocol Buffers schema evolution](https://protobuf.dev/programming-guides/proto3/)

NiceEval 的关键差异是把 Graph node、strong edge 与 committed-root page 冻结成通用遍历层。
generic verifier 不理解 payload media type，也能验证、保留和复制完整闭包。
codec、加密、签名和权限使用 wrapper 或 attestation payload，不进入 Descriptor。

## Merkle proof 与选择性披露

事件证明与 catalog proof 借鉴透明日志和稀疏 Merkle tree 的基本分层：

- Graph root 锚定 Record revision；
- catalog proof 锚定 stream index；
- ordered event tree 锚定 sequence 与 event bytes；
- proof wrapper 只携带验证路径，不携带无关 sibling payload。

相关一手资料：

- [RFC 9162：Certificate Transparency Version 2](https://www.rfc-editor.org/rfc/rfc9162.html)
- [Trillian：Verifiable Data Structures](https://github.com/google/trillian/blob/master/docs/papers/VerifiableDataStructures.pdf)

NiceEval 的 `RecordEvidenceProofV1` 绑定 typed descriptor、完整 `RecordGraphRef`、leafCount、
versioned selector 与统一的 EvidenceTarget。它只存在于目标 Report 或 SampleBundle Store，避免
source Record 对自己的 Graph digest 形成内容哈希自引用。

## Store fencing 与 GC

Store 的 fencing token 借鉴分布式 lease 中“旧持有者永远不能恢复写权”的纪律。
GC barrier 则采用完整 stop-the-world metadata boundary，优先保证可证明性。

- [Martin Kleppmann：How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- [The Chubby lock service](https://research.google/pubs/the-chubby-lock-service-for-loosely-coupled-distributed-systems/)

NiceEval 不使用客户端墙钟判断 lease，也不使用 object mtime 判断 GC 安全点。
远端实现必须提供线性一致 fencing、CAS 与 barrier，或证明等价 serializable 语义。

完整 mirror 把 immutable snapshot 当作重试边界，而不是“复制此刻最新 head”的别名。
capture 与 parse 只产生 `RecordMirrorSnapshotError`；已经 typed 的 snapshot 进入 mirror 后，失败只属于
`RecordMirrorError`。这使 source/target 的 closed、permission、unavailable、IO、corrupt 和首次
expected:null CAS conflict 不会被一个宽泛 transport error 抹平。

## 证明材料

[Schema Evolution](schema-evolution.md) 列出 frozen core 的扩展防火墙、攻击输入和必须持续成立的性质。
