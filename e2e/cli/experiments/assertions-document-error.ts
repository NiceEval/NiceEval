import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Assertions 持久化仍超限时的 CLI 错误形状",
  agent: deterministicAgent("cli-assertions-document-error"),
  evals: ["assertions-document/error"],
});
