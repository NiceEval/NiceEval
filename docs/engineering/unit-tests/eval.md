# Eval 与 Context 的单元测试

契约来源：[Eval](../../feature/eval/README.md)、[Library](../../feature/eval/library.md) 和 [Context](../../feature/eval/library/context.md)。测试重点不是 `defineEval` 返回了几个字段，而是 eval 作者观察到的 context、session、turn 和能力边界是否符合契约。

## 测试矩阵

| 契约 | 观察面 | Fixture |
|---|---|---|
| `send()` 后即时读取 reply、events、usage 和 sessionId | `TestContext` 公共属性 | scripted Agent |
| 多轮续接沿用正确 session | Agent 收到的 `TurnInput` | 记录输入的 scripted Agent |
| HITL 回答与 pending request 正确对位 | 下一次 `send` 输入或明确错误 | waiting Turn 序列 |
| Sandbox 能力只出现在正确构造路径 | 公共类型与运行时 capability guard | remote/sandbox 两种 Agent |
| eval 相对路径按定义文件目录解析 | Sandbox 收到的规范化路径 | recording Sandbox |

## Scripted Agent fixture

Context 测试不需要真实模型。Fixture 只实现 Agent 契约，按顺序返回预设 Turn，并记录收到的输入：

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

function completed(text: string): Turn {
  return {
    status: "completed",
    events: [{ type: "message", role: "assistant", text }],
  }
}
```

这个 fixture 不解析 prompt、不生成答案，也不复制 session 实现；否则测试会同时验证两份相同算法。

## 示例：live view 在 send 后更新

```ts
import { expect, it } from "vitest"
import { createEvalContext } from "../../context/context.ts"

it("send 完成后 reply 和 events 反映本轮结果", async () => {
  const agent = scriptedAgent([completed("Brooklyn: 21°C")])
  const { context } = createEvalContext({
    agent,
    sandbox: remoteSandboxFixture(),
    flags: {},
    signal: new AbortController().signal,
    log() {},
    judge: undefined,
  })

  const turn = await context.send("weather")

  expect(turn.message).toBe("Brooklyn: 21°C")
  expect(context.reply).toBe("Brooklyn: 21°C")
  expect(context.events).toEqual(turn.events)
})
```

这里直接观察用户会读取的值。只断言 `agent.send` 被调用一次不够，因为它不能发现 Context 仍暴露旧快照的 bug。

## 示例：HITL 歧义先失败，不发送错误响应

```ts
import { expect, it } from "vitest"

it("多个 pending request 时拒绝无法对位的字符串回答", async () => {
  const agent = scriptedAgent([
    {
      status: "waiting",
      events: [
        { type: "input.requested", request: { id: "r1", action: "edit-a" } },
        { type: "input.requested", request: { id: "r2", action: "edit-b" } },
      ],
    },
  ])
  const { context } = contextFixture({ agent })

  await context.send("apply edits")
  await expect(context.respond("approve")).rejects.toThrow(/request|对位/)

  expect(agent.received).toHaveLength(1)
})
```

最后一条断言很重要：错误反馈正确但响应已经发给 Agent，仍然违反契约。

## 类型 fixture

能力由构造决定时，合法和非法调用分别放进 typecheck fixture：

```ts
import { defineEval } from "niceeval"

defineEval({
  async test(t) {
    await t.send("hello")
    t.calledTool("search")

    // 只有设计声明该 context 具备 Sandbox 能力时才允许这段代码。
    await t.sandbox.runCommand("pnpm", ["test"])
  },
})
```

负例用 `@ts-expect-error` 锁住禁止组合；运行时测试仍要覆盖从非类型化 JavaScript 或错误构造进入时的 capability guard。

## 不这样测

- 不断言 `defineEval(x)` 与 `x` 是同一个对象，除非对象身份本身是公开契约。
- 不为每个 Context getter 各造一套 Agent；同一轮状态的多个公共视图可以在一个场景里一起证明。
- 不让 fake Agent 自己实现 session 续接规则；它只记录输入，由测试断言 Context 发对了什么。
