// owner: docs/engineering/testing/e2e/runner.md#runner-shared-state-scheduler
// rerun: pnpm e2e test --repo runner -- --run test/shared-state-scheduler.test.ts
import { pollUntil, withTempDir } from "@niceeval/testkit";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("同 Invocation 的同 key waiter 不占有限 worker，holder 后继 Attempt 能继续启动", async () => {
  await runnerE2E.case(
    "shared-state-scheduler",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-scheduler-", async (barrierRoot) => {
        const invocation = niceeval.start(
          ["exp", "shared-state-scheduler", "--rerun", "all", "--max-concurrency", "2", "--json"],
          { env: { NICEEVAL_SHARED_STATE_SCHEDULER_BARRIER: barrierRoot }, timeoutMs: 90_000 },
        );
        try {
          await pollUntil(
            async () => (await exists(join(barrierRoot, "holder-attempt-1-started"))) || undefined,
            {
              timeoutMs: 30_000,
              intervalMs: 20,
              label: "holder enters its first Agent attempt before its successor is required",
            },
          );
          await pollUntil(
            async () => (await exists(join(barrierRoot, "holder-attempt-2-started"))) || undefined,
            {
              timeoutMs: 30_000,
              intervalMs: 20,
              label: "holder successor starts while a same-key Experiment waits",
            },
          );
          const result = await invocation.done;
          expect(result.exitCode, result.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "waiter-attempt-3-started"))).toBe(true);
        } finally {
          await invocation.dispose().catch(() => undefined);
        }
      });
    },
  );
});
