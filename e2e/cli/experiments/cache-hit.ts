import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { preContextErrorAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "同一 Docker task build 在后续 Invocation 从受管 cache 命中",
  agent: preContextErrorAgent,
  sandbox: dockerSandbox({
    source: {
      type: "dockerfile",
      context: new URL("../fixtures/cache-hit/", import.meta.url),
    },
  }),
  evals: ["greet/hello"],
});
