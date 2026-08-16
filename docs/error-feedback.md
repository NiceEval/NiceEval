# Issue 与用户反馈

NiceEval 将持久事实、读取问题和面向读者的文字分开。这样同一组已发布 Record 事实可以被终端、
网页、CI 和自有产品按各自场景呈现。

## 三层边界

| 层 | owner | 内容 |
|---|---|---|
| 持久事实 | Record Core 与五个固定 family | 身份、Member action、Assertion、诊断、采集状态与关联身份。 |
| 读取 | `recordHost`、Analysis Sample | 机器可读的 root error、family read state、selection state 与 Analysis issue。 |
| 呈现 | CLI 或 Report Host | 人读标题、说明、下一步和退出状态。 |

Core 与固定 family 保存稳定 code、phase、detail、context 与必要计数。它们不保存某个页面的措辞、
语言、按钮文案或修复命令。CLI 和 Report 把这些稳定事实与当前动作组合成 Notice；Notice 不回写
Record。

Sample 保留 slot 的 `not-recorded`、`core-invalid` 或 `excluded`，不会把它们改成空的成功数据。
`aggregate()` 与 `query()` 再将问题闭合到 `ClosedRows`、`SemanticFrame` 或 `DomainView`。

## Record open 与 family 读取

`recordHost.openRead()`、创建 Run 与 maintenance 的 typed error 由
[Record Library](feature/record/library.md) 定义。常见 root 级反馈应区分下列情况：

| code | 用户可见含义 | 下一步 |
|---|---|---|
| `record-migration-required` | 已知旧 Record 格式有固定相邻迁移。 | 运行显示的 `niceeval migrate --record <root>`。 |
| `record-format-unsupported` | root 的完整格式 ID 是 future 或 foreign。 | 安装支持该格式的 NiceEval。 |
| `record-maintenance-busy` | migrate 或 clean 与正常读写冲突。 | 关闭占用进程后重试。 |
| `record-migration-plan-invalid` | source、target 或 preflight 不满足迁移条件。 | 按列出的具名 issue 修复；不会写磁盘。 |
| `record-migration-interrupted` | 上次迁移留下混合状态。 | 从 preflight 显示的 Git commit 或自己的备份恢复。 |
| `incomplete-run` | Run 没有完成标识。 | 它不是 Record 事实；运行 `niceeval clean` 删除。 |
| `RecordCoreRead.core-invalid` | 已发布 Run 的 Core、引用或目录互相矛盾。 | 检查该导航结果中的具名 issue。 |

一个已打开 current Record 中，固定 family 的读取者只穷尽四态：`available`、`not-recorded`、
`unsupported`、`invalid`。`not-recorded` 表示已封口 owner 没有该 family；`unsupported` 表示 schema
不受当前版本支持；`invalid` 表示 envelope、payload、ref 或 closure 无效。它们只影响请求该事实的
Analysis 查询，不能扩大成整个 Record 的失败。

迁移不是 family state。只有打开旧 root 时的 `record-migration-required` 才给出 migrate 引导；
family reader 不提供兼容值、隐式 converter 或可保留的旧值替代品。

## 运行错误与诊断

Runner 经 `experimentHost` 调用，并通过 `recordHost` 把可归属的执行错误和诊断封口到相应的
Core 或固定 family owner。每项使用稳定 code，并包含产生处实际知道的 phase、detail 和上下文。

非 optional Assertion 依赖的事实无法交付时，Assertion 形成 `unavailable`，Verdict 因而可形成
`errored`。只供报告使用的读取问题保持局部，不能修改已形成的 Assertion、Verdict 或 Score。
Member action 说明 reuse 或 adoption；它不是另一份 provenance family。

Run 范围的 setup、teardown、共享准备和停止派发问题属于 Run-owned 事实，不能伪装成某个
Attempt 的错误。

## 即时 CLI 错误

argv、配置、模块装载和 selector 错误发生在 Invocation 之前。CLI 以 `error:` 说明失败，以 `fix:`
给出下一步，并以非零状态结束；此时没有 receipt，也没有需要写入的 Record 事实。

已经建立 Invocation 后，当前进程可以显示 progress 和诊断。该反馈不形成持久化协议；长期查看
必须经 `reportHost` 读取已经发布的 Run。

## 新增 code 的义务

1. 在 Core、一个既有固定 family、Analysis 或 Report 的真正 owner 定义稳定 code 和最小结构化字段。
2. 写清它是 root open error、Run/Attempt 事实、Analysis issue 还是 Report execution problem。
3. 让 Analysis 保留机器可读问题，让 CLI 或 Report 负责面向读者的措辞。
4. 新的不可恢复事实先进入 NiceEval 的固定 family 设计与版本治理；不得以通用扩展或自定义 migration 绕过它。

## 相关阅读

- [Record 架构](feature/record/architecture.md)
- [Record Library](feature/record/library.md)
- [Record CLI](feature/record/cli.md)
- [Runner](runner.md)
- [Analysis](feature/analysis/README.md)
- [Reports](feature/reports/README.md)
