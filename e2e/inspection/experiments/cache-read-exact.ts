import { defineExperiment } from "niceeval";
import { cacheRead } from "../adapters/cache-read.ts";
export default defineExperiment({
  adapter: cacheRead,
  models: {
    planner: { model: "offline/shared" },
    reviewer: { model: "offline/shared" },
    unused: { model: "offline/unused" },
  },
  flags: { scenario: "exact" },
  evals: (evaluation) => evaluation.id === "cache-read",
  attempts: 1,
});
