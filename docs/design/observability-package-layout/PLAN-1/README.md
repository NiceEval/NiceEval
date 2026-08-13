# PLAN-1：七个逻辑 Observability families

七个 owner-specific entries 继续作为独立 RecordAttachment family。每个 family 拥有自己的 schema、limit、
collection state 与 owner-local migration。

## 契约

| owner | family | schema |
|---|---|---|
| Attempt | `niceeval.conversation` | `niceeval.conversation/v1` |
| Attempt | `niceeval.commands` | `niceeval.commands/v1` |
| Attempt | `niceeval.usage` | `niceeval.usage/v1` |
| Attempt | `niceeval.timing` | `niceeval.timing/v1` |
| Attempt | `niceeval.diagnostics` | `niceeval.diagnostics/v1` |
| Run | `niceeval.timing` | `niceeval.timing/v1` |
| Run | `niceeval.diagnostics` | `niceeval.diagnostics/v1` |

- producer 在 seal 前完成需要的跨 family identity 与联合验证。
- 每个 family 只有一个 owner-bound collector 和一个写入 occurrence。Adapter 与 OTel bridge 只提交受限 capture
  input，不直接写 Attachment。
- Projection 每次通过一个 `RecordProjection` 读取一个 family，并把六态保留在公共
  `ProjectedSample`；本方案不产生 capture-expectation。
- Report 需要 operation 的 usage、timing 与 conversation 时，分别投影对应 family，再交给
  Relations；不能把数组位置或时间邻近当 join evidence。
- 新 family 可以独立增加，不改变 Record major。

OTel 是 timing collector 的一种内存输入，不是 `niceeval.timing/v1` 中的 durable source。只有已经绑定 exact
owner、经过验证的 owner-clock domain、稳定 phase / label 与 capture-time anchor 的输入才能形成 interval。
raw epoch、clock / owner / phase / label / ref 不可证或重复冲突的 span 被舍弃，并使 collection 带
`unsupported-input` limitation。

Projection handoff 使用现有 `RecordAttachmentReader`、`RecordAttachmentProjector` 与 `RecordProjection`。
每个 declaration 绑定一个 family，执行时再按 logical slot 定位 exact owner；`ProjectedSample` 原样保留 Attachment
六态。不存在 Receipt、representation selection 或跨 family fallback。

## 生命周期与失败

每个 family 由唯一 producer collect、validate、seal，再由 Run publisher 与其它已完成 attachments 一起发布。
官方执行的 Attempt 即使没有 interval 也写 complete-empty timing。已承诺的输入丢失、无法归一、重复、冲突或被
截断时，timing 是 partial；只有历史或第三方 owner 没有写这份 family 时才是 unavailable。

unavailable、migration-required、migration-unavailable、unsupported 与 invalid 保持 RecordAttachment data。
真实 I/O 与 permission 是 reader typed error。联合验证失败必须阻止相关 families 发布，不能在 Projection
时猜测修复。

## 取舍

按逻辑消费面切分使单项读取和 owner-local migration 较小，也让 durable schema 提前固化了当前产品列。
同一次 observation 的 identity、timing 与 usage 可能被拆开，producer 必须维护更多跨 family 一致性。

## 采用条件

当单项读取、独立保留和小 migration blast radius 比采集原子性更重要时，本方案成立。真实 Report 必须
证明跨 family anchors 足够，不能依靠启发式 join。

## Cases

- O1：Agent event 与 OTel timing input 可以共享 issuer-minted anchor；唯一 timing collector 决定 canonical
  interval，不能可靠归一的输入进入 limitation。
- O2：OTel bridge 初始化失败不改变 Assertions available；timing collector 写 partial `capture-failed`。已知采集域
  确实为空时才写 complete-empty。
- O3：旧数据与新数据使用同一 family inventory，不需要 representation selection。

## Limits 与扩展

每个 family 独立声明 payload、items 与 closure bounds。新增事实权威时可以新增 family；合并旧 families
需要新的跨 family maintenance 设计，不能使用 owner-local converter 假装原子迁移。
