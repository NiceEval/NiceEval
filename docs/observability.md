# Observability —— 运行反馈、持久观测与 Reports

Observability 有两条边界。运行中的反馈只服务当前进程。停稳后的业务观测写入 Record 的
owner-local RecordAttachment。Reader、AnalysisSample 与 Report 只消费后一条边界。

本页是 Observability 领域的唯一入口。七个官方 owner-specific Attachment family 的精确 durable schema、限制、
seal 和读取语义唯一由
[Observability Attachments](feature/record/architecture/observability-attachments.md) 定义。
这里不复制字段表。

## 数据路径

```text
Adapter / Sandbox / Runner
        │
        ├─ 运行中反馈 → TTY、机器可读进程反馈
        │
        └─ 收集、脱敏、seal
                         │
                         ▼
            owner-local RecordAttachment
                         │
                         ▼
  RecordReader → neutral projector → AnalysisSample → Calculation → Report
```

终端进度、心跳、活动行与临时计数不进入 Record。进程退出后，只有已发布 Run 内的
RecordAttachment 能由 show、view 或静态报告读取。

## 官方持久观测

官方 producer 对每个实际执行的 Attempt 固定写入五个独立 Attachment。对每个 Run 固定写入
两个独立 Attachment。reference Member 沿精确 Attempt 引用读取，绝不复制这些 payload。

| owner | schema identity | 观察范围 |
|---|---|---|
| Attempt | niceeval.conversation/v1 | provider-neutral、用户可见的对话和操作 |
| Attempt | niceeval.commands/v1 | Sandbox 命令 manifest、结束结果与安全输出 |
| Attempt | niceeval.usage/v1 | 原子 token、request 与 provider-observed cost |
| Attempt | niceeval.timing/v1 | Attempt 本地单调时间区间 |
| Attempt | niceeval.diagnostics/v1 | Attempt advisory 与 execution error |
| Run | niceeval.timing/v1 | Run 本地单调时间区间 |
| Run | niceeval.diagnostics/v1 | Run advisory 与 execution error |

这些是独立 owner-local Attachment，不是一个可选的观测大对象。官方 producer 不能因为某类
没有观察项而省略它：确知为空时仍写 collection 为 complete 且 limitations 为空的 payload。
只有历史 Run 或第三方 producer 从未写入该 schema 时，reader 才把这一 family 表示为
unavailable。

Assertions、Verdict、Score、Eligibility、Sources、diff、Evaluation 与 membership provenance
仍由各自的 producer 拥有。它们不是这些 Observability family 的备用字段，也不会被本领域重写。

## Collection、limitation 与读取状态

collection 说明 producer 对一个已写入 Attachment 的采集完备度。它只有 complete 与 partial：

- complete 必须带空 limitations，表示 producer 已知该列举域完整；零条 observation 也可以 complete。
- partial 必须带至少一条封闭的结构化 limitation，说明截断、脱敏、输入不能归一、采集失败或上限。
- unavailable 不属于 payload。它只表示 owner 下没有这份 family，或请求的是历史／第三方缺失的
  schema。

unsupported、migration-required、migration-unavailable 与 invalid 是 RecordAttachmentRead 的读取
状态。它们不等于 partial，也不能被投影为零、空数组或成功采集。

所有 payload 都是 exact JSON。它们没有 metadata、attributes、data 或任意 JSON 扩展袋。
未知字段、超出上限、重复 identity 和不符合本页限制的值都会使该 Attachment invalid。

## 用户可见对话与临时输入

conversation 只保存 provider-neutral 的用户可见语义：

- user 与 assistant message；
- tool call 与 tool result；tool call 原样保留 source-native 名称，canonical kind 不得替换它；
- 已提供给用户的 thinking summary，绝不保存 hidden chain of thought；
- subagent、input request、skill load、context injection、compaction 与 conversation error。

Adapter 可以在内存中读取 SDK、CLI 或协议帧，但不得把 raw provider frame、原始请求体、原始响应体
或 provider 私有 trace 属性写入 Record。不能映射到固定 variant 的输入只增加 collection limitation。

### Transcript 标准事件流

Transcript 与标准事件流是 Adapter 的临时归一边界。它们可供本次 Attempt 的断言、反馈和
conversation collector 使用，却不是持久格式。持久 conversation 只保留上节列出的安全 variant。

