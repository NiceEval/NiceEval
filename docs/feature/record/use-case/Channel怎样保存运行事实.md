# Channel 怎样保存运行事实

本用例解释一次运行产生的源码、对话、用量与时间怎样进入 Record。Channel 不是消息队列，也不是运行中的 event bus。

Channel 是挂在一个 Run 或 Attempt owner 下的具名 immutable payload closure。它用 `RecordChannelSchemaId` 冻结 payload bytes 的 shape 与语义。

## Core 与 Channel 分工

```text
Record Core
  └─ Run、Slot、Member、Attempt 的身份与引用

owner-local Channels
  └─ Verdict、Assertions、conversation、usage、timing、sources 等业务事实
```

Core 负责导航和引用完整性，不随着新的业务事实扩张。producer 把业务事实写入自己拥有的 typed Channel definition，generic writer 只验证 envelope、closure、owner 与发布安全。

## 先选择 owner

事实属于一次实际执行时使用 Attempt owner。事实描述整轮发现、共享准备或采用决策时使用 Run owner。

| 运行事实 | owner 与 schema | 原因 |
|---|---|---|
| message、tool call、tool result | Attempt / `niceeval.conversation/v1` | 来自一次实际执行 |
| token、请求与 provider 计费观测 | Attempt / `niceeval.usage/v1` | 随实际执行封存 |
| 规范化时间区间 | Attempt / `niceeval.timing/v1` | 形成 Attempt waterfall |
| Sandbox 命令与结果 | Attempt / `niceeval.commands/v1` | 是该 Attempt 的证据 |
| Eval 源码快照 | Run / `niceeval.sources/v1` | 同一 origin Run 的 Attempt 可以共用 |
| Member 形成原因 | Run / `niceeval.membership-provenance/v1` | 解释本轮 slot 怎样采用 Attempt |

完整 catalog 与标准 projector 以 [Observability](../../../observability.md#内建业务通道闭环) 为单源。

## 每次 send 不原样保存 Turn

`send()` 返回的 `Turn` 是作者运行时对象。Adapter 把各轮 message、tool call 与 tool result 归一化，随后写入 Attempt-owned conversation event stream。

usage、timing 与 diagnostics 分别进入自己的 Channel。一个 Channel 损坏或 schema unsupported，只影响显式请求它的 projection，不把其它 Channel 或 Core 一并判坏。

OTLP span 只提供时间轨，不补写行为事件。标准持久输出是归一化后的 timing facts；是否另存 raw OTLP 不由 Record 通用格式推断。

## 落盘单位

每个 Channel directory 包含固定 `channel.json`、主 `payload`，以及 schema 穷尽声明的 Channel-local `blobs/**`。源码、大 stdout 或 patch 可以放 blob，payload 保存可验证引用。

一个 Channel 不能引用其它 Channel 或 owner 的文件。整个 Run seal 完成后才原子发布，因此 reader 不会看到只写了一半的 conversation 或 sources closure。

## 读取路径

```text
RecordReader
  → frozen Run / Attempt owner
  → RecordChannelProjector
  → ChannelProjectionResult<Value>
  → Projection / Report
```

Projector 只解释一个 owner 的一个 Channel。选择哪些 Run 属于 Sample、怎样计算通过率和怎样渲染页面，都留在 Record 之上。

## 相关阅读

- [Channel envelope 与 storage closure](../architecture.md#channelenvelopev1)
- [Channel definition 与 projector](../library.md#channel-definition)
- [Reports](../../reports/README.md)
