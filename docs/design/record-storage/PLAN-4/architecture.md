# PLAN-4 —— Architecture

## 物理边界

```text
.niceeval/
├── record/
│   └── record.sqlite              # operational Record database
├── cache/
│   └── record-query.sqlite
└── coordination/
    └── records/...

${NICEEVAL_HOME:-~/.niceeval}/
├── state.sqlite                   # OS-user Service state
└── cache/                         # deletable user cache
```

只有 `record/record.sqlite` 保存 project Record facts，但这份 operational database 也可以含尚未发布的 `open` / `sealing` rows。Cache、lease、execution claim、writer mailbox、credential、用户 Service state 和临时 snapshot 不进入 Record，也不参与 Run Seal。
`cache/` 是可删除、gitignored 的独立 store；cache schema、migration 与损坏都不能改变 published Record validity。

WAL 模式只用于同一主机的 operational database。它的 raw bytes 不是可分享格式：即使 checkpoint、关闭连接并停稳，free pages 仍可能保留已删除或未发布材料。Host snapshot 必须先通过 barrier 与 SQLite backup 固定 source，再在 target 删除所有 `open` / `sealing` closure，最后用 `VACUUM INTO` 重写 sealed-only database、验证 exact Seal、checkpoint 并关闭。WAL database 不放在不支持所需 shared-memory/locking 语义的 network filesystem。

外部 copy、Git checkout 或第三方提供的 snapshot 一律按 adversarial input 首次导入。Host 在可终止的受限 maintenance process 中关闭 extension 与 `ATTACH`，并设置以下约束：

- runtime limits 与 `mmap_size=0`；
- `trusted_schema=OFF` 与 defensive mode；
- exact schema allowlist；
- SQLite structure 与 NiceEval exact Seal 验证。

只有转成 Host-owned validated generation 后，普通短 reader 才直接打开。Threat model 不证明攻击者同时修改 Host-owned 本地文件时仍安全。

PLAN-4 要求 Node 24.15.0+。
这个版本把 `node:sqlite` 标为 RC，携带 SQLite 3.51.3 的 WAL-reset 修复，并提供 runtime limits。

## Generic schema

物理 schema 至少分成以下关系：

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

`runs.status` 是 `open | sealing | sealed`。`attempts` 永久保留 origin Run；`members` 把目标 Run 的 Slot 连接到 exact Attempt。Core reference 只能指向已 sealed 的 origin Attempt，不复制 Attachment 或 Content。

Attachment row 保存 owner kind、owner identity、family、revision、canonical payload bytes 与 logical inventory。Family 不拥有 table；unknown family rows、items、references 与 Content chunks 可以按 generic columns 原样 snapshot 和 migration。

`contents` 保存 logical handle、byte length、整体 digest 与 chunk count。`content_chunks` 以 `(content_id, ordinal)` 为 primary key，单 row bytes 受 private bounded chunk ceiling；输入 Stream chunk 不决定 durable ordinal 或 row size。

## 用户 Service state Store Host

`state.sqlite` 是 non-portable、跨 project 的 OS-user state，不是 Record 的第二个 namespace。每个 Service 贡献以下定义：

- stable `serviceId` 与当前 schema revision；
- namespaced table/index definitions；
- checked-in adjacent SQL migrations；
- fixed prepared operations 与 typed row decoder。

v1 只接受 application composition 静态列举的第一方 module，不开放运行时或第三方注册。Store Host 为每个 `serviceId` 派生不可伪造的 object prefix；module 不直接选择 table 名。

v1 module 禁止 view、trigger、virtual table、TEMP object、`ATTACH`、跨 namespace foreign key 与自定义 SQLite function。Host 在 statement prepare 与 migration 期间安装 namespace authorizer，并在 migration 后比较 exact `sqlite_schema` 差异。revision update 与相邻 migration 使用同一 transaction。

统一 Store Host 拥有 connection、storage worker、transaction、busy deadline 和 user-state maintenance lease。Service 不能取得 raw connection，不能访问别的 namespace，也不能在网络、Stream 或 provider 等待期间持有 transaction。

module migration 按需执行：只在该 Service operation 或显式 `state migrate --all` 时推进。未使用 module 的 predecessor 不阻止其它 Service operation；newer 或 unknown namespace 原样保留。旧 binary 只对请求该 module 返回 unsupported。

