import { defineExperiment } from "niceeval";
import { fixtureAgent } from "../agents/fixture.ts";

export default defineExperiment({
  description: "中断后的下一消费者可正常运行",
  agent: fixtureAgent,
  evals: ["suite/post-interrupt-consumer"],
});
