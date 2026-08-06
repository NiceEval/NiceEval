import { defineExperiment } from "niceeval";
import { fixtureAgent } from "../agents/fixture.ts";

export default defineExperiment({
  description: "携带语义冒烟实验：两条确定性 eval",
  agent: fixtureAgent,
  evals: ["simple/"],
});
