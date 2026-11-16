import { defineExperiment } from "niceeval";
import { lifecycleSandbox, quickAgent, directAgent } from "../agents/deterministic.ts";
const mode = process.env.NICEEVAL_E2E_AGENT_JUDGE_MODE;
export default defineExperiment({
  adapter: mode === "direct" ? directAgent : quickAgent,
  ...(mode === "direct" ? {} : { sandbox: lifecycleSandbox }),
  ...(mode === "shared" ? { sandboxReuse: true } : {}),
  evals: ["agent-judge"],
});
