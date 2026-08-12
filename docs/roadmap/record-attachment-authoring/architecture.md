# RecordAttachment 作者 SDK —— Architecture

## Authority 模型

```text
defineRecordAttachment
  → opaque definition
     owns: owner + versions + current + adjacent migration graph
       │
       ├─ application installs definition ─→ read / migration trust
       └─ producer allowlists definition ─→ occurrence-local grant
                                                │
                                                ▼
                                   owner-local Record context lease
                                                │
                                                ▼
                                    generic RecordAttachment writer
```

四层使用相同 nominal definition identity，但 authority 不传递：

| 层 | 拥有什么 | 不拥有什么 |
|---|---|---|
| definition | schema、current、完整相邻 migration 图 | 写入 lease、root、registry 安装权 |
| producer allowlist | 一个 occurrence 的 definition grant | CLI migration trust、磁盘能力、reuse policy |
| application registry | 已安装 definition 集合 | producer 写权限、动态 package discovery |
| owner context | 当前 Run 或 Attempt 的实际写入 lease | 跨 owner、跨 session、迁移权限 |

## Definition 编译

definition 边界先 exact 校验 name、连续 version keys、current 与 migration map，再把每个 version 编译成底层
exact JSON definition。每条 migration 编译成同 owner、同 name 的相邻 edge，最后形成一个完整 family。

高层 API 不公开可单独拼装的 version definition、family 或 edge。这样用户不会得到“current 更新了但 registry
漏边”的半成品；底层仍保持 Record Feature 已固定的 nominal definition、family 和 write authority。

## 写入数据流

```text
producer allowlist/link
  → owner context lease
  → record(definition, payload | builder)
  → synchronously validate + reserve family
  → exact encode + closure validation
  → consume owner-local blob Streams
  → generic draft.record(write)
  → owner seal waits every in-flight write
```

一个 owner/family 只有一个 reservation。reservation 在第一次 `record()` 调用时取得，而不是等 Promise 调度或 blob
I/O 完成后竞争。失败不释放 reservation，也不允许用第二个 payload 替换已保留值。不同 family 可以并发，封口屏障等待
它们全部停稳。多个 family 同时失败时按 stable family identity 聚合，不让完成竞速决定主错误。

## Migration 数据流

```text
config imports definition
  → application registry installs its whole graph
  → migration plan exact-matches stored owner/name/schemaId
  → Git restore-point inspection
  → exclusive maintenance lock
  → migration.in-progress
  → family converter reads old verified closure
  → target builder writes new owner-local closure
  → sync target and record.json
  → remove + sync sentinel
```

registry 不重新声明 converter，也不拆下某条 edge 安装。它信任或不信任整个 definition。unknown family 不触发
package import；没有安装 definition 时 bytes 保持 unsupported。

converter failure、defect或 interruption 都保留 sentinel。恢复只来自 Git 或用户自己的备份，不创建 Attachment
backup、root rollback、shadow copy 或 output directory。

converter 对同一 materialized source 必须形成同一 target closure。clock、random、environment、network、filesystem
与 ambient mutable state 即使能由 JavaScript 闭包捕获，也违反 converter contract。具名 `E` 收口为带 family/edge
identity 的 migration step failure；throw 保留 defect，interruption 保留 Effect Cause。

## Identity 与 reuse

schema version 冻结已保存事实的 shape 与语义。producer revision 冻结“怎样形成这份事实”的行为；两者不能互相
替代。

allowlist 不自动把 Attachment presence 加入 reuse contract。需要 current Attachment 才能 carry 的 producer
contract 显式声明 requirement；形成 payload 的算法变化进入对应 owner 的 behavior identity。历史事实是否缺失与
算法是否相同不能从 schema identity 推断。Projection/Report 是否展示、筛选或计算这个值不反向改变执行 identity。

## 官方无特权

`niceeval.*` namespace 只在 package-private construction boundary 增加 authority。definition 形成后，官方与
第三方使用相同 writer、closure validation、registry、migration plan、sentinel、reader state 与 projector。

官方可以在 generic writer 前运行 Assertions、Observability 等领域联合 contract；该 contract 只验证业务事实，
不能绕过 owner、schema、closure 或完成标识。
