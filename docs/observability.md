# Observability —— 通道数据、反馈与 Reports

可观测数据分成两条边界：运行中的反馈服务当前进程；停稳后的业务事实写入 Record 的 owner-local channels。Reader 和 normalizer 把后者交给 Sample 与 ReportInput。

## 数据路径

Agent、Sandbox 和 Runner 同时产生当前进程反馈以及 Run、Attempt channel 数据。前者进入 TTY 或 NDJSON；后者经 RecordReader、normalizer、Sample 和 ReportInput 进入 Reports。

终端进度、心跳、活动行和临时计数不进入 Record。进程退出后，只有已写入 channel 的业务数据可以由 <code>show</code>、<code>view</code> 或静态报告站读取。

## 内建业务通道闭环

下表冻结标准能力的 owner、transport 和消费入口。JSON document 使用 <code>application/json</code>；event stream 使用 <code>application/x-ndjson</code>。每个 decoder 都只接受表中名称与 media type 的组合，并通过同名内建 FactRequirement 交给标准 Report。

| producer / 事实 | owner 与 channel | codec 与 coverage 细节 | 标准消费 |
|---|---|---|---|
| Assertion producer / checks | Attempt / <code>niceeval.assertions</code> | 精确 JSON document；限制见 Assertions | <code>assertionsFact</code> → Attempt checks 与 score |
| Verdict fold / terminal state | Attempt / <code>niceeval.verdict</code> | 精确 JSON document | <code>verdictFact</code> → overview 与 Attempt state |
| Adapter / usage 与 provider 计费观测 | Attempt / <code>niceeval.usage</code> | JSON document；token、request 与 provider-observed cost 分开标记 | <code>usageFact</code> → usage 与 cost cards |
| Adapter / message、tool call、tool result | Attempt / <code>niceeval.conversation</code> | NDJSON；未知 event 只让 decoding partial | <code>conversationFact</code> → conversation/tool timeline |
| Sandbox / command manifest 与结果 | Attempt / <code>niceeval.commands</code> | JSON document；大 stdout/stderr 可引用 Attempt blob | <code>commandsFact</code> → commands 与 evidence |
| Sandbox ledger / 文件变化 | Attempt / <code>niceeval.diff</code> | JSON document；大 patch 可引用 Attempt blob | <code>diffFact</code> → change summary 与 detail |
| Runner、Adapter、Sandbox / 时间区间 | Attempt / <code>niceeval.timing</code> | JSON document；规范 phase interval 与 parent 关系 | <code>timingFact</code> → duration 与 waterfall |
| Attempt lifecycle / diagnostics | Attempt / <code>niceeval.diagnostics</code> | NDJSON；code、phase、detail 与 context | <code>attemptDiagnosticsFact</code> → Attempt diagnostics |
| Run lifecycle / diagnostics | Run / <code>niceeval.diagnostics</code> | NDJSON；setup、teardown、dispatch 与 stop reason | <code>runDiagnosticsFact</code> → Run diagnostics |
| Planner 与 operator / adoption action | Run / <code>niceeval.actions</code> | JSON document；关联 slotId、attemptId 与当时理由 | <code>actionsFact</code> → membership provenance |
| Eval discovery / source snapshot | Run / <code>niceeval.sources</code> | JSON manifest + Run-local SHA-256 blobs | <code>sourcesFact</code> → origin source viewer |

这些链路都包含 producer → descriptor coverage → 内建 decoder → branded FactRequirement → 标准 presentation。未知或退役自定义通道可以 unsupported；表中标准能力的 decoder 与页面入口不能单独退役。Verdict 是 terminal state 的唯一权威，Report 不从 Assertions 重算它。

descriptor 的 <code>coverage</code> 只表达持久采集的 <code>complete | partial | unavailable</code>。截断、脱敏、采样、过滤或采集失败由所属 payload 用结构化 limitation 说明；它们不能折叠成 <code>null</code>。reader 的 decoding coverage 另行说明已有 bytes 是否全部理解。

