// 协议行为:send_alert 经 server.ts 的 beforeToolCall 挂审批,回调型 HITL——同一条 SSE 流卡在
// 服务端等 /api/chat/approve。adapter 在 approval_request 帧上返回 { pause },
// ctx.session.hold() 保存"读了一半的 SSE 流"(见 agents/pi-agent-core.ts);respond 触发的下一轮
// send() 里 ctx.session.take() 取回现场、continue 读同一条流。拒绝与批准各触发一次
// hold()/take(),证明 resume 不是只能用一次、也不是从不消费的死状态。
import { defineEval } from "niceeval";

export default defineEval({
  description: "beforeToolCall 暂停产生 input.requested;hold()/take() 恢复后出现对应 action.result",
  async test(t) {
    // 拒绝分支:deny 之后 send_alert 应记 rejected,不是 failed。
    const denyTurn = await t.send(
      "调用 send_alert 工具,给值班群发一条告警:『数据库连接数过高』。如果审批被拒绝,不要重试,直接告诉我未发送成功。",
    );
    denyTurn.parked();
    const denyRequest = t.requireInputRequest({ action: "send_alert", optionIds: ["approve", "deny"] });
    const afterDeny = await t.respond({ request: denyRequest, optionId: "deny" });
    afterDeny.succeeded();
    t.calledTool("send_alert", { input: { message: /数据库连接数过高/ }, status: "rejected" });

    // 批准分支:同一会话线里再触发一次 hold()/take(),证明现场保存/恢复对第二次同样成立。
    const approveTurn = await t.send("再发一条告警:『磁盘空间不足』,同样需要审批。");
    approveTurn.parked();
    const approveRequest = t.requireInputRequest({ action: "send_alert", optionIds: ["approve", "deny"] });
    const afterApprove = await t.respond({ request: approveRequest, optionId: "approve" });
    afterApprove.succeeded();
    t.calledTool("send_alert", { input: { message: /磁盘空间不足/ }, status: "completed" });
  },
});
