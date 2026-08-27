import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "pty-progress:确定性运行期 TTY feedback owner",
  agent: deterministicAgent("cli-pty-progress"),
  model: "cli-deterministic-v1",
  evals: ["pty/progress"],
});
