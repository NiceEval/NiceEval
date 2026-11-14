import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";

// Deterministic install boundary: no model or registry is contacted by this Journey.
const version = "0.144.1";
export default defineExperiment({
  adapter: defineSandboxAgent({
    name: "install-identity-fixture",
    evidenceCoverage: completeEvidenceCoverage,
    ensure: { identity: { agent: "codex", version, revision: "1" }, probe: shell("true") },
    async send() {
      return { status: "completed", events: [] };
    },
  }),
  sandbox: dockerSandbox({
    source: {
      type: "image",
      image: "niceeval/codex@sha256:e0b8c9b08058a30843537ca9cef7e3508e880edc0f5aba704e29636a2e7d5cd5",
    },
  }),
  evals: ["agent-install-identity"],
});
