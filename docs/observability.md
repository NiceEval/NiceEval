# Observability —— 事实数据、反馈与 Reports

可观测数据分成两条边界：运行中的反馈服务当前进程；停稳后的业务事实写入 Record 的 owner-local RecordAttachment。Reader 和 analysis selection 把后者交给 Sample 与 Reports。

## 数据路径

Agent、Sandbox 和 Runner 同时产生当前进程反馈以及 Run/Attempt RecordAttachment 数据。前者进入 TTY 或机器可读的进程反馈；后者经 RecordReader、analysis selection 与 Reports 呈现。

终端进度、心跳、活动行和临时计数不进入 Record。进程退出后，只有已写入 RecordAttachment 的业务数据可以由 `show`、`view` 或静态报告站读取。

## 内建业务 Attachment 闭环

下表冻结标准能力的 owner、精确 JSON payload 形状和消费入口。每个 Attachment 都由固定 envelope、exact JSON payload 与 owner-local blob closure 组成。

reader 先解码固定 `RecordAttachmentEnvelopeV1`，再按 `(owner, name, schemaId)` 选择 payload decoder。具名 RecordAttachment projector 把自包含 payload 形成 typed view。

| producer / 事实 | owner 与 RecordAttachment | payload、collection 与 limitation 细节 | 标准消费 |
|---|---|---|---|
| Assertion collector | Attempt / `niceeval.assertions/v1` | exact JSON；subject、evaluator、evaluation、evidence、policy 与 projection | Attempt checks 与 score detail |
| Assertion source capture | Attempt / `niceeval.assertion-source-sites/v1` | exact JSON；`entryId` 到 role-tagged runtime site、occurrence、sourceOrder 与 stop disposition | Assertion source navigation |
| 四态判定 | Attempt / `niceeval.verdict/v1` | exact JSON；所有 Pass/Score Attempt 的四态 Verdict | overview、Attempt state 与 reuse planning |
| Score Eval 得分 | Attempt / `niceeval.score/v1` | exact JSON；Score Eval 的独立得分、可排名性、stop cause 与 issues | overview 与排行 |
| Execution eligibility | Attempt / `niceeval.eligibility/v1` | exact JSON；含 mandatory `reuseContract` | reuse planning |
| Adapter / usage 与 provider 计费观测 | Attempt / `niceeval.usage/v1` | exact JSON；token、request 与 provider-observed cost 分开标记 | usage 与 cost cards |
| Adapter / message、tool call、tool result | Attempt / `niceeval.conversation/v1` | exact JSON；未知 event variant 形成 collection partial | conversation/tool timeline |
| Sandbox / command manifest 与结果 | Attempt / `niceeval.commands/v1` | exact JSON；大 stdout/stderr 可引用 owner-local blob | commands 与 evidence |
| Sandbox ledger / 文件变化 | Attempt / `niceeval.diff/v1` | exact JSON；大 patch 可引用 owner-local blob | change summary 与 detail |
| Runner、Adapter、Sandbox / 时间区间 | Attempt / `niceeval.timing/v1` | exact JSON；规范 phase interval 与 parent 关系 | duration 与 waterfall |
| Attempt lifecycle / diagnostics | Attempt / `niceeval.diagnostics/v1` | exact JSON；code、phase、detail 与 context | Attempt diagnostics |
| Eval discovery / definition | Run / `niceeval.evaluations/v1` | exact JSON；distinct evalId → `pass | score` | 离线分母分类 |
| Run lifecycle / diagnostics | Run / `niceeval.diagnostics/v1` | exact JSON；setup、teardown、dispatch 与 stop reason | Run diagnostics |
| Planner 与 operator / 采用原因 | Run / `niceeval.membership-provenance/v1` | exact JSON；关联 slotId、attemptId 与当时理由 | membership provenance |
| Eval discovery / source snapshot | Run / `niceeval.sources/v1` | exact JSON；stable `SourceItemId`、canonical project-relative path、SHA-256 与 own blobs | origin source viewer |
| Runner / invocation provenance | Run / `niceeval.run-provenance/v1` | exact JSON | Invocation detail |

这些链路都经过 producer → fixed envelope → payload decoder → RecordAttachment projector → 标准呈现。未受 projector 支持的自定义 schema 可以 `unsupported`。

Pass 与 Score 都保存四态 Verdict，Score 另有独立得分。两者都是所属评估类型的权威结果，Report 不从 Assertions 重新折叠。

Attachment 的 `collection` 只表达 complete 或带 reason 的 partial。没有同名 Attachment 时，读取是 `unavailable`。截断、脱敏、采样或过滤由 payload 用结构化 limitation 说明；`unsupported`、`invalid` 等读取状态另由 `RecordAttachmentRead` 表达。

