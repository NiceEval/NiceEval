# 多轮 HITL 后重评

执行阶段把每个 Session、Turn、HITL 请求和用户响应写入 sealed Execution graph。新的 grading 定义逐个读取需要的具名 Turn ref，不依赖“最后一次回复”或 Session 聚合快照。

```ts
const definition = defineGrading({
  version: "approval-explained/v1",
  evaluationKind: "pass",
  async grade(g) {
    const request = g.turn("approval-request");
    const reply = g.turn("approval-reply");

    const check = judge.check({
      recipe: approvalExplained,
      material: {
        request: request.material.input,
        reply: reply.material.reply,
      },
    });

    g.judge.llm(check).atLeast(0.8);
  },
});
```

执行完成后才引入这条 definition，会生成新的 Pass Claim。原 Execution、先前 Evaluation 与 Claim 都不变。若 sealed graph 没有 `approval-reply`，Claim 保留 unavailable reason；系统不会重新发送消息、猜测内容或写入虚构检查项。

多个 Turn 来自同一 Session 时使用 Session-local ordinal。来自不同 Session 时，各自序列保持不变，`material` 中的作者排列被标成非因果顺序，不用时间戳拼出虚构全序。
