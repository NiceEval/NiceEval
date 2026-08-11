# Record CLI

默认 durable Record root 是 `<project>/.niceeval/record/`。传入 `--record <root>` 时，该参数就是实际 Record root；CLI 不补接子目录。local sidecar 按 canonical root 自动映射到 sibling `.niceeval-local/<recordKey>/`，没有单独的 `--local-root`。

## 命令访问矩阵

| 命令 | durable Record | local cache | writer session / lock |
|---|---|---|---|
| `niceeval show` | 只读 | 可 best-effort 读写 | 不创建 / 不取得 |
| `niceeval view` | 每轮 rebuild 只读 | 可 best-effort 读写 | 不创建 / 不取得 |
| `niceeval exp --dry` | 只读 | 可 best-effort 读写 | 不创建 / 不取得 |
| `niceeval exp` | 读取 frozen view，发布新 Run | 允许 | 创建 / 独占 writer lock |
| `niceeval record recover` | 仅 commit-only publish 或零修改 | 不依赖 | 独占 writer lock |
| `niceeval record abandon` | 不修改 | 删除一个具名 session | 独占 writer lock |

“只读”指不写 durable Record，也不创建可恢复 session。cache 写失败、竞争或权限不足不能让前三条命令失败，也不能改变输出。它们可以和 `niceeval exp` 并发。

同一 root 同时最多一条写命令。第二个 `exp`、`recover` 或 `abandon` 以 `record-writer-busy` 失败；它不等待、不接管，也不读取另一个 writer 的 build 目录。

## show 与 view

`show` 和 `view` 只通过具名 analysis projector 形成 `AnalysisSample`，不接受绕开已选 Run 的独立 Attempt selector。

```text
niceeval show --run <runId> [--run <runId> ...]
niceeval show --latest [--experiment <id> ...]
niceeval view --run <runId> [--run <runId> ...]
niceeval view --latest [--experiment <id> ...]
```

