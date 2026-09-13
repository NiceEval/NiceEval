import { defineExperiment } from "niceeval";
import { markerApplication } from "../evals/assertion-judge-fake.eval.ts";

export default defineExperiment({
  description: "Judge measurement 使用受控 provider 并保留完整应用材料",
  adapter: markerApplication,
  evals: ["assertion-judge-fake"],
});
