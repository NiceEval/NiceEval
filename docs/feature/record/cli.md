# Record CLI

默认 durable root 是 `<project>/.niceeval/record/`。`--record <root>` 直接指定实际 Record root，不再补接子目录。

local sidecar 从 canonical root 自动映射到 sibling `.niceeval-local/<recordKey>/`。CLI 不提供 `--local-root`。

## 命令与锁

| 命令 | portable Record | maintenance lease | writer lock |
|---|---|---|---|
| `niceeval show` | 读取 current major | shared | 不取得 |
| `niceeval view` | 每轮 rebuild 读取 current major | shared | 不取得 |
| `niceeval exp --dry` | 读取 current major | shared | 不取得 |
| `niceeval exp` | 读取 frozen view，发布新 Run | shared | exclusive |
| `niceeval record recover` | 只完成 sealed Run publish | shared | exclusive |
| `niceeval record abandon` | 不修改 portable Record | shared | exclusive |
| `niceeval migrate` | 原地转换整个 root | exclusive | source-version exclusive |

reader 不取得 writer lock，因此可以和正常 writer 并发。它仍在整个 Scope 内持有 shared maintenance lease。

`niceeval migrate` 与所有 reader、writer 和 recovery 互斥。busy 时 fail fast，并提示关闭 `show`、`view` 或正在写入的命令。

## 所有普通命令只认 current major

`show`、`view`、`exp --dry` 与 `exp` 共用固定 bootstrap open boundary。

已知旧 major 返回：

```text
record-migration-required
This Record uses niceeval.record/v1; this NiceEval reads niceeval.record/v3.
Run: niceeval migrate --record <root>
```

普通命令不会进入兼容读取模式，也不会自动迁移。future 与 foreign format 返回 `record-format-unsupported`。

如果 local migration state 存在，`record-migration-recovery-required` 优先于格式判断。用户再次执行 `niceeval migrate` 收敛现场。

## show 与 view

```text
niceeval show --run <runId> [--run <runId> ...]
niceeval show --latest [--experiment <id> ...]
niceeval view --run <runId> [--run <runId> ...]
niceeval view --latest [--experiment <id> ...]
```

两条命令先由 analysis selection 形成 core-only `AnalysisSample`，再按 ReportPlan 的 binding 读取 Channel projection。

```text
RecordReader + shared maintenance lease
    ↓ analysis selection
AnalysisSample + frozen dependency closure
    ↓ ReportPlan + composition adapter
ReportInput
    ↓ close reader Scope
ReportExecution → terminal / web / static export
```

一个 Channel 的 unavailable、unsupported 或 invalid 只影响请求它的 consumer。Report runtime 不接收 Record path、reader 或延迟磁盘 Stream。

## exp 与 dry run

`niceeval exp` 在模型、Sandbox、外部命令或付费调用前完成 current-format open、storage capability preflight 和 lock acquisition。

write session 的 frozen view 用于 reuse planning。每个完整 Run 分别 seal 和 publish；一次 Invocation 不形成跨 Run 事务。

`niceeval exp --dry` 不创建 Invocation、Run 或 writer session，也不取得 writer lock。它仍打开 current Record，并运行同一 reuse planning。

Record root 不存在时，dry run 可以把历史明确显示为 empty source。Record root 是旧 major 时必须先 migrate，绝不能把旧历史当成 empty。

## 显式迁移

```text
niceeval migrate [--record <root>]
```

命令取得 exclusive maintenance lease，并按相邻版本顺序迁移到当前 major。它保留同一个 `recordId`、RunId、SlotId、AttemptId 与 Channel payload closure。

迁移原地替换 root。CLI 没有 `--out`、`--rollback`、`--keep-backup` 或 legacy-read flag。

运行前，用户应按自己的数据治理要求提交 Git 或创建备份。NiceEval 不自动创建 durable backup，也不保存迁移历史。

迁移不会重算 Assertions、Verdict、Eligibility、Evaluation 或 provenance。无法证明无损时返回 `record-migration-not-lossless`，public root 保持 source format。

进程崩溃或 cleanup 中断后，所有普通命令返回 `record-migration-recovery-required`。再次运行同一命令会根据 exact recovery matrix 完成 cutover 或 cleanup。

current root 上运行 migrate 返回 `record-migration-not-needed`。future 与 foreign format 返回 `record-format-unsupported`。

## Run publish recovery

普通 `exp` 发现遗留 Run session 时返回 `record-recovery-required`，并列出每个 session ID。它不按时间猜测要恢复哪一个。

sealed session 只允许 commit-only recovery：

```text
niceeval record recover --record <root> --session <sessionId> --commit-only
```

building 或用户明确不要的 session 可以 abandon：

```text
niceeval record abandon --record <root> --session <sessionId>
```

`abandon` 只删除精确 local session，不修改 portable Record。未知 session schema 不能自动 resume 或 clean，但允许用户看过诊断后显式 abandon。

## 错误与下一步

| code / state | 含义 | 下一步 |
|---|---|---|
| `record-root-missing` | root 不存在 | 检查项目或 `--record`；只有 `exp` 可以初始化 |
| `record-migration-required` | root 是已知旧 Record major | 运行 `niceeval migrate` |
| `record-migration-recovery-required` | local migration 现场未收敛 | 再次运行 `niceeval migrate` |
| `record-format-unsupported` | future 或 foreign format | 使用能理解该格式的导入工具或正确 NiceEval 版本 |
| `record-migration-not-lossless` | converter 无法证明事实等价 | 保留现场；不要手工删除 local migration state |
| `record-maintenance-busy` | migrate 与 reader/writer 冲突 | 关闭对应进程后重试 |
| `record-writer-busy` | 同一 root 已有 writer | 等写命令结束后重试 |
| `record-recovery-required` | 有遗留 Run publish session | 逐个 recover 或 abandon |
| `record-core-invalid` | bootstrap、Core 或引用损坏 | 按具名 path 与 issue 检查外部修改 |
| `ChannelProjectionResult.unsupported` | 当前 projector 不认识被请求 schema | 升级 consumer；其它 Channel 仍可读 |
| `ChannelProjectionResult.invalid` | envelope、payload、closure 或 projector contract 无效 | 按该 Channel 的 issues 处理 |

## Git、复制与分享

copy、backup、Git checkout 或 merge 前，先停止该 root 的 reader、writer 与 migrate。外部操作完成后重新运行 `show` 或验证入口。

`.niceeval-local/` 必须被忽略。它不随 Record 复制或提交，也不能帮助接收方恢复。

Record 可能包含源码、prompt、conversation、命令和 blob。纳入 Git 前由用户检查敏感信息与仓库体积。

迁移后的回退同样使用 Git 或用户备份恢复整个 root。NiceEval 不提供自己的 rollback history。
