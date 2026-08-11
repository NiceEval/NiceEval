# RecordAttachment 怎样保存运行事实

RecordAttachment 是挂在一个 Run 或 Attempt 上的具名、版本化数据。它不是消息队列，
也不是运行中的 event bus。

契约单源始终在 [RecordAttachment definition](../library.md#identity-与-attachment-definition)
与 [完整 blob closure](../architecture.md#recordattachment-与完整-blob-closure)。

## Core 与 RecordAttachment 分工

```text
Record Core
  └─ Run、Slot、Member、Attempt 的身份与引用

owner-local RecordAttachments
  └─ Verdict、Assertions、Conversation、Usage、Timing、Sources 等运行事实
```

Core 负责所有 reader 都必须理解的导航和引用。producer 通过 typed definition、family 与
write builder 写入业务事实；generic writer 只验证 owner、schema、exact JSON、完整 closure
与 Core 引用。

## 先选择 owner

事实来自一次实际执行时使用 Attempt owner。事实描述整轮发现、共享输入或 Member 采用原因
时使用 Run owner。

| 运行事实 | owner 与 schema | 原因 |
|---|---|---|
| message、tool call、tool result | Attempt / `niceeval.conversation/v1` | 来自一次实际执行 |
| token、请求与 provider 计费观测 | Attempt / `niceeval.usage/v1` | 随实际执行封存 |
| 规范化时间区间 | Attempt / `niceeval.timing/v1` | 形成 Attempt waterfall |
| Sandbox 命令与结果 | Attempt / `niceeval.commands/v1` | 是该 Attempt 的证据 |
| Eval 源码快照 | Run / `niceeval.sources/v1` | 同一 origin Run 的 Attempt 可以共用 |
| Member 采用原因 | Run / `niceeval.membership-provenance/v1` | 解释本轮 Slot 怎样采用 Attempt |

完整 built-in catalog 以 [Observability](../../../observability.md) 为单源；该页面应同步使用
RecordAttachment 术语。

## 以 builder 形成完整 closure

definition 的 `blobRefs(payload)` 是 payload 内 refs 的完整、按出现顺序的 projection。
write builder 同时捕获 family、payload、每个新 ref 与它的 `RecordBlobSource<E, R>`。

```ts
const write = makeRecordAttachmentWrite(conversationFamily, (blobs) => {
  const transcript = blobs.add(transcriptSource);
  return {
    payload: {
      turns,
      transcript: transcript.ref,
    },
    blobs: [transcript] as const,
  };
});
```

`transcript.ref` 没有可见 path 或可编辑 key。它只属于这一次 builder。generic writer 比较
`blobRefs(payload)` 与 `blobs` 后才消费 Stream 并写入 owner-local `blobs/<opaque-key>`。

payload 指向却没有 source、source 未被 payload 指向、重复 key、非法 ref 或 bytes 和
projection 不一致都会拒绝这次 write。producer 不能通过 raw JSON、文件路径、另一个
Attachment 的 ref 或类型断言绕过 runtime identity 检查。

## 每次 send 不原样保存 Turn

`send()` 返回的 `Turn` 是作者运行时对象。Adapter 把 message、tool call 与 tool result
归一化，再写入 Attempt-owned Conversation Attachment。

Usage、Timing 与 Diagnostics 分别进入自己的 Attachment。一个 Attachment 损坏、需要
migration、无法无损迁移或 unsupported，只影响请求它的 projection。

## 落盘与完成标识

每个 Attachment directory 包含固定 `attachment.json`、exact JSON 的 `payload.json`，
以及 builder 产生的完整 owner-local `blobs/<opaque-key>` closure。

Attachment 不能引用其它 Attachment、其它 owner 或 root 外文件。writer 写完所有 Core 与
Attachment 后才创建 Run 的 `complete` 标识。

中断写入没有完成标识，因此 reader 不读取其中任何 Attachment，只返回 incomplete warning。
完成标识存在后，单个 Attachment 的后续损坏仍只影响它自己。

## 读取路径

```text
RecordReader / RecordWriteSession.view
  → frozen Run / Attempt owner
  → RecordAttachment family
  → RecordAttachmentRead<Payload>
  → RecordAttachmentValue<Payload>
  → RecordProjection
  → ProjectedSample / Report
```

`available` 只在 exact payload 与全部 blobs 已验证时出现。`value.blobs` 是只读
capability；它只能打开 closure 中的 `RecordBlobRef`。permission 与 EIO 是
`RecordReadError`，interruption 保留 Effect Cause，不会被伪装为 `invalid`。

RecordAttachment 读取只解释一个 owner 的一份具名数据。选择哪些 Run 属于 Sample、怎样
计算通过率以及怎样渲染页面，都留在 Record 之上。

## 相关阅读

- [RecordAttachment 与 storage closure](../architecture.md#recordattachment-与完整-blob-closure)
- [RecordAttachment definition](../library.md#identity-与-attachment-definition)
- [Projection](../../projection/README.md)
