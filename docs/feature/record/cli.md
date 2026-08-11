# Record CLI

CLI 使用同一套 Record Library。普通命令只读 current Core major；不会自动迁移、偷偷兼容
旧 Core，也不会把未完成 directory 当成 Run。

## 命令与锁

| 命令 | maintenance lock | writer lock | 是否修改已发布事实 |
|---|---|---|---|
| `niceeval show` | shared | 否 | 否 |
| `niceeval view` | shared | 否 | 否 |
| `niceeval exp --dry` | shared | 否 | 否 |
| `niceeval exp` | shared | exclusive | 只新增 Run |
| `niceeval clean` | shared | exclusive | 否；只删未完成 directory |
| `niceeval migrate` | exclusive | 不另取 | 是 |

reader 可以和 writer 并发。writer 尚未创建完成标识的 directory 不会进入 reader snapshot。

`migrate` 与 reader、writer、clean 互斥。busy 时 fail fast，并提示用户关闭对应命令后
重试。`migration.in-progress` 存在时不是 busy：所有普通命令与 migrate 都 fail closed。

## 普通命令只认 current Core major

已知旧 Core major：

```text
record-migration-required
Record format: niceeval.record/v1
Current format: niceeval.record/v3
Run: niceeval migrate --record <root>
```

future 或 foreign format 返回 `record-format-unsupported`。root 不存在与旧格式不是同一种
状态；`exp --dry` 只能把真正不存在的 root 当成 empty history。

known old Attachment 只影响请求它的功能：

```text
attachment-migration-required
RecordAttachment: niceeval.verdict/v1
Required: niceeval.verdict/v2
Run: niceeval migrate --record <root>
```

未请求该 Attachment 的功能继续运行。unknown Attachment 返回 `unsupported`，并且其它
Core 与 Attachment 仍可读。

`migration-unavailable` 不显示 `Run: niceeval migrate`。它表示已知 Attachment 的 old
bytes 已被保留，但 current value 无法如实形成；重新运行同一命令不会改变这个事实。

## show 与 view

`show` 和 `view` 打开一次 frozen reader snapshot，再由 Analysis selection、Projection 与
Report 消费。它们不会读取当前 Eval 源码来补历史数据。

存在未完成 Run 时：

```text
Warning: 2 incomplete Runs were ignored.
They are not readable or reusable.
Inspect and remove them with: niceeval clean
```

warning 不阻塞有效 Run，也不把未完成 Run 加入列表或分析分母。

一个 Attachment `unavailable`、`migration-required`、`migration-unavailable`、
`unsupported` 或 `invalid` 只影响请求它的 Report component。`available` payload 的
blob closure 已完整验证；blob I/O、permission 与 handle failure 按 Effect Cause 到达
命令边界，而不改写为 data state。

CLI 的内建 problems surface 始终显示这些状态。`migration-unavailable` 给出 owner 的
reason、保留 bytes 的事实与发布新 Run 的建议，不要求用户重跑 migrate。

## exp 与 dry run

`niceeval exp` 在模型、Sandbox、外部命令或付费调用前完成 current-format open，并取得
writer lock。

write session 打开时冻结已有 Run，供 reuse planning 使用。运行过程中逐步写入新 Run
directory；只有 draft 在 final flush/close 后最后创建 `complete`，新 Run 才对以后打开的
reader 可见。

受控执行错误可以形成完整 `errored` Attempt 并随 Run 发布。进程退出、I/O failure 或
interruption 发生在完成标识前时，不发布该 Run；以后只产生 incomplete warning。

完成标识后 fiber 可能还未交付 receipt。CLI 不以 receipt 缺失撤销 durable Run。draft
进入 `failed` 后不能再写入或重新发布，且 finalizer 不删除其 incomplete directory。

`niceeval exp --dry` 不创建 Run、draft 或 writer lock。它仍打开 current Record，并运行同一
reuse planning。

## clean

```sh
niceeval clean [--record <root>] [--yes]
```

默认输出每个未完成 RunId，并要求确认。命令取得 writer lock；若 `exp` 仍在写入则返回
busy。

删除前再次检查完成标识。已经完成的 Run 即使出现在先前列表中也会跳过；有完成标识但
Core invalid 的 Run 永远不属于 clean 范围。

非交互调用必须传 `--yes`。成功 receipt 列出 deleted 与 skipped RunId。

## migrate

```sh
niceeval migrate [--record <root>] [--yes]
```

命令先进行只读 preflight，并打印完整计划：

```text
Core
  niceeval.record/v1 -> v2 -> v3

RecordAttachments
  niceeval.verdict/v1 -> v2
  com.example.cost/v1 -> v2

Not losslessly migratable
  niceeval.sources/v2 -> v3: dependency fact was not recorded

Unsupported and preserved
  com.example.trace/v1
```

