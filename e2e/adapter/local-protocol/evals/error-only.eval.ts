import { defineEval } from "niceeval";

// error frame 是公开失败诊断的协议事实；[DONE] 不得让它变 pass，缺少
// assistant 消息也不得用泛化 malformed-stream 文案覆盖真实 errorText。
export default defineEval({
  description: "UI Message Stream preserves an error-only response diagnostic",
  async test(t) {
    await t.send("trigger error-only stream");
    throw new Error("expected an error-only stream not to produce a successful Turn");
  },
});
