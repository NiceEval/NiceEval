# 模拟用户 —— 让一个 agent 替用户回答被测 agent 的提问

被测 agent 在任务中途停下来提问（`input.requested`，或在回复里列出待确认的选择）时，题目需要有人回答。
手写回答只有两种做法：一律回固定的一段话，或者按关键词猜对方问了什么再拼预设答案。前者答非所问，后者对措辞敏感，被测 agent 换一种问法就拿到不同的回答。

模拟用户是一个扮演用户的 pi agent。作者写下这位用户知道什么、已经决定了什么，它读被测 agent 实际的提问，按这些事实作答，没决定过的事交还给被测 agent 自己判断。

能写成固定一句话的续轮（例如"继续"）仍然直接 `t.send`。模拟用户只用于回答内容取决于对方怎么问的场景，它有随机性，换模型回答会变。

## 定义与调用

```ts
import { defineScoreEval, defineSimulatedUser } from "niceeval";

const owner = defineSimulatedUser({
  instructions:
    "你是 DB-GPT 仓库的维护者，刚让 agent 把 niceeval 接进来。你已经决定：选 Tier 1，首跑不接 OTel；" +
    "目标模型用 /opt/fixture-secrets/target-app.env 里的 TARGET_APP_MODEL，不做 experiment flags；" +
    "可以自主运行、诊断和重试，不限制 Attempt 数。没有可用的 Judge key。" +
    "只回答 agent 问到的事；问到你没决定过的，让它依据仓库与随包文档自己判断。",
});

export default defineScoreEval({
  async test(t) {
    const first = await t.send("READ … and install niceeval for this repo.");
    const user = t.simulatedUser(owner);
    const handoff = await user.reply(first);
    // …
  },
});
```

```ts
interface SimulatedUserDefinition {
  readonly instructions: string;        // 这位用户是谁、知道什么、已经决定了什么
  readonly timeoutMs?: number;          // 单次 reply 的墙钟上限，默认 120_000
}

interface SimulatedUser {
  /** 读 turn 的提问并回答，作为同一 session 的下一轮发送，返回新的 Turn。 */
  reply(turn: Turn): Promise<Turn>;
}

declare function defineSimulatedUser(definition: SimulatedUserDefinition): SimulatedUserDefinition;
// t.simulatedUser(definition): SimulatedUser —— Agent 的 t 与 Session 上可用
```

- `defineSimulatedUser` 从 `niceeval` 导出。instructions 去空白后非空，最多 8 KiB UTF-8 bytes；timeoutMs 为正安全整数；未知字段和 accessor 拒绝，定义校验后冻结。定义没有名字。
- `t.simulatedUser(definition)` 绑定主 Session，在 Session 上调用时绑定该 Session。它属于 Agent 会话能力，普通自定义应用不因提供同名 `send` 方法而取得该能力。
- 同一个 `SimulatedUser` 的多次 `reply` 共用一个 pi 会话。不同实例、Session 或 Attempt 的 pi 历史互不共享；定义可复用，运行期实例不可跨 Attempt 使用。
- `reply(turn)` 只接受同一 session 的最新 Turn：
  - turn 在等待输入（`status === "waiting"` 且有 `inputRequests`）时，为每个请求生成一条回答，按 `t.respond` 的语义作为下一轮发送。请求带选项时，回答必须是其中一个 option id；否则是文本。
  - 非 waiting Turn 读其回复，生成一条消息，按 `send` 的语义作为下一轮发送。waiting 却没有请求时明确失败，不退回普通文本绕过 HITL。
- Turn 必须是本 Attempt、本 Session 实际返回的对象，不能用字段相同的对象冒充。旧 Turn、跨 Session Turn、已关闭实例和同一 Session 的在途驱动均在模型请求与 Adapter 发送前拒绝。
- 生成期间若另一次驱动改变 Session，提交前重新检查最新 Turn 与待处理请求，拒绝过时回答。全部回答先校验再一次性 `respond`：拒绝重复、缺失或未知 requestId，不按回答数组位置匹配。
- 请求带非空 options 时只接受该请求的 option id；没有选项时只接受文本。提交按原请求顺序构造结构化 responses 与文本投影，不能仅把文字拼进 `send`。合法提交至多驱动一次下一轮。
- 发出的内容就是这一轮的用户消息，出现在被测 agent 的 history 与 `show --execution` 里，和作者手写的消息一样计入这轮输入。
- 作者需要多轮问答时自己写循环，例如 `while (turn.status === "waiting") turn = await user.reply(turn)`；NiceEval 不内置自动对话轮次。

