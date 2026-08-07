import { defineExperiment } from "niceeval";
import { fixtureAgent } from "../agents/fixture.ts";

export default defineExperiment({
  description: "历史去重验证：一条确定性 eval 的身份追加与携入去重",
  agent: fixtureAgent,
  evals: ["suite/"],
});
