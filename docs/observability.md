# Observability —— 运行反馈、持久观测与 Reports

Observability 有两条边界。运行中的反馈只服务当前进程；停稳后的观测写入 Record。Record durable
catalog 按 capture authority 固定为五个 source family。Analysis 从这些 source 投影 conversation、usage、
commands、timing、diagnostics 与 source navigation；Report 只消费闭合的 Analysis 结果。

本页是 Observability 领域的唯一入口。字段、限制、seal 和读取语义的精确 durable schema 由
[Observability Source receipts](feature/record/architecture/observability-attachments.md) 定义；本页说明它在
运行、读取与报告边界中的位置。

## 数据路径

```text
Adapter / SessionManager / Sandbox / Runner
        │
        ├─ 运行中反馈 → TTY、机器可读进程反馈
        │
        └─ 收集、脱敏、seal
                         │
                         ▼
     五个 fixed Observability source family
                         │
                         ▼
       Record Host source read → Analysis projection → Report
```

终端进度、心跳、活动行与临时计数不进入 Record。进程退出后，只有已发布 Run 内的
RecordAttachment 能由 show、view 或静态报告读取。

## 五个 source family，五个 capture authority

| family | owner | capture authority | durable fact |
|---|---|---|---|
| `niceeval.agent-turns` | Attempt | Adapter | 解释并脱敏后的 terminal Turn 与 provider usage observation |
| `niceeval.turn-contexts` | Attempt | SessionManager | 每个物理 `t.send` 当时已知的 source context |
| `niceeval.sandbox-commands` | Attempt | Sandbox wrapper | command manifest、唯一终态与安全 stream |
| `niceeval.runner-activities` | Attempt、Run | 对应 owner 的 Runner monotonic clock | activity、phase、anchor 与区间 |
| `niceeval.runner-diagnostics` | Attempt、Run | 对应 owner 的 Runner diagnostic sink | advisory 与 execution error |

这五项与 `niceeval.assertions`、`niceeval.file-changes`、`niceeval.sources`、`niceeval.artifacts` 共同组成
Record 的九项 fixed catalog；各自 owner 由 catalog 声明。

一个 capture authority 只能保存自己亲历且有权解释的事实。reference Member 沿精确 origin Attempt 读取，
不复制 source payload。conversation、usage、commands、timing、diagnostics 与 source navigation 都是读侧投影，
不占 durable catalog entry。

## Collection、limitation 与 source read

collection 说明已经写入 payload 的采集完备度，只有 complete 与 partial：

- complete 的 limitations 必须为空；零条 observation 也可以 complete。
- partial 必须带至少一条封闭的结构化 limitation，说明截断、脱敏、输入不能归一、采集失败或上限。

partial 表示已保存事实有明确缺口，不表示“没有发生”。reader 逐 source 保留以下状态：

| state | 含义 |
|---|---|
| `complete` | exact payload 与 owner-local blob closure 已验证，capture authority 完整观察了集合 |
| `partial` | 安全前缀已验证，且 limitations 明确列出缺口 |
| `not-recorded` | Seal manifest 没有该 owner 的 source，不等于 complete-empty |
| `invalid` | manifest、envelope、payload、segment identity、ref 或 closure 无效 |

形成 source value 前的 I/O 或 permission failure 是 typed read failure，不会伪装成空数据。旧
`niceeval.record` beta format 不进入 current reader 或 maintenance，明确返回 `unsupported-format`。它缺少
可证明的 capture authority 与 provenance，不能拆分或伪迁移成 source receipt。

所有 payload 都是 exact JSON。它们没有 metadata、attributes、data 或任意 JSON 扩展袋。未知字段、
超出上限、重复 identity 和不符合 schema 的值都会使对应 Attachment 为 invalid。

## 用户可见对话与临时输入

conversation 从 `agent-turns` 与 `turn-contexts` 投影 provider-neutral 的用户可见语义：

- user 与 assistant message，以及 tool call 与 tool result；
- 已经提供给用户的 thinking summary；
- subagent、input request、skill load、context injection、compaction 与 conversation error。

tool call 保留 source-native name；hidden chain of thought 不落盘。

Adapter 可以在内存中读取 SDK、CLI 或协议帧，但不得把 raw provider frame、原始请求体、原始响应体或
provider 私有 trace 属性写入 Record。不能映射到固定 variant 的输入只增加 Agent Turns source limitation。

Adapter 可以解释自己的 tape、JSONL、SDK stream 或临时标准事件流，但只向 NiceEval 交付已解释、脱敏的
terminal `Turn`。raw tape、raw frame、原始请求与响应、hidden chain of thought、secret 和任意 attribute
都不能进入 Record。

### Canonical 目标: OpenTelemetry GenAI 语义约定，不发明私有 schema

OTel GenAI 语义可帮助 Runner 在内存中识别操作与时间。它只是 Runner Activities 的 capture input；
Record 不保存 raw OTLP、span attribute 或 provider 名称。

OTel bridge 只在事件发生时把 span 绑定到 exact Run 或 Attempt、同一枚 verified owner-monotonic clock、
稳定 phase / label 与 capture-time refs。它不在事后从 epoch 推回 owner offset。不能同时证明这些条件的
span 不形成 activity，并使 Runner Activities source 以 `unsupported-input` 保持 partial。

### 每个 Agent 一个薄 mapper

每个 Adapter 把自己的协议输入映射成 terminal Turn。mapper 不能让 Report 依赖 provider 分支，也不能以
未知字段透传绕过 `niceeval.agent-turns` 的固定输入。

## 命令、安全输出与诊断

每次 Sandbox command 先收集脱敏 manifest，再收集一个终态 result。成功、非零退出、取消与未启动都
保留 observed result；没有终态时以 partial limitation 表示缺口，不能只留下 manifest。

