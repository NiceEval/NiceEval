// rerun: pnpm e2e test --candidate source --repo runner -- --run test/before-cache-progress.test.ts
import { pollUntil, waitForOutput, withProcess } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeSessionListDocument, decodeSessionShowDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { withSnapshotInfrastructure } from "../fixtures/remote-snapshot/infrastructure.ts";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/experiments/cli/README.md
test.concurrent("派发前准备通过 JSON 事件与 invocation show 暴露进度", async () => {
  await runnerE2E.case("before-cache-progress", async (context) => {
    await withSnapshotInfrastructure(context, async ({ env, filter }) => {
      await writeFile(
        join(context.paths.projectRoot, "experiments/snapshot-first.ts"),
        `import { defineExperiment } from "niceeval";
import { shell } from "niceeval/sandbox";
import { snapshotAgent, snapshotSandbox } from "../agents/remote-snapshot.ts";
export default defineExperiment({ adapter: snapshotAgent, evals: ["snapshot-shared"], sandbox: snapshotSandbox.before(
  shell({ id: "observable-suffix", command: "mkfifo /tmp/prepare-release; touch /tmp/prepare-entered; read line < /tmp/prepare-release" })
) });`,
      );
      const invocationEnv = env;
      await withProcess(
        [join(process.cwd(), "node_modules/.bin/niceeval"), "exp", "snapshot-first", "--rerun", "all", "--json"],
        {
          cwd: context.paths.projectRoot,
          env: invocationEnv,
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
            { timeoutMs: 90_000, intervalMs: 100, label: "preparation action waiting for release" },
          );
          try {
            await waitForOutput(running, "stdout", /"event":"prepare"/u, {
              timeoutMs: 1000,
              label: "JSON preparation events",
            });
            const list = await context.commands.niceeval.run(["invocation", "list", "--json"]);
            const invocation = decodeSessionListDocument(list.json<unknown>()).sessions.find(
              (s) => s.status === "active",
            )!;
            const observed = await pollUntil(
              async () => {
                const shown = await context.commands.niceeval.run([
                  "invocation",
                  "show",
                  invocation.sessionId,
                  "--json",
                ]);
                const session = decodeSessionShowDocument(shown.json<unknown>()).session;
                if (!("experiments" in session)) return undefined;
                const experiment = session.experiments.find((e) => e.experimentId === "snapshot-first");
                expect(experiment).toHaveProperty("preparations");
                return experiment;
              },
              { timeoutMs: 10_000, intervalMs: 100, label: "persisted preparation observation" },
            );
            expect(observed).toMatchObject({
              preparations: [
                expect.objectContaining({
                  action: { index: 2, total: 2, id: "observable-suffix" },
                  phase: "action",
                  phaseEnteredAt: expect.any(String),
                  sandbox: { provider: "e2b", nativeInstanceId: expect.stringMatching(new RegExp(`^${container}`)) },
                }),
              ],
            });
            const human = await context.commands.niceeval.run(["invocation", "show", invocation.sessionId]);
            expect(human.stdout).toContain("observable-suffix");
            expect(human.stdout).toContain(container);
            await waitForOutput(running, "stdout", /"event":"progress"[^\n]*"preparing":1/u, {
              timeoutMs: 40_000,
              label: "progress heartbeat counts preparation nodes",
            });
          } finally {
            await context.run(["docker", "exec", container, "sh", "-c", "printf 'release\\n' > /tmp/prepare-release"]);
          }
          const result = await running.done;
          expect(result.exitCode, result.diagnostic()).toBe(0);
          expect(result.expEvents().filter((event) => "event" in event && event.event === "prepare")).not.toEqual([]);
        },
      );
    });
  });
});
