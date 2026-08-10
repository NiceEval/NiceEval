# 对多轮 HITL Execution 重新评分

## 目标

Agent 先在主 Session 拟稿，请求发送邮件的人工批准，再完成发送。
Eval 随后开一条独立 Session，核对发送日志。

评分需要同时检查：

- 第一轮回复；
- HITL 后的第二轮；
- 独立 audit Session 的明确前缀；
- 整个 Attempt 的工具调用次数；
- 两轮 reply 的交叉关系；
- 发送 Turn 的 Sandbox diff。

## Ref contract

```ts
export const refs = defineEvalRefs({
  draft: turnRef(),
  sent: turnRef(),
  audit: sessionRef(),
  auditTurn: turnRef(),
});

export const gradingRefs = refs.pick({
  draft: true,
  sent: true,
  audit: true,
  auditTurn: true,
});
```

这些 key 是跨 Execution 的作者寻址契约。
`draft` 不是“第 1 轮”的别名，`sent` 也不依赖展示 token `turn2`。

## Execution

```ts
export default defineEvalExecution({
  source: import.meta.url,
  refs,

  async run(t) {
    const draft = await t.send("先拟稿，发送前询问我。");
    const request = t.requireInputRequest({ action: "send_email" });
    const sent = await t.respond({ request, optionId: "approve" });

    const audit = t.newSession();
    const auditTurn = await audit.send("独立核对是否真的发送。");

    return { draft, sent, audit, auditTurn };
  },
});
```

`requireInputRequest()` 仍是 Agent 驱动协议，不是 Assertion Fact 的 `require()`。
它保留在 execution；离线 grading 不能重新回答 HITL，也不能改变已经发生的分支。

## Grading

```ts
export default defineEvalGrading({
  source: import.meta.url,
  refs: gradingRefs,

  grade(g, ref) {
    g.check(ref.draft.succeeded(), { key: "draft-succeeded" });
    g.check(ref.draft.message, includes("此致"), {
      key: "draft-signoff",
    });

    g.check(
      ref.audit.through(ref.auditTurn).calledTool(toolMatch("mail_log")),
      { key: "audit-session-checked-log" },
    );

    g.check(g.calledTool(toolMatch("send_email"), { count: 1 }), {
      key: "attempt-sent-once",
    });

    g.check(
      { draft: ref.draft.message, sent: ref.sent.message },
      satisfies("发送结果与草稿一致", ({ draft, sent }) => sent.includes(draft)),
      { key: "cross-turn-consistency" },
    );

    g.check(g.sandbox.during(ref.sent).fileChanged("outbox.json"), {
      key: "sent-turn-wrote-outbox",
    });
  },
});
```

`ref.audit` 默认包含完整 sealed audit Session。
这里显式写 `through(ref.auditTurn)`，说明该 Fact 只依赖 auditTurn 及之前的事件。

`g.calledTool()` 聚合全部 Session。
它能发现主 Session 中的发送，也会把 audit Session 的工具事件放进候选集合。

`g.sandbox.during(ref.sent)` 只查看 sent 的 send 区间。
最终 Attempt diff 仍可由 `g.sandbox.fileChanged()` 单独查询，两者的起止边界不同。

## 修改评分

后来把 signoff 从 `includes("此致")` 改成更完整的 matcher，只改变 grading source。
执行 `niceeval grade --run <run-id>` 会复用原 Execution graph，并建立新 GradingRun。

Agent 不会重新收到三条输入，HITL 不会重演，audit Session 也不会重建。
新结果只有在 `show/view --grading-run` 显式选择时才替代当前视图中的 default grading。
