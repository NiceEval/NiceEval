# 使用 `t`、Session 与 Turn

Eval 通过 `t` 驱动主会话，通过 `t.newSession()` 创建独立会话；每次 send 返回不可变 Turn。

```ts
const mainTurn = await t.send("查布鲁克林天气");

const other = t.newSession();
const otherTurn = await other.send("查旧金山天气");
```

## 驱动 API

`t` 与 session 都支持 `send`、`sendFile`、`requireInputRequest`、`respond` 和 `respondAll`。只有 `t` 能创建新 session。

| API | 用法 |
|---|---|
| `await t.send(input)` | 发送字符串或结构化消息，等待稳定后返回 Turn |
| `await t.sendFile(path, text?)` | 把项目内本地文件作为 data URL 随本轮发送，MIME 按扩展名推断 |
| `t.requireInputRequest(filter?)` | 要求最近一轮恰好有一个匹配的待输入请求，并返回它 |
| `await t.respond(...responses)` | 回答指定请求，并作为同一 session 的下一轮发送 |
| `await t.respondAll(optionId)` | 用一个 option 回答当前 session 的全部待处理请求 |
| `t.newSession()` | 创建独立 session；它的事件仍进入 `t.*` 的 attempt 聚合 |

session 上的同名 API 只读写该 session，不影响主 session 的 resume 状态。Turn 不继续驱动会话；下一轮仍从 `t` 或对应 session 调用。

## 向运行反馈长步骤

`test(t)` 中由 eval 自己执行的长步骤可以通过 `t.progress` 更新当前 attempt 的短期状态;需要在运行结束后保留的问题用 `t.diagnostic`:

```ts
async test(t) {
  t.progress({ message: "uploading fixtures", current: 1, total: 3 });
  await t.sandbox.uploadDirectory("fixtures/project");

  const check = await inspectFixture();
  if (check.degraded) {
    t.diagnostic({
      code: "fixture-check-degraded",
      level: "warning",
      message: "Fixture preflight used the fallback checker",
      data: { checker: check.name },
    });
  }

  await t.send("完成任务");
}
```

这两个方法只报告反馈,不用于断言:`progress` 可被 Human active 行覆盖且不会逐条进入 Agent/CI 输出;`diagnostic` 是永久事件,但即使 level 为 `error` 也不会自动改变 verdict。测试结论仍由断言决定,基础设施无法继续时则抛异常。scope 固定为 `eval.run`,eval 不能借此把自己显示成 sandbox 或 agent 阶段。完整反馈契约见 [Experiments · 生命周期代码怎样向这次运行反馈](../../experiments/library.md#生命周期代码怎样向这次运行反馈)。

## 读取结果

| 对象 | 常用字段 |
|---|---|
| `t` | `reply`、`sessionId`、主 session 即时 `events` |
| session | `reply`、`sessionId`、该 session 的 `events` |
| turn | `message`、`data`、`status`、`events`、`usage` |

`t.events` 是主 session 的即时读取视图；最终的 `t.*` 作用域断言会聚合本 attempt 的全部 session。`turn.status` 为 `completed`、`failed` 或 `waiting`；`turn.usage` 是否存在取决于 Adapter 能否提供。

怎样对这些结果评分，见 [Scoring](../../scoring/library.md)；内部作用域绑定见 [Scoring Architecture](../../scoring/architecture/scopes.md)。