### Canonical 目标: OpenTelemetry GenAI 语义约定，不发明私有 schema

OTel GenAI 语义可帮助 Adapter 在内存中识别操作与时间。它不是 Record payload，也不让
niceeval.timing/v1 保存 raw OTLP、span attribute 或 provider 名称。

OTel bridge 只在事件发生时把 span 绑定到 exact Attempt、同一枚 verified owner-monotonic clock、稳定 phase / label
与 capture-time refs。它不在事后从 epoch 推回 owner offset，也不持有 writable definition。无法同时证明这些条件的
span 不形成 interval，并让 timing collection 以 `unsupported-input` 保持 partial。

### 每个 Agent 一个薄 mapper

每个 Adapter 把自己的协议输入映射到同一组 conversation、usage 与 timing capture 调用。
mapper 不能让 Report 依赖 provider 分支，也不能以未知字段透传绕过 durable schema。

## 命令、安全输出与诊断

每次 Sandbox 命令先登记脱敏 manifest，再调用外部进程。进程结束后登记一个终态 result。
成功、非零退出、取消与未启动都保留 observed result；成功不是由 collector 预先过滤的情况。

stdout 与 stderr 分流处理。collector 先把输入转成安全 UTF-8，再应用已登记敏感值的脱敏，最后
分别执行大小上限。每流最多保存 65,536 bytes；不超过 4,096 bytes inline，其余作为该命令
Attachment 自己 closure 中的 blob。截断、替换非 UTF-8 或脱敏都会留下 partial limitation。

这种脱敏只处理 collector 已知的敏感值。它不是未知 secret 的检测器，也不是恶意 JavaScript、
恶意 provider 或 hostile filesystem 的安全沙箱。

diagnostics 分开保存 advisory 与 execution-error。它只允许公开 code、受限安全摘要、稳定 phase、
安全 cause chain、封闭 context 与可选 SourceItem frame。它不保存 raw Error.message、stack、
Cause、绝对路径、secret 或任意 JSON。诊断本身不自动改变 Verdict、Score 或 Eligibility。

## 用量、成本与时间

usage 保存原子 observation，而非 Attempt 总计。token bucket、一个 request 与一笔
provider-observed cost 各自是一项 observation。cost 以 canonical decimal string、provider 与
currency 保存。

总 token、cache ratio、价格表估算、FX、跨币种汇总、命令成功、owner-local observed timing window、
diagnostic 分组与跨 family join 都是 Calculation。它们必须显式声明所需 projection、完整度策略、
observed 与逻辑 Sample denominator，不能回写 Record。`niceeval.timing/v1` 没有 designated root 或完整因果边，
所以它不能单独证明 Attempt 总耗时或 critical path。需要这些读数时，必须先发布能证明它们的新事实契约。

每个 timing Attachment 有自己的 owner-monotonic clock。Run offset 与 Attempt offset 不能相减或
拼接。interval 保存稳定 phase、稳定 label、startOffsetMs、durationMs、可选 parent 与终态。
decoder 还验证 `startOffsetMs + durationMs` 是 non-negative safe integer。raw epoch、OTLP span、span
attribute 与 provider 名称都不落盘。

### 用量与成本：token / 计费

provider-observed cost 是 provider 当时报告的事实。价格表、模型价、货币换算与总成本属于独立
Calculation 的输入和输出。缺少 provider cost 不得用估算金额冒充一项 observation。

### OTLP traces-统一瀑布图

OTLP 可以通过 in-process bridge 补充本次进程的时间采集。bridge 在 span start/end 时使用同一个 owner clock 采样，
而不是把 exporter 中的 epoch timestamp 当作 offset。持久瀑布图只从 normalized timing interval 投影形成。
无法归属到 exact Run / Attempt、clock domain 不可证、phase / label 不稳定或 refs 不精确的 span，不得加入任一 owner
的 usage、duration 或 timing tree；它使对应 timing collection partial。

## owner-local identity 与组合读取

turn、item、call、command、usage observation、interval 与 diagnostic 都由 producer mint
attachment-local identity。它们不是数组下标、消息文本、时间戳或目录名称的函数。

跨 family reference 是可选的。官方 seal 前，ObservabilityRecordContractV1 验证每个提供的
reference 在同一 owner 下恰有一个 target，且 family、entity kind 与 identity 匹配。它不凭文字、
时间或数组顺序猜 target。

