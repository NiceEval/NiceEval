import { defineEval } from "niceeval";

// [DONE] 是协议终点；其后的完整 assistant 帧不能反过来让 send 成功。
export default defineEval({
  description: "UI Message Stream ignores frames after [DONE]",
  async test(t) {
    await t.send("trigger frames after done");
    throw new Error("expected frames after [DONE] not to produce a successful Turn");
  },
});
