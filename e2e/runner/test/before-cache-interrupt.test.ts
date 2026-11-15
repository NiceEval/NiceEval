// rerun: pnpm e2e test --candidate source --repo runner -- --run test/before-cache-interrupt.test.ts
import { pollUntil, withProcess } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { withSnapshotInfrastructure } from "../fixtures/remote-snapshot/infrastructure.ts";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/experiments/cli/README.md
test.concurrent("准备阶段取消保留已发布前缀的结算，未结算节点不伪装成失败", async () => {
  await runnerE2E.case("before-cache-interrupt", async (context) => {
    await withSnapshotInfrastructure(context, async ({ filter, env }) => {
      const {
        paths,
        run,
        commands: { niceeval },
      } = context;
      const invocationEnv = { ...env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} ${env.NODE_OPTIONS}` };
      await writeFile(
        join(paths.projectRoot, "experiments/snapshot-first.ts"),
        `import { defineExperiment } from "niceeval";
import { shell } from "niceeval/sandbox";
import { snapshotAgent, snapshotSandbox } from "../agents/remote-snapshot.ts";
export default defineExperiment({
  adapter: snapshotAgent,
  evals: ["snapshot-shared"],
  sandbox: snapshotSandbox.before(shell({ id: "pending-suffix", changeFrequency: 100,
    command: "mkfifo /tmp/before-cache-release; touch /tmp/before-cache-entered; read line < /tmp/before-cache-release" })),
});
`,
      );
      const invoke = async (json: boolean, hit: boolean) => {
        try {
          await withProcess(
            [
              join(process.cwd(), "node_modules/.bin/niceeval"),
              "exp",
              "snapshot-first",
              "--rerun",
              "all",
              ...(json ? ["--json"] : []),
            ],
            { cwd: paths.projectRoot, env: invocationEnv, processGroup: true, timeoutMs: 180_000, graceMs: 15_000 },
            async (controlled) => {
              const pid = controlled.pid;
              if (pid === undefined) throw new Error("Missing invocation process owner");
              await Promise.race([
                pollUntil(
                  async () => {
                    const containers = await run(["docker", "ps", "-q", "--filter", filter]);
                    expect(containers.exitCode, containers.diagnostic()).toBe(0);
                    for (const id of containers.stdout.trim().split(/\s+/u).filter(Boolean)) {
                      const gate = await run([
                        "docker",
                        "exec",
                        id,
                        "sh",
                        "-c",
                        "test -f /tmp/before-cache-entered && cat /tmp/shared-prefix",
                      ]);
                      if (gate.exitCode === 0) {
                        expect(gate.stdout, gate.diagnostic()).toBe("shared");
                        return true;
                      }
                    }
                    return undefined;
                  },
                  { timeoutMs: 150_000, intervalMs: 100, label: "published prefix restored into pending suffix" },
                ),
                controlled.done.then((receipt) => {
                  throw new Error(receipt.diagnostic());
                }),
              ]);
              process.kill(-pid, "SIGINT");
              const receipt = await controlled.done;
              expect(receipt.exitCode, receipt.diagnostic()).toBe(130);
              if (json) {
                expect(receipt.expReceipt().completion, receipt.diagnostic()).toBe("interrupted");
                expect(receipt.expTerminal().summary.beforeCaches, receipt.diagnostic()).toEqual({
                  total: 2,
                  hit: hit ? 1 : 0,
                  prepared: hit ? 0 : 1,
                  degraded: 0,
                  failed: 0,
                });
              } else {
                expect(receipt.stdout, receipt.diagnostic()).toContain(
                  "Before caches: 1 hit · 0 prepared · 0 degraded · 0 failed · 1 not settled (2 total)",
                );
              }
            },
          );
        } finally {
          const containers = await pollUntil(
            async () => {
              const remaining = await run(["docker", "ps", "-aq", "--filter", filter]);
              expect(remaining.exitCode, remaining.diagnostic()).toBe(0);
              return remaining.stdout.trim() === "" ? remaining : undefined;
            },
            { timeoutMs: 15_000, intervalMs: 100, label: "owned preparation staging cleanup" },
          );
          expect(containers.stdout.trim(), containers.diagnostic()).toBe("");
        }
      };
      await invoke(true, false);
      // Cancelling preserves the verified immutable prefix; the next preparation
      // hits it while the same suffix is still unsettled.
      await invoke(true, true);
      await invoke(false, true);
      const preview = await niceeval.run(["exp", "snapshot-first", "--dry", "--json"], { env: invocationEnv });
      expect(preview.exitCode, preview.diagnostic()).toBe(0);
    });
  });
});
