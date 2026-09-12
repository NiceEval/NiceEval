import { defineExperiment } from "niceeval";
import { customAlpha } from "../fixtures/custom-applications.ts";

export default defineExperiment({
  description: "Native custom adapter alpha",
  adapter: customAlpha,
  attempts: 2,
  evals: ["custom-native-actions"],
  flags: { implementation: "alpha" },
});
