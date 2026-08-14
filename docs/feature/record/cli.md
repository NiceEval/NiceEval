# Record CLI

CLI 通过 [Record Library](library.md) 打开 exact v1 Record protocol。它不在 `show`、`view`、`exp`
或 `clean` 中自动迁移字节；非 v1 格式返回 `unsupported-format`。没有 `complete` 的目录不是 Run。

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
Inspect and remove them with: niceeval clean
```

一个 query 只在真正需要时读取对应的 Attachment 和 blob。未持久化的 fixed family 显示
`not-recorded`；不能 exact decode 的非支持 schema 显示 `unsupported`；closure 或 exact payload 无效显示
`invalid`。这些局部问题不把其它有效 Run 从 selection 中移除。

读到 `available` 后，payload 已 deep-freeze，blob closure 已验证并 materialize。命令的投影和
Report 不会再次打开 storage。形成 value 前的 I/O 或 permission failure 仍是 typed read failure，
不会伪装成空数据。

## `exp` 与 `exp --dry`

`niceeval exp` 在模型、Sandbox、外部命令或付费调用前打开 current Record，并取得 shared append
lease。它创建一个全新的 RunId 和 `runs/<RunId>/`；不会锁住其它 Run writer，也不会更新 root manifest、
counter、`latest` 或共享 summary。

每个实际执行的 Attempt 只写自己的目录。相同 logical Slot 的跨 Invocation 去重由 execution claim
处理，claim 在 dispatch 时取得，在承载该 Attempt 的 Run durable seal 后释放。`maxConcurrency`
同样属于 Experiment / Coordination，而不是 Record。

Run `seal()` 等待本 Run 的 Attempt 与 collector 停稳，验证 Core、reference、固定 family 和 blob
closure，关闭并 flush 内容后才创建 `complete`。完成标识前的退出、I/O failure 或 interruption 留下
incomplete directory；完成标识后即使 receipt 尚未输出，Run 也已 durable 发布。

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

`niceeval.record/v1` 和五个 `/v1` family 是首个支持格式，migration 链为空。因此 `migrate`
对完整 current v1 Record 返回：

```text
Record is already current: niceeval.record/v1
```

它遇到任何非支持格式返回 `unsupported-format`，并且不写盘。它不猜测中间格式，也不接受第三方
converter。发布 v2 时，CLI 必须随 v2 一同提供固定的 v1→v2 step；那时旧 v1 才会显示
`migration-required` 和准确的 `niceeval migrate --record <root>` 下一步。

存在固定 migration 时，命令先做只读 Git preflight，并打印计划。预检要求：

- Record 位于 Git worktree；
- 全部 portable bytes 都由 HEAD 跟踪；
- Record 的 index 和 worktree 没有 modified、deleted、untracked 或 ignored 内容；
- `migration.in-progress` 不存在。

预检通过后，命令显示 restore commit，并要求确认；非交互调用必须显式传 `--yes`。它创建并 sync
`migration.in-progress`，原地运行每个相邻步骤，完整验证 Core、五个 family 和 blob closure，最后删除并
sync marker。

NiceEval 不创建 staging、backup、rollback、root replacement 或恢复日志。迁移失败、被 kill 或断电时，
marker 保留。普通命令和 migrate 随后返回 `migration-interrupted`；用户必须用 Git 完整恢复
`.niceeval/record` 的历史字节，再重新运行 migrate。

## 错误与下一步

| code/state | 含义 | 下一步 |
|---|---|---|
| `already-current` | Record 已是 `niceeval.record/v1` | 不修改 Record |
| `unsupported-format` | format 不是支持的 Core/family v1 | 使用支持该格式的 NiceEval；不要强行迁移 |
| `migration-required` | 已发布的固定相邻 migration 可以处理旧格式 | 运行显示的 `niceeval migrate` 命令 |
| `migration-interrupted` | `migration.in-progress` 存在 | 用 Git 完整恢复 Record 后重试 |
| `record-maintenance-busy` | maintenance 与 reader/writer/clean 冲突 | 关闭占用命令后重试 |
| `incomplete-run` | Run 没有 `complete` | 有效 Run 继续可用；用 `niceeval clean` 检查 |
| `not-recorded` | 已封口 owner 没有请求的 fixed family | 让 query 按其 missing policy 处理 |
| `unsupported` | Attachment schema 不受支持 | 使用支持它的 NiceEval；其它 family 仍可读取 |
| `invalid` | envelope、payload、ref 或 closure 无效 | 检查该 family；其它有效事实继续可用 |

## Git、复制与分享

只提交 `<project>/.niceeval/record/`。`.niceeval-local/` 中的 claim、lease、cache 与 session 不能提交、
复制或分享。

复制、Git checkout 或 merge 前停止 writer 和 maintenance。incomplete directory 即使被复制，也不会被
目标 reader 当成 published Run。Record 可能包含源码、prompt、conversation 和 blob；提交或分享前由
用户确认仓库权限、脱敏和保留策略。
