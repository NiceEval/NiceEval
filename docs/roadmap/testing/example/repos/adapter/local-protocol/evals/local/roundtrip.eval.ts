import { defineEval } from "niceeval";

// 正常消息往返。本 Repo 的每条测试都把 backend 指向可控失败 fixture（5xx），
// attempt 在 agent.run 阶段 errored、判分断言不执行——Eval 的存在只是让实验有真实
// 的被测输入。真实 provider 兼容性由 main / nightly lane 的 live ai-sdk Repo 证明。
export default defineEval({
  description: "本地协议 backend 的正常消息往返（本 Repo 只把它对准可控错误 fixture）",
  async test(t) {
    const turn = await t.send("你好");
    await turn.succeeded().stopOnFailure();
  },
});
