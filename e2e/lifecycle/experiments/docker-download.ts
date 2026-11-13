import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";

const downloadAgent = defineSandboxAgent({
  name: "lifecycle-download",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  install: {
    identity: { agent: "lifecycle-download", version: "1.0.0", revision: "1" },
    probe: shell("node --version >/dev/null && git --version >/dev/null"),
  },
  send: async () => ({ status: "completed", events: [] }),
});

export default defineExperiment({
  adapter: downloadAgent,
  sandbox: dockerSandbox({
    source: { type: "image", image: "niceeval/codex@sha256:e0b8c9b08058a30843537ca9cef7e3508e880edc0f5aba704e29636a2e7d5cd5" },
    user: "node",
    resources: {
      cpus: 1, memoryBytes: 512 * 1024 ** 2, pidsLimit: 128, readOnlyRootfs: true,
      tmpfs: {
        "/tmp": { sizeBytes: 64 * 1024 ** 2, mode: 0o1777 },
        "/home/sandbox/workspace": { sizeBytes: 64 * 1024 ** 2, mode: 0o755, uid: 1000, gid: 1000 },
      },
    },
  }),
  evals: ["docker-download"],
});
