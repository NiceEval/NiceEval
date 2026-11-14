# 模拟用户 —— 让一个 agent 替用户回答被测 agent 的提问

被测 agent 在任务中途停下来提问（`input.requested`，或在回复里列出待确认的选择）时，题目需要有人回答。
手写回答只有两种做法：一律回固定的一段话，或者按关键词猜对方问了什么再拼预设答案。前者答非所问，后者对措辞敏感，被测 agent 换一种问法就拿到不同的回答。

模拟用户是一个扮演用户的 pi agent。作者写下这位用户知道什么、已经决定了什么，它读被测 agent 实际的提问，按这些事实作答，没决定过的事交还给被测 agent 自己判断。

能写成固定一句话的续轮（例如"继续"）仍然直接 `t.send`。模拟用户只用于回答内容取决于对方怎么问的场景，它有随机性，换模型回答会变。

## 定义与调用

```ts
import { defineSimulatedUser } from "niceeval";

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
// t.simulatedUser(definition): SimulatedUser —— root、custom Adapter 的 t 与 Session 上可用
```

- `defineSimulatedUser` 从 `niceeval` 导出。instructions 非空，最多 8 KiB；timeoutMs 为正安全整数；未知字段和 accessor 拒绝，定义校验后冻结。定义没有名字。
- `t.simulatedUser(definition)` 绑定当前 session（在 Session 上调用时绑定该 Session）。同一个 `SimulatedUser` 的多次 `reply` 共用一个 pi 会话，记得之前问过什么、答过什么。
- `reply(turn)` 只接受同一 session 的最新 Turn：
  - turn 在等待输入（`status === "waiting"` 且有 `inputRequests`）时，为每个请求生成一条回答，按 `t.respond` 的语义作为下一轮发送。请求带选项时，回答必须是其中一个 option id；否则是文本。
  - 否则读 turn 的回复，生成一条消息，按 `send` 的语义作为下一轮发送。
- 发出的内容就是这一轮的用户消息，出现在被测 agent 的 history 与 `show --execution` 里，和作者手写的消息一样计入这轮输入。
- 作者需要多轮问答时自己写循环，例如 `while (turn.status === "waiting") turn = await user.reply(turn)`；NiceEval 不内置自动对话轮次。

## 模拟用户 agent

模拟用户由 NiceEval 在宿主进程里用 pi-agent-core 的 `AgentHarness` 运行，复用 [Agent Judge](../../judge/library.md#agent-judge--在-sandbox-里自己取证再评分) 的 pi 运行时与受管 Provider 路径（可选依赖、`Models` provider 内的审计、预算与取消、溢出时压缩）。

- 模型取这条 Eval × Experiment 生效的 Judge Provider 与模型。`TypesafeProvider` 不支持，`reply` 抛出 `simulated-user-unsupported-provider`。
- 没有 Sandbox 工具：模拟用户只读被测 agent 的提问，不查看现场。唯一的工具是 `reply_to_agent`，参数 schema 随当前 turn 变化：等待输入时是 `{ answers: { requestId, text | optionId }[] }`，要求每个请求恰好一条；否则是 `{ message }`。
- 系统提示写明扮演用户、只依据 instructions 回答、不替被测 agent 做实现决定、不编造 instructions 里没有的事实。被测 agent 的回复与请求作为不可信 user 内容进入消息。
- 模型不调用 `reply_to_agent`、参数非法且在 4 轮内没有修正、期限耗尽或传输失败时，`reply` 抛出 `simulated-user-failed`，这条 Attempt 为 errored：没有合法回答就无法继续这段对话，不能归咎于被测 agent。取消保持 interruption。

## 记录、用量与身份

- 每次 `reply` 在执行记录里留一条模拟用户活动：所回答的 turn、模型实际收到的提问、提交的回答、请求与响应、耗时。`show --execution` 在对应轮次之前显示它，`--expand` 可展开完整请求。
- 模型用量进入 Judge 用量账本，operation 为 `simulated-user`，不进入 `t.usage`。`niceeval.judge-usage` 保持 revision 1，只在 operation 枚举里加入它，不向前兼容。
- instructions 在 Eval 源码里，随源码闭包进入 Eval 指纹。使用模拟用户的 Eval，其 Attempt 身份另外包含生效的 Judge Provider 身份与模拟用户的系统提示 revision：换模型或改提示模板都会让旧结果失效，因为被测 agent 收到的输入变了。
- 未使用模拟用户的 Eval 不写新的默认配置键，身份不变。

## 验收

- 本地 OpenAI 兼容 mock 脚本化 `reply_to_agent`：被测 agent 发出两个 `input.requested`（一个带选项、一个文本），`reply` 为两者各提交一条回答并以同一 session 的下一轮发送；带选项的请求收到 option id；返回的 Turn 是新一轮。
- 被测 agent 没有提问时，`reply` 发送一条消息；同一个 `SimulatedUser` 的第二次 `reply`，请求里含第一次的问答历史。
- mock 不调用工具或参数一直非法时，Attempt 为 errored，原因 `simulated-user-failed`；TypeSafe 零发送并抛出 `simulated-user-unsupported-provider`。
- `show --execution` 显示模拟用户活动与回答；Judge 用量含 `simulated-user` 记录。
- 未使用模拟用户的 Eval 身份不变（identity-domains release 测试保持通过）；改 instructions 或换 Judge 模型让使用它的 Eval 重新规划。
