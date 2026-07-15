# Eval 与 Context 的测试用例

本页是 Eval 契约的场景登记表：契约改动时按对应分组核对哪些用例要重写，评审测试改动时按它核对影响面。fixture 形状见 [测试架构](README.md)。

## 发现与 id 推导

契约来源：[Eval](../../../feature/eval/README.md)、[Library](../../../feature/eval/library.md)。

| 契约 | 场景 |
|---|---|
| id 只从文件路径推导（`evals/weather/brooklyn.eval.ts` → `weather/brooklyn`），配置对象禁止 `id` / `name` | 正例：嵌套目录的路径→id；类型负例：`@ts-expect-error` 传 id/name；运行时传入报明确错误 |
| 只有 `.eval.ts` / `.eval.tsx` 被发现，两种后缀规则一致 | 正例：两种后缀同规则 id；反例：`.ts`、`.test.ts` 不被发现 |
| 默认导出数组扇出为多个 eval，id 加 4 位零填充索引，顺序稳定 | 正例：3 行数组 → `x/0000..0002`；边界：单元素数组仍带索引、空数组 |
| 默认导出 keyed record 按业务 key 扇出，id 接 key 且按 key 字典序稳定 | 正例：乱序 `{ b, a }` → `x/a, x/b`；边界：空 record；反例：空 key、`.`、`..`、含 `/` / `\\` / 控制字符时报出文件与 key |
| `setup(sandbox, ctx)` 拿到完整 `Sandbox`（非 `t.sandbox` 受限视图），时机在环境层钩子与分类账锚点之后、agent 接入之前 | 类型正例：参数含完整面；顺序断言：setup 在 agent 首次 send 前 |
| `setup` 返回的 cleanup 在 attempt 收尾时被调用 | 正例：恰好一次；边界：test 抛异常时仍被调用 |
| `setup` 的 ctx 提供 progress/diagnostic，scope 绑定 `eval.setup` | 正例：setup 内 diagnostic 事件的 scope 字段 |

## send 与 turn

契约来源：[Context](../../../feature/eval/library/context.md)、[Library](../../../feature/eval/library.md)。

| 契约 | 场景 |
|---|---|
| `await t.send(input)` 接受字符串或结构化消息，返回不可变 Turn | 正例：两种输入；不可变性：写入抛错；类型负例：Turn 上无 send |
| send 完成后 `t.reply` 是最后一条 assistant 消息，`t.events` 反映主 session 当前事件流，`t.sessionId` 为主会话 id | 正例：send 后三者更新；反例：第二轮后 reply 变化，不暴露旧快照 |
| 多轮 `t.send` 沿用同一主 session | 正例：记录型 agent 收到正确续接；对照：newSession 的轮次不混入 |
| `turn.status` 是 `completed` / `failed` / `waiting` 三值；`turn.usage` 可缺失（取决于 Adapter） | 三种 status 各一例；usage 缺失时为 undefined 而非报错 |
| `t.sendFile(path, text?)` 把本地文件按扩展名推断 MIME 后读成 `InputFile`（base64）附加本轮 `input.files` | 正例：png/txt 得不同 MIME；反例：文件不存在报明确错误；边界：无扩展名 |
| turn 级断言失败只记一条断言，不中断 `test()` 执行 | 正例：失败断言后后续代码仍执行且结果记录 |

示例——直接观察用户会读取的值，只断言 `agent.send` 被调用一次不够，因为那发现不了 Context 暴露旧快照的 bug：

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

## Session

契约来源：[Context](../../../feature/eval/library/context.md)、[Architecture](../../../feature/eval/architecture.md)。

| 契约 | 场景 |
|---|---|
| `t.newSession()` 返回同一套 drive API 与作用域断言、`session.judge`；只有 `t` 能创建新 session | 类型正例：session API 面；类型负例：session 上无 newSession |
| session 上的同名 API 只读写该 session，不影响主 session 的 resume 状态 | 正例：交替 send 各自续接；反例：session.respond 不消费主 session 的 pending |
| `t.newSession()` 的事件仍汇入 `t.*` 的 attempt 级聚合 | 正例：仅在新 session 调工具时 `t.calledTool` 仍命中 |

## 作用域断言（接收者决定作用域）

契约来源：[Architecture](../../../feature/eval/architecture.md)。判定语义的完整矩阵在 [Scoring 用例](../scoring/cases.md)，这里只登记 Context 侧的接收者行为。

| 契约 | 场景 |
|---|---|
| `t.*` 聚合全部 session 全部轮次，`test()` 结束后才最终求值（final timing） | 正例：断言写在轮次之前仍看到之后的事件；正例：含 newSession 事件 |
| `session.*` 只看该 session 在断言记录时已发生的事件（时点快照） | 正例：断言后的新事件不计入；对照：同名 `t.*` 断言计入 |
| `turn.*` 只看这一轮自己的事件与用量 | 正例：第一轮调工具、第二轮 `turn.calledTool` 失败 |
| 三个接收者共享同一套断言词汇；`outputEquals` / `outputMatches` 为 turn 独有 | 类型正例：同名方法签名一致；类型负例：t 上无 outputEquals |

