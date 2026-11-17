// rerun: pnpm e2e test --candidate source --repo runner -- --run test/before-cache-dispatch.test.ts
import { pollUntil, withProcess } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeSessionListDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { withSnapshotInfrastructure } from "../fixtures/remote-snapshot/infrastructure.ts";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/sandbox/README.md
test.concurrent("准备完成的配对在无关分支仍阻塞时派发", async () => {
  await runnerE2E.case("before-cache-dispatch", async (context) => {
    await withSnapshotInfrastructure(context, async ({ env, filter }) => {
      await writeFile(
        join(context.paths.projectRoot, "experiments/snapshot-second.ts"),
        `import { defineExperiment } from "niceeval";
import { shell } from "niceeval/sandbox";
import { snapshotAgent, snapshotSandbox } from "../agents/remote-snapshot.ts";
export default defineExperiment({ adapter: snapshotAgent, evals: ["snapshot-shared"], sandbox: snapshotSandbox.before(
  shell({ id: "blocked-suffix", command: "mkfifo /tmp/prepare-release; touch /tmp/prepare-entered; read line < /tmp/prepare-release" })
) });`,
      );
      await withProcess(
        [
          join(process.cwd(), "node_modules/.bin/niceeval"),
          "exp",
          "--experiment",
          "snapshot-first",
          "--experiment",
          "snapshot-second",
          "--rerun",
          "all",
          "--json",
        ],
        {
          cwd: context.paths.projectRoot,
          env: env,
          processGroup: true,
          timeoutMs: 120_000,
        },
        async (running) => {
          const container = await pollUntil(
            async () => {
              const listed = await context.run(["docker", "ps", "-q", "--filter", filter]);
              for (const id of listed.stdout.trim().split(/\s+/u).filter(Boolean)) {
                const entered = await context.run(["docker", "exec", id, "test", "-f", "/tmp/prepare-entered"]);
                if (entered.exitCode === 0) return id;
              }
              return undefined;
            },
            { timeoutMs: 90_000, intervalMs: 100, label: "unrelated preparation branch blocked" },
          );
          try {
            await pollUntil(
              async () => {
                const listed = await context.commands.niceeval.run(["invocation", "list", "--json"]);
                const session = decodeSessionListDocument(listed.json<unknown>()).sessions.find(
                  (s) => s.status === "active",
                );
                const experiment = session?.experiments?.find((e) => e.experimentId === "snapshot-first");
                if (experiment === undefined) return undefined;
                const shown = await context.commands.niceeval.run(["show", `run:${experiment.runId}`, "--json"]);
                return shown.run().run.plannedAttempts.some((slot) => slot.publication.state === "published")
                  ? true
                  : undefined;
              },
              {
                timeoutMs: 20_000,
                intervalMs: 200,
                label: "ready pairing publication before releasing unrelated branch",
              },
            );
          } finally {
            const released = await context.run([
              "docker",
              "exec",
              container,
              "sh",
              "-c",
              "printf 'release\\n' > /tmp/prepare-release",
            ]);
            expect(released.exitCode, released.diagnostic()).toBe(0);
          }
          const result = await running.done;
          expect(result.exitCode, result.diagnostic()).toBe(0);
          expect(result.expEvalEvents().map(({ verdict }) => verdict)).toEqual(["passed", "passed"]);
        },
      );
    });
  });
});
