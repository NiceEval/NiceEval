import { defineExperiment } from "niceeval";
import { defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";
const lifecycleSandbox = dockerSandbox({ source: { type: "image", image: "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f" }, user: "node", resources: { cpus: 1, memoryBytes: 536870912, pidsLimit: 128 } });
const quickAgent = defineSandboxAgent({ name: "creation-labels", evidenceCoverage: completeEvidenceCoverage,
  ensure: { identity: { agent: "node", version: "24", revision: "1" }, probe: shell("node --version") },
  send: async () => ({ status: "completed", events: [] }),
});

export default defineExperiment({
  adapter: quickAgent,
  sandbox: lifecycleSandbox,
  sandboxCache: { before: "bypass" },
  evals: ["creation-labels"],
  ...(process.env.NICEEVAL_LABEL_MODE === "run-only" ? { sandboxLabels: "run-only" as const } : {}),
});
