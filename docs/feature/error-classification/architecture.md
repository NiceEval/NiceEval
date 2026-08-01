# 执行失败分类 —— 架构

分类与两个执行体(重试、止损闸)怎样长在运行管道上:类型形状、分类链、执行体契约、Effect 边界与不变量。
判据本身(两轴各自的可证明性、组合规则)单源在 [README · 分类](README.md#分类),本篇不复述。

## 数据建模

实体关系一句话:**分类是数据(`FailureClass`),类只是它的便利构造;各声明通道(fatal 错误类、三个分类器)产出这份数据,两个执行体在各自的消费点读它。**
声明方只回答封闭问题(可不可重试、波及多远);重试几次、退避多久、闸怎么落全部归执行体,声明方不感知也不能影响策略——core 不按 agent 或 experiment 名字分支,策略对所有声明方一致。

### 类型

词表与守卫从包根导出,`niceeval/adapter` 复导出同一形状——eval 作者与 adapter 作者各自的入口拿到的是同一个类型:

```ts
/** 空间轴取值:失败死因的波及范围。 */
export type FailureScope = "attempt" | "eval" | "experiment";

/**
 * 一次执行失败的分类:retryable(时间轴)与 scope(空间轴)是仅有的两条决策轴;
 * reason 是开放词表的细分诊断,只进 activity 与诊断文案,不参与策略。
 * 内建回退产出 reason "rate_limit" | "network";声明方可自造词。scope 默认值 "attempt"。
 */
export type FailureClass =
  | { readonly retryable: true; readonly reason: string; readonly scope?: FailureScope }
  | { readonly retryable: false; readonly reason?: string; readonly scope?: FailureScope };

/** send() 无法返回可信 Turn 时 reject 的结构化 envelope。 */
export interface SendFailure {
  readonly type: "agent-send-failed";
  /** 协议对本次输入是否已开始处理的证据；只有 rejected 允许整段重发。 */
  readonly acceptance: "rejected" | "started" | "unknown";
  readonly message: string;
  readonly cause?: unknown;
  readonly events?: readonly StreamEvent[];
  readonly usage?: Usage;
  readonly process?: {
    readonly exitCode?: number;
    readonly signal?: string;
    readonly stdout?: string;
    readonly stderr?: string;
  };
}

/** adapter 可选分类器:返回 undefined 表示「不认识,交给后续链路」。 */
export type SendFailureClassifier = (failure: SendFailure) => FailureClass | undefined;

/** 与最终 AttemptError 和回退分类器同源的有界、脱敏失败摘要。 */
export function sendFailureText(failure: SendFailure): string;

/** 实验级分类器的输入:本实验任意 per-attempt 阶段的一次终局失败。 */
export interface AttemptFailureInfo {
  readonly phase: LifecyclePhase;
  /** 与报错文案同源的失败文本；SendFailure 取 sendFailureText，其它阶段取错误链 message。 */
  readonly text: string;
  readonly cause: unknown;
}

/** 实验可选分类器,挂载在 ExperimentDefinition.classifyFailure:识别自家共享基建的死因。 */
export type AttemptFailureClassifier = (failure: AttemptFailureInfo) => FailureClass | undefined;
```

`retryable: true` 时 `reason` 必填是类型级规则:可重试的失败一定出现在 activity 行与可能的耗尽摘要里,那里需要一个给人读的词;不可重试的失败常常说不清是什么(这正是它不可重试的原因),`reason` 可省略。

**抛出点 fatal 错误类**,包根导出,面向 eval / 实验作者:

```ts
/** 从任意 per-attempt 阶段抛出:全实验剩余 attempt 同因必死,停止派发。 */
export class ExperimentFatalError extends Error {
  readonly _tag: "NiceevalClassifiedError";
  readonly class: FailureClass;   // { retryable: false, scope: "experiment" }
  constructor(message: string, options?: { cause?: unknown });
}

/** 从任意 per-attempt 阶段抛出:本 eval 剩余 attempt 同因必死,停止派发。 */
export class EvalFatalError extends Error {
  readonly _tag: "NiceevalClassifiedError";
  readonly class: FailureClass;   // { retryable: false, scope: "eval" }
  constructor(message: string, options?: { cause?: unknown });
}

/** 结构守卫:识别任何携带分类的错误对象。识别的唯一契约。 */
export function failureClassOf(error: unknown): FailureClass | undefined;
```

fatal 错误类的契约是 `_tag` 与 `class` 两个数据字段,识别一律走 `failureClassOf` 的结构检查,不用 `instanceof`——依赖树里出现第二份 niceeval 实例(link、版本重复)时类身份静默失效,数据不会。
`failureClassOf` 沿 `cause` 链逐层查找、取最外层携带分类的错误——作者的 fatal 错误类被上层库包装再抛时声明不丢失。

fatal 错误类不继承任何 effect 类型,公开 `.d.ts` 零 effect 依赖——用户只写 async 函数的公开 API 边界不因此破例。
fatal 错误类只覆盖空间轴的两个非默认档;默认档(`scope: "attempt"` 的普通失败)不需要类——任何未分类的抛出本来就落成本 attempt `errored`,给默认行为发明类型是噪音。

`Agent` 上的挂载面是可选字段 `classifySendFailure?: SendFailureClassifier`(完整 interface 见 [agent 契约](../adapters/architecture/agent-contract.md#agent-与-turn))。`completed` / `waiting` 是正常形态；`failed` 是可信、可评分的领域失败，三者都不进 send 执行失败分类。
`kind: "direct"` 与 `kind: "sandbox"` 的 agent 走同一条链,契约不分身份。

### 分类链

按失败来源分两条链;每条链上,先给出非 `undefined` 结果的一道定分类,后续不再询问。

**send 执行失败**(`send()` reject `SendFailure`),五道:

1. **抛出点携带的分类**:`failureClassOf` 命中即定——作者知识优先级最高,不再询问任何分类器。
2. **实验分类器**(可选):识别以协议错误形态浮出的共享基建死因(对自家隧道 host 的拒连)。
   排在 adapter 之前:它按自家坐标(host、路径)过滤,特异性高于协议通用形状;两者同时认领的失败恰是 scope 必须赢的场景——adapter 只有时间轴答案,先问它会把实验级死因留在 `"attempt"` 档,止损闸永远落不下。
3. **adapter 分类器**(可选):最懂自家协议的错误形状,返回 `FailureClass` 或 `undefined` 回落。
4. **保守回退分类器**:只在 envelope 同时带有可验证的协议/transport code 时映射通用形状——受理前 429 → `{ retryable: true, reason: "rate_limit" }`;连接建立失败 → `{ retryable: true, reason: "network" }`;其余 → `{ retryable: false }`。
   回退永不给出超出 `"attempt"` 的 scope:框架无法从文案证明兄弟必死。
   失败文本与报错文案都取 `sendFailureText(failure)`，不出现「报错说 A、分类看 B」。文本本身只用于诊断，不能把 `acceptance` 从 `unknown` 猜成 `rejected`。
5. **受理证据门**(执行体的否决权,只裁时间轴):只有 `failure.acceptance === "rejected"` 才保留 `retryable: true`；`started` 或 `unknown` 一律强制降为 `false`。
   Adapter 只有在协议终态、服务端 code 或 transport 阶段能证明未受理时才可写 `rejected`。任何 agent 产出事件都要求至少为 `started`；空 `events`、CLI 非零退出、流中断或 “retry later” 文案都只能是 `unknown`，不能作为反证。
   它不触碰 `scope`:证据门裁的是重发安全性,不是波及范围。
   这道门把「只有能证明未受理才重试」变成结构化机器不变量，而不是从事件缺失或自然语言反推。

**生命周期阶段失败**(sandbox prepare command、`test(t)` 体内、per-attempt 收尾),三道:

1. **抛出点携带的分类**(`failureClassOf`)。
2. **实验分类器**。
3. **默认 `{ retryable: false }`**。
   这些位置没有重试执行体,时间轴即使给出也无人消费(消费点的位置性见 [README](README.md#消费点是位置性的)),链上不挂产时间轴的回退正则。

**provisioning 失败**:sandbox 内部的两维分类(性质 + 后果)自治、不外泄。
向外浮出的确定性配置死因附带 `FailureClass`,scope 按声明 owner 定档:凭据缺失 → `"experiment"`;template 不存在由携带 template 的 owner(eval / experiment)决定波及范围。
scope 由止损闸消费,映射与判据单源在 [Sandbox · Provisioning 失败与重试](../sandbox/architecture.md#provisioning-失败与重试)。
内部分类与回退正则的形状同见该篇;两边正则表各自实现,sandbox 的错误模块不外泄到 context 层,重复是模块边界的价格,刻意付。

**分类器纪律**(对 adapter 与实验分类器一致):快、纯、不抛错——分类器抛错按 `undefined` 回落处理、自身错误被吞掉,分类是旁路,不得用新错误掩盖原始失败。

## 重试执行体

执行体包住 context 层对 `agent.send(...)` 的那一次调用——全仓库只有这一个 choke point,adapter、runner、eval 都不再各自处理瞬时错误。
进入执行体的失败已是 agent 内层自愈(被测 CLI 自己的断连重连,能力因 agent 而异)的最终结果,执行体不区分、也不探测 agent 有没有这层能力([分层契约](README.md#自愈阶梯与止损阶梯))。
时序:

1. 会话记账(`session.turnCount` 自增、`userEvent` 推入事件流)在进入执行体之前完成,整个重试循环内不重复。
2. 调 `agent.send(input, ctx)`。
   返回 `completed` / `waiting` / `failed` Turn → 原样交回管道,循环结束；领域失败 Turn 从不重试。
3. reject `SendFailure` → 走分类链。
   `retryable: false`，`acceptance !== "rejected"`，或两层重试预算任一耗尽 → 循环结束，写 `AttemptError{code: "agent-send-failed"}` 并携带其 `FailureClass` 向下浮出。
4. `retryable: true` → 退避睡眠 → 回到 2,原样重发同一个 `TurnInput`。

`scope` 不影响重试行为:执行体只读时间轴。
被吸收的失败不进入逻辑会话事件流,避免重发产生的半截消息参与行为断言；但每次物理尝试都追加到 Attempt 的 `retryAttempts`,保留 acceptance、分类、events、usage、process 与耗时。
顶层 usage / cost 汇总所有物理尝试，最终成功不会抹掉前面已经花掉的 token 与钱。
被吸收的失败仍不到止损闸；它是可观测证据，不是终局失败([组合规则](README.md#分类))。

### 退避与槽位

| 参数 | 契约 |
| --- | --- |
| send 级预算 | 每次 send 调用封顶 4 次尝试(首次 + 至多 3 次重试),退避的指数底数按本次 send 内的重试序号走 |
| attempt 级预算 | 整个 attempt 全部 send 加总的重试次数封顶 8 次;预算耗尽后,后续可重试失败不再重试、直接浮出。两层预算叠加:单轮抖动由 send 级吸收,多轮持续挣扎由 attempt 级止损——环境系统性出问题时该如实 `errored`,不该把 attempt 泡在退避里蚕食 deadline |
| 退避 | 指数 + 全抖动:第 n 次重试前睡 `uniform(0, 5s × 2^(n-1))`,上界依次 5s / 10s / 20s |
| 槽位 | 睡眠期间释放**全局并发位**,睡醒重新排队(与 [provisioning 重试](../sandbox/architecture.md#provisioning-失败与重试)同形的槽位接口,不共享实现)——被限流的一批 attempt 不占着全局名额陪睡。让出的位立刻派给排队中的 attempt:全局位保吞吐,不保「限流时降压」——agent 侧按用户计的并发限额在退避期间仍被新 attempt 顶满,退避换不来空余限额,live 面板的 `running` 行数也因此可超过全局上限(睡眠者计 running 但不持位)。要「被限流时不加压」,用实验级 `maxConcurrency` 闸——它**不释放**:名额与 attempt 同生命周期(语义单点见 [Runner · 调度](../../runner.md#调度有界并发)),退避期间继续持有,串行 / 降速实验被限流时不向同实验放行更多 attempt |
| 中断 | 退避睡眠可被 interruption 干净打断;随后仍须重新取得已释放的全局并发位,才会把中断向外传播——这是 permit 记账不丢失优先于中断及时性的阶段性取舍。attempt 外层 deadline 原样生效,重试不延长任何预算,不新增第二套超时语义 |

基数比 provisioning 的 1 秒大一个量级:限流窗口通常以十秒计,过小的基数只会让前几次重试在同一个限流窗口里白烧尝试次数。

## 止损执行体

止损闸消费终局失败的空间轴,粒度两级:每个 experiment 一把实验闸,每个 (experiment, eval) 一把 eval 闸;实验闸落下蕴含该实验全部 eval 闸。

**触发**:attempt 封口时读取终局失败携带的 `FailureClass.scope`——`"eval"` 落对应 eval 闸,`"experiment"` 落实验闸。
落闸幂等:并发 attempt 同时声明同一死因是常态,重复触发只折叠诊断计数。
落闸在 invocation 内不可逆:在飞 attempt 后续成功不重开——作者背书的判定不被单次成功推翻,抖动的服务不该让调度来回摆;恢复的正路是修复后重跑(见下)。

**派发**:attempt 取并发位之前检查所属闸;闸落 → 不派发。
等待集中同闸的 attempt 走既有 interruption 通路中止、退出等待集。
检查点存在良性竞态——闸落下的瞬间可能有 attempt 已越过检查、照常跑完,代价是多烧一个沙箱,不为它引入额外互斥。

**记账**:未派发的 attempt 计入 `unstarted`,完成状态 `incomplete`(与 run 级 fail-fast 停派发同一记账通路,见 [Runner · 完成状态](../../runner.md#完成状态));不为没跑过的 attempt 制造 `errored` 记录。
退出码由观察到失败的那条 `errored` attempt 保证判红。

**诊断**:每次落闸经[实验域诊断通路](../../runner.md#实验域诊断持久化)落一条:

```ts
{
  code: "dispatch-halted",
  level: "error",
  phase: /* 触发失败所在的生命周期阶段 */,
  message: /* 触发失败的 message,即作者的修复提示 */,
  data: { scope, evalId? },       // evalId 仅 eval 闸有
  dedupeKey: /* scope + evalId,重复声明折叠计数 */,
}
```

运行期反馈流同时收到同源 message 的即时通知;双通路互不派生是实验域诊断的既有规则。

**生命周期边界**:

- 实验级 `setup` 里抛 fatal 错误类,与抛任何错误同义——既有语义(全部 attempt 记 `errored(experiment-setup-failed)`、不派发,见 [Experiments](../experiments/library.md#实验级共享服务setup-与-teardown))已是最大止损,不设第二条路径。
- 实验级 `teardown` 里抛,降级为普通 teardown 诊断——teardown 时点已无可保护的派发余量,且止损状态不跨 invocation,声明无处生效。
- per-attempt teardown 里抛,verdict 处理沿用既有规则(teardown 失败是诊断、不改 verdict),但 scope 声明照常落闸——知识就是知识,兄弟 attempt 还在派发中。

**无持久状态**:闸随 invocation 消亡,唯一持久痕迹是 `dispatch-halted` 诊断。
`errored` 与 `unstarted` 均不进指纹缓存,修复后重跑同一条命令即增量续跑,不需要任何解除机制。

## Effect 边界

分类与止损横跨仓库的 Promise / Effect 分界,三环各守其位:

- **公开面(Promise 世界)**:fatal 错误类、`FailureClass`、分类器类型都是纯 TypeScript,零 effect 依赖;用户与 adapter 作者只写 async 函数的公开 API 哲学不变。
  路由借 Effect 生态的 tagged error 习语——`_tag` 数据字段路由、类只负责构造数据——但不 import 它。
- **attempt 边界(Effect 世界)**:Promise 侧的失败穿过边界时归一化为内部 tagged error(`Data.TaggedError`,携带 `FailureClass` 与 phase);实验闸 / eval 闸用 `Effect.makeLatch`(close 幂等、免费满足落闸幂等不变量);等待集中止走既有 interruption。
- **结果建模(`E = never`)**:attempt fiber 的类型保持 `Effect<EvalResult>`,错误通道刻意为空——`errored` 是 eval runner 的合法结果,不是调度失败;scope 信号经封口读取触发落闸,不走错误通道向上传播。
  Effect 的失败三分法与本设计的格子一一对应:typed failure ↔ 被分类的失败,defect ↔ 未分类的意外异常(默认格,`"unexpected-error"`),interrupt ↔ 超时 / 用户中断 / earlyExit / 闸中止,三者不混流。

重试执行体活在 context 层的 Promise 世界:中断响应走 `ctx.signal` 链,槽位释放走 attempt 层注入的 release / reacquire 桥接回调;退避形状(指数 + 全抖动)与 Effect Schedule 同形,不共享实现——`Schedule` 表达不了「睡眠期间释放并发位」的契约。

## 观察面

- **重试中**:走 attempt 的 activity 行,期望形态 `turn retry 2/4 (rate_limit) — waiting 8s`——括号里的词就是分类的 `reason`,声明方自造词原样展示;不产生 diagnostic——这是正常自愈过程。
  重试成功后 activity 恢复常态,永久输出零痕迹。
- **重试耗尽**:浮出的失败 message 追加重试摘要,注明耗尽的是哪层预算——send 级形态 `… · retries exhausted (4 attempts, rate_limit)`,attempt 级形态 `… · attempt retry budget exhausted (8 retries, rate_limit)`;未发生过重试的失败不加后缀。
  摘要只进 message、不进结构化字段——它回答的是人读 `errored` 时的「框架试过了吗」,不是程序要分支的数据。
- **落闸**:反馈流一条 error 级通知,人读文本按[诊断体裁](../experiments/cli.md#人在终端里怎么用)给 error 符号——`✗ experiment halted (dispatch-halted): <message>` / `✗ eval halted: <message>`;`--json` 是同一条诊断的 `warning` 事件(`code: "dispatch-halted"`,`level: "error"`,eval 闸带 `evalId`)。
  两面都只在首次落闸时出现一行、不带折叠计数:落闸后被中止的等待集 attempt 不逐条刷屏,数量体现在完成状态的 `unstarted` 里。
  `run.json` 诊断见[止损执行体](#止损执行体)。

## 不变量

- 重试只包 `agent.send` 一次调用;会话记账、事件流、send 窗口都以「一次逻辑 send」为单位,重试对它们不可见。
- 分类链的任何一道都不能制造新失败;浮出的必须是最终一次尝试的原始错误(message 允许追加重试摘要)。
- send 执行错误统一落 `AttemptError.code: "agent-send-failed"`；领域失败 Turn 只参与断言，不使用该 code。`errored` 不缓存、下次运行照常重跑；scope 不改写错误种类。
- 受理证据门只否决时间轴且压过一切分类器；只有结构化 `acceptance: "rejected"` 能放行重试，它不触碰空间轴。
- 回退分类器永不给出超出 `"attempt"` 的 scope;扩 scope 的声明只能来自携带作者知识的通道(抛出点、adapter / 实验分类器、provisioning 的可证明配置死因)。
- 被重试吸收的失败不抵达止损闸;抵达闸的一定是终局失败。
- 闸只停派发、不抢占在飞;落闸幂等、invocation 内不可逆、不跨 invocation 持久。
- 声明方只影响决策轴与 `reason` 词,不影响策略:重试预算、退避参数、槽位行为、落闸机制对所有声明方一致;`reason` 在整条链路里只出现在 activity 与 message / 诊断文案,不进任何分支条件。
- 识别 fatal 错误类只依赖 `_tag` + `class` 结构,不依赖类身份。

## 相关阅读

- [README](README.md) —— 动机、两轴判据、组合规则、声明通道、止损语义与非目标。
- [Library](library.md) —— fatal 错误类与实验分类器的写法、`classifySendFailure`、观察面。
- [Runner](../../runner.md) —— fail-fast、完成状态、实验域诊断持久化。
- [Sandbox · Provisioning 失败与重试](../sandbox/architecture.md#provisioning-失败与重试) —— 词表对齐的另一处分类与退避形状。
- [Adapter · agent 契约](../adapters/architecture/agent-contract.md) —— `Agent` 完整 interface 与生命周期不变量。
