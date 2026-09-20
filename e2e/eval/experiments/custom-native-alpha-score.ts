import { defineExperiment } from "niceeval";
import { customAlpha } from "../fixtures/custom-applications.ts";

export default defineExperiment({
  description: "Native custom adapter alpha score",
  adapter: customAlpha,
  attempts: 2,
  evals: ["custom-native-score"],
});
