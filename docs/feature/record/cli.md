# Record CLI

CLI 通过 [Record Library](library.md) 打开 exact current Record protocol：root 是
`{ format: "niceeval.record", schemaVersion: 1 }`。它不在 `show`、`view`、`exp` 或 `clean` 中自动迁移
字节；不相容格式必须先由显式 `niceeval migrate` 处理，才能形成 `RecordReadSession`。没有 `complete`
的目录不是 Run。

CLI 是五个 Host composition SDK 的一个调用者。`exp` 与 `accept` 经 `experimentHost`，Record I/O 经
`recordHost`。dispatch claim 与 lease 经 `coordinationHost`，Sample 经 `analysisHost`。`show`、`view` 与
静态 export 经 `reportHost`。本页只定义其中 Record I/O 的用户可见契约。

## 命令与 lease

| 命令 | lease | 是否改变已发布事实 |
|---|---|---|
| `niceeval show` | shared read | 否 |
| `niceeval view` | shared read | 否 |
| `niceeval exp --dry` | shared read | 否 |
| `niceeval exp` | shared append | 只新增自己的 Run |
| `niceeval clean` | exclusive maintenance | 否；只删除 incomplete Run |
| `niceeval migrate` | exclusive maintenance | 只在有固定相邻 migration 时改写历史字节 |

shared read 和 append lease 可并存。每个 `exp` writer 只修改自己排他创建的
`runs/<RunId>/`，因此正常追加没有全局 writer lock（写入锁）。maintenance 与 reader、writer、clean
互斥；冲突时返回 `record-maintenance-busy`，而不是等待并持有一个半完成的操作。

## `show` 与 `view`

`show` 和 `view` 打开一个 `RecordReadSession`，调用 `selectRuns()`，再把同一个 reader 与
`RecordSelection` 交给 Analysis。它们不会读取当前 Eval 源码、当前 worktree、provider 或网络来补
历史事实。

存在 incomplete Run 时，CLI 继续显示有效 Run，并显示：

```text
Warning: 2 incomplete Runs were ignored.
They are not readable or reusable.
details: niceeval clean
```

受控 `SIGINT` 会先把已完成 Attempt、仍在飞的 Attempt 和未派发 Member 分别封口，再发布完整 Run，因此这类 Run 不触发 incomplete warning。warning 只报告进程来不及收尾、写入失败或 seal 失败后没有 `complete` 的 directory；reader 不从这些 draft 中拼装部分事实。

一个 query 只在其 `AnalysisInput` 或 `DomainView` 真正需要时读取对应的 Attachment 和 blob。未持久化的
fixed family 显示 `not-recorded`；closure 或 exact payload 无效显示 `invalid`。这些局部问题不把其它有效
Run 从 selection 中移除。

root 或 Core schemaVersion 不匹配时，CLI 返回 `migration-required`（有固定相邻步骤）或
`unsupported-format`，不形成 reader。已知 family 的旧 schemaVersion 同样要求显式 migrate，ordinary read
不兼容。

未知独立 future family 例外：CLI 保留其 directory、payload 与 blob bytes，跳过解释并继续读取 Core 与
认识的 family。依赖它的 AnalysisInput 或 DomainView 显示 `unsupported`。带 `/vN` 后缀的
未发布 family 草案不是这种 future family，仍返回 `unsupported-format`。

读到 `available` 后，payload 已 deep-freeze，blob closure 已验证并 materialize。Analysis 与 Report
不会再次打开 storage。形成 value 前的 I/O 或 permission failure 仍是 typed read failure，不会伪装成
空数据。

## `exp` 与 `exp --dry`

`niceeval exp` 在模型、Sandbox、外部命令或付费调用前打开 current Record，并取得 shared append
lease。它创建一个全新的 RunId 和 `runs/<RunId>/`；不会锁住其它 Run writer，也不会更新 root manifest、
counter、`latest` 或共享 summary。

Experiment Host 在取得 append lease 前形成必填 `RunContext`：
`{ experimentId, execution: { agentId, model, reasoningEffort, flags }, labels }`。普通 Run 的
`CreateRunRequest` 与只引用历史 Attempt 的 `CreateReferenceRunRequest` 都携带它。writer 先验证 exact
Core shape，并要求 `context.experimentId === experimentId`；它在 `seal()` 时将 context 写进 `run.json`，
不会以运行结束时的当前配置回填历史。

每个实际执行的 Attempt 只写自己的目录。相同 logical Slot 的跨 Invocation 去重由 execution claim
处理，claim 在 dispatch 时取得，在承载该 Attempt 的 Run durable seal 后释放。`maxConcurrency`
同样属于 Experiment / Coordination，而不是 Record。

