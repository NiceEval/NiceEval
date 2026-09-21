import { defineExperiment } from "niceeval";
import { typesafeApplication } from "../evals/typesafe-judge.eval.ts";

export default defineExperiment({ adapter: typesafeApplication, evals: ["typesafe-judge"] });
