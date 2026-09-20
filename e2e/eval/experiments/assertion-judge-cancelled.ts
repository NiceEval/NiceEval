import { defineExperiment } from "niceeval";
import { markerApplication } from "../evals/assertion-judge-fake.eval.ts";

export default defineExperiment({
  description: "挂起的 Judge HTTP 请求由 Attempt deadline 取消",
  adapter: markerApplication,
  timeoutMs: 4_000,
  evals: ["assertion-judge-cancelled"],
});