Run `seal()` 等待本 Run 的 Attempt 与 collector 停稳，验证 Core、reference、固定 family 和 blob
closure，关闭并 flush 内容后才创建 `complete`。完成标识前的退出、I/O failure 或 interruption 留下
incomplete directory；完成标识后即使 receipt 尚未输出，Run 也已 durable 发布。

Runner 对受控 `SIGINT` 的调用会在进入 `seal()` 前关闭仍在飞的 Attempt 与未派发 Member。已完成 Attempt 的 locator 和固定事实随同一个完整 Run 发布；reader 仍只读取带 `complete` 的 Run，不建立 draft 读取旁路。

`niceeval exp --dry` 不创建 Run、Attempt 或 append lease。它只用 read session 形成计划和 reuse
判断；新的 Run 在它的 selection 形成后封口时，不会反向改变该计划。

## `clean`

```sh
niceeval clean [--record <root>] [--yes]
```

`clean` 先列出没有 `complete` 的 RunId，并要求确认。它取得 maintenance lease 后再次检查 marker，
只删除仍 incomplete 的目录。已经封口的 Run 即使 Core invalid，也不在 clean 范围内。

非交互调用必须传 `--yes`。成功 receipt 列出 `deleted` 和在重验中变为已封口的 `skipped` RunId。

## `migrate`

```sh
niceeval migrate [--record <root>] [--yes]
```

root / Core schemaVersion `1` 没有已发布 predecessor。所有 fixed family 也处于 current 时，`migrate`
对完整 current Record 返回：

```text
Record is already current: niceeval.record (schemaVersion 1)
```

root / Core 不相容时，若有固定相邻步骤则返回 `migration-required`，否则 `unsupported-format`，并且不写盘。
已知 family 的旧 schemaVersion 也经这条 maintenance 路径迁移。未发布的斜杠版本草案不是 migration source。
未知 independent future family 不迁移，也不删除。CLI 不猜测中间格式，不接受第三方 converter。

Observability v1 由固定 `1 → 2` maintenance step 迁移；两个 owner 的 payload、label、blob refs 与 blob bytes
逐字保留，只更新 envelope。历史格式完成或由 Git 恢复后，才可打开为 current reader。

存在固定相邻步骤时，命令先做只读 Git preflight，并打印计划。预检要求：

- Record 位于 Git worktree；
- 全部 portable bytes 都由 HEAD 跟踪；
- Record 的 index 和 worktree 没有 modified、deleted、untracked 或 ignored 内容；

预检通过后，命令显示 restore commit，并要求确认；非交互调用必须显式传 `--yes`。它在 exclusive
maintenance lease 下原地运行每个相邻步骤，完整验证 Core、认识的 fixed family 和 blob closure 后才结束。

NiceEval 不创建 staging、backup、rollback 或 root replacement。首次改写前创建的
`migration.in-progress` 只保存已通过 preflight 的 restore commit，不保存 payload。迁移失败、被 kill 或断电后，
CLI 从 sentinel 打印限定到 Record root 的精确 `git restore`、tracked-byte 验证和 sentinel 清除命令；只有验证
worktree 与 index 都等于该 commit 后才清除 sentinel，再重新运行 migrate。在旧格式或未恢复的迁移现场，CLI
不创建 reader，Analysis 和 Report 也不会看到迁移执行态。

## 错误与下一步

| code/state | 含义 | 下一步 |
|---|---|---|
| `already-current` | root / Core 是 schemaVersion `1`，所有 fixed family 也处于 current | 不修改 Record |
| `migration-required` | root / Core 或已知 family 有固定相邻 migration | 运行 `niceeval migrate`；ordinary reader 不改盘 |
| `unsupported-format` | root / Core 无支持步骤、known family 是 future/无链版本，或 family 名使用未发布 `/vN` 草案 | 使用写出该格式的 NiceEval；不要按损坏数据恢复 |
| `record-maintenance-busy` | maintenance 与 reader/writer/clean 冲突 | 关闭占用命令后重试 |
| `incomplete-run` | Run 没有 `complete` | 有效 Run 继续可用；用 `niceeval clean` 检查 |
| `not-recorded` | 已封口 owner 没有请求的 fixed family | 让 query 按其 missing policy 处理 |
| `unsupported` | input 或 view 依赖本版本不认识的 future family | 使用认识该 family 的 NiceEval；其它结果继续可用 |
| `invalid` | envelope、payload、ref 或 closure 无效 | 检查该 family；其它有效事实继续可用 |

## Git、复制与分享

只提交 `<project>/.niceeval/record/`。`.niceeval/` 下的 execution claim、session、gate 与
`coordination/records/<recordKey>/` lease sidecar 都不能提交、复制或分享。

复制、Git checkout 或 merge 前停止 writer 和 maintenance。incomplete directory 即使被复制，也不会被
目标 reader 当成 published Run。Record 可能包含源码、prompt、conversation 和 blob；提交或分享前由
用户确认仓库权限、脱敏和保留策略。
