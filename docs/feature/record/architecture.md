# Record 架构

Record Core 拥有 SQLite resource、publication、Seal、Content、reference、reader 与 maintenance。
family definition 拥有 logical Schema、validation 与相邻 data migration。capture authority 只提交它亲历的事实。

Record Host 还拥有 writer admission、snapshot barrier 与 maintenance coordination tables。
Experiment coordination、user cache、Inspection 与 Delivery 都不进入 Record database 或 Run closure。

## Storage ownership

```text
<project>/.niceeval/
└── record.sqlite                 ProjectDatabase: Record + Host-only coordination tables

${NICEEVAL_HOME:-~/.niceeval}/niceeval.sqlite
                                  UserDatabase: feature-owned user state and registries
```

`record.sqlite` 是一份 root-wide SQLite application database。它保存 Core、Attachment、collection item、reference、Content
chunk 与 Seal，也可能保存未发布的 `open` / `sealing` rows。writer admission、snapshot barrier、maintenance lease 与 snapshot scrub
所需 coordination tables 同在这份 database，只能由 Record Host 使用，且不属于 Run closure 或 Snapshot。

Record Host 独占 connection、transaction、authorizer、storage worker、schema interpretation、snapshot 与 maintenance。
family、Plugin、Service、Inspection 与 Delivery 都不能取得这些 capability。

`niceeval.sqlite` 是另一份跨 project 的 OS-user `UserDatabase`。它不是 Record namespace、Run closure 或 Snapshot 的一部分。
其 feature Repository 保存 durable user state、Docker/E2B cache registry 与 Incus allocation/artifact ledger。
它们也保存 user-level lease/coordination 与 credential reference。secret 走单独的 classification、权限与加密边界。

任何一项都不能因为“需要持久化”而进入 Record。cache registry 不是独立 SQLite 或 JSON sidecar。
cache registry 的 schema、cleanup 或业务错误不能成为其它 durable Repository 的逻辑前置。

## Generic rows 与 logical model

物理 schema 至少表达：

```text
record_metadata
runs
slots
members
attempts
attachments
attachment_references
collection_items
contents
content_chunks
run_seal_entries
storage_migrations
```

`runs.status` 是 `open | sealing | sealed`。Attempt 永远保留 origin Run；Member 把目标 Run 的 Slot 连接到 exact Attempt。
reference 只指向已 sealed origin owner，不复制 Attachment 或 Content。

Attachment generic row 保存 owner kind、owner identity、family、family revision、canonical payload bytes 与 logical inventory。
Family 不拥有 table、column、index、pragma、transaction 或 chunk policy。unknown family 的 payload、item、reference 与 Content
chunk 能按 generic columns 原样保存、Snapshot 与 physical migration；ordinary reader 不擅自把它解码为 valid 或 invalid。

`contents` 保存 immutable logical handle、byte length、whole digest 与 chunk count；`content_chunks` 以 private ordinal 保存
bounded bytes。输入 Stream chunk、SQLite page 与 row size 都不是 logical Content 形状。

## Definition 与 family evolution

`Record.attempt`、`Record.run` 与 `Record.attemptCollection` 创建 nominal definition。Host composition 按
`(ownerKind, family)` 拒绝冲突并冻结 session catalog；没有 global registry、动态注册、last-one-wins 或 family-name switch。

future v1 family/data migration 改变 canonical payload、items、Content 或 references 时使用 TypeScript typed adjacent converter，推进
family revision并重建 closure 与 Seal。它不导入 0.13.x bytes。unknown family 只按 raw generic rows 搬运，不能调用缺失的 family Schema。

physical schema migration 改变 table、index、trigger 或 storage revision。相邻 SQL 全部 checked in、人工审查并随 NiceEval
发布；runtime 不生成 schema，不执行 Drizzle migration。只改变 physical representation 时必须保留 Run、Attempt、family
revision、Content bytes/digest、reference identity 与 `LogicalSealIdentity`，只推进 storage generation。

family migration 改变 business facts 时形成新的 logical identity；依赖旧 revision 的结果失效。ordinary open 发现 predecessor
只返回 migration-required。小 metadata migration 可在 exclusive transaction 内完成；大表 rebuild 或大量 family rewrite 必须
copy-on-write，验证 target 后才原子替换 source。

## Publication 与 exact Seal

Run 使用多个短 transaction：

1. create transaction 插入 `open` Run、Slot 与 writer generation；
2. bounded mailbox 把 admitted commands 交给 dedicated storage worker；
3. worker 以 bounded row/byte batch transaction 追加 facts；
4. Attempt completion fence 关闭 admission并等待 backlog；
5. Run finalizer 切到 `sealing`，在 transaction 外流式验证完整 closure；
6. 最终短 transaction 重新验证 writer generation、inventory identity、counts 与 digests，写 `run_seal_entries` 并切到 `sealed`；
7. receipt 只在 commit 后形成。

ordinary reader 的每个 operation 都选择 `sealed` cutoff。`open` / `sealing` rows 即使结构完整也不是 published facts。
final Seal transaction 内崩溃会整体 rollback 并保留 `sealing`；recovery finalizer 重验后只能 seal 一次。Commit 后 receipt 丢失
不改变 Run validity。

sealed closure 只能由显式 maintenance 改写。fixed prepared statements、trigger、schema identity 与 exclusive maintenance
lease 共同阻止 ordinary writer 更新或删除已发布 facts。

