# Assertions —— scope snapshots

完整模型见 [Assertions](../README.md)。断言范围（Assertion scope）是 root `t`、Session 与 Turn。
三者都暴露 `toolCalls`、`eventOccurrences`、原始 `events` 与 `check`。
工具领域包装取 ctx-owned collection 并调用同一 `check`。
event 领域包装对 `eventOccurrences` 做同一件事。`toolCalls` 与 `eventOccurrences` 是冻结的 managed collection subject，
不是已求值的 Assertion；`events: readonly StreamEvent[]` 仍是普通 Value subject，没有 occurrence sidecar。

## 三种 receiver

| receiver | getter 冻结的 snapshot |
|---|---|
| Turn | 该不可变 Turn 的 `toolCalls`／`eventOccurrences` 封口 cut。 |
| Session | 该次 getter 之前的 Session `toolCalls`／`eventOccurrences` 前缀。 |
| 根 `t` | 该次 getter 时所有已启动 Session 的 `toolCalls`／`eventOccurrences` vector cut。 |

Turn 封口后，重复读取 `turn.toolCalls` 或 `turn.eventOccurrences` 内容相同。
Session 与 root 每次 getter 冻结当下 cut；后一次 getter 可以看到更新，旧引用永不变化。
`check` 使用 subject 携带的 scope identity 与 cut，不按调用 `check` 的 ctx 重新裁切。

Session 从第一次交互开始算已启动。仅创建空 handle 不会进入根 scope。于是早读取的 collection 不会被未来事件补成
matched，早晚两次 getter 可以得到不同引用。

Session scope 包含本 Session 在 getter 处之前的全部 Turn，因此 scoped tool Assertion 可以检查跨 Turn 的行为。根 `t` 冻结所有已启动 Session 的 vector cut，并按 Session 保留前缀。它不把独立 Session 拼成一条全局事件顺序。
根上的 `toolOrder` 与 `eventOrder` 对每条 Session 的前缀分别求值，再按存在量词合并。

`toolCalls`、`eventOccurrences`、collection Match 与包装的 selector、材料状态和三值计数只在 [Scoped assertions](../library/scoped-assertions.md) 定义。这里的 snapshot 规则决定 collection 在何处读取 occurrence，不另立匹配契约。

## 材料 receiver 与调用切面

每个 receiver 私有保存 runtime、assertOpen、readContext、scopeIdentity、readCut 与 closed。
check 和 closeQA 是捕获 receiver 的闭包；提取方法后仍使用原 scope，不读取 this、全局 ctx 或按名称探测应用。
Adapter ctx 来自 create 的返回值，没有 Agent scope 字段；材料定义不建立另一份 reader 注册表。

Agent scopeIdentity 校验 Turn 的 sessionId/turnId/scopeId、Session 的 sessionId/scopeId，以及 Attempt 的 scopeId。
reader 前先捕获正式 producer sequence，将不可变 cut 放入本次调用的私有 frame，再读取 ctx。
getter 从正式 owner 取得新不可变切面，facade 转发属性描述符，不能在对象 spread 时提前求值。

reader 同步且纯，不调用断言、模型或应用动作。读取期间重入 check/closeQA 在下一次读取前拒绝，finally 清除私有读取标记。
reader 返回的受管集合必须具有相同 runtime owner、scope 与 sequence cut。
跨 owner 或 scope 为作者错误；材料 reader 返回旧 cut 为 unavailable，不以旧前缀证明完整问答。
显式 managed subject 的 check 仍按前文使用 subject 自带 cut，不重新裁切。

## Agent 默认历史

默认 history reader 由 Agent facade 拥有，只把正式账本投影为只读 DTO，不进入中立 core 或公共材料绑定表。
它保留正式事件与精确关联工具事实，不使用仅含三类事件的薄 eventOccurrences 投影来冒充完整历史。

| 材料 | 完整性要求 |
|---|---|
| Agent 默认历史 | events、messages、actions，以及当前 cut 内全部 sealed observed send。usage/data 不参与。 |
| EventMatch | 沿用正式 eventOccurrences 的完整性，不由默认历史的额外工具关联要求降级。 |
| ToolMatch | actions 及正式 cut 内工具关联。 |

