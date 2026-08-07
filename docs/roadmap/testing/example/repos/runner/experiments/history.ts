import { defineExperiment } from "niceeval";
import { fixtureAgent } from "../agents/fixture.ts";

export default defineExperiment({
  description: "历史去重冒烟实验：一条确定性 eval",
  agent: fixtureAgent,
  evals: ["suite/"],
});