共享数据库意味着 file corruption、disk full 与 SQLite schema migration 是 user-root failure domain；Service 业务数据仍按 namespace 隔离。若采用门证明某个 Service 的迁移或写入需要独立 failure domain，才改为 per-Service database，而不是让 Service 自行打开任意 SQLite 文件。

credential 不因“属于某个 Service”自动进入 `state.sqlite`。每个 Service 必须另行定义 secret classification、OS permission 与 encryption boundary；cache 继续是可删除的第三类 store。

## Run publication

Run lifecycle 使用多个短 transaction，而不是一个长 transaction：

1. create-once transaction 插入 `open` Run、Slot 与 writer generation；
2. Host mailbox 按 encoded bytes 与 command count 限流，dispatcher 把多个 command 合成 worker batch；
3. Attempt/Attachment/Content writer 用 bounded batch transaction 追加 rows；
4. finalizer 停止 producer并把状态改为 `sealing`；
5. finalizer 在 transaction 外流式验证 payload、Content、reference 与候选 inventory；
6. final transaction 重新核对 writer generation、row counts 和 inventory digest，插入 `run_seal_entries` 并切到 `sealed`；
7. receipt 只在 commit 成功后形成。

每个 admitted command 取得 Host sequence。SQLite retry 只用冻结 bytes 重新执行 prepared statement，不重新执行 builder 或消费 source。

Command identity 固定 writer generation、owner、sequence、definition/family 与 logical identity。已存在 command 只有在 canonical digest 和全部 identity 字段相同时才是 committed success；其它组合以具名 conflict fail closed。

后台 encode 或 storage failure poison 所属 Attempt。Host 停止新 admission，并由下一次 write 或 `attempt.complete()` 返回 failure。

ordinary reader 的每个入口都要求 `runs.status = 'sealed'`。Open/sealing rows 即使结构完整也不是 published facts。

sealed rows 只能由显式 maintenance migration 改写。Host 使用 trigger、固定 prepared statements、schema identity 与 exclusive maintenance lease 共同阻止 ordinary writer 更新或删除 sealed closure。

## 多进程 locking

多个 NiceEval 进程可以同时打开同一 local database。WAL 允许 reader 与 writer 并行，但任一时刻只有一个 write transaction。

