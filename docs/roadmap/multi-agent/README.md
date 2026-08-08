# Multi-Agent Evals

被测对象越来越多是多 agent 系统:orchestrator 委派 subagent、planner 交接给 writer、客服 bot 对着模拟用户。这篇回答:niceeval 怎么评它们,而不破坏 core 中立、CLI 模型和现有断言作用域规则。

## 先分清:「多 agent eval」是三件不同的事

| 场景 | 一句话 | 本文守护 |
|---|---|---|
| **A. 被测对象内部是多 agent** | 一次 `t.send`,里面有 planner / researcher / writer 分工 | ✅ 主体 |
| **B. eval 编排多个 agent 对手戏** | 主被测 agent 对着另一个 agent(模拟用户、谈判对手)你来我往 | ✅ 次之 |
| **C. 同一 eval 跑多个 agent 对比** | claude-code vs codex 谁做得好 | ❌ 已有,走 [experiments](../../feature/experiments/README.md) 矩阵,不在本文 |

## 统一模型

多 Agent Eval 使用三个正交概念：

- **归属**：每条行为事件声明由哪个 agent 产生，既有断言可以按 agent 过滤。
- **交接**：`handoff` 表达控制权单向转移，与有调用和返回配对的 subagent 委派分开。
- **对手戏**：Eval 通过第二个 Session 驱动场景 agent，主被测与对手的事件、成本和 Verdict 归属保持分离。

`operation.started` / `operation.finished` 继续用 `operationId` 表达 subagent 调用。
`calledSubagent(name, match?)` 与 `noFailedActions` 保留既有语义，agent 归属只增加过滤维度，不创造另一套断言词汇。

## 场景 A:被测对象内部是多 agent

```ts
export default defineEval({
  description: "研究报告:检索归 researcher,writer 不许联网",
  async test(t) {
    await t.send("调研 WebGPU 生态并写一页纸报告");

    t.agentOrder(["planner", "researcher", "writer"]);   // 出场顺序(子序匹配,同 toolOrder)
    t.handedOff({ from: "researcher", to: "writer" });   // 控制权交接
    t.agent("researcher").calledTool("web_search");      // 归属过滤 × 既有断言词汇
    t.agent("writer").notCalledTool("web_search");       // 负断言:声明 agentObservability 才可信
    t.agent("writer").messageIncludes("参考来源");
  },
});
```

`t.agent(name)` 不是新的断言词汇,是在既有作用域上加一层**归属过滤**:返回的接收者提供同一套作用域断言(`calledTool` / `messageIncludes` / `event` / …),只是数据换成「归属为 name 的事件子集」。作用域规则不变(作用域由接收者决定):`t.agent(x)` 看全 run、`turn.agent(x)` 看这一轮,归属 × 作用域正交。实现细节(事件流怎么改、能力位、采集可行性)见 [architecture.md](architecture.md)。

## 场景 B:eval 编排多个 agent 对手戏

复用 `newSession`,不发明新驱动 API:

```ts
export default defineEval({
  description: "客服顶住砍价:模拟用户连续压价 5 轮",
  async test(t) {
    const shopper = t.newSession({ agent: "bargain-user" });  // 注册表里的另一个 agent
    let ask = "这台能便宜 500 吗?";
    for (let i = 0; i < 5; i++) {
      const sellerTurn = await t.send(ask);                   // 主被测:客服 bot
      const shopperTurn = await shopper.send(sellerTurn.message);
      ask = shopperTurn.message;
    }
    t.notCalledTool("apply_discount");                        // 只评主被测
    t.judge.autoevals.closedQA("客服是否始终礼貌且未擅自降价?").atLeast(0.8);
  },
});
```

`newSession` 返回带 `send` / `reply` / 作用域断言的 session，并接受可选 `{ agent }` 参数。
主被测与对手 agent 的 CLI 层区分见 [cli.md](cli.md)；对手事件的聚合与成本处理见 [architecture.md](architecture.md)。

## 非目标

- 跨 agent 对比评分:experiments 矩阵已有(场景 C)。
- A2A / ACP 等 agent 间协议对接:那是某个 adapter 的活,core 不认协议。
- agent 间消息内容的自动评分:judge 已守护,不需要新机制。
- 多轮对手戏的循环语法糖(`converse(agent, { maxTurns })` 之类)：普通 TypeScript 循环是完整表达，不提供第二种控制流 API。

## 跨场景裁决

- `StreamEvent.agent`、`t.agent()`、`agentObservability` 与 `DerivedFacts.agents` 共同表达归属。
- `handoff`、`handedOff` 与 `agentOrder` 表达交接；`agentOrder` 匹配 agent 首次出现形成的子序列，完整轨迹使用 `eventsSatisfy`。
- `newSession({ agent })` 的对手是场景常量，不消费 Experiment 矩阵的 `model`。
- 对手 Session 可以拥有自己的 subagent 与 `handoff` 事件。归属名在 Session 内解释，聚合时同时保留 Session 身份，不设特殊分支。