单一 family 的 decoder 只验证自己的 payload、blob closure 和 attachment-local relation。读取端遇到
跨 family dangling reference 时，单一 family 仍可用；请求组合视图的 projector 或 Calculation 把该
组合结果标为 partial，并给出结构化原因。

## seal、发布与失败

Attempt 的全部 finalizer 停稳后，唯一 owner-bound timing collector 与其它官方 collector 才冻结该 Attempt 的五份
Attachment。OTel bridge 只向这个 timing collector 提交受限 capture input，不能直接写 Record。Run teardown
停稳后，才冻结 Run 的 timing 与 diagnostics。随后 coordinator 让
ObservabilityRecordContractV1 对全部 owner、identity、collection、跨 family reference 与 SourceItem
frame 联合验证。

官方实际执行的 Attempt 即使没有 timing interval，也写 complete-empty timing payload；这不是 duration 为零。安全
interval 有缺口时写 partial limitation。只有历史 Record 或第三方 producer 未写该 family 时才是 unavailable。

generic Record writer 仍只验证 Core、typed Attachment、owner-local blob closure 与精确 Core
reference。它不知道官方 observability 名称或业务规则。联合验证或任一普通写入失败时，Run 不创建
complete marker；没有 marker 的目录不是 Record 事实。

采集不能完整时，producer 尽量 seal 已验证的安全数据，并写 partial limitation。不能安全构成 exact
payload、联合验证失败或 Record I/O 失败保留为 typed error。它们不被伪装成 complete、空值或
unavailable。

## Projector、Calculation 与 Report 同权

每个 owner-specific family 都公开一个 neutral RecordAttachmentProjector。projector 只把一份
available Attachment 变为自包含 typed view。commands projector 在此处统一 inline 与 blob，因而
consumer 看不到二者的物理差异。

一个 projector 不汇总计数、命令成功、observed timing window、成本或 diagnostic 分组，也不读取另一
family。需要这些结果的作者同时声明所需 projection，再由 Calculation 显式组合。当前 timing v1 的普通纯函数可以
按 slot 计算 `max(startOffsetMs + durationMs) - min(startOffsetMs)`；它不能把该观测区间升级成总耗时或 critical
path。

官方 Report 与第三方 Report 都通过最终选定的公共 Record-to-Report 数据面消费这些 family。
官方页面没有私有 reader、legacy evidence bridge 或额外数据权限。

## 迁移与第三方边界

本页只定义 current v1。每个 owner-specific Attachment 独立拥有相邻 schema migration。普通 open
不会改写磁盘；用户显式运行 niceeval migrate 后才执行完整相邻链。

第三方长期保存的事实必须使用自己的 versioned Attachment 与 projector。`ctx.fact`、`FactRecord`、
`AttemptEvidence.capabilities`、`events.json`、`commands.json` 与 `trace.json` 不是新的持久契约，
也不能作为官方或第三方 Report 的回填依据。

## 宿主侧行为断言：t.o11y

行为断言只消费自己声明的 evidence。缺少或 partial 的观测由该断言的完整度规则处理，不能解释为
“没有发生”。临时 o11y summary 可以从已声明 projection 形成，但它不拥有原始 Attachment，也不
改变 Sample denominator。

## 结果可视化：niceeval view

show、view 与静态报告只消费已形成的 ReportExecution。它们不重新打开 Record、不重跑 Adapter
mapper，也不访问 provider、网络或当前 worktree。

## 相关阅读

- [Observability Attachments](feature/record/architecture/observability-attachments.md)
  —— 七个 owner-specific family schema、限制、seal 和 failure 语义。
- [Record 架构](feature/record/architecture.md) —— Core、closure、完成标识与 migration。
- [Record Library](feature/record/library.md) —— family、capture contract 与 Effect API。
- [Projection](feature/projection/README.md) —— owner access 与穷尽读取结果。
- [Record → Report 设计地图](design/record-to-report-stack.md) —— 各层决策、依赖与合法组合，
  不构成当前契约。
- [官方 OTel Timing Use Case](roadmap/record-analysis-report/use-case/官方OTelTiming.md)
  —— definition、capture、write、Projection、Calculation 与 Report 的完整语法。
- [Assertions 证据](feature/assertions/architecture/evidence.md) —— evidence 完整度怎样影响断言。
