# Attachment 怎样保存运行事实

NiceEval 不把运行事实放进开放 JSON bag。每份事实都属于一个固定 Attachment family、一个 owner 和一个
exact payload。调用方不能追加字段或改变 durable shape，更不能定义自己的 family。

契约单源始终在 [七个固定 Attachment family](../architecture.md#七个固定-attachment-family) 与
[Record Library](../library.md#固定-attachment-family-与-blob-closure)。

## 先选 owner 与 family

| 事实 | family | owner | 原因 |
|---|---|---|---|
| AssertionResult、Evidence 与 sealed result | `niceeval.assertions` | `owners.attempt` | 来自一次实际检查 |
| 对话、OTel、事件、命令、用量、时间与诊断 | `niceeval.observability` | `owners.attempt` 或 `owners.run` | 由对应 owner 的 collector 封口 |
| Sandbox 观察到的 send 区间文件变化轨迹 | `niceeval.file-changes` | Attempt | 保留 agent 归因、策略与时序 |
| 每个物理 send 的源码与 timing join | `niceeval.source-navigation` | Attempt | 连接运行时 turn 与静态 source site |
| Eval 与 loader 的源码闭包 | `niceeval.sources` | origin Run | 同 Run 的 Attempt 共用当时源码 |
| 有媒体类型的大型文件 | `niceeval.artifacts` | `owners.attempt` 或 `owners.run` | 归属由文件生命周期决定 |
| Experiment 展示名称 | `niceeval.experiment-presentation` | Run | 固定历史 Run 的人类标题，不改变 Core identity |

owner 不是展示层的选择。它决定目录、identity、reference 和 blob closure。reference Member 不产生新
Attempt，也不复制任何 Attachment；读取时沿精确 origin Attempt 和 origin Run 追溯。

Observability 与 Artifacts 各有一个 NiceEval internal definition，两个 owner shape 写在同一 `owners` map。
没有 attempt / run 的重复 family，也没有应用作者可调用的 `defineRecordAttachment`。

File Changes 允许同一路径出现在不同 send 区间。若 agent 在 `turn1` 创建 `src/app.ts`，Eval 在两个 send 之间
写入它，agent 在 `turn2` 再修改它，两个 send 区间各有一条 `src/app.ts` 变化。同一 send 区间内的变化按
ASCII path 排序且不重复；这让读侧能保留 agent 的完整轨迹，而不是把 Eval 写入合进文件级摘要。

## 一个 family 一份完整 closure

每个 Attachment directory 固定包含：

```text
attachments/<family>/
├─ attachment.json   stable family 与 numeric schemaVersion
├─ payload.json      exact JSON
└─ blobs/<opaque-key>
```

例如 Assertions 的 envelope 是：

```json
{ "family": "niceeval.assertions", "schemaVersion": 1 }
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
  → internal deep-frozen snapshot
  → Analysis query
```

Adapter、Sandbox 和 Assertion producer 只调用 NiceEval 已发布的窄 collector 方法。此前未保存的事实
由 NiceEval 扩展既有 family，或加入新的 static fixed family；调用方不能定义 family，也不能绕过 collector
写入 `payload.json`。

`RecordReadSession` 的 internal adapter 只在 Sample 的 `AnalysisInput` 或 `DomainView` 首次需要某份
owner/family 时读取和验证它。`available` snapshot 包含 deep-frozen payload 和完整内存 blob snapshot；
读取 blob 时返回 defensive copy，不重开文件。Scope 关闭后，已经形成的 snapshot 仍可同步消费。

历史 owner 缺少 current catalog 中请求的 family 时返回 `not-recorded`。`invalid` 只影响请求该事实的 query，
不能把其它 Core 或 family 伪装为失败。已知 family 的旧 schemaVersion 要求显式 migrate，ordinary reader
不兼容。未知独立 future family 保留在磁盘、跳过解释，不影响 Core 与认识的 family；只有请求它的
AnalysisInput / DomainView 返回 `unsupported`。带 `/vN` 后缀的未发布 family 草案仍是
`unsupported-format`。

## 不能写进 Attachment 的内容

下列内容属于其它层：

- execution claim、lease、session、cache 和 global `latest` 属于 local operation state；
- matcher 实现、计划、reuse 判断和当前 worktree 属于 behavior / Experiment；
- total、平均值、通过率、排名、分母和页面树属于 Analysis 或 Report；
- 此前未保存的不可恢复事实必须进入 NiceEval 的固定协议，不得由 Adapter 扩充 catalog。

## 相关阅读

- [Sources manifest](../architecture.md#sources-manifest)
- [Observability Attachment](../architecture/observability-attachments.md)
- [Assertions](../../assertions/README.md)
