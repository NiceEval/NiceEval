# Attachment 怎样保存运行事实

NiceEval 不把运行事实放进开放 JSON bag。每份事实都属于一个固定 Attachment family、一个 owner
和一个 exact payload。它不是 event bus，也不是第三方可以追加字段的消息队列。

契约单源始终在 [五个固定 Attachment family](../architecture.md#五个固定-attachment-family) 与
[Record Library](../library.md#固定-attachment-family-与-blob-closure)。

## 先选 owner 与 family

| 事实 | family | owner | 原因 |
|---|---|---|---|
| AssertionResult、Evidence 与 sealed result | `niceeval.assertions/v1` | Attempt | 来自一次实际检查 |
| 对话、OTel、事件、命令、用量、时间与诊断 | `niceeval.observability/v1` | Attempt 或 Run | 由对应 owner 的 collector 封口 |
| Sandbox 观察到的按路径变化 | `niceeval.file-changes/v1` | Attempt | 是该 Attempt 的执行证据 |
| Eval 与 loader 的源码闭包 | `niceeval.sources/v1` | origin Run | 同 Run 的 Attempt 共用当时源码 |
| 有媒体类型的大型文件 | `niceeval.artifacts/v1` | Attempt 或 Run | 归属由文件生命周期决定 |

owner 不是展示层的选择。它决定目录、identity、reference 和 blob closure。reference Member 不产生新
Attempt，也不复制任何 Attachment；读取时沿精确 origin Attempt 和 origin Run 追溯。

## 一个 family 一份完整 closure

每个 Attachment directory 固定包含：

```text
attachments/<family>/
├─ attachment.json   family 与 schema identity
├─ payload.json      exact JSON
└─ blobs/<opaque-key>
```

payload 中的每个 `RecordBlobRef` 都必须有且只有一份本 directory 的 blob。反过来，每个 blob 也必须
恰被 payload 引用一次。producer 不能提交 raw path、raw key、raw bytes 或另一个 owner 的 ref。

例如 command stdout、文件文本、源码和 Artifact 内容可成为本 family 的 blob。一个 Sources blob
不能被 Attempt 直接引用；source site 只保存 source item identity 和 digest 的 semantic join（语义连接）。

缺 key、多 key、重复 key、手写 key、跨 owner ref 或 root 外路径会让这份 Attachment 成为 `invalid`。
它不会产生可用但不完整的值。I/O 和 permission failure 发生在 value 形成前，仍是 typed read failure。

## 采集到读取的路径

```text
fixed collector
  → exact payload + own blob drafts
  → Run seal validates closure
  → complete
  → RecordReadSession reads on demand
  → deep-frozen RecordAttachmentValue
  → Analysis projection
```

Adapter、Sandbox 和 Assertion producer 只调用 NiceEval 已发布的窄 collector 方法。它们不能定义第六个
family，也不能绕过 collector 写入 `payload.json`。

`RecordReadSession` 只在 query 首次需要某份 owner/family 时读取和验证它。`available` value 包含
deep-frozen payload 和完整内存 blob snapshot；`bytes(ref)` 返回 defensive copy，不重开文件。Scope
关闭后，这份已形成的值仍可同步消费。

历史 owner 缺少请求 family 时返回 `not-recorded`；非 v1 schema 是 `unsupported`。这两种状态与
`invalid` 都只影响请求该事实的 query，不能把其它 Core 或 family 伪装为失败。

## 不能写进 Attachment 的内容

下列内容属于其它层：

- execution claim、lease、session、cache 和 global `latest` 属于 local operation state；
- matcher 实现、计划、reuse 判断和当前 worktree 属于 behavior / Experiment；
- total、平均值、通过率、排名、分母和页面树属于 Analysis 或 Report；
- 新的不可恢复事实必须进入 NiceEval 的固定协议，不得由 Adapter 自行新增 family。

## 相关阅读

- [Sources manifest](../architecture.md#sources-manifest)
- [Observability Attachment](../architecture/observability-attachments.md)
- [Assertions](../../assertions/README.md)
- [Projection](../../projection/README.md)
