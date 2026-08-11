# 多轮 HITL 后重评

执行阶段把每个 Session、Turn、HITL 请求和用户响应写入 sealed Observation/ref graph。新的 grading 定义
通过具名 ref 读取需要的 Turn 或 Session 前缀，而不是依赖“最后一次回复”。

```ts
const rubric = defineGrading({
  version: "approval-explained/v1",
  evaluationKind: "pass",
  async grade(g) {
    g.turn("approval-reply").judge.autoevals.closedQA("是否解释了审批结果？")
      .atLeast(0.8);
  },
});
```

执行完成后才引入这条 rubric，会生成新的 Pass claim。原 execution 与先前 grading 不变。若 sealed graph
没有 `approval-reply`，claim 保留不可用原因；系统不会重新发送消息、猜测内容或写入虚构检查项。
