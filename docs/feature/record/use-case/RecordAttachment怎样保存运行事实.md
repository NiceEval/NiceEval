---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# Attachment 怎样保存运行事实

NiceEval 不把运行事实放进开放 JSON bag。每份事实都属于一个 branded Attachment family、一个 owner 和一个
exact logical value。调用方不能追加字段或绕过 definition 改变 durable shape；第三方 package 可以定义自己的
family。新的 family definition 本身作为 `RecordContribution` 显式贡献给 Host。只有已有 family 的演进使用
matching persistence。

契约单源始终在 [Definition identity 与 owner brand](../architecture.md#definition-identity-与-owner-brand) 与
[Record Library](../library.md#high-level-record-definition)。

## 先选 owner 与 family

| 事实 | family | owner | 原因 |
|---|---|---|---|
| AssertionResult、Evidence 与 sealed result | `niceeval.assertions` | `owners.attempt` | 来自一次实际检查 |
| terminal Turn 与 provider usage observation | `niceeval.agent-turns` | `owners.attempt` | Adapter 只交付已解释、脱敏的 terminal Turn |
| 每个物理 `t.send` 的 source context | `niceeval.turn-contexts` | `owners.attempt` | SessionManager 保存 capture-time anchor |
| command lifecycle 与安全 stream | `niceeval.sandbox-commands` | `owners.attempt` | Sandbox wrapper 保存 manifest、唯一终态与 stream |
| owner-local activity | `niceeval.runner-activities` | `owners.attempt` 或 `owners.run` | Runner monotonic clock 保存 activity |
| advisory 与 execution error | `niceeval.runner-diagnostics` | `owners.attempt` 或 `owners.run` | Runner diagnostic sink 保存安全诊断 |
| Sandbox 观察到的 send 区间文件变化轨迹 | `niceeval.file-changes` | Attempt | 保留 agent 归因、策略与时序 |
| Eval 与 loader 的源码闭包 | `niceeval.sources` | origin Run | 同 Run 的 Attempt 共用当时源码 |
| 有媒体类型的大型文件 | `niceeval.artifacts` | `owners.attempt` 或 `owners.run` | 归属由文件生命周期决定 |

owner 不是展示层的选择。它决定目录、identity、reference 和 content closure。reference Member 不产生新
Attempt，也不复制任何 Attachment；读取时沿精确 origin Attempt 和 origin Run 追溯。

Runner Activities、Runner Diagnostics 与 Artifacts 对 Run / Attempt 分别定义 owner-branded family value；
family 名可以相同，但 definition 只能绑定一个 owner kind。conversation、usage、commands、timing、diagnostics
与 source navigation 都是 reader-side view 或 relation，不额外占 catalog entry。

File Changes 允许同一路径出现在不同 send 区间。若 agent 在 `turn1` 创建 `src/app.ts`，Eval 在两个 send 之间
写入它，agent 在 `turn2` 再修改它，两个 send 区间各有一条 `src/app.ts` 变化。同一 send 区间内的变化按
ASCII path 排序且不重复；这让读侧能保留 agent 的完整轨迹，而不是把 Eval 写入合进文件级摘要。

## 一个 family 一份完整 closure

每个 Attachment directory 固定包含：

```text
attachments/<family>/
├─ attachment.json              family、durable revision、Core 私有 payload/content/reference pointers
├─ payload/sha256/<digest>      canonical logical value
└─ content/sha256/<digest>      本 Attachment 私有的 immutable content object
```

例如 Assertions envelope 的结构是：

```json
{
  "format": "niceeval.record-attachment",
  "ownerKind": "attempt",
  "family": "niceeval.assertions",
  "revision": 2,
  "payload": { "sha256": "...", "byteLength": 123 },
  "contents": [],
  "references": []
}
```

Core compiler 从 sealed content/reference Schema declarations 生成完整 closure plan。每个 token 都必须有且只有一份本 directory 的 content object；每个 object 也必须被 envelope inventory 引用。producer 不能提交 raw path、raw digest、raw storage bytes 或另一个 owner 的 token。

例如 command stdout、文件文本、源码和 Artifact 内容由各自 family 的 sealed content field 持有。一个 Sources content token
不能被 Attempt 直接引用；source site 只保存 source item identity 和 digest 的 semantic join（语义连接）。

缺 key、多 key、重复 key、手写 key、跨 owner ref 或 root 外路径会让这份 Attachment 成为 `invalid`。
它不会产生可用但不完整的值。I/O 和 permission failure 发生在 value 形成前，仍是 typed read failure。

## 采集到读取的路径

```text
capture authority
  → 领域 collector append / sort / deduplicate
  → owner record.write 一次 exact current logical value
  → Run seal validates closure
  → complete
  → RecordReadSession reads on demand
  → deep-frozen value 与 Scope-owned content reader
  → Analysis query
```

Adapter、Sandbox 和 Assertion producer 在各自唯一 capture authority 内收集逐条事实，按领域规则排序、去重并
决定 complete/partial。它们最后一次调用 owner-scoped `record.write(a(value))` 或
`record.write(a(builderCallback))`。

callback 只在 matching owner session 执行并获得 `content` 与 `reference` builder。第三方 package / Plugin 使用
同一边界，不能绕过 family schema、content closure 或 owner brand 写入物理文件。

同 owner/family 没有通用 append，也不能有第二个 capture authority。重复或并发 write 在 callback、Stream 与 I/O
前返回 `record-already-written`，并使未发布 Run fail closed。没有 write 是 `not-recorded`；完整观察到零项要 write
complete-empty value；只保留有界前缀时要在该完整 value 中显式写 `partial` 与 limitation。完整 case 矩阵见
[Record Library](../library.md#write--append-case-matrix)。

`RecordReadSession` 的 internal adapter 只在 Sample 的 `AnalysisInput` 或 `DomainView` 首次需要某份
owner/family 时读取和验证它。`available` 包含 deep-frozen logical value 与仅对该值 sealed handle 有效的
content reader。读取受 session Scope 管理；调用方在 Scope 内读尽或显式关闭，finalizer 会关闭遗留 stream、handle 与 lease。

历史 owner 缺少请求 family 时返回 `not-recorded`。`invalid` 只影响请求该事实的 query，不能把其它 Core 或
family 伪装为失败。已知 family 的旧 durable revision 不进入 ordinary reader；只在完整相邻 chain 存在时可显式
migrate。未贡献 family 不阻塞无关局部读取；direct/reference closure 与 `requireComplete()` 返回
`family-definition-required`。

## 不能写进 Attachment 的内容

下列内容属于其它层：

- execution claim、lease、session、cache 和 global `latest` 属于 local operation state；
- matcher 实现、计划、reuse 判断和当前 worktree 属于 behavior / Experiment；
- total、平均值、通过率、排名、分母和页面树属于 Analysis 或 Report；
- 此前未保存的不可恢复事实必须进入具名 family definition，不得由 Adapter 绕过 catalog 直接写物理 bytes。

## 相关阅读

- [Sources manifest](../architecture.md#sources-manifest)
- [Observability Source receipts](../architecture/observability-attachments.md)
- [Assertions](../../assertions/README.md)
