import { defineEval } from "niceeval";
import { eventMatch, pattern } from "niceeval/expect";

// 正例：签入 fixture 的完整 SSE 被 uiMessageStreamAgent 归约为 assistant message。
// 只断言本 Repo 拥有的 transport 事实，不宣称 live AI SDK 协议兼容。
export default defineEval({
  description: "transport-ok: canned UI Message Stream 文本往返",
  async test(t) {
    const turn = await t.send("ping local-protocol transport");
    await t.require(turn.succeeded());
    t.assert(
      t.event(
        eventMatch("message", {
          role: "assistant",
          text: pattern(/local-protocol-ok/),
        }),
      ),
    );
  },
});
