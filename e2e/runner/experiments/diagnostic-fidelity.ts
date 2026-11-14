import { defineExperiment } from "niceeval";
import { acquireManagedProcess, completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";

const scenario = process.env.NICEEVAL_DIAGNOSTIC_SCENARIO;
const identity = { agent: "diagnostic-fixture", version: "1.2.3", revision: "revision-7" };
export default defineExperiment({
  adapter: defineSandboxAgent({
    name: "diagnostic-fixture",
    evidenceCoverage: completeEvidenceCoverage,
    install: { identity, probe: shell(scenario === "aggregate" || scenario === "target" ? "true" : "false") },
    installers:
      scenario === "verify-only"
        ? [{ identity, installMode: "verify-only" }]
        : [
            {
              identity,
              installMode: "sandbox-network",
              async install() {
                if (scenario === "install-failed") throw new Error("fixture installer permission denied");
              },
            },
          ],
    async send(_input, ctx) {
      // Fault the public process transport receipt after the real process exits.
      // Both children still close stdin, exit and release their Docker handles.
      for (const resource of ["runner", "jsonl"]) {
        const process = await acquireManagedProcess(ctx, resource, { argv: ["cat"] });
        const wait = process.wait.bind(process);
        process.wait = async () => {
          await wait();
          throw Object.assign(new Error(`${resource} release transport unavailable`), {
            name: "FixtureTransportError",
            code: `E_${resource.toUpperCase()}`,
          });
        };
      }
      return { status: "completed", events: [] };
    },
  }),
  sandbox: dockerSandbox({
    source: {
      type: "image",
      image: "niceeval/codex@sha256:e0b8c9b08058a30843537ca9cef7e3508e880edc0f5aba704e29636a2e7d5cd5",
    },
  }),
  evals: ["diagnostic-fidelity"],
});
