import { defineExperiment } from "niceeval";
import { markerApplication } from "../evals/assertion-judge-fake.eval.ts";

export default defineExperiment({
  description: "非法材料不登记 Judge Assertion，也不调用模型",
  adapter: markerApplication,
  evals: ["assertion-judge-admission"],
});
