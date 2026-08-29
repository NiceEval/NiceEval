# Issue 与用户反馈

NiceEval 将持久事实、Inspection 问题和面向读者的界面分开。这样同一组已发布 Record 事实可以被 machine query、runtime View
与 CI 按各自场景消费。

## 三层边界

| 层 | owner | 内容 |
|---|---|---|
| 持久事实 | Record Core 与五个固定 family | 身份、Member action、Assertion、诊断、采集状态与关联身份。 |
| 读取 | `recordHost`、Inspection operation | 机器可读的 root error、family read state、selection audit 与 operation issue。 |
| 呈现 | query codec 或 View | machine document、固定 UI 与退出状态。 |

Core 与固定 family 保存稳定 code、phase、detail、context 与必要计数。它们不保存某个页面的措辞、语言、按钮文案或修复命令。
query codec 与 View 把这些稳定事实组合成各自交付；Delivery 不回写 Record。

Inspection result 保留 slot 的 `not-recorded`、`core-invalid` 或 `excluded`，不会把它们改成空的成功数据。每个具名 operation
把 selection、sealed cutoff、partial、missing、issues 与 Evidence 关闭成 plain-data result。

## Record open 与 family 读取

`recordHost.openRead()`、创建 Run 与 maintenance 的 typed error 由
[Record Library](feature/run/library.md) 定义。常见 root 级反馈应区分下列情况：

| code | 用户可见含义 | 下一步 |
|---|---|---|
| `record-migration-required` | 已知旧 Record 格式有固定相邻迁移。 | 运行显示的 `niceeval migrate --record <root>`。 |
| `record-format-unsupported` | Record 来自不受支持或已撤销的 baseline。 | 先备份错误中的精确 Record 路径，再显式移除该资源并重跑；程序不自动删除。 |
| `record-maintenance-busy` | migrate 或 clean 与正常读写冲突。 | 关闭占用进程后重试。 |
| `record-migration-plan-invalid` | source、target 或 preflight 不满足迁移条件。 | 按列出的具名 issue 修复；不会写磁盘。 |
| `record-migration-interrupted` | 上次迁移未形成可验证的 current 状态。 | 按 preflight 显示的 source identity 重试；无法重试时从自己的备份恢复。 |
| `incomplete-run` | Run 没有完成标识。 | 它不是 Record 事实；运行 `niceeval clean` 删除。 |
| `RecordCoreRead.core-invalid` | 已发布 Run 的 Core、引用或目录互相矛盾。 | 检查该导航结果中的具名 issue。 |

一个已打开 current Record 中，固定 family 的读取者穷尽 `available`、`not-recorded`、`migration-required`、`unsupported`
与 `invalid`。`not-recorded` 表示已封口 owner 没有该 family；`unsupported` 表示 revision 不受当前版本支持；`invalid` 表示
payload、reference 或 closure 无效。它们只影响请求该事实的 Inspection operation，不能扩大成整个 Record 的失败。

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

argv、配置、模块装载和 selector 错误发生在 Invocation 之前。CLI 以 `error:` 说明实际失败，并以非零状态结束；
此时没有 receipt，也没有需要写入的 Record 事实。只有有限且确定的命令语法错误才附 `usage:`，有对应公开说明时
可以附 `docs:`；不得为 Provider、凭据、网络或宿主运行条件错误枚举或猜测 `fix:`。

已经建立 Invocation 后，当前进程可以显示 progress 和诊断。该反馈不形成持久化协议；长期查看
必须经固定 Inspection operation 读取已经发布的 Run。

## 新增 code 的义务

1. 在 Core、一个既有固定 family 或 Inspection operation 的真正 owner 定义稳定 code 和最小结构化字段。
2. 写清它是 root open error、Run/Attempt 事实、Inspection issue 还是 Delivery problem。
3. 让 Inspection result 保留机器可读问题，让 CLI 或第一方 View 负责面向读者的措辞。
4. 新的不可恢复事实先进入 NiceEval 的固定 family 设计与版本治理；不得以通用扩展或自定义 migration 绕过它。

## 相关阅读

- [Record 架构](feature/run/architecture.md)
- [Record Library](feature/run/library.md)
- [Record CLI](feature/run/cli.md)
- [Runner](runner.md)
- [Inspection](feature/inspection/README.md)
- [Insight](feature/insight/README.md)