## 模拟用户 agent

模拟用户由 NiceEval 在宿主进程里用 pi-agent-core 的 `AgentHarness` 运行，和 [Agent Judge](../../judge/library.md#agent-judge--在-sandbox-里自己取证再评分) 一样直接用 pi：NiceEval 只定义 system prompt 与 `reply_to_agent` 工具，模型请求、上下文、溢出时压缩、usage 与 abort 都交给 pi。

- 模型取这条 Eval × Experiment 生效的 Judge Provider 与模型，包含 Experiment 替换后的模型、endpoint、凭据声明和协议配置，不新增独立模型配置。模拟用户是执行输入生成者，共用 Provider 不使它成为评分者。
- `TypesafeProvider` 不支持，`reply` 抛出 `simulated-user-unsupported-provider`；拒绝发生在创建 harness、读取凭据与发送之前。未配置 Provider 或缺少可选 pi 依赖同样零发送，报告 `simulated-user-failed` 与具名 reason。
- 没有 Sandbox 工具：模拟用户只读被测 agent 的提问，不查看现场。唯一的工具是 `reply_to_agent`，参数 schema 随当前 turn 变化：等待输入时是 `{ answers: { requestId, text | optionId }[] }`，要求每个请求恰好一条；否则是 `{ message }`。
- 系统提示写明扮演用户、只依据 instructions 回答、不替被测 agent 做实现决定、不编造 instructions 里没有的事实。被测 agent 的回复与请求作为不可信 user 内容进入消息。
- 每次 `reply` 最多 4 轮普通模型生成。未调用工具或参数非法时，允许在剩余轮数内修正；第一个合法提交锁定回答，同批后续工具与 pi 自动续轮都不能再次发送。工具执行只交付回答候选，不直接驱动被测 Agent。
- 模型生成、校验与发送约束见[模拟用户架构](../architecture.md#模拟用户)。模型未提交合法回答、期限耗尽、容量不足、压缩失败或传输失败时，`reply` 抛出 `simulated-user-failed`。这些是执行错误，不生成失败 Assertion，也不制造合法的 failed Turn。
- 模拟用户执行失败锁存到 Attempt 的执行 outcome，即使作者捕获异常也不能形成成功结果；[Verdict](../../verdict/README.md) 依既有规则折叠为 `errored`，保留此前的 Assertion facts。Attempt 取消保持 interruption，Attempt deadline 保持原 timeout 归属。
- 回答提交后，下一轮直接经过原 Session 的 `respond` / `send`；发送失败与合法 `Turn.status === "failed"` 保持原契约，不包装成模拟用户失败，不重新生成回答重发。

### 错误归属

以下 code 属于 Attempt 执行 diagnostic，不是新的 Verdict 或 `FailureClass` 类别。
实现需在该 diagnostic owner 的类型、编码与读侧保留 code、phase 和 reason，不能只把 code 放进异常文字。
[失败分类](../../error-classification/README.md) 的 reason 是开放诊断值，不按字符串推导重试或扩大 scope。

| code | reason 与后果 |
| --- | --- |
| `simulated-user-invalid-turn` | `foreign-turn`、`stale-turn`、`session-busy`、`waiting-without-requests` 或 `closed`；拒绝本次调用，不发模型请求或下一轮输入 |
| `simulated-user-unsupported-provider` | `typesafe`；零发送，执行错误 |
| `simulated-user-failed` | `provider-unconfigured`、`pi-unavailable`、`invalid-answer`、`no-answer`、`timeout`、`transport`、`context-overflow` 或 `capacity`；不发送下一轮输入，执行错误 |

模拟用户生成不进入 Agent send 的重试执行体，框架不额外重新发送 pi 模型请求。
终局失败默认 `retryable: false`、`scope: "attempt"`；仅凭 Provider 类型或错误文字不触发 Eval 或 Experiment 级止损。

## 执行活动、用量与身份

- 每次已准入的 `reply` 持久化一条模拟用户执行活动：所回答的 Turn、模型实际收到的提问、提交的回答、请求与响应、耗时与失败原因。失败且未发送下一轮时也保留该活动。
- `show --execution` 在源 Turn 之后、回答驱动的新 Turn 之前显示它。活动使用独立 producer / actor，不把 pi 工具、内部历史、压缩或模型用量归入被测 Agent 的事件、工具断言或 `t.trace`。
- `--expand <stable-id>` 经 `attempt.trace.detail` 读取封存证据，展开模拟用户的 pi 对话（收到的提问、assistant 消息与提交）；分页与容量限制沿用 Inspection，不从宿主现场重建。审计不包含凭据。
- 模型用量不进入 Judge 用量账本，也不进入 `t.usage`：模拟用户的调用不是 Assertion，不能伪造 entry 去满足账本关联。每次 `reply` 的执行活动自带用量：pi 报告的每条 assistant 消息与压缩摘要的 input / output tokens，以及按 Judge Provider 显式估价得到的金额（没有估价时为 unpriced）；失败请求的用量同样保留。
- Attempt 的费用汇总把模拟用户作为独立费用类别 `simulated-user` 计入，和 application、judge 并列显示；未使用模拟用户的 Attempt 没有这个类别。
- 不给每个 Eval 单独增加身份输入。instructions 写在 Eval 源码里，随源码闭包进入 Eval 指纹；生效的 Judge runtime 已经属于既有配置身份，换模型照常让旧结果失效。未使用模拟用户的 Eval 身份不变。
- 模拟用户的系统提示模板、`reply_to_agent` schema 与回答语义属于 NiceEval 运行时行为。改变它们按 [身份域规则](../../experiments/architecture/cache.md#niceeval-身份域变更) 处理：更换对应 domain 并登记为 `behavior-changing` 的具名变更，不声明为 `encoding-only`。首次引入本功能不改变任何既有输入的编码，不需要升域。

## 验收

- 本地 OpenAI 兼容 mock 脚本化 `reply_to_agent`：被测 agent 发出两个 `input.requested`（一个带选项、一个文本），`reply` 为两者各提交一条回答并以同一 session 的下一轮发送；带选项的请求收到 option id；返回的 Turn 是新一轮。
- 被测 agent 没有提问时，`reply` 发送一条消息；同一个 `SimulatedUser` 的第二次 `reply`，请求里含第一次的问答历史。
- mock 不调用工具或参数一直非法时，Attempt 为 errored，原因 `simulated-user-failed`；TypeSafe 零发送并抛出 `simulated-user-unsupported-provider`。
- `show --execution` 显示模拟用户活动与回答；执行活动含用量，Attempt 费用汇总含 `simulated-user` 类别。
- 未使用模拟用户的 Eval 身份不变（identity-domains release 测试保持通过）；改 instructions 或换 Judge 模型让使用它的 Eval 重新规划。
- mock 只替代外部 HTTP 模型边界，执行安装后候选的公开 API 与真实 pi harness。兼容 Chat Completions 的流式工具调用与 usage，捕获请求体；不 mock 核心 Session、工具校验、缓存规划或账本。
- 重复、缺失、未知 requestId、错误 option id 与同时出现 text/optionId 均零 Adapter 发送；修正后只发送一次。旧 Turn、跨 Session Turn、并发驱动与关闭后调用均按错误契约拒绝，互不污染历史。
- 验证首个合法提交后，同批重复工具和迟到响应不会再次驱动；超时、取消和压缩失败不发送回答，取消后没有继续发出的模型请求。
- 通过脚本化溢出响应触发真实 `compact()`，核对摘要请求、重发与用量；四轮上限与同一 reply 的 deadline 不因压缩重置。
- 未使用模拟用户的 Eval 不新增任何身份字段；失败请求的用量与审计可离线读回。

HTTP mock 证明协议、状态与归属的确定性结果，不证明真实模型会忠实遵守 instructions；事实遵循的质量评估属于独立的模型实验。
