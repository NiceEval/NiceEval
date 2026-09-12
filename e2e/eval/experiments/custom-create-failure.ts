import { defineExperiment } from "niceeval";
import { customCreateFailure } from "../fixtures/custom-applications.ts";

export default defineExperiment({
  description: "Custom application create fails after acquisition",
  application: customCreateFailure,
  evals: ["custom-create-failure"],
});
