import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "loader reads routed through a shared helper",
  adapter: deterministicAgent,
  evals: ["helper-loader/"],
});