## Run 通道

Run 保存不能归属单个 Attempt 的事实，例如 Experiment setup 或 teardown 诊断、共享准备计时、carry 与 accept 理由、源码快照，以及停止派发的原因。它们使用 Run-owned channel，并以 slot 或 Attempt identity 关联需要的上下文。

Run 通道不能复制 Attempt 的业务值。采用已有 Attempt 的 Member 仍读取该 Attempt 的当前 channel 数据。

## 事件与归一化

Adapter 把 SDK 或 CLI 的原始流转换为稳定的 conversation、usage 与 timing 事实。未知 event variant 不会使核心 Record 无效；请求它的 decoder 可以给出 partial 或 unsupported，未请求它的页面继续工作。

Adapter 可以把可识别的 GenAI 语义归一为 conversation、usage 与 timing facts。Reports 只消费 normalizer 明确交付的稳定结构，不能直接读取 provider 输出或 Record 文件。

raw OTLP 是否默认持久化不由本轮 Record 契约决定。无论该策略怎样选择，<code>niceeval.timing</code> 都必须保留可画 waterfall 的 normalized phase intervals；关闭 raw trace 不能删除标准时间事实。

一个 span 必须归属明确的 Attempt，或归属明确的 Run。归属不明的 span 只作为局部诊断，不能被拼进任一 Attempt 的耗时或用量。

## 用量、成本与时间

usage channel 保存 provider 报告的 token、请求和计费观测，以及足以说明读数状态的采集完整度。provider-observed cost 必须带 provider identity 与币种，不能冒充 NiceEval 计算值。价格表换算、汇总和图表属于 Calculation；派生 cost 同时保存 price table identity，并声明所需 facts、完整度 policy、observed 与 Sample denominator。

timing channel 保存明确命名的区间和计时 domain。timeout、执行耗时和共享准备耗时使用各自的区间；Reports 不从目录时间或终端文本推断它们。

每个 timing interval 具有稳定 id、phase、start、duration 和可选 parent interval id。decoder 必须拒绝负 duration、重复 id、缺失 parent 或 parent cycle；标准 Report 用这些 normalized intervals 形成文字 phase 表与 waterfall。

partial 用量或计时读数必须显示 observed、denominator 与 partial。未采集、当前 reader 不支持和损坏输入分别保留自己的状态，不能合并为零。

<code>o11y summary</code> 是 Report Calculation 从已规范化 conversation、usage 和 timing facts 得到的读数集合。它不拥有原始 channel 数据，也不改变 Sample 分母。

## 断言证据

行为、usage、diff 和 Sandbox 断言只消费已声明的 channel。采集不足时，Assertion 根据自己的需求形成 <code>unavailable</code>；它不会把缺席解释为“没有发生”。

完整规则见 [Assertions 证据](feature/assertions/architecture/evidence.md)。Verdict 的四态折叠见 [Verdict](feature/verdict/architecture.md)。

## Reports 与静态分享

Reports 接收 ReportInput，不打开磁盘，也不再次读取 channel。每页和 Calculation 只会受到自己声明的 facts 影响。

Attempt-owned fact 通过 included slot 读取。Run-owned adoption 与 diagnostic fact 可以从已选 Run 读取；source fact 固定通过 included Attempt 的 origin Run 读取。origin Run 只提供受限 fact，不进入 Sample 分母，也不把 Record root、路径或 reader 暴露给 Report。

静态 export 将预渲染页面、组件宿主数据、精确 runtime、资源和 <code>StaticAssetManifest</code> 写入一个目录。浏览器离线读取该目录；它不访问源 Record、网络或之后安装的 NiceEval。

## 相关阅读

- [Record 架构](feature/record/architecture.md)
- [Record Library](feature/record/library.md)
- [Reports 架构](feature/reports/README.md)
- [Reports Calculations](feature/reports/README.md)
- [Adapter 证据](feature/adapters/architecture/evidence.md)
