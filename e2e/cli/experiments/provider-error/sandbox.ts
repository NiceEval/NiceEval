import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { preContextErrorAgent } from "../../agents/deterministic.ts";

export default defineExperiment({
  description: "provider-error/sandbox:Attempt 创建前保留 builder stderr 与 Run 下钻",
  agent: preContextErrorAgent,
  sandbox: dockerSandbox({
    source: {
      type: "dockerfile",
      context: new URL("../../fixtures/provider-error-sandbox/", import.meta.url),
    },
  }),
  evals: ["greet/hello"],
});
