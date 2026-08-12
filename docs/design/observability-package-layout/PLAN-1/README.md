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
- Projection 每次通过一个 `PackageAccess` 读取一个 family，并把六态映射到公共
  `PackageReadResult`；本方案不产生 capture-expectation。
- Report 需要 OTel operation 的 usage、timing 与 conversation 时，分别投影对应 family，再交给
  Relations；不能把数组位置或时间邻近当 join evidence。
- 新 family 可以独立增加，不改变 Record major。

Projection handoff 使用现有 `RecordAttachmentFamily`、`RecordAttachmentLocator`，并把
`PackageReadResult<Payload, never>` 作为读取结果。每个 access 绑定一个 family 和 exact owner；不存在
Receipt、representation selection 或跨 family fallback。

## 生命周期与失败

每个 family 由自己的 producer collect、validate、seal，再由 Run publisher 与其它已完成 attachments 一起
发布。family 可以独立 complete、partial 或失败；Run publish 只接收已经 seal 的 closure。

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

- O1：Agent event 与 OTel facts 分别进入既有 family，并保存同一个 issuer-minted anchor。
- O2：OTel unavailable 不改变 Assertions available；本方案无法区分 unsupported 与 not-enabled，除非对应
  family 自己已有可靠状态。
- O3：旧数据与新数据使用同一 family inventory，不需要 representation selection。

## Limits 与扩展

每个 family 独立声明 payload、items 与 closure bounds。新增事实权威时可以新增 family；合并旧 families
需要新的跨 family maintenance 设计，不能使用 owner-local converter 假装原子迁移。
