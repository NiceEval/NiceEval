import { defineExperiment } from "niceeval";
import { fixtureAgent } from "../agents/fixture.ts";

export default defineExperiment({
  description: "中断后的下一消费者冒烟实验",
  agent: fixtureAgent,
  evals: ["suite/smoke"],
});
