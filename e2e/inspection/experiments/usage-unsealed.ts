import { defineExperiment } from "niceeval";
import { usageUnsealedAdapter } from "../adapters/usage-unsealed.ts";

export default defineExperiment({
  adapter: usageUnsealedAdapter,
  evals: ["usage-unsealed"],
  attempts: 1,
});
