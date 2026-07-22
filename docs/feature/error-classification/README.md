# 执行错误类型:瞬时 vs 确定性

turn 级错误分类与有界重试:把 [sandbox 层已有的瞬时/确定性两维分类](../sandbox/architecture.md#provisioning-失败与重试)延伸到 agent turn / adapter stream 这一层,让「换个时机大概率能过」的瞬时故障在 attempt 内部自愈,而不是把基建抖动放大成 `errored`。

## 动机

一次 turn 失败若只拍平成一个不透明的 `AttemptError{code: "turn-failed"}`、message 是 adapter 吐出的原始一行文本,瞬时故障(限流、连接中断)与确定性错误(同因必复现)就无法区分,带来两个问题:

1. **没有重试**:限流这类瞬时故障当次 attempt 直接判 `errored`,唯一的自愈手段是重新调度整次实验(靠 `runs` + `earlyExit`),粒度太粗——重新走一遍 setup、已经 `passed` 的 attempt 也要重新决定要不要重放,而不是「这一次 send 换个时机再试一次」。
2. **run 级 fail-fast 误杀瞬时故障**:[run 级止损](../../runner.md#首过即停earlyexit)按 `result.error.code` 连续复现判定确定性错误、停止派发同 key 的后续 attempt。当所有 turn 失败共享同一个粗粒度 code 时,高并发批跑里限流大概率连续撞上,止损机制会把最该重试的场景当成确定性错误放弃派发。

真实样本(批跑时多条 attempt 同报):

```
This send returned failed (turn status = failed): agent run exited with code 1 ·
last error: stream disconnected before completion: Concurrency limit exceeded for
user, please retry later
```

## 分类

分类结果分两层:**顶层是二分的决策——可重试还是不可重试**,这是重试执行体唯一消费的轴;其下挂一个开放词表的 `reason` 细分(内建兜底产出 `"rate_limit"` / `"network"`,adapter 分类器可自造词),只进观察面(activity、耗尽摘要),不参与策略。

```ts
export type TurnErrorClass =
  | { readonly retryable: true; readonly reason: string }    // reason 必填:进 activity 与耗尽摘要
  | { readonly retryable: false; readonly reason?: string };
```

turn 失败没有 provisioning 那类「远端可能已创建计费实例」需要对账的歧义后果,决策只需要一个轴:是否瞬时。所有可重试失败共享同一套退避策略——`reason` 不同不改变重试行为,它回答「为什么」,不回答「怎么办」。把决策与诊断拆成两层的理由:框架预设不了所有错误的细分词表,adapter 细分自家错误(队列满、模型预热中)时不该被迫塞进 `rate_limit` / `network` 两个桶;而「要不要重试」是封闭问题,二分即穷尽。

**分类判据是重试安全性,不是错误文案的相似度**:只有能证明「这次输入未被 agent 受理」的错误才归可重试——

- `"rate_limit"`(内建 reason):服务端在受理前拒绝(429、限流关键字、明示 "retry later")。样本里的「Concurrency limit exceeded for user, please retry later」属于这类:它虽经 stream 断开的包装浮出,但本质是入场拒绝,服务端明说了请重试。
- `"network"`(内建 reason):连接建立失败(DNS 解析失败、连接被拒、TLS 握手失败、首字节前超时)——请求根本没到 agent。
- 其余一切不可重试,包括无法证明 agent 未开始处理的流中断、响应中途连接重置。

判据的理由:重试等于把同一段 user text 原样重发。若 agent 在失败前已经执行了部分工具调用、写了 workspace,重发会让它把做过的操作再做一遍,产出一个被污染的判定——比一次诚实的 `errored` 更糟。所以歧义一律不可重试:宁可判死一个 attempt,不产出不可信的 verdict。这与 provisioning 分类「偏向宽认瞬时」方向相反,因为两处误判的代价不对称方向相反:provisioning 误重试的代价只是封顶的退避时间,turn 误重试的代价是判定正确性。

一次 send 的失败以两种形态浮出——`send()` 抛出异常,或返回 `status: "failed"` 的 Turn(agent CLI 退出码非零、流中断都以后者浮出,上面的真实样本即是)。两种形态都进分类;精确的输入形状(`TurnFailure`)与三道分类链(adapter 分类器 → 保守兜底 → 执行体的受理证据门)见 [Architecture](architecture.md#数据建模)。

分类精度按 adapter 分别实现:不同 CLI / SDK 的错误形状不同,adapter 可自带分类器覆盖兜底(可选能力,挂在 [agent 契约](../adapters/architecture/agent-contract.md)的 `classifyTurnError` 字段上,与 sandbox 各 provider 自带 `classifyProvisionError` 同一套路,写法见 [Library](library.md#adapter-作者classifyturnerror));外层有一个保守的兜底分类器,复用 sandbox IO 分类器的正则形状——限流关键字 → 可重试(`"rate_limit"`),连接建立层错误 → 可重试(`"network"`),其余 → 不可重试。

## 挂载点与重试范围

分类与重试只包住对 `agent.send(...)` 的那一次调用,不重放会话记账——`session.turnCount` 自增、`userEvent` 推入事件流这些在 send 之前就发生,重试不重复它们;重试成功后的 turn 数与事件流,与一次成功的 send 无异。变更归因的 send 窗口横跨全部尝试:同一段逻辑输入只有一个窗口。分类判据保证被重试的错误发生在 agent 受理之前,窗口内不应有 agent 写入;万一分类器误判、失败尝试里已有写入,它们仍落在同一个 send 窗口、归因给 agent,归因契约不破。

重试预算两层:单次 send 封顶 4 次尝试,整个 attempt 另有加总的重试上限——多轮 eval 每轮都在限流窗口里挣扎说明环境有系统性问题,该如实 `errored`,不该把 attempt 泡在退避里蚕食 deadline。执行体的精确契约——两层预算的数值、基数 5 秒的全抖动指数退避、退避期间释放并发槽位、activity 反馈形态、耗尽后的错误摘要——见 [Architecture · 重试执行体](architecture.md#重试执行体)。重试封顶后,`agent.send()` 最终返回的失败 Turn 照旧走 `expectOk()` → `TurnFailed` → `AttemptError{code: "turn-failed"}` 路径,下游契约不变。

## 在自愈阶梯里的位置

瞬时故障的自愈分三层,由内向外,每层只兜上一层兜不住的:

1. **agent 内层自愈**(能力因 agent 而异):被测 CLI / SDK 自己的重连与续传——codex 断连会带着会话现场自动重试接着跑,bub 则没有这层。这是唯一能「从断点续传」的层,因为会话状态在它手里。adapter 不代偿这层能力,不在 `send` 里自己整段重发;`send` 浮出的失败视为 agent 侧自愈的最终结果——有内层自愈的 agent 浮出失败,意味着它自己已经放弃。
2. **turn 级重试**(本功能):对受理前的失败整段重发同一段 `TurnInput`。它只兜「输入还没进 agent」的窗口——正因为断点续传只有内层做得到,本层对流中断这类「已进 agent」的失败重发只会让 agent 重做已做过的操作,一律不可重试。
3. **重跑 eval**(最外层恢复路径):重试耗尽或不可重试的失败落成 `errored`;`errored` 不进指纹缓存,重跑同一条命令即是续跑,只补跑失败的 attempt(见 [Runner · 缓存](../../runner.md#缓存指纹去重))。

## 与 run 级 fail-fast 的关系

turn 级重试是 fail-fast 之下的前置吸收层:fail-fast 只在 attempt 拿到「重试已耗尽」的最终结果后才看到一次 `errored`,而不是原始的第一次瞬时报错。run 级 streak 判定本身不改——它继续按 `result.error.code` 连续复现判定确定性错误,只是这个 code 出现的前提已经变成「瞬时故障重试封顶后依旧失败」,信号比原始抖动干净。

## 非目标

- 不改变 `AttemptError.code` 的公开形状或 `errored` 判定语义——重试是 `send()` 内部的自愈,对外仍然只暴露「这次 attempt 到底 errored 没有」。
- 不复用或修改 sandbox provisioning 重试的实现——那层要处理「远端资源是否已创建」的对账,turn 级不需要;两层只共享分类思路、退避形状与槽位接口。
- 不在 CLI 或 `defineEval` / `defineExperiment` 加用户可见的重试配置——封顶次数与退避参数是固定值,有真实需要再考虑开放。
- 不改 `runs` / `earlyExit` / run 级 fail-fast 的既有语义,只在其下新增一层更小粒度的吸收。

## 相关阅读

- [Architecture](architecture.md) —— 类型形状、分类链、重试执行体与不变量。
- [Library](library.md) —— adapter 作者怎么写 `classifyTurnError`;eval / 实验作者的观察面。
- [用例](use-case/README.md) —— 批跑限流自愈、流中断为什么不重试、给 adapter 写分类器。
- [Runner](../../runner.md) —— earlyExit、run 级 fail-fast 与外层超时。
- [Sandbox · Provisioning 失败与重试](../sandbox/architecture.md#provisioning-失败与重试) —— 被对齐的分类与退避形状。
- [Adapter · agent 契约](../adapters/architecture/agent-contract.md) —— `classifyTurnError` 的挂载面。
