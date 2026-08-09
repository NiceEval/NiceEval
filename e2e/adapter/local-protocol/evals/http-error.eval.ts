import { defineEval } from "niceeval";

// HTTP 错误场景：fixture 返回 500。期望 agent-send-failed 并带可行动诊断；
// 若 send 成功则主动失败。
export default defineEval({
  description: "http-error: HTTP 500 must fail agent.send with diagnosis",
  async test(t) {
    await t.send("trigger http 500");
    throw new Error("expected HTTP 500 to fail agent.send");
  },
});
