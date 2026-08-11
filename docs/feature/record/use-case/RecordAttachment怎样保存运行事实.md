# RecordAttachment 怎样保存运行事实

RecordAttachment 是挂在一个 Run 或 Attempt 上的具名、版本化数据。它不是消息队列，也不是运行中的 event bus。

## Core 与 RecordAttachment 分工

```text
Record Core
  └─ Run、Slot、Member、Attempt 的身份与引用

owner-local RecordAttachments
  └─ Verdict、Assertions、Conversation、Usage、Timing、Sources 等运行事实
```

Core 负责所有 reader 都必须理解的导航和引用。producer 通过 typed RecordAttachment definition 写入业务事实；generic writer 只验证 owner、schema、exact JSON closure 与 Core 引用。

## 先选择 owner

事实来自一次实际执行时使用 Attempt owner。事实描述整轮发现、共享输入或 Member 采用原因时使用 Run owner。

| 运行事实 | owner 与 schema | 原因 |
|---|---|---|
| message、tool call、tool result | Attempt / `niceeval.conversation/v1` | 来自一次实际执行 |
| token、请求与 provider 计费观测 | Attempt / `niceeval.usage/v1` | 随实际执行封存 |
| 规范化时间区间 | Attempt / `niceeval.timing/v1` | 形成 Attempt waterfall |
| Sandbox 命令与结果 | Attempt / `niceeval.commands/v1` | 是该 Attempt 的证据 |
| Eval 源码快照 | Run / `niceeval.sources/v1` | 同一 origin Run 的 Attempt 可以共用 |
| Member 采用原因 | Run / `niceeval.membership-provenance/v1` | 解释本轮 Slot 怎样采用 Attempt |

完整 built-in catalog 以 [Observability](../../../observability.md) 为单源；该页面应同步使用 RecordAttachment 术语。

## 每次 send 不原样保存 Turn

`send()` 返回的 `Turn` 是作者运行时对象。Adapter 把 message、tool call 与 tool result 归一化，再写入 Attempt-owned Conversation RecordAttachment。

Usage、Timing 与 Diagnostics 分别进入自己的 RecordAttachment。一个 RecordAttachment 损坏、需要 migration、无法无损迁移或 unsupported，只影响请求它的 projection。

## 落盘与完成标识

每个 RecordAttachment directory 包含固定 `attachment.json`、exact JSON 的 `payload.json`，以及 definition 穷尽声明的 owner-local `blobs/**`。大 stdout、源码或 patch 可以放 blob，payload 保存可验证引用。

一个 RecordAttachment 不能引用其它 RecordAttachment、其它 owner 或 root 外文件。writer 写完所有 Core 与 RecordAttachment 后才创建 Run 的 `complete` 标识。

中断写入没有完成标识，因此 reader 不读取其中任何 RecordAttachment，只返回 incomplete warning。完成标识存在后，单个 RecordAttachment 的后续损坏仍只影响它自己。

## 读取路径

```text
RecordReader
  → frozen Run / Attempt owner
  → RecordAttachment family
  → RecordAttachmentRead<Payload>
  → RecordProjection
  → ProjectedSample / Report
```

RecordAttachment 读取只解释一个 owner 的一份具名数据。选择哪些 Run 属于 Sample、怎样计算通过率以及怎样渲染页面，都留在 Record 之上。

## 相关阅读

- [RecordAttachment 与 storage closure](../architecture.md#recordattachment)
- [RecordAttachment definition](../library.md#recordattachment-definition)
- [Projection](../../projection/README.md)