Host 启用多连接 WAL 前检查 embedded SQLite version。受 [WAL-reset bug](https://sqlite.org/wal.html#walreset) 影响的版本不能进入本候选支持面；支持的 Node runtime 必须携带 upstream 3.51.3+ 或具名 backport 修复。

每个进程最多拥有一个 dedicated Record storage worker。worker 使用短 `BEGIN IMMEDIATE` transaction、private bounded busy wait 和调用方 deadline。Content writer 在 bounded chunk batch 后 commit并释放 write lock，不持锁等待 provider、网络、Sandbox、模型或 producer input。

SQLite file lock 不是公平队列。
storage worker 在尝试 database write lock 前进入 Coordination 拥有的 per-root writer admission；每个进程同时最多一个 waiter，每张 ticket 只执行一个 bounded batch。
admission 是 crash-recoverable FIFO ticket/lease protocol，不是第二份 Record database。完成、deadline、取消或 owner crash 都会交还或回收 admission，后续健康、未取消且在 deadline 内的 waiter 才能前进。direct SQLite writer 不在支持面。

真实 file-backed SQLite 与九个独立 Node process 的协议证据见
[SQLite Coordination 多进程收据](../../../research/record-storage/coordination/sqlite-coordination-receipt.md)。该证据是 Linux/ext4 选择参考，不把 candidate 冒充成 production implementation。

deadline 同时约束 writer admission 与 SQLite busy wait。
超时返回 typed contention failure；它不能被写成 partial Attachment，也不能让 Host 猜测 commit 是否成功。
Host 使用 transaction state 与 stable command identity 重读确认。

Schema migration、snapshot barrier 与 destructive maintenance 继续使用 Coordination 的 exclusive maintenance lease。SQLite file lock 防止 corruption，但不代替 NiceEval 的版本检查、operation feedback 或跨进程 migration authority。

## 冷启动

普通 open 只验证 header、schema identity 与目标 operation 所需的索引，不扫描全部 Run，也不运行全库 `integrity_check`。数据库总 bytes 不是固定 open 工作量；巨大 schema、未 checkpoint WAL、crash recovery、慢 filesystem 和首次 page fault 仍会增加延迟。

query/show 每次直接打开短 read-only connection，不支付 worker startup。
Insight 不长期保持 read transaction；active revision 固定 sealed cutoff，detail RPC 用短 reader 重开同一 immutable facts。

### 初步本机参照结果

2026-08-25 在 Node 24.19.0、SQLite 3.53.3 的本地临时数据库上执行了非采用性 microbenchmark。Fixture 为 13.09 MiB、100 Run、100,000 Attempt 和约十张表。

| 场景 | p50 | p95 |
|---|---:|---:|
| 同一 Node 进程中 open + schema query + indexed lookup + close | 0.231 ms | 0.251 ms |
| 新 Node 进程 + 同一 database operation | 25.802 ms | 27.535 ms |

第二项包含 Node process startup。两项都命中 warm OS page cache，不代表真实冷盘、未 checkpoint WAL 或 crash recovery。

最新采用收据让四个进程各执行 250 个 `synchronous=FULL` 的独立短事务。1,000 个事务全部成功，总 wall time 为 676.928 ms。

SQLite 没有公平调度：最晚 writer 的首次 commit 等待 530.193 ms。
这个结果要求 Host writer admission，不能用 busy timeout 冒充持续进展保证。

144 MiB chunk、50,000 items、backup、crash、migration 与 worker startup 的完整结果见
[Root-wide SQLite 采用收据](../../../research/record-storage/root-wide-sqlite-receipt.md)。
该结果是单机选择证据，不是跨硬件性能承诺。

## 完整验证与 hostile database

reader 使用 read-only connection、fixed SQL、runtime limits、defensive mode、`trusted_schema=OFF` 和 exact schema allowlist。
它关闭 extension loading，把 `ATTACH` limit 设为 0，并用 authorizer 拒绝 ATTACH、DDL、write 与非 `main` database access。

SQLite structural integrity 不能代替 NiceEval closure validation。`requireComplete()` 仍按 Run Seal 流式核对 Core、Attachment、collection item、Content length/digest、references、missing 与 extra logical rows。

ordinary family read 只走 owner/family index，并按需读取 Content chunks。它不扫描全部 database，也不把未验证的 unknown family 解释成 valid。

## Migration

Database schema migration 与 family data migration 是两条链：

- schema migration 改变 table、index、trigger 与 storage revision；
- family migration 改变某个 family 的 canonical payload、items、Content 或 references。

ordinary open 发现 predecessor 时返回 `migration-required`。Maintenance 取得 exclusive lease，检查 source schema、目标版本、可用空间和 active connection，再执行相邻 migration。

相邻 schema migration 是仓库拥有、人工审查并随包发布的 SQL；runtime 不生成 schema，也不执行 `drizzle-kit push`。

family/data migration 使用 TypeScript typed converter，unknown family 只按 raw bytes 与 generic inventory 搬运。

只改变 physical schema 的 migration 保留 Run / Attempt / family revision / Content bytes、digest、reference identity 与 `LogicalSealIdentity`。它只重建 physical Seal representation 与 storage generation。

改变 canonical business facts 的 family migration 推进 family revision、重建 closure 与 Seal。依赖旧 revision 的 Insight 结果随之失效。

只增加 metadata 的 migration 可以在 exclusive maintenance transaction 内完成。

需要 rebuild 大表的 migration 创建 copy-on-write target，流式搬运并验证后再替换 source。它预检至少一份额外 database、WAL 与验证所需空间。

替换前必须排除并关闭全部 source connection。target 验证并 fsync 后 atomic rename 到 stable path，再 fsync parent directory。崩溃在 rename 前重开 source，rename 后重开 target；migration receipt 不是 commit record，可以从 stable generation 重建。

147.75 MiB fixture 的 in-place table rebuild 持有 exclusive lock 1,421.612 ms，并让 checkpoint 后 database 增长到 291.96 MiB。
该结果固定了大表 rebuild 的 copy-on-write 边界，而不是把这项成本留给 Drizzle Kit 隐藏。
