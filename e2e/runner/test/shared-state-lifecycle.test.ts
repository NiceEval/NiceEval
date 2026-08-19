// owner: docs/engineering/testing/e2e/runner.md#runner-shared-state-lifecycle
// rerun: pnpm e2e --repo runner -- --run test/shared-state-lifecycle.test.ts
import { pollUntil, withTempDir } from "@niceeval/testkit";
import { access, writeFile } from "node:fs/promises";
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

test("相同 sharedState.key 在前一 Experiment teardown 后才允许下一 Experiment 进入 setup", async () => {
  await runnerE2E.case(
    "shared-state-lifecycle",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-", async (barrierRoot) => {
        const first = niceeval.start(["exp", "shared-state-first", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        let second: ReturnType<typeof niceeval.start> | undefined;
        let secondEnteredSetupBeforeRelease: boolean | undefined;

        try {
          await pollUntil(
            async () => (await exists(join(barrierRoot, "first-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 10, label: "first Experiment reaches its agent" },
          );

          second = niceeval.start(["exp", "shared-state-second", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 60_000,
          });

          secondEnteredSetupBeforeRelease = await pollUntil(
            async () => (await exists(join(barrierRoot, "second-setup-attempted"))) || undefined,
            { timeoutMs: 3_000, intervalMs: 10, label: "second Experiment setup starts while first owns shared state" },
          )
            .then(() => true)
            .catch(() => false);
        } finally {
          await writeFile(join(barrierRoot, "release-first-agent"), "");
        }

        const [firstResult, secondResult] = await Promise.all([first.done, second!.done]);
        expect(secondEnteredSetupBeforeRelease).toBe(false);
        expect(firstResult.exitCode, firstResult.diagnostic()).toBe(0);
        expect(secondResult.exitCode, secondResult.diagnostic()).toBe(0);
        expect(await exists(join(barrierRoot, "first-teardown-complete"))).toBe(true);
        expect(await exists(join(barrierRoot, "second-setup-complete"))).toBe(true);
        expect(await exists(join(barrierRoot, "second-agent-started"))).toBe(true);
      });
    },
  );
});
