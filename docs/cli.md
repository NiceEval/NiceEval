# CLI —— 内部架构

<code>niceeval</code> 把命令输入分到运行、读取与维护三条路径。面向用户的命令和选项由各 Feature 的 CLI 页定义；本页只定义入口模块的责任边界。

- [Experiments CLI](feature/experiments/cli.md) 定义 <code>exp</code>、<code>accept</code>、机器反馈和 Invocation receipt。
- [Record CLI](feature/record/cli.md) 定义 Record root、<code>show</code>、<code>view</code> 与 <code>clean</code>。
- [Reports CLI](feature/reports/README.md) 定义 <code>show</code>、<code>view</code> 与静态 export 的输入和输出。

## 模块边界

| 区域 | 职责 |
|---|---|
| <code>src/cli.ts</code> | argv、命令分派、信号与退出状态。 |
| <code>runner/</code> | 发现、调度、Sandbox 生命周期和 Invocation receipt。 |
| <code>record/</code> | writer、reader、通道读取与数据规范化。 |
| <code>sample/</code> | Run 选择、分母和 slot 状态。 |
| <code>report/</code> | ReportInput、Calculation 和渲染。 |
| <code>show/</code>、<code>view/</code> | 终端、本机网页和静态 export 宿主。 |

<code>src/cli.ts</code> 只做 argv 读取、工作目录确定、命令分派、进程信号接线和退出码交付。它不定义 Record 文件语义，不计算报告读数，也不把终端文本当作业务事实。

## 三条数据路径

### 运行

~~~text
argv
  ↓
Experiment discovery and scheduling
  ↓
RecordWriter
  ↓
InvocationReceipt
~~~

<code>exp</code> 为每个选中的 Experiment 建立 Run 和 expected slots。Runner 把 Attempt 的业务数据写到 owner-local channels，并以 <code>executed</code>、<code>carried</code> 或 <code>accepted</code> Member 采用 Attempt。命令完成时只返回 <code>InvocationReceipt</code>；Verdict、用量、耗时和详情由调用方按 receipt 的 <code>runIds</code> 从停稳 Record 读取。

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

<code>show</code> 与 <code>view</code> 只面对停稳的 Record root。它们先运行具名 analysis projector，再由 reader 和 normalizer 形成 `AnalysisSample` 与 ReportInput。Reports 从不打开 Record 路径，也不自行读取目录或通道字节。

<code>--run</code> 与 <code>--latest</code> 分别映射到 `explicit-runs/v1` 与 `latest/v1` analysis projector。CLI 不从目录名、时间或显示文本猜测对象。<code>view --out</code> 写出自包含站点；浏览器只读取站点自己的文件。

### 维护

<code>clean --record &lt;root&gt; --writer &lt;writerId&gt;</code> 只删除已经确认属于该 writer 的 orphan 临时目录。它不删除正式 Run 或 Attempt，也不替其它 writer 收尾。

## 输出与反馈

一次 Invocation 的 TTY 面板、NDJSON progress 和诊断只服务当前进程。它们可替换、合并或丢弃，不能成为 Record 的持久化协议。

持久化的业务事实由 Runner 分别写入 Run 或 Attempt channel。终端与 <code>--json</code> 可以显示这些事实的当前摘要，但不得从反馈文本反向形成 Record 数据。

<code>exp --json</code> 的最后一条机器输出是 receipt。调用方以进程退出状态和该 receipt 判断调用是否结束，再以 <code>runIds</code> 读取业务数据。

## 运行时与中断

调度路径使用 Effect 管理有界并发、Sandbox 释放与中断。读取、选择和报告渲染保持普通数据流：它们只消费已经交付的普通值。

收到 <code>SIGINT</code> 或 <code>SIGTERM</code> 后，CLI 请求 Runner 中断。Runner 完成能够完成的收尾，保留已经发布的 Attempt，并返回 <code>completion: "interrupted"</code> 的 receipt。用户中断不是新的 Attempt 业务事实。

argv、配置或 selector 无法建立 Invocation 时，CLI 输出 <code>error:</code> 和 <code>fix:</code>，以非零状态结束；此时没有 receipt。

## 退出码

退出码结合本次 Invocation completion 与已知 Verdict 计算。业务判定来自本次运行形成的停稳 Record 数据，不能由终端颜色、进度行或一个宽摘要代替。

有关 budget、首过即停、失败停止派发和细分错误的规则，见 [Runner](runner.md) 与 [执行失败分类](feature/error-classification/README.md)。

## 相关阅读

- [Runner](runner.md)
- [Record](feature/record/README.md)
- [Sample](feature/sample/README.md)
- [Reports](feature/reports/README.md)