stdout 与 stderr 分流处理。collector 先把输入转成安全 UTF-8，再应用已知敏感值脱敏，最后分别执行
大小上限。每流最多保存 65,536 bytes；不超过 4,096 bytes inline，其余写入 `niceeval.sandbox-commands`
自己的 blob closure。截断、替换非 UTF-8 或脱敏都会留下 partial limitation。

这种脱敏只处理 collector 已知的敏感值。它不是未知 secret 的检测器，也不是恶意 JavaScript、恶意
provider 或 hostile filesystem 的安全沙箱。

`niceeval.runner-diagnostics` 分开保存 advisory 与 execution error。它只允许公开 code、受限安全摘要、
稳定 phase、安全 cause chain 与可选 SourceItem frame；不保存 raw Error.message、stack、Cause、绝对路径、
secret 或任意 JSON。诊断是观测事实，不自动改变 assertion outcome 或 reuse decision。

## 用量、成本与时间

`niceeval.agent-turns` 保存原子 usage observation，而非 Attempt 总计。token bucket、一个 request 与一笔
provider observed cost 各自是一项 observation。provider cost 只承载上游如实带回的事实，不承载任何估算；
amount 使用 canonical decimal，并同时保存 provider 与 currency。

总 token、cache ratio、Runner `estimatedCostUSD`、FX、跨币种汇总、command success、owner-local observed timing window 与
diagnostic 分组都是 Calculation。

Runner 始终从 Config/runtime price table 独立计算 `estimatedCostUSD`，即使已有 provider-cost observation 也照常计算。
只有 `maxCost` 消费这个 estimate。Report 成本投影只使用显式 PricingProfile 与 sealed Usage，绝不读取 Runner estimate。

所有 Calculation 显式声明所需 source 与完整度策略，不能回写 Record。`niceeval.runner-activities` 的
unknown outcome、partial source 或不完整 parent containment 不能单独证明 Attempt 总耗时或 critical path。

每份 Runner Activities source 有自己的 owner-monotonic clock。Run offset 与 Attempt offset 不能相减或拼接。
activity 保存稳定 phase、稳定 label、startOffsetMs、durationMs、可选 parent 与终态。decoder 验证
`startOffsetMs + durationMs` 是 non-negative safe integer。raw epoch、OTLP span、span attribute 与
provider 名称都不落盘。

### 用量与成本：token / 计费

provider observed cost 是 provider 当时报告的事实。价格表、模型价、货币换算与总成本属于独立
Calculation 的输入和输出。缺少 provider cost 不得用估算金额冒充一项 observation，也不得把 observed 值或 estimate 互相替换。

### OTLP traces-统一瀑布图

OTLP 可以通过 in-process bridge 补充本次进程的时间采集。bridge 在 span start/end 时使用同一个 owner
clock 采样，而不是把 exporter 中的 epoch timestamp 当作 offset。持久瀑布图只从 normalized activity
形成。无法归属到 exact Run / Attempt、clock domain 不可证、phase / label 不稳定或 refs 不精确的
span 不得加入 activity tree；它使对应 Runner Activities source 为 partial。

## owner-local identity、seal 与失败

turn、item、call、command、usage observation、activity 与 diagnostic 都由对应 capture authority mint
不可推导的 identity。它们不是数组下标、消息文本、时间戳或目录名称的函数。

Attempt finalizer 与 Run teardown 停稳各自适用的 capture authority。Run `seal()` 逐 source 验证 collection、
segment identity、limit、command/result pair、stream closure、activity tree 和 Sources frame。验证后的 payload
与 own blobs 一起纳入 Seal manifest。

capture authority 完整观察到空集合时写 complete-empty source；这不等于另一 source 也完整，更不等于 duration
为零。采集不能完整时，authority 尽量 seal 已验证的安全前缀并写 partial limitation。不能安全构成 exact
payload、局部验证失败或 Record I/O failure 不会伪装成 complete 或空值。

## Analysis、Report 与版本

Analysis 逐 source 消费 `complete` 或 `partial` payload，并在需要 command stream 文本时通过受限 capability
读取 inline 或 blob storage。它可以组合多个已声明 source 来形成 Calculation，却不修改 Record、选择新的 owner
或把缺失数据解释为“没有发生”。Report 只消费闭合的 Analysis 结果，没有私有 reader 或额外数据权限。

五个 source family 各自拥有稳定 family identity 与 numeric `schemaVersion`。current reader 只接受当前
source-first format；旧 aggregate 不会交给 Analysis、Report 或相邻 Attachment migration。

## 宿主侧行为断言：t.o11y

行为断言只消费自己声明的 evidence。缺少或 partial 的观测由该断言的完整度规则处理，不能解释为
“没有发生”。它不拥有原始 Attachment，也不改变 Sample denominator。

## 结果可视化：niceeval view

show 只消费已关闭的目标 Page；view 与静态报告只消费已形成的完整站点。它们不重新打开 Record、不重跑 Adapter mapper，
也不访问 provider、网络或当前 worktree。

## 相关阅读

- [Observability Source receipts](feature/record/architecture/observability-attachments.md)
  —— 五个 source family 的精确 payload、限制、seal 和 failure 语义。
- [Record 架构](feature/record/architecture.md) —— Core、closure、完成标识与 migration。
- [Record Library](feature/record/library.md) —— fixed family read、capture contract 与 Effect API。
- [Record → Report 设计地图](design/record-to-report-stack.md) —— 各层决策、依赖与合法组合，
  不构成当前契约。
- [Assertions 证据](feature/assertions/architecture/evidence.md) —— evidence 完整度怎样影响断言。
