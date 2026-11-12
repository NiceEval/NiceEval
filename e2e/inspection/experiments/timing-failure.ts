import { defineExperiment } from "niceeval";
import { shell } from "niceeval/sandbox";
import { deterministicAgent, deterministicSandbox } from "../agents/deterministic.ts";

export default defineExperiment({
  adapter: deterministicAgent(),
  sandbox: deterministicSandbox.before(shell({ id: "inspection-timing-failure", command: "exit 7" })),
  evals: ["inspection"],
});
