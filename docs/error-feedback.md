# Issue 与用户反馈

NiceEval 将持久事实、Inspection 问题和面向读者的界面分开。这样同一组已发布 Record 事实可以被 `show --json`、runtime View
与 CI 按各自场景消费。

## 三层边界

| 层 | owner | 内容 |
|---|---|---|
| 持久事实 | Record Core 与固定 family | 身份、Member action、Assertion、诊断、采集状态与关联身份。 |
| 读取 | Run Host、Inspection operation | 机器可读的 root error、family read state、selection audit 与 operation issue。 |
| 呈现 | Inspection codec、Show 与 View | machine document、固定 UI 与退出状态。 |

Core 与固定 family 保存稳定 code、phase、detail、context 与必要计数。它们不保存某个页面的措辞、语言、按钮文案或修复命令。
Inspection codec、Show 与 View 把这些稳定事实组合成各自交付；Delivery 不回写 Record。

Inspection result 保留 Planned attempt 的 `not-recorded`、`core-invalid` 或 `excluded`，不会把它们改成空的成功数据。每个具名 operation
把 selection、sealed cutoff、partial、missing、issues 与 Evidence 关闭成 plain-data result。

## Record open 与 family 读取

Run Host 的公开失败由 [Record Library](feature/run/library.md) 定义。
打开存储、创建 Run 与读取 publication 时，常见反馈区分下列情况：

| code | 用户可见含义 | 下一步 |
|---|---|---|
| `record-schema-unsupported` | 存储格式不受当前安装支持。 | 保留精确路径中的原数据；停止使用它的进程后，显式归档或移除该存储，再重跑。程序不自动删除。 |
| `record-write-busy` | 写入或维护操作与其它持有者冲突。 | 等操作结束或关闭对应进程后重试。 |
| `record-resource-limit-exceeded` | 本次打开或读取超过可支持的资源限制。 | 按具名限制调整读取范围，或报告当前安装无法完成的任务。 |
| `active` Run | Run 仍开放，已发布 Attempt 可以读取。 | 原进程结束且无法继续时，使用 `niceeval run recover <run-id> --yes`。 |
| `RecordCoreRead.core-invalid` | 已发布 Run 的 Core、引用或目录互相矛盾。 | 检查该导航结果中的具名 issue。 |

一个已打开 current Record 中，固定 family 的读取者区分 `available`、`not-recorded`、`unsupported`
与 `invalid`。`not-recorded` 表示已封口 owner 没有该 family；`unsupported` 表示当前安装不接受该事实形状；`invalid` 表示
payload、reference 或 closure 无效。它们只影响请求该事实的 Inspection operation，不能扩大成整个 Record 的失败。

格式不符在建立 reader / writer 前拒绝。family reader 只验证当前形状，不提供兼容值或隐式转换。

## 运行错误与诊断

Runner 经 `experimentHost` 调用，并通过 Record owner 把可归属的执行错误和诊断封口到相应的
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
4. 新的不可恢复事实先进入 NiceEval 的固定 family 设计与全局存储格式；不得以通用扩展或隐式转换绕过它。

## 相关阅读

- [Record 架构](feature/run/architecture/README.md)
- [Record Library](feature/run/library.md)
- [Record CLI](feature/run/cli.md)
- [Runner](runner.md)
- [Inspection](feature/inspection/README.md)
- [Insight](feature/insight/README.md)
