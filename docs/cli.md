# CLI —— 内部架构

`niceeval` 把命令输入分到运行、读取与恢复三条路径。面向用户的命令和选项由各 Feature 的 CLI 页定义；本页只定义入口模块的责任边界。

- [Experiments CLI](feature/experiments/cli.md) 定义 `exp`、`accept`、机器反馈和 Invocation receipt。
- [Record CLI](feature/record/cli.md) 定义 Record root、只读命令与具名 session recovery。
- [Reports CLI](feature/reports/README.md) 定义 `show`、`view` 与静态 export 的输入和输出。

## 模块边界

| 区域 | 职责 |
|---|---|
| `src/cli.ts` | argv、命令分派、信号与退出状态。 |
| `runner/` | 发现、调度、Sandbox 生命周期和 Invocation receipt。 |
| `record/` | writer、reader、通道读取与数据规范化。 |
| `sample/` | Run 选择、分母和 slot 状态。 |
| `report/` | ReportInput、Calculation 和渲染。 |
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
  ↓ seal whole Run
no-replace atomic publish
  ↓
InvocationReceipt
~~~

`exp` 为每个选中的 Experiment 建立 Run 和 expected slots。Runner 把 Attempt 的业务数据写到 owner-local channels，并以 `executed`、`carried` 或 `accepted` Member 采用 Attempt。完整 Run 在 local session seal 后一次发布；命令完成时只返回 `InvocationReceipt`，Verdict、用量、耗时和详情由调用方按 receipt 的 `runIds` 从已发布 Record 读取。

### 查看与导出

~~~text
RecordReader
  ↓
normalizer
  ↓
AnalysisSample
  ↓
ReportInput
  ↓
show / view / static export
~~~

`show` 与 `view` 使用 lock-free frozen `RecordReader`，可以和 writer 并发。它们先运行具名 analysis projector，再由 reader 和 composition adapter 形成 `AnalysisSample` 与 ReportInput。Reports 从不打开 Record 路径，也不自行读取目录或通道字节。

`--run` 与 `--latest` 分别映射到 `explicit-runs/v1` 与 `latest/v1` analysis projector。CLI 不从目录名、时间或显示文本猜测对象。`view --out` 写出自包含站点；浏览器只读取站点自己的文件。

### 恢复

`niceeval record recover --record <root> --session <sessionId> --commit-only` 只完成已经 seal 的 Run publish 与 local cleanup。`niceeval record abandon --record <root> --session <sessionId>` 只删除这个具名 local session。

两者都取得 writer lock。Record 没有按 orphan 猜测的 clean、局部 edit 或 delete 命令。

## 输出与反馈

一次 Invocation 的 TTY 面板、NDJSON progress 和诊断只服务当前进程。它们可替换、合并或丢弃，不能成为 Record 的持久化协议。

持久化的业务事实由 Runner 分别写入 Run 或 Attempt channel。终端与 `--json` 可以显示这些事实的当前摘要，但不得从反馈文本反向形成 Record 数据。

`exp --json` 的最后一条机器输出是 receipt。调用方以进程退出状态和该 receipt 判断调用是否结束，再以 `runIds` 读取业务数据。

## 运行时与中断

调度与 Record I/O 使用 Effect 管理有界并发、资源、typed error 与中断；纯选择和状态折叠仍保持普通值。reader、writer lock、文件与流由 Scope 持有，内部调用链不自行启动 Effect runtime。

收到 `SIGINT` 或 `SIGTERM` 后，CLI 请求 Runner 中断。Runner 完成能够完成的收尾，保留已经发布的完整 Run；未 seal 的 owner temp 可由当前 Scope 删除，已 seal 或 publish outcome 未确认的现场保留给 recovery。命令返回 `completion: "interrupted"` 的 receipt；用户中断不是新的 Attempt 业务事实。

argv、配置或 selector 无法建立 Invocation 时，CLI 输出 `error:` 和 `fix:`，以非零状态结束；此时没有 receipt。

## 退出码

退出码结合本次 Invocation completion 与已知 Verdict 计算。业务判定来自本次运行已经发布的 Record 数据，不能由终端颜色、进度行或一个宽摘要代替。

有关 budget、首过即停、失败停止派发和细分错误的规则，见 [Runner](runner.md) 与 [执行失败分类](feature/error-classification/README.md)。

## 相关阅读

- [Runner](runner.md)
- [Record](feature/record/README.md)
- [Sample](feature/sample/README.md)
- [Reports](feature/reports/README.md)
