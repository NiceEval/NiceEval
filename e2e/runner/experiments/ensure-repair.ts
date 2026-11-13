import { strictEqual } from "node:assert";
import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";

const identity = { agent: "repair-fixture", version: "1.0.0", revision: "1" };
export default defineExperiment({
  adapter: defineSandboxAgent({
    name: "repair-fixture", evidenceCoverage: completeEvidenceCoverage,
    ensure: { identity, probe: shell("test -f /tmp/ensure-repaired || { printf 'missing fixture link\\n' >&2; exit 1; }") },
    installers: [{
      identity, installMode: "staged",
      async repair(sandbox) { await sandbox.runShellOrThrow("touch /tmp/ensure-repaired"); },
      prepareArtifact() { throw new Error("repair must complete without preparing a payload"); },
      async install() { throw new Error("repair must complete without installation"); },
    }],
    async send() { return { status: "completed", events: [] }; },
  }),
  sandbox: dockerSandbox({ source: { type: "image", image: "niceeval/codex@sha256:e0b8c9b08058a30843537ca9cef7e3508e880edc0f5aba704e29636a2e7d5cd5" } }),
  evals: ["ensure-repair"],
});
