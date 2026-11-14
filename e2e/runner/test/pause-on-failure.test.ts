// rerun: pnpm e2e test --repo runner -- --run test/pause-on-failure.test.ts
import { withProcess } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @use-case docs/feature/sandbox/use-case/sandbox-pause-on-failure-debug.md
test.concurrent.each([
  { outcome: "failed", configured: true, flags: [], paused: true },
  { outcome: "errored", configured: false, flags: ["--pause-on-failure"], paused: true },
  { outcome: "failed", configured: true, flags: ["--no-pause"], paused: false },
  { outcome: "passed", configured: true, flags: [], paused: false },
])(
  "$outcome: config=$configured flags=$flags completes without Enter on piped stdin",
  async ({ outcome, configured, flags, paused }) => {
    await runnerE2E.case(`pause-${outcome}-${paused}`, async ({ paths }) => {
      await writeFile(
        join(paths.projectRoot, "niceeval.config.ts"),
        `
      import { defineConfig } from "niceeval";
      export default defineConfig({ pauseOnFailure: ${configured}, timeoutMs: 60000 });
    `,
      );
      await writeFile(
        join(paths.projectRoot, "experiments/pause-debug.ts"),
        `
      import { writeFile } from "node:fs/promises";
      import { defineExperiment } from "niceeval";
      import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
      import { shell } from "niceeval/sandbox";
      import { sharedStateProviderStopSandbox } from "../agents/shared-state-provider-stop.ts";
      export default defineExperiment({
        adapter: defineSandboxAgent({
          name: "pause-debug", evidenceCoverage: completeEvidenceCoverage,
          install: { identity: { agent: "pause-debug", version: "1", revision: "1" }, probe: shell("true") },
          send: async () => ({ status: "completed", events: [] }),
          after: async () => { await writeFile("pause-agent-cleaned", "cleaned"); },
        }),
        sandbox: sharedStateProviderStopSandbox,
        evals: ["pause-debug"],
      });
    `,
      );
      await writeFile(
        join(paths.projectRoot, "evals/pause-debug.eval.ts"),
        `
      import { defineEval } from "niceeval";
      import { includes } from "niceeval/expect";
      export default defineEval({ test(t) {
        ${outcome === "errored" ? 'throw new Error("pause fixture execution error");' : `t.check("actual", includes(${JSON.stringify(outcome === "passed" ? "actual" : "missing")}));`}
      }});
    `,
      );
      // Keep piped stdin open without sending Enter or EOF. Completion must not
      // depend on an input event in a non-interactive invocation.
      await withProcess(
        [
          process.execPath,
          "--input-type=module",
          "-e",
          `
      import { spawn } from "node:child_process";
      const child = spawn(process.argv[1], process.argv.slice(2), { stdio: ["pipe", "pipe", "pipe"] });
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
      child.on("error", (error) => { console.error(error); process.exitCode = 91; });
      child.on("close", (code) => { process.exitCode ??= code ?? 92; });
    `,
          join(paths.projectRoot, "node_modules/.bin/niceeval"),
          "exp",
          "pause-debug",
          "--rerun",
          "all",
          "--json",
          ...flags,
        ],
        {
          cwd: paths.projectRoot,
          env: { NICEEVAL_SHARED_STATE_PROVIDER_STOP_BARRIER: paths.projectRoot },
          processGroup: true,
          timeoutMs: 90_000,
        },
        async (child) => {
          const result = await child.done;
          expect(result.timedOut, result.diagnostic()).toBe(false);
          expect(result.stderr, result.diagnostic()).not.toContain("Press [Enter]");
          expect(result.stderr.includes("Sandbox retained for debugging."), result.diagnostic()).toBe(paused);
          expect(result.expReceipt().createdRunIds, result.diagnostic()).toHaveLength(1);
          expect(await readFile(join(paths.projectRoot, "pause-agent-cleaned"), "utf8")).toBe("cleaned");
          expect(await readFile(join(paths.projectRoot, "provider-group-stop-complete"), "utf8")).toBe("");
        },
      );
    });
  },
);
