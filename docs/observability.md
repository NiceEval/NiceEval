# Observability —— 通道数据、反馈与 Reports

可观测数据分成两条边界：运行中的反馈服务当前进程；停稳后的业务事实写入 Record 的 owner-local channels。Reader 和 normalizer 把后者交给 Sample 与 ReportInput。

## 数据路径

Agent、Sandbox 和 Runner 同时产生当前进程反馈以及 Run、Attempt channel 数据。前者进入 TTY 或 NDJSON；后者经 RecordReader、normalizer、Sample 和 ReportInput 进入 Reports。

终端进度、心跳、活动行和临时计数不进入 Record。进程退出后，只有已写入 channel 的业务数据可以由 <code>show</code>、<code>view</code> 或静态报告站读取。

## Attempt 通道

Attempt 保存实际执行细节。内建业务通道按事实的 owner 和访问方式选择 document、JSONL 或 blob：

| 事实 | 通道形态 | 说明 |
|---|---|---|
| Assertion 与 Verdict | document | 可直接读取和人工编辑的终态数据。 |
| conversation、tool 与阶段事件 | JSONL | 按发生顺序追加的事实。 |
| diagnostics | JSONL 或 document | 具名 code、phase、detail 与上下文。 |
| usage 与 timing | document 或 JSONL | 原始累计项和明确的时间区间。 |
| diff、源码与大文本 | document 加 Attempt-owned blob | 引用只在该 Attempt 内有效。 |
| telemetry | JSONL | 已规范化的 span 与事件。 |

具体 channel 名称、字节编码和 decoder 由所属 Feature 定义。descriptor 的 <code>coverage</code> 说明持久采集状态；reader 的解码状态另行说明本次能否读全已有字节。

## Run 通道

Run 保存不能归属单个 Attempt 的事实，例如 Experiment setup 或 teardown 诊断、共享准备计时、carry 与 accept 理由，以及停止派发的原因。它们使用 Run-owned channel，并以 slot 或 Attempt identity 关联需要的上下文。

Run 通道不能复制 Attempt 的业务值。采用已有 Attempt 的 Member 仍读取该 Attempt 的当前 channel 数据。

## 事件与 telemetry

Adapter 把 SDK 或 CLI 的原始流转换为稳定的 conversation、tool、usage 与 telemetry 事实。未知 event variant 不会使核心 Record 无效；请求它的 decoder 可以给出 partial 或 unsupported，未请求它的页面继续工作。

OTLP 适配器将可识别的 GenAI 语义映射到 telemetry channel。provider 私有属性可以作为保留字段进入该 channel，但 Reports 只消费 normalizer 明确交付的事实，不能直接读取 provider 输出或 Record 文件。

一个 span 必须归属明确的 Attempt，或归属明确的 Run。归属不明的 span 只作为局部诊断，不能被拼进任一 Attempt 的耗时或用量。

## 用量、成本与时间

usage channel 保存 provider 报告的 token、请求和计费数据，以及足以说明读数状态的采集完整度。价格换算、汇总和图表属于 Calculation：它必须声明所需 facts、完整度 policy、observed 与 Sample denominator。

timing channel 保存明确命名的区间和计时 domain。timeout、执行耗时和共享准备耗时使用各自的区间；Reports 不从目录时间或终端文本推断它们。

partial 用量或计时读数必须显示 observed、denominator 与 partial。未采集、当前 reader 不支持和损坏输入分别保留自己的状态，不能合并为零。

<code>o11y summary</code> 是 Report Calculation 从已规范化 telemetry、usage 和 timing facts 得到的读数集合。它不拥有原始 channel 数据，也不改变 Sample 分母。

## 断言证据

行为、usage、diff 和 Sandbox 断言只消费已声明的 channel。采集不足时，Assertion 根据自己的需求形成 <code>unavailable</code>；它不会把缺席解释为“没有发生”。

完整规则见 [Assertions 证据](feature/assertions/architecture/evidence.md)。Verdict 的四态折叠见 [Verdict](feature/verdict/architecture.md)。

## Reports 与静态分享

Reports 接收 ReportInput，不打开磁盘，也不再次读取 channel。每页和 Calculation 只会受到自己声明的 facts 影响。

静态 export 将预渲染页面、组件宿主数据、精确 runtime、资源和 <code>StaticAssetManifest</code> 写入一个目录。浏览器离线读取该目录；它不访问源 Record、网络或之后安装的 NiceEval。

## 相关阅读

- [Record 架构](feature/record/architecture.md)
- [Record Library](feature/record/library.md)
- [Reports 架构](feature/reports/README.md)
- [Reports Calculations](feature/reports/README.md)
- [Adapter 证据](feature/adapters/architecture/evidence.md)