`--run` 映射到 `explicit-runs/v1`，`--latest` 映射到 `latest/v1`。完整排序、malformed candidate 与错误规则由 [Sample Library](../sample/library.md#分析投影器) 定义；CLI 不维护第二份选择算法。

一次调用的数据路径固定为：

```text
RecordReader(frozen candidateSet)
    ↓
AnalysisSample + frozen dependencyClosure → ReportPlan
    ↓
composition adapter → ReportInput
    ↓ dispose reader
ReportExecution → terminal / web
```

Attempt detail 只能由已选 `AnalysisSample` 的 Member 建立，例如 `--run <runId> --page attempt-<attemptId>`。carried/accepted Attempt 的 origin 由受限 dependency closure 读取；origin 不加入 latest candidates 或 Sample 分母。

`show` 一次打开一个 reader。`view` 每次配置或页面数据 rebuild 都先 dispose 上一轮 execution、ReportInput 与 reader，再打开新的 frozen view；单轮渲染不随并发 publish 改变。weak scan 可能漏掉刚发布的 Run，下一轮 rebuild 才可能看见。

页面请求到 unavailable 或 unsupported fact 时显示对应状态。请求到 invalid 时只让相关页面失败并列出 issue；未请求的未知 schema 不阻止其它页面。Report runtime 不打开 Record 路径。

## exp 与 dry run

`niceeval exp` 在任何模型、Sandbox、外部命令或付费调用前完成 Record storage capability preflight，并取得 writer lock。随后创建一个 `RecordWriteSession`，以它的 frozen `view` 运行 execution projector，在 local session 形成完整 Run，最后逐 Run seal 和发布。

一次 Invocation 的多个 Run 分别原子发布，不构成一个事务。读者可以只看见其中一部分，但不会看见半个 Run。命令结束时返回 `InvocationReceipt`；详情仍由 `show` 或 `view` 按 `runIds` 读取。

`niceeval exp --dry` 不建立 Invocation、不创建 Record、不取得 writer lock，也不做昂贵工作。Record 已存在时，它用同一个 projector 的只读路径显示 policy、effective options、reuse 与 gap。Record 不存在时，它把历史视为显式的 empty source，并说明正式 `exp` 将初始化 root；它不能为了预览先创建 `.niceeval/record/` 或 sidecar session。

## Crash recovery

普通 `exp` 发现一个或多个遗留 session 时返回 `record-recovery-required`，逐项列出 session ID 与可安全识别的状态；它不按时间选择“最新”现场。

sealed session 只允许 commit-only recovery：

```text
niceeval record recover --record <root> --session <sessionId> --commit-only
```

命令按 [recovery crash matrix](architecture.md#recovery-manifest-与-crash-matrix) 重新校验 source、destination 与完整 manifest。它只完成原先已经 sealed 的 directory rename、fsync、destination revalidation 和 local cleanup，不恢复模型、Sandbox、外部命令或 projector。

building-only、损坏、未知 future schema 或用户不再需要的 session 可以显式 abandon：

```text
niceeval record abandon --record <root> --session <sessionId>
```

`abandon` 只删除精确 session ID 的 no-follow local directory，永不修改 durable Record。未知 session schema 不能自动 resume 或 clean，但允许用户在看到诊断后显式 abandon。多个遗留 session 必须逐个处理。

destination 已 durable、local cleanup 未完成时，recover 明确显示 `durable: true` 与 `localCleanup: pending`。后续 writer 继续失败，直到再次 recover 删除 local 现场或用户 abandon 该现场；不能把 cleanup 失败说成 Run 未提交。

Record 没有 `record edit`、`record delete` 或按 orphan 猜测的 `clean` 命令。已发布 Run immutable；local recovery 只使用上面两个具名 session 命令。

## 反馈与下一步

| code / state | 含义 | 下一步 |
|---|---|---|
| `record-root-missing` | `show` / `view` 的 root 不存在 | 检查项目或 `--record` |
| `record-format-unsupported` | 根文件不是 reader 支持的完整格式 ID | 指向正确 root 或使用支持该格式的 reader |
| `record-core-invalid` | root、Run 或核心引用无效 | 按具名 path 与 issue 修复外部损坏 |
| `record-writer-busy` | 同一 root 已有 writer | 等该写命令结束；reader 仍可并发 |
| `record-recovery-required` | lock 已释放但有遗留 session | 逐个 `recover --commit-only` 或 `abandon` |
| `record-session-schema-unsupported` | local session 来自未来/未知格式 | 检查后只可显式 `abandon` |
| `record-storage-capability-unsupported` | 文件系统缺少发布所需原语 | 换用支持 lock、fsync 与 no-replace rename 的本地文件系统 |
| `record-publish-ambiguous` | source 与 destination 同时存在 | 保留现场，不认作成功 |
| `record-publish-outcome-unknown` | source 与 destination 都不存在 | 保留诊断，不认作成功 |
| `record-publish-invalid` | 任一现存目录不匹配 manifest | 保留全部现场，检查损坏或碰撞 |
| `sample-latest-indeterminate` | malformed candidate 让 latest 无法穷尽 | 修复具名 entry 或显式选择 |
| `ChannelRead.unsupported` | reader 不认识被请求 schema | 升级 reader；其它 facts 仍可读 |
| `ChannelRead.invalid` | descriptor/payload/blob 损坏 | 按 channel issue 处理 |

## Copy、Git 与分享

durable portable boundary 是整个 Record root。执行 `cp`、backup、Git checkout 或 merge 前，先停止该 root 的 writer、reader 与外部编辑；普通文件复制不是运行中原子快照。操作后重新运行 `show` 或专用验证入口，不能从 Git 冲突解决结果推断引用仍有效。

`.niceeval-local/` 必须忽略，不随 root 复制或提交。整个 Record 纳入 Git 时先检查 conversation、sources、commands、diff 与 blobs 是否含敏感信息，并评估历史体积和 binary blobs。只分享选定页面或读数时使用自包含静态 Report，不复制局部 Run/channel 伪装成 Record。
