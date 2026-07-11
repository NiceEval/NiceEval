import { defineExperiment } from "niceeval";
import { defineSandbox } from "niceeval/sandbox";
import { defineSandboxAgent } from "niceeval/adapter";
import { createFakeSandbox } from "../../lib/fake-sandbox.ts";
import { logEvent } from "../../lib/log.ts";

// 失败语义回归:第二个 setup 钩子抛错 → 计执行错误(verdict errored),不阻断已进入的
// 收尾——第一个 setup 返回的 cleanup、sandbox.teardown 钩子仍要跑;sandbox.setup 排在
// agent.setup 之前,所以 agent.setup 从未被调用,agent.teardown 也不该跑
//(与既有的 agentDidSetup 门槛一致)。
const sandbox = defineSandbox({
  name: "fake-error",
  create: async () => createFakeSandbox(),
})
  .setup(async (_sb, ctx) => {
    await logEvent("sandbox:setup:ok", ctx.experimentId);
    return async () => {
      await logEvent("sandbox:cleanup:ok", ctx.experimentId);
    };
  })
  .setup(async () => {
    throw new Error("boom: sandbox setup failed");
  })
  .teardown(async (_sb, ctx) => {
    await logEvent("sandbox:teardown:always", ctx.experimentId);
  });

const agent = defineSandboxAgent({
  name: "error-agent",
  async setup(_sb, ctx) {
    await logEvent("agent:setup", ctx.experimentId);
  },
  async send() {
    return {
      status: "completed" as const,
      events: [{ type: "message" as const, role: "assistant" as const, text: "ok" }],
      usage: { inputTokens: 1, outputTokens: 1, requests: 1 },
    };
  },
  async teardown(_sb, ctx) {
    await logEvent("agent:teardown", ctx.experimentId);
  },
});

export default defineExperiment({
  description: "回归夹具:sandbox.setup 抛错的失败语义",
  agent,
  sandbox,
  model: "mock-error",
  runs: 1,
  earlyExit: false,
  evals: ["error"],
});
