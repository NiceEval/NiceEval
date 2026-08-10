import { defineEval } from "niceeval";

// 断流场景：fixture 半截 SSE 后 destroy socket。期望 send 以 agent-send-failed
// 落在 phase=agent.run；若意外成功则主动失败，防止假绿。
export default defineEval({
  description: "disconnect: mid-stream socket destroy must fail send",
  async test(t) {
    await t.send("trigger disconnect");
    throw new Error("expected transport disconnect to fail agent.send");
  },
});
