# Issue 与用户反馈

NiceEval 将持久业务事实、读取问题和面向读者的文字分开。这样同一组已发布 Record 事实可以被终端、网页、CI 和自有产品按各自场景呈现。

## 三层边界

| 层 | owner | 内容 |
|---|---|---|
| 写入 | Run 或 Attempt RecordAttachment | 结构化 diagnostic、执行错误、事实采集状态与关联身份。 |
| 读取 | Record reader 或 Sample | 机器可读的 issue、RecordAttachment 状态和选择状态。 |
| 呈现 | CLI 或 Reports | 人读标题、说明、下一步和退出状态。 |

RecordAttachment 数据保存稳定 code、phase、detail、context 与必要的计数。它不保存某个页面的措辞、语言、按钮文案或修复命令。

reader 根据 Core、envelope、payload 与请求生成 issue。Sample 保留 slot 的 `not-recorded`、`core-invalid` 或 `excluded`，不会把它们改成空的成功数据。

CLI 和 Reports 将 code、issue 与当前动作组合成 Notice。Notice 可以包含下一步，但不能回写 Record。

## Record 错误

[Record Library](feature/record/library.md) 与 [Record CLI](feature/record/cli.md) 定义稳定的 typed error 与状态。常见反馈应区分下列情况：

| code/state | 用户可见含义 | 下一步 |
|---|---|---|
| `record-migration-required` | Core 是已知旧 major。 | 运行 `niceeval migrate --record <root>`。 |
| `record-format-unsupported` | root 的完整格式 ID 是 future 或 foreign。 | 安装支持该格式的 NiceEval。 |
| `record-writer-busy` | 同一 root 已有 writer 或 clean 持有 writer lock；reader 不受影响。 | 等写命令结束，或指定其它 Record root。 |
| `record-maintenance-busy` | migrate 与 reader/writer/clean 冲突。 | 关闭占用进程后重试。 |
| `record-migration-plan-invalid` | converter 链、source 或 target 的 preflight 失败。 | 按列出的具名 issue 修复；不会写磁盘。 |
| `record-migration-interrupted` | 上次 migration 留下混合状态。 | 从 preflight 显示的 Git commit 或自己的备份恢复。 |
| `record-clean-confirmation-required` | clean 需要用户确认。 | 检查列表后确认，或传 `--yes`。 |
| `incomplete-run` | Run 目录没有完成标识。 | 它不是 Record 事实；运行 `niceeval clean` 删除。 |
| `RecordCoreRead.core-invalid` | 已发布 Run 的 Core、引用或目录互相矛盾。 | 修复该导航结果中的具名文件和 issue。 |
| `RecordAttachmentRead.invalid` | Attachment envelope、payload 或 closure 无效。 | 检查该 Attachment；其它数据继续可用。 |

未请求或未安装的 RecordAttachment 显示为 `unsupported`；业务上未采集显示为 `unavailable`；已知旧 schema 有完整 converter 链时是 `migration-required`，路径命中不可无损迁移边时是 `migration-unavailable`。后者保留旧 bytes，是可保留、不可迁移状态，不能伪装成 current value。

## 运行错误与诊断

Runner 将可归属的执行错误和诊断写入相应 Run 或 Attempt RecordAttachment。每项使用稳定 code，并包含产生处实际知道的 phase、detail 和上下文。

非 optional Assertion 依赖的 RecordAttachment 无法交付时，Assertion 形成 `unavailable`，Verdict 因而可形成 `errored`。只供报告使用的失败保持为局部诊断，不得修改已形成的 Assertion 或 Verdict。

Run 范围的 setup、teardown、共享准备和停止派发问题属于 Run-owned RecordAttachment，不能伪装成某个 Attempt 的错误。

## 即时 CLI 错误

argv、配置、模块装载和 selector 错误发生在 Invocation 之前。CLI 以 `error:` 说明失败，以 `fix:` 给出下一步，并以非零状态结束；此时没有 receipt，也没有需要写入的 Record Attachment。

已经建立 Invocation 后，当前进程可以显示 progress 和诊断。该反馈不形成持久化协议；长期查看必须读取已经发布的 Run。

## 新增 code 的义务

1. 在事实 owner 定义稳定 code 和最小结构化字段。
2. 写清该字段属于 Run 还是 Attempt RecordAttachment。
3. 让 reader 保留机器可读 issue，让 CLI 或 Reports 负责面向读者的措辞。
4. 对请求的 invalid、unavailable、migration-required、migration-unavailable 和 unsupported 分别定义可见行为。

## 相关阅读

- [Record 架构](feature/record/architecture.md)
- [Record Library](feature/record/library.md)
- [Record CLI](feature/record/cli.md)
- [Runner](runner.md)
- [Reports 架构](feature/reports/README.md)