## Run-owned Attachment

Run 保存不能归属单个 Attempt 的事实，例如题型、Experiment setup 或 teardown 诊断、共享准备计时、采用理由、源码快照，以及停止派发的原因。它们使用 Run-owned RecordAttachment，并以 eval、slot 或 Attempt identity 关联需要的上下文。

Run-owned RecordAttachment 不复制 Attempt 的业务值。采用已有 Attempt 的 reference Member 仍读取该 immutable Attempt 的 Attachment 数据。

Sources 是 origin Run-owned；source-sites 是 Attempt-owned。两者只以 schema-declared
`SourceItemId` 与 digest 做 semantic join，不能共享 blob、storage path、reader handle 或
capability。source-sites 缺失、unsupported 或 invalid 时，Assertions 仍可读取，source navigation
只显示 `unmapped`。

## 事件与归一化

Adapter 把 SDK 或 CLI 的原始流转换为稳定的 conversation、usage 与 timing payload。不受当前 decoder 支持的 event variant 不会使 Core 无效；请求它的 projection 可以 partial 或 unsupported。

Adapter 可以把可识别的 GenAI 语义归一为 conversation、usage 与 timing RecordAttachment。Reports 只消费 projector 明确交付的 typed view，不能直接读取 provider 输出或 Record 文件。

raw OTLP 是否默认持久化不由本轮 Record 契约决定。无论该策略怎样选择，`niceeval.timing/v1` 都必须保留可画 waterfall 的 normalized phase intervals；关闭 raw trace 不能删除标准时间事实。

一个 span 必须归属明确的 Attempt，或归属明确的 Run。归属不明的 span 只作为局部诊断，不能被拼进任一 Attempt 的耗时或用量。

## 用量、成本与时间

`niceeval.usage/v1` 保存 provider 报告的 token、请求和计费观测，以及足以说明读数状态的 collection。provider-observed cost 必须带 provider identity 与币种，不能冒充 NiceEval 计算值。

价格表换算、汇总和图表属于 Calculation。派生 cost 保存 price table identity，并声明所需数据、完整度 policy、observed 与 Sample denominator。

timing RecordAttachment 保存明确命名的区间和计时 domain。timeout、执行耗时和共享准备耗时使用各自的区间；Reports 不从目录时间或终端文本推断它们。

每个 timing interval 具有稳定 id、phase、start、duration 和可选 parent interval id。decoder 必须拒绝负 duration、重复 id、缺失 parent 或 parent cycle；标准 Report 用这些 normalized intervals 形成文字 phase 表与 waterfall。

partial 用量或计时读数必须显示 observed、denominator 与 partial。未采集、当前 reader 不支持和损坏输入分别保留自己的状态，不能合并为零。

`o11y summary` 是 Report Calculation 从 conversation、usage 和 timing projections 得到的读数集合。它不拥有原始 RecordAttachment，也不改变 Sample 分母。

## 断言证据

行为、usage、diff 和 Sandbox 断言只消费已声明的 RecordAttachment。采集不足时，Assertion 根据自己的需求形成 `unavailable`；它不会把缺席解释为“没有发生”。

完整规则见 [Assertions 证据](feature/assertions/architecture/evidence.md)。Verdict 的四态折叠见 [Verdict](feature/verdict/architecture.md)。

## Reports 与静态分享

Reports runtime 只消费 `ReportExecution`，不打开磁盘，也不再次读取 Attachment。每页和 Calculation 只受自己声明的数据影响。

Attempt-owned projection 通过 included slot 读取。Run-owned provenance 与 diagnostics 从 selected Run 读取；sources 固定通过 included Attempt 的 origin Run 读取。

源码导航同时声明 Assertions、source-sites 与 attempt-origin Sources 三个中立 projection，再用
纯 `assembleAttemptSourceTreeV1` 组合已形成的值。它不把 Record reader、source blob capability
或当前 worktree 传给 Report；一个 `entryId` 即使有多个 site，result 与 score 仍只计一次。

origin Run 不进入 Sample 分母，也不把 Record root、path 或 reader 暴露给 Report。

静态 export 将预渲染页面、组件宿主数据、精确 runtime、资源和 `StaticAssetManifest` 写入一个目录。浏览器离线读取该目录；它不访问源 Record、网络或之后安装的 NiceEval。

## 相关阅读

- [Record 架构](feature/record/architecture.md)
- [Record Library](feature/record/library.md)
- [Reports 架构](feature/reports/architecture.md)
- [Adapter 证据](feature/adapters/architecture/evidence.md)
