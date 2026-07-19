// pnpm e2e 跑的唯一 experiment:全部本仓库 eval,针对真实 HTTP+SSE 应用跑一次。
// 模型由应用自己的 AGENT_MODEL env 决定(见 src/agent.ts),这里不覆盖。
import { defineExperiment } from "niceeval";
import agent from "../agents/pi-agent-core.ts";

export default defineExperiment({
  description: "pi-agent-core e2e:工具执行、会话续接、HITL 暂停恢复、usage 与失败状态",
  agent,
  runs: 1,
});
