# Eval 与 Context 的测试架构

契约来源：[Eval](../../../feature/eval/README.md)、[Library](../../../feature/eval/library.md)、[Context](../../../feature/eval/library/context.md) 和 [Architecture](../../../feature/eval/architecture.md)。测试重点不是 `defineEval` 返回了几个字段，而是 eval 作者观察到的 context、session、turn 和能力边界是否符合契约。用例登记在 [cases.md](cases.md)。

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

这个 fixture 不解析 prompt、不生成答案，也不复制 session 实现；否则测试会同时验证两份相同算法。session 续接规则由生产 Context 决定，测试通过 `received` 断言 Context 发对了什么。

`contextFixture({ agent })` 在 scriptedAgent 之上补齐 `createEvalContext` 需要的中性参数（recording Sandbox、空 flags、AbortSignal、静默 log），让单条测试只写与契约相关的输入。所有权与稳定性规则见 [Harness](../harness.md)。

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
