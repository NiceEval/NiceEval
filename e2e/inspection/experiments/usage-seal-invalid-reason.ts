import { defineExperiment } from "niceeval";
import { usageSealAdapter } from "../adapters/usage-seal.ts";

export default defineExperiment({
  adapter: usageSealAdapter,
  evals: (evaluation) => evaluation.id === "usage-seal-invalid-reason",
  attempts: 1,
});