## Bounded writer 与多进程协调

每个 process 最多一个 dedicated storage worker。worker 使用 `node:sqlite`、短 `BEGIN IMMEDIATE` transaction、private busy
wait 与 caller deadline；模型、Sandbox、provider、capture backpressure 和 builder 都在 transaction 外。

SQLite WAL 允许 readers 与短 writer 并行，但 physical writer 只有一个，且 file lock 不保证公平。
每次 bounded batch 在尝试 SQLite write lock 前取得 ProjectDatabase 的 Host-only coordination-table FIFO admission ticket。
一个 ticket 只运行一个 batch，commit 后必须归还，不能连续排空整个 backlog。
owner crash、deadline 与 cancellation 都能回收 ticket。direct SQLite writer 不在支持面。

mailbox 同时限制 command count 与 encoded bytes。pre-enqueue cancellation 不生成 sequence；post-enqueue cancellation 只取消
等待 ack，command 仍属于 Attempt backlog。commit 后 ack 前崩溃以冻结 command identity 重读结果；exact match 成功，identity
或 digest 不同则 `record-command-conflict` 并 fail closed。

## Bounded reader 与 generation lease

ordinary read 使用 fixed prepared queries：按 Run、Attempt locator、owner/family 定位，只选择 sealed cutoff，只在消费 Content
时读取 chunk rows。每一行先经 typed decoder，database row、statement、connection 与 transaction handle 不越过 Host。

`read()` 是 whole-value API，必须在读 rows 前通过 count、canonical bytes、nodes/depth 与 Content metadata admission。
`openCollection()` 是大 collection 的 self-scoped Stream API。每次 Stream execution 取得 shared storage-generation lease 与
私有 read-only connection，按 bounded page 查询，并在每页后释放 buffer。

migration 等待 lease。physical migration 后可在同一 `LogicalSealIdentity` 下重开；family migration 后要求 restart。

Content `byteLength` 只读 metadata，`bytes` / `text` 先做 whole-value admission，`stream` 按 bounded chunk rows 读取。
无论完整或流式入口，提前停止、failure 与 interruption 都由 Scope 立即关闭 resource。

## RecordSnapshot、copy 与 hostile input

operational `record.sqlite` 的 raw main-file copy 永不受支持。停止 writer、checkpoint 或关闭 connection 也不能证明 free pages
不含未发布材料。

Host 形成 Snapshot 时先预检 database bytes、可用空间与 caller deadline，再从 ProjectDatabase 内 Host-owned
coordination tables 取得 per-root snapshot barrier。
barrier 阻止新的 write transaction admission，等待已经开始的真实 transaction commit/rollback；mailbox 中未开始的 command
保留在 backlog。Host 只在 barrier 内用 SQLite backup 固定 target，随后立即释放 source barrier。

独立 target 删除所有 `open` / `sealing` closure 和本机 coordination rows，以 `VACUUM INTO` 重写 sealed-only bytes，验证 exact
Seal、checkpoint 并关闭。
只有完成这些步骤的 nominal `RecordSnapshot` 能 copy、进入 Git 或传给 `--record`。Git merge 不是 row merge
protocol，binary diff 与 branch conflict 是已接受代价。

外部 Snapshot 一律视为 hostile input。Host 在可终止、资源受限的 maintenance unit 中关闭 extension 与 `ATTACH`。
它设置 runtime limits、`mmap_size=0`、`trusted_schema=OFF`、defensive mode 与 authorizer。

Host 随后验证 database header、exact schema allowlist、SQLite structure、typed rows 和每个 Logical Seal。
只有导入为 Host-owned validated generation 后，ordinary reader 才直接打开。
本 threat model 不承诺抵御攻击者同时篡改 Host-owned local file。

## UserDatabase 与 feature Repository

`UserDatabase` 是普通 backend，不是 module 平台。central owner 独占 database path、connection、transaction、busy deadline、
user-level maintenance lease 与 migration orchestration。Service/domain 只调用 feature Repository，不会得到 path、connection、
transaction 或 SQL capability。

应用静态组合有限第一方 Repository。Repository 就近拥有 checked-in schema、fixed prepared operations、typed row decoder 与 adjacent
migration。central owner 在该 Repository 首次 operation 或显式 maintenance 时执行 lazy adjacent migration。

durable user-state、Docker/E2B cache、Incus allocation/artifact ledger、user-level lease/coordination 和 credential-reference 分别是
具名 Repository。Incus ledger 不再以 `~/.local/state/niceeval/*.json` 作为长期 registry。

没有 State module/SPI、lifecycle DSL、通用 SQL executor、运行时/第三方注册或 feature 自选 table/namespace。
cache Repository 的 schema、cleanup 或业务 failure 只失败该 Repository 的 operation，不预先阻断其它 durable Repository。
共享文件的 corruption、disk full、WAL recovery 和 SQLite lock 是明确接受的共同资源 failure domain。
credential Repository 仅保存 reference，secret 不入库。v1 不提供 raw UserDatabase portable backup。

## Runtime boundary

Runtime 要求 Node 24.15.0+，直接使用内置 `node:sqlite`。仓库拥有 STRICT schema、checked-in adjacent SQL、fixed prepared
statements 与 Effect Schema/具名 decoder；不引入 Drizzle。Drizzle、第三方 ORM 与 SQLite Kit 都不能替代 format identity、
generic family bytes、Logical Seal、publication closure、authorizer 或 migration receipt。
