# Issue 与用户反馈

NiceEval 将持久业务事实、读取问题和面向读者的文字分开。这样同一组已发布 Record 事实可以被终端、网页、CI 和自有产品按各自场景呈现。

## 三层边界

| 层 | owner | 内容 |
|---|---|---|
| 写入 | Run 或 Attempt channel | 结构化 diagnostic、执行错误、事实采集状态与关联身份。 |
| 读取 | Record reader 或 Sample | 机器可读的 issue、通道状态和选择状态。 |
| 呈现 | CLI 或 Reports | 人读标题、说明、下一步和退出状态。 |

channel 数据保存稳定 code、phase、detail、context 与必要的计数。它不保存某个页面的措辞、语言、按钮文案或修复命令。

reader 根据核心文件、descriptor、通道文件和请求生成 issue。Sample 保留 slot 的 `not-recorded`、`invalid` 或 `excluded`，不会把它们改成空的成功数据。

CLI 和 Reports 将 code、issue 与当前动作组合成 Notice。Notice 可以包含下一步，但不能回写 Record。

## Record 错误

[Record Library](feature/record/library.md) 定义稳定的 typed error。常见反馈应区分下列情况：

| code | 用户可见含义 | 下一步 |
|---|---|---|
| `record-root-missing` | 指定的 Record root 不存在。 | 检查项目路径或 `--record`。 |
| `record-writer-busy` | 同一 root 已有 writer 或 recovery 持有 OS lock；reader 不受影响。 | 等写命令结束，或指定其它 Record root。 |
| `record-recovery-required` | lock 已空闲，但存在遗留 local session。 | 对列出的 session 逐项 commit-only recover 或 explicit abandon。 |
| `record-format-unsupported` | 根文件的完整格式 ID 不被 reader 支持。 | 指向正确 root，或使用支持该格式的 reader。 |
| `record-core-invalid` | 根级 `record.json` 或根级保留布局无效。 | 修复根文件和具名 root issue。 |
| `record-storage-capability-unsupported` | 文件系统缺少 lock、no-follow、fsync 或 no-replace rename。 | 在任何昂贵工作前失败；换到满足契约的本地文件系统。 |
| `CoreRead.invalid` | 某个 Run、Member 或 Attempt 的核心 identity、目录或引用相互矛盾。 | 修复该导航结果中的具名文件和 issue。 |
| `ChannelRead.invalid` | 当前页面需要的 channel 无效。 | 按其中的 issue 修复 descriptor 或 channel 文件。 |

未知或已退役 channel 显示为 `unsupported`；业务上未采集或不适用显示为 `unavailable`。二者都不同于损坏输入。

## 运行错误与诊断

Runner 将可归属的执行错误和诊断写入相应 Run 或 Attempt channel。每项使用稳定 code，并包含产生处实际知道的 phase、detail 和上下文。

非 optional Assertion 依赖的 channel 无法交付时，Assertion 形成 `unavailable`，Verdict 因而可形成 `errored`。只供报告使用的失败保持为局部诊断，不得修改已形成的 Assertion 或 Verdict。

Run 范围的 setup、teardown、共享准备和停止派发问题属于 Run channel，不能伪装成某个 Attempt 的错误。

## 即时 CLI 错误

argv、配置、模块装载和 selector 错误发生在 Invocation 之前。CLI 以 `error:` 说明失败，以 `fix:` 给出下一步，并以非零状态结束；此时没有 receipt，也没有需要写入的 Record 通道。

已经建立 Invocation 后，当前进程可以显示 progress 和诊断。该反馈不形成持久化协议；长期查看必须读取已经发布的 Run。

## 新增 code 的义务

1. 在事实 owner 定义稳定 code 和最小结构化字段。
2. 写清该字段属于 Run 还是 Attempt channel。
3. 让 reader 保留机器可读 issue，让 CLI 或 Reports 负责面向读者的措辞。
4. 对请求的 invalid、unavailable 和 unsupported 分别定义可见行为。

## 相关阅读

- [Record 架构](feature/record/architecture.md)
- [Record Library](feature/record/library.md)
- [Runner](runner.md)
- [Reports 架构](feature/reports/README.md)
