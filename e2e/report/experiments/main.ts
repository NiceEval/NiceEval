import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

const agent = deterministicAgent("report-fixture", 0.00002);

export default defineExperiment({
  description: "main:签入确定性 Agent 生成 passed/failed/errored 三态证据",
  agent,
  model: "report-fixture-v1",
  labels: { line: "codex" },
  flags: { memory: "baseline" },
  evals: ["tool-call", "deliberate-fail", "deliberate-error"],
});
