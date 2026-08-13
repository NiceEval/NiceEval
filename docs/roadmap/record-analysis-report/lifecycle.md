# Record → Analysis → Report —— Lifecycle

## Invocation 到 Report

```text
openRecordAccessRuntime(root, recordAttachments)
  │
  ├─ invocation.withWriteSession
  │    ├─ session.view → reuse planning → ExecutionReusePlan
  │    ├─ gaps → actual Attempt owner
  │    │           ├─ reserve mounted binding families
  │    │           ├─ producer open / seal / release
  │    │           ├─ sealed domain values → adapters
  │    │           └─ canonical commands → sealed Attempt
  │    ├─ Run bindings → sealed Run values → adapters
  │    ├─ publish complete Runs
  │    └─ close writer + shared maintenance lease
  │
  └─ invocation.withSnapshot
       ├─ mint fresh generation
       ├─ RecordReader → selectAnalysisSample() → AnalysisSampleHandle
       ├─ compile ReportData → finite Analysis field closure
       ├─ unique Projections + Relations + field materializers
       ├─ materialized rows → Page / PageFamily / renderer
       └─ close snapshot; ReportExecution remains self-contained
```

write session 与 Analysis snapshot 不重叠。`publish` 不刷新 `session.view`；只有 session 关闭后的 fresh snapshot 能看到
本次 Run。

## 锁与 Scope

| operation | 锁顺序 | Scope 结束时 |
|---|---|---|
| `withWriteSession()` | shared maintenance → exclusive writer | drain bindings／commands，释放 writer 与 maintenance lease |
| `withSnapshot()` | shared maintenance | 关闭 generation 与 owner handles，释放 maintenance lease |
| `migrate()` | exclusive maintenance | sentinel 与 durable commit 收束后释放 |

outer runtime 不长期持 lease。长寿 runtime 与 verified cache 不成为 migration busy 原因。

## Attempt producer 时序

actual gap Attempt 才执行：

```text
owner open + reserve + pending obligations
  → Agent ready
  → bindings open in linked order
  → beforeAttempt hooks
  → Eval body / sends
  → afterAttempt hooks
  → bindings seal and release in reverse order
  → sealed values adapt
  → canonical commands drain
  → domain aggregate validates
  → Attempt seals
```

一个 producer open、seal、release 各一次。session 只住在该 Attempt 的 child Scope。seal 接收穷尽 primary exit；release
失败会阻止 adaptation。正常采集缺口形成领域 explicit state，不能靠 missing Attachment 继续发布。

Effect 3.22.1 的 finalizer error 固定为 `never`。host 捕获 release 的完整 `Exit`／`Cause` 并写入 owner failure
aggregation，再让 finalizer 自身收束为 `never`。typed failure、defect 与 interruption不能只 log 或折叠成 unavailable。

carry／reuse 不打开 producer session，也不写新 Attachment。

## Assertions、Evidence 与 Diff

Sandbox／runner 先形成 frozen workspace diff 领域值。diff Assertion evaluator 与 File Diff adapter 消费同一值，避免判定
与持久事实漂移。

Assertions collector 按 declaration order 封口 subject、evidence、coverage、limitations 与 result。bounded evidence
进入 Assertions payload；较大材料进入 Assertions 自有 blob closure。Diff 与 Assertions 是两个 official bindings，
各自承担 total obligation。

whole-Attempt aggregate 在 publication 前核对二者一致性。Assertions 的 diff material 只保存 schema identity 与
preview，不借用 Diff 的 blob/path/ref。

## Run producer 时序

Run owner open 时登记 `recordAdapters.run` obligations。Run sessions 在 Experiment setup 前 acquire，在 teardown 后
seal／release。Run domain values adaptation、aggregate validation、Attempt references 与 portable writes 全部成功后，
writer 才创建 `complete`。

Experiment Plugin 的 Attempt binding属于另一个 pair occurrence；它不会复用 Run session 或 grant。

## Analysis snapshot

一次 `withSnapshot()` mint 一个 generation，整个 Analysis 停留在 callback：

1. selection 固定 selected Runs、logical slots 与 denominator；
2. `analyze({ fields })` 或 ReportData 编译本次请求的有限 Analysis dependency closure；
3. SDK 领域 Projection 在同一 handle 上至多执行一次；
4. Relations 只消费 closed same-Sample projections，field materializer 只形成 aligned rows；
5. Page／PageFamily callback 只消费 materialized closed rows，不能返回新 `ReportData`；
6. semantic tree 闭合后关闭 generation，`ReportExecution` 不保留 Record capability。

普通 Analysis 脚本可以根据已读值决定下一次 `analyze()`。一个 Report 的 `ReportData` dependencies 必须在 callback 前
闭合，callback 不能追加 I/O。
CLI 的 `executeReportFromRecord()` 只是 open reader → selection → `executeReport()` 的一次性组合入口，不建立第二条读路径。

## 显式 migration

```text
maintenance.planMigration
  → exact-match installed opaque capabilities
  → build root-bound plan
  → maintenance.authorizeMigration(exact plan, explicit decision)
  → exclusive maintenance lock
  → create migration.in-progress
  → run adjacent converters
  → shared schema / plain-data / closure validators
  → durable commit
  → remove and sync sentinel
```

普通 read 返回 `migration-required` 或 `migration-unavailable`。producer binding、Analysis 与 Report 都不调用 converter。
Plugin mount 也不自动安装或迁移。

迁移前形成的 `ReportExecution` 保持原状态。成功删除 sentinel 后，host 必须开新的 snapshot 并重新执行 Report；只有这份
新 execution 能看见 current Attachment。converter、durable I/O 或 interruption 失败会保留 sentinel，后续 open fail
closed，用户从 Git restore point 或自己的备份恢复。

若一个未来 migration 必须原子改写多个 families，采用前必须另定义 migration group 的 authority、成员映射与 commit
语义。缺少契约时明确 `migration-unavailable`，不靠 callback 顺序模拟事务。

## 热重载

`niceeval view` 每次 rebuild 都开独立 `withSnapshot()`。成功的新 `ReportExecution` 原子替换 last-good；失败保留
last-good。last-good 不持 lease、reader 或 generation，因此不会阻止 writer 或 migration。
