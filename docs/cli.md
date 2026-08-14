# CLI —— 内部架构

`niceeval` 把命令输入分到运行、读取与恢复三条路径。面向用户的命令和选项由各 Feature 的 CLI 页定义；本页只定义入口模块的责任边界。

- [Experiments CLI](feature/experiments/cli.md) 定义 `exp`、`accept`、机器反馈和 Invocation receipt。
- [Record CLI](feature/record/cli.md) 定义 Record root、只读命令、clean 与 migrate。
- [Reports CLI](feature/reports/README.md) 定义 `show`、`view` 与静态 export 的输入和输出。

## 模块边界

| 区域 | 职责 |
|---|---|
| `src/cli.ts` | argv、命令分派、信号与退出状态。 |
| `runner/` | 发现、调度、Sandbox 生命周期和 Invocation receipt。 |
| `record/` | writer、reader、RecordAttachment 读取与数据规范化。 |
| `sample/` | Run 选择、分母和 slot 状态。 |
| `report/` | ReportExecution、Calculation 和渲染。 |
| `show/`、`view/` | 终端、本机网页和静态 export 宿主。 |

`src/cli.ts` 只做 argv 读取、工作目录确定、命令分派、进程信号接线和退出码交付。它不定义 Record 文件语义，不计算报告读数，也不把终端文本当作业务事实。

## 三条数据路径

### 运行

~~~text
argv
  ↓
Experiment discovery and scheduling
  ↓
RecordWriteSession
  ↓ validate + flush
complete marker
  ↓
InvocationReceipt
~~~

`exp` 为每个选中的 Experiment 建立 Run 和 expected slots。Runner 把 Attempt 的业务事实写到 owner-local RecordAttachment，并用 Member 把 slot 连接到精确 Attempt。

reuse 与 explicit adoption 形成 reference Member，实际执行形成 origin Attempt。采用原因写入 `niceeval.membership-provenance`。

Run 全部内容 flush 后，writer 最后创建零字节 `complete` 完成标识。命令只返回 `InvocationReceipt`；调用方按 receipt 的 `runIds` 从已发布 Record 读取 Verdict、用量、耗时和详情。

### 查看与导出

~~~text
opaque Record
  ↓
analysis selection
  ↓
AnalysisSample
  ↓ Report declarations
ReportExecution
  ↓
show / view / static export
~~~

`show` 与 `view` 的内部 host 使用持有 shared maintenance lease 的 frozen reader，可以和 writer 并发。它先由 analysis selection 形成纯 `AnalysisSample`，再按 Report 声明闭合数据依赖，形成一次 immutable `ReportExecution`。reader 与 selection handle 不从包导出。

Reports runtime 从不打开 Record path，也不自行读取 Attachment bytes。

`--run` 映射到 `explicit-runs` analysis selection。不带 locator 或 `--run` 的 `show` / `view` 使用 `project-current`，从默认 Record 的全部 Run 中保留身份仍匹配当前项目的结果。CLI 不按目录名、时间或显示文本猜测对象，也不改写历史 Run。`view --out` 写出自包含站点；浏览器只读取站点自己的文件。

### 恢复

受控 `SIGINT` / `SIGTERM` 会先停止派发并收尾。Runner 删除尚未完成的 provisional Attempt 后，可以发布一个带完整 expected-slot 分母的 Run：已完成 slot 保留 Member，未完成 slot 显示为 `not-recorded` / `interrupted`。强杀、writer failure 或 rollback failure 仍会留下未发布目录；reader 忽略它并给出 `incomplete-run` warning，用户用 `niceeval clean` 删除。

`niceeval migrate --record <root>` 取得 exclusive maintenance lease，并把已知可迁移的 source major 原地转换到 current major。普通命令遇到 source major 时只返回 `record-migration-required`。

迁移没有 compat read、output root 或 rollback command。Git 与用户备份负责回退。

## 输出与反馈

一次 Invocation 的 TTY 面板、NDJSON progress 和诊断只服务当前进程。它们可替换、合并或丢弃，不能成为 Record 的持久化协议。

持久化的业务事实由 Runner 分别写入 Run 或 Attempt RecordAttachment。终端与 `--json` 可以显示这些事实的当前摘要，但不得从反馈文本反向形成 Record 数据。

`exp --json` 的最后一条机器输出是 receipt。调用方以进程退出状态和该 receipt 判断调用是否结束，再用 `show --json` 与 `runIds` 读取业务数据。

## 运行时与中断

调度与 Record I/O 使用 Effect 管理有界并发、资源、typed error 与中断；纯选择和状态折叠仍保持普通值。reader、writer lock、文件与流由 Scope 持有，内部调用链不自行启动 Effect runtime。

收到 `SIGINT` 或 `SIGTERM` 后，CLI 请求 Runner 中断。Runner 完成能够完成的收尾，并在 rollback 成功时发布已完成事实与 `interrupted` 缺口。命令返回 `completion: "interrupted"` 的 receipt；用户中断不是新的 Attempt 或 Verdict。更早的 writer failure 优先于随后 cleanup failure，任一写入或 rollback failure 都不会发布 Run。

argv、配置或 selector 无法建立 Invocation 时，CLI 输出 `error:` 和 `fix:`，以非零状态结束；此时没有 receipt。

## 退出码

退出码结合本次 Invocation completion 与已知 Verdict 计算。业务判定来自本次运行已经发布的 Record 数据，不能由终端颜色、进度行或一个宽摘要代替。

`niceeval exp` 只有一份有优先级的退出码契约，Roadmap 功能不得为自己的 failure 另占状态码：

| 优先级 | 退出码 | 条件 |
|---:|---:|---|
| 1 | `130` | 收到中断信号；受控收尾可以交付 receipt，但不把中断改写为其它结果。 |
| 2 | `2` | 未捕获异常或 rejection 使 CLI 无法按受控路径结算。 |
| 3 | `1` | argv、配置或 selector 未能建立 Invocation；或 Invocation incomplete、required reporter 失败、存在 `failed` / `errored` Verdict 或其它受控执行失败。 |
| 4 | `0` | Invocation 完整结算，required reporter 成功，且没有 `failed` / `errored` Verdict。 |

同一调用命中多项时取表中更高优先级。功能自己的 receipt、diagnostic 与 typed failure 保存细分原因；退出码不复制第二套领域分类。

有关 budget、首过即停、失败停止派发和细分错误的规则，见 [Runner](runner.md) 与 [执行失败分类](feature/error-classification/README.md)。

## 相关阅读

- [Runner](runner.md)
- [Record](feature/record/README.md)
- [Sample](feature/sample/README.md)
- [Reports](feature/reports/README.md)
