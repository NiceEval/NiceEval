import { defineExperiment } from "niceeval";
import { fixtureAgent } from "../agents/fixture.ts";

export default defineExperiment({
  description: "新手上路的第一个实验",
  agent: fixtureAgent,
  evals: ["onboarding/"],
});
