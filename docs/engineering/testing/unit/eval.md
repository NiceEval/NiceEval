# Eval 与 Context 怎么测

契约来源：[Eval](../../../feature/eval/README.md)、[Library](../../../feature/eval/library.md)、[Context](../../../feature/eval/library/context.md)、[Architecture](../../../feature/eval/architecture.md)、[执行错误类型](../../../feature/error-classification/README.md)。测试重点不是 `defineEval` 返回了几个字段，而是 eval 作者观察到的 context、session、turn 和能力边界是否符合契约。本篇的缝：fake 自有 `Agent` / `Sandbox` 接口，测其上的 Context 逻辑；缝的真实侧（真实 Agent）由 [E2E 适配器域](../e2e/adapter/README.md)验收（[Fake 边界](README.md#fake-边界mock-什么测哪一层)）。

## 观察面与边界

| 契约域 | 观察面 | Fixture |
|---|---|---|
| 发现与 id 推导 | 发现结果的 id 集合与错误反馈 | 临时目录里的 `.eval.ts` / `.eval.tsx` 文件树 |
| `send()` 后即时读取 reply、events、usage 和 sessionId | `TestContext` 公共属性 | scripted Agent |
| 多轮续接与多 session 隔离 | Agent 收到的 `TurnInput` | 记录输入的 scripted Agent |
| HITL 回答与 pending request 对位 | 下一次 `send` 输入或明确错误 | waiting Turn 序列 |
| Sandbox 能力只出现在正确构造路径 | 公共类型与运行时 capability guard | remote/sandbox 两种 Agent |
| eval 相对路径按定义文件目录解析 | Sandbox 收到的规范化路径 | recording Sandbox |
| setup 时机与 cleanup | 生命周期事件顺序 | 记录调用序的 setup/cleanup 闭包 |
| turn 瞬时错误分类与重试 | 重试次数、会话记账、最终 AttemptError | 按脚本抛错或返回 failed Turn 的 Agent |

## Fixture 规范

Context 测试不需要真实模型。 Fixture 只实现 Agent 契约，按顺序返回预设 Turn，并记录收到的输入：

```ts
import type { Agent, Turn, TurnInput } from "../../types.ts"

interface ScriptedAgent extends Agent {
  readonly received: TurnInput[]
}

function scriptedAgent(turns: readonly Turn[]): ScriptedAgent {
  const received: TurnInput[] = []
  let cursor = 0

  return {
    name: "scripted",
    kind: "remote",
    received,
    async send(input) {
      received.push(input)
      const turn = turns[Math.min(cursor, turns.length - 1)]
      cursor += 1
      if (turn === undefined) throw new Error("fixture has no turns")
      return turn
    },
  }
}
```

这个 fixture 不解析 prompt、不生成答案，也不复制 session 实现；否则测试会同时验证两份相同算法。session 续接规则由生产 Context 决定，测试通过 `received` 断言 Context 发对了什么。

`contextFixture({ agent })` 在 scriptedAgent 之上补齐 `createEvalContext` 需要的中性参数（recording Sandbox、空 flags、AbortSignal、静默 log），让单条测试只写与契约相关的输入。所有权与稳定性规则见 [Harness](harness.md)。

能力由构造决定时，合法与非法调用分别放进 typecheck fixture：合法组合正常编译，禁止组合用 `@ts-expect-error` 锁住；运行时测试仍要覆盖从非类型化 JavaScript 或错误构造进入时的 capability guard。

## 覆盖规范

每个域必须证明的行为类别与不允许静默放走的错误；具体场景由测试代码枚举，测试名描述契约和场景：

- **发现与 id 推导**：id 只从文件路径推导（配置对象禁止 `id`/`name`）；`.eval.ts`/`.eval.tsx` 两种后缀同规则，其它后缀不被发现；数组与 keyed record 扇出的 id 构成与顺序稳定性；非法 key 的完整报错。必须同时覆盖"应发现"与"不应发现"的两面。
- **`defineEval` / `defineScoreEval` 的题型标记**：`defineEval` 产物恒 `scoring: "pass"`，`defineScoreEval` 产物恒 `"points"`——两者字段与校验规则完全同形（拒绝显式 `id`、拒绝显式 `scoring`、要求 `test` 为函数、`environment` 非空字符串），各自的报错消息各自指名函数名，不复用对方文案。`defineScoreEval` 的 `test(t)` 里 `t` 允许调用 `.points(n)` / `t.score(label, n)`，且 `.points(n)` 之后只剩 `.gate()` / `.optional()`、这套 `t` 上没有 `t.require`（类型层证明，见 typecheck fixture）；跨题型复用的 helper 标注 `BaseTestContext<H>` 时两种 `t` 都能传入。
- **send 与 turn**：`send` 的输入形态与不可变 Turn；send 后 `reply`/`events`/`sessionId` 反映本轮结果——直接观察用户会读取的值，只断言 `agent.send` 被调用一次发现不了 Context 暴露旧快照的 bug；`turn.status` 三值与 usage 可缺失；**多轮 Usage 累计的诚实口径**——adapter 未报告的字段(`requests`、cache 计数)累计后保持省略,不得以 0/每轮 +1 凑数,fixture 要区分「报了 0」与「没报」两态;轮标签铸造规则（主会话 `turn<N>`、新会话 `session<K>/turn<N>`）；`sendFile` 的 MIME 推断与错误反馈；turn 级断言失败不中断 `test()`。
- **Session**：session 与主 session 的读写隔离（各自续接、respond 不串消费），同时新 session 的事件仍汇入 `t.*` 聚合——隔离与聚合两面都要有区分力场景。
- **作用域断言的接收者行为**：`t.*` 全量聚合 + final timing、`session.*` 时点快照、`turn.*` 本轮独占；接收者专属 API 的类型边界。判定语义的完整矩阵归 [Scoring](scoring.md)，这里只测接收者行为。
- **HITL**：`requireInputRequest` 的恰好一个语义（0 个、多个都报错）；filter 的匹配与不匹配；无法对位时**先报错且不向 agent 发送任何响应**——错误反馈正确但响应已发出仍违反契约，`agent.received` 长度必须一并断言；`respond`/`respondAll` 的续接与跨 session 隔离。
- **Sandbox 能力暴露面**：`t.sandbox` 只在声明 capability 时存在，未声明时是明确错误而非 undefined；文件只经显式上传进入沙箱；本地路径按 eval 定义文件目录解析；`t.sandbox` 面不含生命周期动作。路径、命令与生命周期契约归 [Sandbox](sandbox.md)。
- **judge 作用域与诊断**：判卷材料随接收者分层、`{ on }` 覆盖；`diagnostic` 不改变 verdict、scope 不可伪装；`progress` 不进最终输出。judge 的评分与模型解析归 [Scoring](scoring.md)。
- **turn 瞬时错误与重试**：兜底分类器按重试安全性给出可重试/不可重试与内建 reason（rate_limit / network），`thrown` 与 `turn-failed` 两种 `TurnFailure` 形态都要有区分力场景；adapter 分类器的覆盖、自定义 reason 原样透出、返回 `undefined` 与抛错同样按 `undefined` 回落（继续问后续通道，不掩盖原始失败）；受理证据门对带 agent 产出事件的失败 Turn 的否决——文本像限流也不重试；重试只包 `agent.send`、会话记账不重放、被吸收尝试的事件不落账；send 级与 attempt 级两层预算各自封顶——多轮 send 里 send 级预算重置而 attempt 级预算持续扣减必须有区分力场景；耗尽后错误码不变与 message 重试摘要注明耗尽层（未重试的失败无后缀）；退避可被中断干净打断。
- **失败分类链的两轴扩展**：抛出点糖衣类经 `failureClassOf` 结构识别——含 `cause` 链穿透（被包装再抛不丢声明）与不依赖类身份（结构相同的手工对象同样命中）；turn 链的决议序（抛出点 → 实验分类器 → adapter → 兜底，先非 `undefined` 定案；实验分类器与 adapter 同时认领同一失败时实验的 scope 声明胜出要有区分力场景）与生命周期阶段链（无兜底正则、缺省 `{ retryable: false }`）各有区分力场景；实验分类器 `AttemptFailureInfo` 的 `text` 与报错文案同源；分类器抛错按 `undefined` 回落且不掩盖原始失败；受理证据门只降时间轴、不触碰 `scope`；`scope` 缺省 `"attempt"`；`retryable: true` 带 `scope` 的失败被重试吸收后不外泄 scope，耗尽后携带 scope 浮出。

## 不这样测

- 不断言 `defineEval(x)` 与 `x` 是同一个对象，除非对象身份本身是公开契约。
- 不为每个 Context getter 各造一套 Agent；同一轮状态的多个公共视图在一个场景里一起证明。
- 不让 fake Agent 自己实现 session 续接规则；它只记录输入，由测试断言 Context 发对了什么。
