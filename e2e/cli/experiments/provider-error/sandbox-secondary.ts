import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { preContextErrorAgent } from "../../agents/deterministic.ts";

export default defineExperiment({
  description: "provider-error/sandbox-secondary:另一 Run 的同名内部 timing node 不得吞掉错误",
  agent: preContextErrorAgent,
  sandbox: dockerSandbox({
    source: {
      type: "dockerfile",
      context: new URL("../../fixtures/provider-error-sandbox-secondary/", import.meta.url),
    },
  }),
  evals: ["greet/hello"],
});
