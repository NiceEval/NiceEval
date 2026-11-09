# Assertions —— evidence

Assertion 的材料必须在 Attempt 发布前归一为 Assertions Attachment 自己 closure 中的 sealed content。producer 从不把“没有读到”解释成“没有发生”，Inspection 也不在事后重新采集。

## family Host 与 entry coverage

读取时只有两个不能互相替代的层次：

| 层次 | 说明 |
|---|---|
| family Host | 请求的 Assertions family 是 `available`、`not-recorded` 或 `invalid`。只有 `available` 已保证 exact value 与完整 own content closure。 |
| entry coverage | 当 Assertions 为 `available` 时，每条 Assertion 的 material 是 `complete`、`partial`、`unavailable` 或 `not-applicable`，并带该 entry 的 limitations／原因。 |

revision 1 没有通用 Attachment 完整度字段。producer 少采、sampling、redaction 与 truncation 都写进受影响 entry 的 coverage 和 limitations；reader 不会把它们消掉。未写入已贡献 family 是 `not-recorded`，envelope、payload、content 或 closure 损坏是 `invalid`。future revision 或不相容 durable bytes 在 reader session 形成前返回 `unsupported-format`。完整闭包与 source-local read 的定义见 [Record architecture](../../run/architecture/README.md#attachment-closure-惰性读取与-cache)。

## 显式 value snapshot

```ts
t.check(
  await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]),
  commandSucceeded(),
);
```

`await` 先取得 `CommandResult`，随后 `t.check` 把该次读取的安全 subject 编码为 Assertions Attachment 自有 sealed content，并保存有界 preview。材料至少包括 criterion 实际使用的字段、coverage 与 limitations；secret 永不进入 Assertions Attachment。

scope Assertion 的 material 是 collection 已冻结的 cut snapshot。根 `t` 把 vector cut 归一为有界 JSON，使离线 reader 能说明纳入了哪些 Session 前缀，而不是持有一个可变的“最后状态”或跨 Attachment ref。

Sandbox diff Assertion 同样保存自己实际判定所需的安全 summary、evidence 与限制。完整 diff bytes 仍只属于 FileChanges family；Assertions 不借用它的 content handle，也不因不能保留全文而假装没有观察到变化。

## required、optional 与 supplemental

| 需求 | producer 不能取得材料时 |
|---|---|
| required | entry 写入 `coverage: unavailable` 和具名原因；[Verdict](../../verdict/architecture.md) 依规则成为 `errored`。 |
| optional | entry 保留 unavailable，不单独改变 Verdict。 |
| supplemental | 写入对应 diagnostic；不伪造 Assertion result。 |

同一材料同时被 required 与 optional 使用时按 required 处理。若多个 entry 需要同一份 bytes，producer 必须为每个 material mint 独立 own content handle。

这些 handle 不能共享，也不能借用 Sandbox、usage、diff、conversation、tool 或 telemetry family 的 handle。

## 发布边界

collector 在归一已求值 entry 时分配 attachment-local `entryId`，并拒绝重复 ID。它在 whole Run seal 前写稳定的 Assertions payload，其中 source navigation row 也只能以 `entryId` join 既有 Sources item；Verdict 与 Score 都在读侧从这些已封口事实形成。

第三方 criterion 的 schema 不能解码时，entry 局部显示 `unsupported` 或 `invalid`。其它 entry、以及不依赖该 entry 的读侧结果不受影响。

## 上下文材料的两类快照

材料声明只保存 reader、predicate 与预算，不保存应用 ctx 或 Attempt。框架只捕获 reader 返回的事实，不遍历整份应用上下文。
每次登记同步调用 reader 一次，复制稳定 ID、原文、元数据和源顺序；定义可以跨 Attempt 复用，事实切面不复用。

匹配快照与 Judge 发送快照各自持有材料，但绑定同一个 receiver cut：

| 快照 | 规则 |
|---|---|
| 匹配快照 | 普通 DTO 有界深复制并保留显式 undefined，不调用 accessor 或 toJSON。Agent 使用 owner 冻结的原 row 与关联，保留 occurrence sidecar、locator 和正式 query evaluator。 |
| Judge 发送快照 | 只包含全部已知命中项的完整原值或 correlated occurrence。无法无损表示为 JSON 的材料为 unavailable，不静默省略 undefined 或猜测缺失工具回执。 |

普通材料接受有限 number、string、boolean、null、undefined、稠密数组和普通数据对象。
对象只读取自有字符串数据属性；访问器、Symbol、函数、非有限数、循环、Date、Map、Set 与类实例不可捕获。
ID 非空、无控制字符、最多 128 UTF-8 bytes，且集合内唯一；框架不从业务字段合成身份。
结构或品牌错误是作者错误；合法材料无法捕获时保存 unavailable 与具体原因，不执行模型。

每个 Assertion runtime 创建私有 owner token，受管工具与事件 sidecar 携带该 token。
登记校验 token、scope 与 cut，不把受管集合转为普通 JSON 后重新匹配，也不将旧集合重新裁到当前切点。
普通 predicate 只接收匹配快照，Agent predicate 复用原受管求值器；双方都使用既有三值组合语义。

## 捕获容量与完整度

捕获先保存 declaredState、knownTotal，再按源顺序增量计量和复制。
每项必须完整接纳；节点、深度或字节不足时不保留半个事实，不先无界序列化整个集合。
预算停止只保留完整前缀，保存 limit、configured、observed 与 stoppingIndex，并将 exhaustive 置为 false。
complete 保留源的声明，不因捕获了前缀就宣称已经穷尽。

存在性允许已接纳项中的确定见证通过；没有见证时，只有源 complete、扫描 exhaustive 且全部 predicate 可判定才能失败。
整组问答要求这三个条件同时成立；任一未知、容量停止或关系不明均为 unavailable，零模型调用。
存在性的 decisive 不能被用作整组问答的决定性证明。

读取集合的 capture 预算与全部命中项的 Judge 材料预算分别计量。
完整读取的大集合可以只有一个小命中组；缩小 capture 预算不能让未穷尽集合通过问答。
全部命中项保序发送，未命中事实不重复进入 ScoreMatch 初始材料或模型计费。

完整事实由本 Assertions Attachment 自有 bytes content 保存，不经过 BoundedJsonValue 的字符串、深度和数组 preview 限制。
Boolean 和 QA 都保留完整已接纳事实；QA 另保存实际请求、响应、引用和选择收据。
封存 envelope 必须计入 JSON 转义、引用 schema、协议字段和 manifest，不能只量内部审计。
模型调用前按响应字节硬上限预留最坏 envelope 空间；审计 decoder 支持 8 MiB，捕获器上限为深度 72、2097152 节点。

证据完整度与展示省略独立：

| 捕获结果 | entry coverage 与 limitation |
|---|---|
| 完整捕获且源 complete | complete；preview 省略不改变它。 |
| 源 partial | partial/provider-limited，并保留 producer 原因。 |
| 源 unavailable | unavailable/source-unavailable，并保留原始 reason。 |
| 因 capture 预算停止 | partial/capacity-limited；保存 capturedItems、knownTotalItems、omittedBytes。未观测省略字节时 omittedBytes 为 null。 |
| 单事实不可捕获或 reader 前容量拒绝 | unavailable，附具体诊断；没有虚构的前序事实。 |

同一份预算停止的材料可以证明存在，但其收据仍是 exhaustive:false、coverage 仍是 partial/capacity-limited。
它不能据此证明完整问答。

## 材料预留与封口收据

每项断言持有一次性私有预留凭证。reader 前按 capture 字节上限、受管 audit 上限与 64 KiB 诊断空间预留。
Boolean、存在性和本地 ContextScoreMatch 不预留 Judge audit；closeQA 使用 options 的 maxAuditBytes，受管 ContextScoreMatch 使用定义中的 llm.maxAuditBytes。
两者都不从集合项数推导调用次数。

成功登记才将凭证移交 runtime。reader 抛错、登记失败或登记前取消退还全部预留并释放临时捕获。
捕获后按实际事实编码降低预留；在途模型仍占用审计预留。正常、零调用及取消终态均按实际封存字节结算，退还未用额度。
已留存完整证据继续计入 Attempt 的 64 MiB 文字与审计总量；图片总量独立计账。
取消和迟到完成不能重复退款、重新增加内容或重启模型；封存字节不得超过凭证额度，拒绝原因的空间提前保留。

所有终态都保留 evaluation.receipt 的 examined、matched、mismatched、unavailable、knownTotal、complete、exhaustive、decisive。
计数只含实际完成判断的候选；读取前失败或未能捕获集合时 knownTotal 为 null、计数零，三个布尔完整性字段为 false。
只有源确实为空时 knownTotal 才为零；完整 N 项零命中时 examined=mismatched=knownTotal=N。
完整零命中的 complete、exhaustive、decisive 为 true，unknown 仍保留实际进度。

Boolean 与 measurement 使用同一个终态 receipt hook。封口先关闭进度写入，再取得不可变收据；晚到 callback 不改计数。
收据保存在 evaluation，不放入可裁剪 explanation。无模型调用的分支保留 question、source 与选择原因，不伪造已发送 audit。
单事实 reader 只捕获一个聚合值，并且最多求值一次原有 Match；不会扫描内部数组重复评分。

## 相关阅读

- [Assertions 架构](README.md)
- [Source sites](source-sites.md)
- [Record architecture](../../run/architecture/README.md)
- [Verdict 规则](../../verdict/architecture.md)
- [Inspection Architecture](../../inspection/architecture.md)
- [Adapter evidence](../../adapters/architecture/evidence.md)