成功、失败和中断的每次实际 send 都封存 outcome 与 evidence coverage，即使没有返回 Turn handle 也保留正式事件。
没有可信完整 Turn、正在执行的 send、缺失正式段或未封存的已吸收重试事件都使默认材料 partial，不补造稳定 ID。
orphan、ambiguous、缺失前序或跨 Session 关系保留原行与具名原因，不丢掉整组，也不猜测问题是否需要它们。

Turn 先按封存的 throughSessionSequence 读取同 Session 前缀，关联全部前缀，再选择该 Turn 的事件。
Session 与 Attempt 使用各自 call-time cut；关联、enrichment 和完整度均不能越 cut。
旧 Turn 不取得后续回执；后续 Turn 可以使用自身前缀内的工具开始事实。
排序按正式 Session 分组与 sessionSequence，不把跨 Session 数组顺序解释为墙钟因果。
正式 summary 保持字段标签，不冒充 provider 原文。

通用 closeQA 在参数验证后把材料声明与问题编译为私有评分 Match，再交给同一 receiver 的 check。
编译不执行 reader、不捕获应用事实、不取得新 runtime；Agent 默认与领域简写都归一化为现有 MaterialMatch。
关闭作者阶段先禁止登记和读取，清除全部 receiver 的 readContext/readCut/default-reader 与私有 cut frame。
提取的方法同样先被 guard 拒绝；已登记断言只持有捕获事实，不能重新读应用或发送模型。

## Agent 用量贡献与读取

SessionManager 在每次实际 send 开始时创建 pending 贡献，终结时冻结用量、coverage 与 outcome。
Ledger hook 在调用 Agent 前失败时不创建贡献；自动重试的每次调用各自登记，不按逻辑 Turn 去重。

```ts
interface AgentUsageContribution {
  readonly sessionScopeId: string;
  readonly turnId: string;
  readonly sendAttempt: number;
  readonly state: "pending" | "terminal";
  readonly outcome: "completed" | "failed" | "interrupted" | null;
  readonly model: string | null;
  readonly usage: Readonly<Usage> | null;
  readonly coverage: ResolvedEvidenceCoverage["usage"];
}
```

sendAttempt 从 0 开始；pending 的 usage/outcome 为 null。终局失败、已吸收重试与成功返回都保留终态贡献。
一次 send 可以包含多个内部模型请求，因此该贡献不是物理请求计数。
Turn 统计含逻辑 send 的全部重试；Session 按 sessionScopeId 选择；Attempt 包含全部贡献。
贡献、不可变读取切面与每次 send 的完整性都由正式 owner 保存，不由 Eval 聚合日志或成功 Turn 列表重建。

getter 先经过 authoring-open guard，每次返回与账本隔离的深冻结切面；后续上报不修改旧变量或已登记断言。
逐贡献的 token、费用与 maxTokens/maxCost 使用 [官方用量投影](../../adapters/library/README.md#读取官方用量与耗时)，不另建预算算法。
范围内 pending、partial coverage 或缺桶阻止 exact；已知非负值保留为 lower-bound，全部未观测则 unavailable。
非法数量使对应指标 unavailable，不能通过补零消除缺口。
金额在每项进入投影时先规范为 canonical decimal，再做定点累加和比较；真实零优先，未知或非 USD 费用不能证明 USD 上限通过。

## `succeeded`

`succeeded` 读取可信终态和 unresolved HITL。它不是 `noFailedActions` 的别名：一次 action 失败后如果
协议恢复为 completed，`succeeded` 可 matched，而 `noFailedActions` 保持 mismatched。

协议终态为 failed 时 `succeeded` mismatched。只有消息文本含“502”而协议为 completed 时，不猜测失败。
Adapter 或 transport 不能给出可信 snapshot 时，Attempt 是 execution error。Judge evaluator 的失败不影响
`succeeded`。

根 `t.succeeded()` 在零活动时确定地 mismatched。运行中或没有可信终态的 scope 不能被当作 completed，
也不能用 last status 代替 vector cut。

## 停止

scoped Boolean handle 可 `await .orStop()`。mismatch 会设置 authoring stop latch；已登记 scope Assertion
仍结算，未执行到的源码不会凭空产生结果。`stop` 的持久 source site 只保存实际执行的位置；详细的
handle 规则见 [Assertions Library](../library/README.md#handle-配置)。
