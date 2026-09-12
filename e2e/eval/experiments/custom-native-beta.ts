import { defineExperiment } from "niceeval";
import { customBeta } from "../fixtures/custom-applications.ts";

export default defineExperiment({
  description: "Native custom application beta",
  application: customBeta,
  attempts: 2,
  evals: ["custom-native-actions"],
  flags: { implementation: "beta" },
});
