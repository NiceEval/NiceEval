import { defineExperiment } from "niceeval";
import { customBeta } from "../fixtures/custom-applications.ts";

export default defineExperiment({
  description: "Native custom adapter beta score",
  adapter: customBeta,
  attempts: 2,
  evals: ["custom-native-score"],
});
