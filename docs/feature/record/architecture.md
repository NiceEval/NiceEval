# Record 架构

Record Core 拥有 SQLite resource、publication、Seal、Content、reference、reader 与 maintenance。
family definition 拥有 logical Schema、validation 与相邻 data migration；capture authority 只提交它亲历的事实。
Experiment coordination、cache、Inspection 与 Delivery 都不进入 Record database。

## Storage ownership

```text
<project>/.niceeval/
├── record/record.sqlite          ProjectRecordStore operational database
├── cache/                        deletable project cache
└── coordination/                 execution claims, leases, writer admission

${NICEEVAL_HOME:-~/.niceeval}/
├── state.sqlite                  OS-user Service state
└── cache/                        deletable user cache
```

`record.sqlite` 是一份 root-wide SQLite application database。它保存 Core、Attachment、collection item、reference、Content
chunk 与 Seal，也可能保存未发布的 `open` / `sealing` rows。

Record Host 独占 connection、transaction、authorizer、storage worker、schema interpretation、snapshot 与 maintenance。
family、Plugin、Service、Inspection 与 Delivery 都不能取得这些 capability。

`state.sqlite` 是另一份跨 project 的 OS-user database，不是 Record namespace、Run closure 或 Snapshot 的一部分。
cache 可删除，coordination 可回收，credential 走单独的 secret classification、权限与加密边界；任何一项都不能因为
“需要持久化”而进入 Record 或 Service state。

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

family/data migration 改变 canonical payload、items、Content 或 references。它使用 TypeScript typed adjacent converter，推进
family revision并重建 closure 与 Seal。unknown family 只按 raw generic rows 搬运，不能调用缺失的 family Schema。

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

SQLite WAL 允许 readers 与短 writer 并行，但 physical writer 只有一个，且 file lock 不保证公平。每次 bounded batch 在尝试
SQLite write lock 前取得 Coordination 的 per-root FIFO admission ticket；一个 ticket 只运行一个 batch，commit 后必须归还，
不能连续排空整个 backlog。owner crash、deadline 与 cancellation 都能回收 ticket。direct SQLite writer 不在支持面。

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

Host 形成 Snapshot 时先预检 database bytes、可用空间、观测 throughput 与 caller deadline，再取得 per-root snapshot barrier。
barrier 阻止新的 write transaction admission，等待已经开始的真实 transaction commit/rollback；mailbox 中未开始的 command
保留在 backlog。Host 只在 barrier 内用 SQLite backup 固定 target，随后立即释放 source barrier。

独立 target 删除所有 `open` / `sealing` closure，以 `VACUUM INTO` 重写 sealed-only bytes，验证 exact Seal、checkpoint 并关闭。
只有完成这些步骤的 nominal `RecordSnapshot` 能 copy、进入 Git 或传给 `--record`。Git merge 不是 row merge
protocol，binary diff 与 branch conflict 是已接受代价。

外部 Snapshot 一律视为 hostile input。Host 在可终止、资源受限的 maintenance unit 中关闭 extension 与 `ATTACH`。
它设置 runtime limits、`mmap_size=0`、`trusted_schema=OFF`、defensive mode 与 authorizer。

Host 随后验证 database header、exact schema allowlist、SQLite structure、typed rows 和每个 Logical Seal。
只有导入为 Host-owned validated generation 后，ordinary reader 才直接打开。
本 threat model 不承诺抵御攻击者同时篡改 Host-owned local file。

## OS-user Service state Store Host

`~/.niceeval/state.sqlite` 只运行 application composition 静态列举的第一方 module。每个 module 声明稳定 `serviceId`、current
revision、namespaced schema、checked-in adjacent SQL migrations、fixed prepared operations 与 typed row decoder。

Store Host 为 `serviceId` 派生不可伪造 namespace。它独占 connection、transaction、authorizer、busy deadline、storage worker
与 maintenance。module 不得提交 raw SQL 或自行选择 table name。

v1 禁止第三方/运行时注册、view、trigger、virtual table、TEMP object、`ATTACH`、跨 namespace foreign key 与 custom SQLite
function。Host 在 prepare/migration 时安装 namespace authorizer，并在 migration 后核对 exact `sqlite_schema` delta。
revision update 与 adjacent migration 位于同一 transaction。

module 按需 migrate：只在该 Service operation 或显式 `state migrate --all` 时推进。未使用 predecessor module 不阻塞其它
namespace；newer/unknown namespace 原样保留，旧 binary 只对请求的 module 返回 unsupported。Service operation 只能调用静态
fixed operation，不能取得 SQL capability，也不能在 network、Stream 或 provider 等待期间持有 transaction。

## Runtime boundary

Runtime 要求 Node 24.15.0+，直接使用内置 `node:sqlite`。仓库拥有 STRICT schema、checked-in adjacent SQL、fixed prepared
statements 与 Effect Schema/具名 decoder；不引入 Drizzle。Drizzle、第三方 ORM 与 SQLite Kit 都不能替代 format identity、
generic family bytes、Logical Seal、publication closure、authorizer 或 migration receipt。