每个 converter 只执行相邻一步。一次 CLI 调用会编排到当前安装的 NiceEval 与插件所声明的
target。遇到 `not-losslessly-migratable` 边时保留旧 Attachment bytes；`--yes` 不能伪造
current value，也不把它变成可重试任务。

### Git safety

preflight 检查 `.niceeval/record`：

- 位于 Git worktree；
- 所有 portable 文件都由当前 commit 跟踪；
- 没有 modified、deleted、untracked 或 ignored 内容；
- HEAD 中存在可恢复的 source tree；
- `migration.in-progress` 不存在。

满足时显示 restore commit 后继续确认。无法证明时显示数据损失 warning，并要求用户输入
确认；非交互调用必须显式传 `--yes`。

这项检查证明本地 Git 可以恢复，不证明 commit 已经 push 到 GitHub。是否推送远端由用户
决定。

### 执行与中断

preflight 先验证完整相邻链、所有 source schema 和 closure、owner preservation、ID 与
路径冲突。失败时不写磁盘。

第一次写 portable bytes 前，migrate exclusive create 并 sync root 下的零字节
`migration.in-progress`。Core 与 Attachment-only migration 都使用它。

命令随后写入并 sync target bytes。target `record.json` 最后写入并 sync；只有最后删除
并 sync sentinel，root 才重新可读。

步骤中被 kill、断电、converter failure 或写入失败时，sentinel 留在 root。普通命令、
plan 与 migrate 返回 `record-migration-interrupted`，不会自动恢复、删除 sentinel 或从
中间版本继续。用户从 preflight 显示的 Git commit 或自己的备份恢复。

声明 `not-losslessly-migratable` 的 Attachment 保持原 bytes，并产生
`attachment-migration-unavailable`。converter failure 与明确不可迁移不同：前者留下
sentinel 并停止命令，后者允许其它目标 bytes 完成后按计划发布。

current root 且没有需要写入的 target 时，migrate 返回 `record-migration-not-needed`。

## 错误与下一步

| code/state | 含义 | 下一步 |
|---|---|---|
| `record-migration-required` | Core 是已知旧 major | 运行 `niceeval migrate` |
| `attachment-migration-required` | 请求了有完整 converter 链的旧 Attachment | 运行 `niceeval migrate` |
| `attachment-migration-unavailable` | 已知 Attachment 无法无损形成 current schema | 保留 bytes；使用能解释该版本的 consumer，或发布新的 Run |
| `record-format-unsupported` | future 或 foreign Core | 安装支持该格式的 NiceEval |
| `record-maintenance-busy` | migrate 与 reader/writer/clean 冲突 | 关闭占用进程后重试 |
| `record-writer-busy` | 另一个 writer 或 clean 持有锁 | 等它退出后重试 |
| `record-migration-plan-invalid` | converter chain、source、closure 或 target preflight 失败 | 按列出的具体项修复；尚未写磁盘 |
| `record-migration-interrupted` | sentinel 表示前次 migration 未完成或不可确认 | 从 Git/备份恢复；不要重跑 migrate |
| `record-clean-confirmation-required` | clean 需要用户确认 | 检查列表后确认或传 `--yes` |
| `incomplete-run` | Run 没有完成标识 | 有效 Run 继续可用；运行 `niceeval clean` |
| `RecordCoreRead.core-invalid` | 已完成 Run 的 Core 损坏 | 该 Run 不可用于分析；其它 Run 继续可用 |
| `RecordAttachmentRead.migration-required` | known old Attachment 有完整 converter 链 | 运行 `niceeval migrate` |
| `RecordAttachmentRead.unsupported` | 未安装对应 definition | 安装 owning plugin；其它 Attachment 继续可用 |
| `RecordAttachmentRead.migration-unavailable` | known path 包含不可无损迁移边 | old bytes 保留；该 current projection 不可用，勿重跑 migrate |
| `RecordAttachmentRead.invalid` | Attachment envelope/payload/ref/blob/closure 无效 | 检查该 Attachment；其它数据继续可用 |

## Git、复制与分享

只提交 `<project>/.niceeval/record/`。session、lock 与 cache 所在的 `.niceeval-local/`
不提交。

复制、Git checkout 或 merge 前停止 writer 与 migration。未完成 directory 即使被复制，也
不会被目标 reader 当成 published Run。带 `migration.in-progress` 的 root 需要从 Git 或
备份恢复，不能在副本上自动继续。

Record 可能包含源码、prompt、conversation 与 blob。提交或分享前由用户确认仓库权限、
脱敏和保留策略。
