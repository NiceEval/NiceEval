import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineSandboxAgent, type AgentInstaller } from "niceeval/adapter";
import { dockerSandbox, shell, type SandboxCommandTarget } from "niceeval/sandbox";

const identity = { agent: "repair-fixture", version: "1.0.0", revision: "1" };
const scenario: string = "repaired";
const repair = async (sandbox: SandboxCommandTarget) => {
  console.error("ensure-repair-callback-entered");
  if (scenario === "repair-throws") throw new Error("fixture repair failed");
  if (scenario !== "repair-misses") await sandbox.runShellOrThrow("touch /tmp/ensure-repaired");
};
const installer: AgentInstaller = scenario === "verify-only" ? {
  identity, installMode: "verify-only", repair,
} : scenario === "repaired" ? {
  identity, installMode: "staged", repair,
  prepareArtifact() { throw new Error("repair must complete without preparing a payload"); },
  async install() { throw new Error("repair must complete without installation"); },
} : {
  identity, installMode: "sandbox-network", repair,
  async install(sandbox) {
    await sandbox.runShellOrThrow("touch /tmp/ensure-repaired");
  },
};
export default defineExperiment({
  adapter: defineSandboxAgent({
    name: "repair-fixture", evidenceCoverage: completeEvidenceCoverage,
    ensure: { identity, probe: shell("test -f /tmp/ensure-repaired || { printf 'missing fixture link\\n' >&2; exit 1; }") },
    installers: [installer],
    async send() { return { status: "completed", events: [] }; },
  }),
  sandbox: dockerSandbox({ source: { type: "image", image: "niceeval/codex@sha256:e0b8c9b08058a30843537ca9cef7e3508e880edc0f5aba704e29636a2e7d5cd5" } }),
  evals: ["ensure-repair"],
});
