import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "pipe-progress:非 TTY 实时进度",
  agent: deterministicAgent("cli-pipe-progress"),
  model: "cli-deterministic-v1",
  evals: ["pipe/progress"],
});
