# Record → Analysis → Report —— Lifecycle

## Invocation 到 Report

```text
openRecordAccessRuntime(root)
  │
  ├─ invocation.withWriteSession
  │    ├─ session.view → reuse planning → ExecutionReusePlan
  │    ├─ gaps → Attempt execution
  │    │           └─ owner context → ctx.record / ctx.recordEffect
  │    ├─ publish complete Runs
  │    └─ close writer + shared maintenance lease
  │
  └─ invocation.withSnapshot
       ├─ mint fresh generation
       ├─ selection → AnalysisSampleHandle
       ├─ direct Projection calls
       ├─ Relations + Derivation
       ├─ Report manifest → Page / renderer closed inputs
       └─ close snapshot; ReportExecution remains self-contained
```

写会话和分析 snapshot 不重叠。`publish` 不刷新 `session.view`，也不让 draft 进入旧 generation。只有关闭 write
session 后创建的新 snapshot 才能看到本次发布的 Run。

## 锁与 Scope

| Operation | 锁顺序 | Scope 结束时 |
|---|---|---|
| `withWriteSession()` | shared maintenance → exclusive writer | flush / poison 判定完成，释放 writer 与 maintenance lease |
| `withSnapshot()` | shared maintenance | generation 关闭，owner handles 失效，释放 maintenance lease |
| `migrate()` | exclusive maintenance | sentinel 与 durable commit 收束后释放 |

outer `RecordAccessRuntime` 不长期持有任何 lease。只要没有活跃 child Scope，maintenance operation 就能取得 exclusive
lock；长寿 runtime 或 verified-read cache 不能成为 migration busy 原因。

## Owner-local 写入

一个 producer occurrence 的生命周期固定为：

```text
link exact definitions
  → reserve owner/name
  → mint owner-local context lease
  → submit tracked record commands
  → wait until every command settles
  → validate domain aggregate contract
  → seal owner
  → publish complete Run
```

`ctx.record()` 返回 Promise，`ctx.recordEffect()` 返回 Effect-native operation。两者观察同一个 tracked command；
Promise facade 不创建第二个 runtime 或 detached fiber。

admission 在 command 开始前核对 owner、exact grant 与 open lease。command 接受后发生的 schema、plain-data、blob
closure 或 durable write failure 会 poison owner；捕获 rejection 不能让该 Run 继续发布。

## Assertions、Evidence 与 Diff 的时序

Sandbox / runner 先形成一次 frozen workspace diff 语义值。diff Assertion evaluator 与 File Diff adapter 消费同一
值，避免“判定看到 A、Record 保存 B”。

Assertions producer 在 declaration order 中冻结 subject、evidence、coverage、limitations 与 sealed result。
bounded evidence 直接进入 Assertions payload；较大 evidence 进入 `niceeval.assertions` 自己的 blob closure。

File Diff 与 Assertions 是两个独立 Attachment command。whole-Attempt aggregate contract 在发布前核对二者是否
一致；Assertions 中的 diff material 只保存 `schemaId` 与 preview，不持有另一个 Attachment 的 blob/path/ref。

## Analysis snapshot 内部时序

一次 `withSnapshot()` mint 一个 generation，整个 Analysis 都停留在这个 callback：

1. selection 固定 selected Runs、logical slots 与 denominator；
2. `projectAnalysisSample()` 按需读取 package，但复用同一个 view；
3. Relations 只消费已经 closed 的 ProjectedSample；
4. Derivation 只消费 closed projections / relations；
5. Report host 执行自己的静态 manifest，并把 closed values 交给 author callbacks；
6. callback 完成后关闭 generation，`ReportExecution` 不保留任何 Record capability。

普通脚本可以根据第 2 步结果决定另一次 projection。Report manifest 必须在 author callback 前闭合，callback 不能
追加 I/O。

## 显式 migration

```text
maintenance.planMigration
  → exact-match installed definitions
  → build opaque plan
  → acquire exclusive maintenance lock
  → create migration.in-progress
  → run adjacent converters
  → reuse generic schema / plain-data / closure validators
  → durable commit
  → remove and sync sentinel
```

普通 read 返回 `migration-required` 或 `migration-unavailable`，不会调用 converter。普通 write 也不改写旧 family。
File Diff 与 Assertions definition 各自拥有相邻 migration；v1 不预先建立 Evaluation migration group。

若 future Diff migration 还必须改写 Assertions 中的 schema 指示，采用该 schema 前必须定义 migration group。该契约
要完整说明 authority、成员映射、原子提交与失败；缺少契约时明确返回 migration-unavailable。

## 热重载

`niceeval view` 每次 rebuild 都开独立 `withSnapshot()`。成功的新 `ReportExecution` 原子替换 last-good；失败时保留
last-good。last-good 不持有 lease、reader 或 generation，因此不会阻止 writer 或 migration。
