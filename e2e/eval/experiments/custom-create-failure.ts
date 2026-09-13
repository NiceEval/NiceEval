import { defineExperiment } from "niceeval";
import { customCreateFailure } from "../fixtures/custom-applications.ts";

export default defineExperiment({
  description: "Custom adapter create fails after acquisition",
  adapter: customCreateFailure,
  evals: ["custom-create-failure"],
});
