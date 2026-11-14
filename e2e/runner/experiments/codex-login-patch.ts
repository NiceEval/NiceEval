import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { dockerSandbox } from "niceeval/sandbox";
export default defineExperiment({
  adapter: codexAgent({ apiKey: "unused-no-model-call" }),
  model: "gpt-6.1-sol",
  sandbox: dockerSandbox({
    source: {
      type: "image",
      image: "niceeval/codex@sha256:e0b8c9b08058a30843537ca9cef7e3508e880edc0f5aba704e29636a2e7d5cd5",
    },
    user: "node",
  }),
  evals: ["codex-login-patch"],
});
