import { defineExperiment } from "niceeval";
import { fixtureAgent } from "../agents/fixture.ts";

export default defineExperiment({
  description: "携带语义验证：两条确定性 eval 的携入与部分补跑",
  agent: fixtureAgent,
  evals: ["simple/"],
});
