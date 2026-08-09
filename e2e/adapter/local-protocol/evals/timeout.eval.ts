import { defineEval } from "niceeval";

// 超时场景：fixture 挂起 body。experiment.timeoutMs 压到数秒，期望 attempt
// 以 timeout / phase=agent.run 结束；若挂起被错误完成则主动失败。
export default defineEval({
  description: "timeout: hanging SSE body must hit attempt deadline",
  async test(t) {
    await t.send("trigger hang");
    throw new Error("expected hanging transport to time out agent.send");
  },
});
