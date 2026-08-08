# 运行观测协议 —— 参考方案

这一层登记设计从哪些成熟软件与规范借来，以及 NiceEval 有意没有照搬什么。
目标契约仍以 [Architecture](../architecture.md) 和 [Library](../library.md) 为准。

## Projector 与 Projection

`Projector` 不是 NiceEval 自造的名称。
Event Sourcing/CQRS 软件已经用它表示“消费事件并产生读模型的组件”，而 `Projection` 表示产生的读模型或持续消费进程。

| 软件 | 官方名称 | 实际语义 | NiceEval 的关系 |
|---|---|---|---|
| Commanded + Ecto | `Projector` | Event handler 订阅事件并事务性更新 SQL read model | 借组件名与重新执行语义，不借持久 subscription |
| Spatie Laravel Event Sourcing | `Projector` | 事件处理类写数据库或文件中的 Projection | 借 Projector/Projection 区分，不借有副作用的写模型 |
| Neos Event Sourced Content Repository | `Projector` | 确定性函数把事件应用到 projection data model | 与 NiceEval 的纯函数约束最接近 |
| Python `eventsourcing` | `projector_func` | 从 stored events 重建 aggregate | 与按需读取有限历史最接近 |
| Akka Projections | `Projection` | 持续消费带 offset 的 Source，并写外部模型 | 只有 projection 家族语义，不是 exact `Projector` 先例 |
| EventStoreDB / KurrentDB | `Projection` / projection engine | 保存 checkpoint、state 与 result，可持续运行 | 只有可重入读模型语义，不是 NiceEval 的运行模型 |

一手资料：

- [Commanded：Creating a projector](https://hexdocs.pm/commanded_ecto_projections/usage.html) 明确把 Projector 定义为专门的 event-handler 进程，并以 name 标识 subscription。
- [Commanded Ecto API](https://hexdocs.pm/commanded_ecto_projections/Commanded.Projections.Ecto.html) 用 `Projector` 示例展示事件到 read model 操作的转换。
- [Spatie：Creating projectors](https://spatie.be/docs/laravel-event-sourcing/v7/using-projectors/creating-and-configuring-projectors/) 提供 `Projector` 基类与生成命令。
- [Spatie：Writing your first projector](https://spatie.be/docs/laravel-event-sourcing/v7/using-projectors/writing-your-first-projector/) 区分处理事件的 Projector 与写出的 Projection。
- [Neos 的 Event Sourcing 定义](https://docs.neos.io/guide/contributing-to-neos/event-sourced-content-repository/how-we-understand-event-sourcing) 把 Projector 描述为确定、无副作用的纯函数。
- [Python eventsourcing Application](https://eventsourcing.readthedocs.io/en/stable/topics/application.html) 公开使用 `projector_func` 从事件重建对象。
- [Akka Projection overview](https://doc.akka.io/libraries/akka-projection/current/overview.html) 把带 offset 的持续消费进程称为 Projection。
- [KurrentDB Projection introduction](https://docs.kurrent.io/server/v26.1/features/projections/intro) 展示持续运行、checkpoint 与 reset 后重新执行。

NiceEval 只采用“权威历史经确定性计算得到读模型”这部分。
`AttemptProjector` 不维护 subscription、offset 或 checkpoint，不写持久 read model，也不触发网络或其它外部副作用。
它返回的 `Availability<T>` 和 `basedOn` 是 NiceEval 为证据审计增加的语义，不应冒充上述软件的共同契约。

```ts
interface AttemptProjector<T> {
  (attempt: AttemptHandle): Promise<Availability<T>>;
  readonly name: string;
  readonly version: string;
}

// 相同 sealed Record、Projector 版本与参数产生相同结果。
const result = await timing(attempt);
```

下面是持续写 read model 的 projection processor，不是 NiceEval Projector：

```ts
on(event, async () => {
  await readModel.update(event);
  await offsetStore.commit(event.offset);
});
```

因此公开名称保留具体的 `AttemptProjector<T>`。
文档不能把 Akka 或 EventStoreDB 写成 exact `Projector` 命名先例，也不能暗示 NiceEval 需要它们的运行基础设施。

## Typed-object 容器

v2 容器不是凭空设计，也不靠预先猜完全部字段。
它组合了多个成熟协议已经证明过的机制：

| 出处 | 借用的机制 | 不照搬的部分 |
|---|---|---|
| OCI Image Spec | `mediaType + digest + size` Descriptor 与内容寻址 DAG | image、config、layer 的容器镜像业务语义 |
| Git object database | 不可变内容对象与引用分离 | Git 的少量固定对象类型和 packfile |
| Protocol Buffers | payload 追加字段、未知内容保留、删除字段身份不复用 | ProtoJSON 无法无损 round-trip unknown fields；NiceEval frozen core 不开放字段追加 |
| CloudEvents | 小型稳定 envelope、独立 data schema、namespaced extension | 传输绑定和云事件业务语义 |
| OpenTelemetry Schema | 已发布 schema 身份不可原地改写 | 通用 rename/migration 引擎 |
| RFC 8785 JCS | 小型 JSON 索引的规范字节 | 大型 blob 与 NDJSON payload |

一手资料：

- [OCI Content Descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md) 定义 `mediaType`、`digest`、`size` 和 Merkle DAG 引用。
- [OCI Image Layout](https://github.com/opencontainers/image-spec/blob/main/image-layout.md) 定义固定入口与按算法、digest 存放 blob。
- [Git data model](https://git-scm.com/docs/gitdatamodel) 区分不可变 object、reference 与 index。
- [Protocol Buffers schema evolution](https://protobuf.dev/programming-guides/proto3/) 说明旧 parser 如何保留未知字段，并警告 JSON 转写会丢失它们。
- [CloudEvents core specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md) 区分 core attribute、extension 与独立 `dataschema`。
- [OpenTelemetry schemas](https://opentelemetry.io/docs/specs/otel/schemas/) 为已发布 schema 提供不可变身份和显式转换。
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) 定义 JSON Canonicalization Scheme。

NiceEval 的关键差异是把 Graph node 与 strong edge 冻结成通用遍历层。
Generic verifier 即使不懂 payload media type，也能验证并复制完整强闭包；只有依赖该 payload 的 Projector 或页面 unavailable。
codec、加密与签名使用 wrapper 或 attestation payload，不进入 DescriptorV1，也不能成为修改 frozen core 的捷径。

## 证明材料

[Schema Evolution](schema-evolution.md) 用旧 Record 的 1→15 历史逐项反事实回放，并列出同一功能在旧链路与新链路中的修改面。
它也定义版本升级防火墙和必须通过的兼容性质测试。
