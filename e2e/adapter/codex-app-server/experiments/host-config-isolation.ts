import { codexAgent } from "niceeval/adapter";
import { defineExperiment } from "niceeval";
import { sandbox } from "../sandbox.ts";

export default defineExperiment({
  description: "容器 Sandbox 不读取或改写宿主 Codex 配置",
  agent: codexAgent({ apiKey: "fixture-key" }),
  sandbox,
  evals: ["host-config-isolation"],
  attempts: 1,
});
