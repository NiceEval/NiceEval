import { defineExperiment } from "niceeval";
import { managedFailureApp } from "../evals/assertion-managed-failure.eval.ts";

export default defineExperiment({ adapter: managedFailureApp, evals: ["assertion-managed-failure"] });
