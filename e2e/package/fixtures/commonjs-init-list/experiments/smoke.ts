import { defineExperiment } from "niceeval";
import { smokeAgent } from "../agents/smoke.ts";

export default defineExperiment({
  description: "installed package dry-plan smoke",
  agent: smokeAgent,
  evals: ["cjs-default", "tsx-default"],
});