## HITL / 待输入请求

契约来源：[Context](../../../feature/eval/library/context.md)。

| 契约 | 场景 |
|---|---|
| `t.requireInputRequest(filter?)` 要求最近一轮**恰好一个**匹配请求并返回它；0 个或多个匹配报错（gate） | 正例：唯一匹配返回；反例：无 pending 报错；反例：两个同类请求 filter 不足以区分时报错 |
| `filter.prompt`（string/RegExp）匹配提问文本；`filter.optionIds` 要求恰好这组选项 | 正例：RegExp 匹配；反例：optionIds 是子集/超集时不匹配 |
| 多个 pending request 且回答无法对位时，`respond` 先报错且**不向 agent 发送任何响应** | 反例：两个 pending + 字符串回答 → reject 且 `agent.received` 长度不变 |
| `await t.respond(...responses)` 回答指定请求并作为同 session 下一轮发送 | 正例：下一轮输入携带 request id + optionId 且续接同 session |
| `await t.respondAll(optionId)` 回答当前 session 全部待处理请求 | 正例：多个 pending 全部被回答；反例：不影响其它 session 的 pending |

示例——错误反馈正确但响应已经发给 Agent，仍然违反契约，所以最后一条断言必不可少：

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

## Sandbox 能力与操作

契约来源：[Library](../../../feature/eval/library.md)。sandbox 自身的路径、命令与生命周期契约在 [Sandbox 用例](../sandbox/cases.md)，这里登记 Context 暴露面。

| 契约 | 场景 |
|---|---|
| `t.sandbox` 只在 agent 声明 sandbox capability 时存在；未声明时访问得到明确 capability 错误而非 undefined | 类型负例：`@ts-expect-error`；运行时反例：非类型化调用命中 guard 报错 |
| 起始文件没有自动发现或隐式拷贝，写入只经 `writeFiles` / `uploadFiles` / `uploadDirectory` 显式发生 | 反例：fixture 目录存在但未上传时 sandbox 为空 |
| `uploadDirectory(localDir, targetDir?, opts?)` 的 `localDir` 相对 eval 定义文件目录解析；省略 `targetDir` 落 workdir；`opts.ignore` 排除子目录 | 正例：recording Sandbox 收到规范化路径；正例：ignore 挡住 node_modules |
| `t.sandbox.diff` / `fileChanged` 读 agent 归因增量，首次 send 前恒为空、可读不报错 | 边界：未 send 直接读 diff 为空不报错；反例：写入 fixture 后未 send，`fileChanged` 不通过 |
| `t.sandbox` 只含立即 IO/命令与结果视图/延迟断言两组 API，`stop()` 等生命周期动作不暴露 | 类型负例：t.sandbox 上无 stop；类型正例：两组 API 齐全 |
| `t.sandbox.diff.get(path)` 返回可直接传入 `t.check(...)` 或 judge `{ on }` 的值 | 正例：diff 内容传 includes 匹配器 |

## judge 作用域与反馈

契约来源：[Library](../../../feature/eval/library.md)、[Context](../../../feature/eval/library/context.md)。judge 的评分与模型解析契约在 [Scoring 用例](../scoring/cases.md)。

| 契约 | 场景 |
|---|---|
| `t.judge` / `session.judge` 默认评对应 session 整段对话；`turn.judge` 默认只评 `turn.message` | 正例：记录型 judge 收到的材料随接收者不同；对照：turn1.judge 不含 turn2 内容 |
| judge `{ on }` 显式传值时评传入材料而非会话 | 正例：on 为 diff 时 judge 收到 diff 而非对话 |
| `t.diagnostic` 产生永久事件，`level: "error"` 也不改变 verdict；结论只由断言决定 | 正例：diagnostic error 后全断言通过 → verdict 仍 passed |
| `t.progress` / `t.diagnostic` 的 scope 固定 `eval.run`，eval 代码不能伪装成其它阶段 | 正例：scope 字段恒为 eval.run；类型负例：不接受 scope 参数 |
| `t.progress` 只更新当前 attempt 短期状态，不逐条进入最终输出 | 正例：多次 progress 后结果记录不逐条累积 |

## 不这样测

- 不断言 `defineEval(x)` 与 `x` 是同一个对象，除非对象身份本身是公开契约。
- 不为每个 Context getter 各造一套 Agent；同一轮状态的多个公共视图在一个场景里一起证明。
- 不让 fake Agent 自己实现 session 续接规则；它只记录输入，由测试断言 Context 发对了什么。
