import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "source:为 show --source 提供入口与嵌套断言模块的完整运行证据",
  agent: deterministicAgent("report-source-fixture"),
  model: "report-source-fixture-v1",
  evals: ["source-snapshot"],
});
