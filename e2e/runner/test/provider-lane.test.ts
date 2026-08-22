// owner: docs/engineering/testing/e2e/runner.md#runner-provider-lane
// rerun: pnpm e2e --repo runner -- --run test/provider-lane.test.ts
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

async function appearsWithin(path: string, timeoutMs: number, label: string): Promise<boolean> {
  return pollUntil(
    async () => await exists(path) ? true : undefined,
    { timeoutMs, intervalMs: 20, label },
  ).then(() => true).catch(() => false);
}

test("等待 sharedState 不占用同一 exclusive provider lane，无关 Experiment 仍可进入 Agent", async () => {
  await runnerE2E.case(
    "shared-state-exclusive-provider-lane",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-exclusive-lane-", async (barrierRoot) => {
        const holder = niceeval.start(["exp", "shared-state-lease-holder", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 120_000,
        });
        let contenders: ReturnType<typeof niceeval.start> | undefined;
        let independentEnteredBeforeLeaseRelease = false;
        let waiterEnteredSetupBeforeLeaseRelease = false;
        let setupError: unknown;

        try {
          await pollUntil(
            async () => (await exists(join(barrierRoot, "lease-holder-agent-started"))) || undefined,
            { timeoutMs: 60_000, intervalMs: 10, label: "sharedState holder reaches its Agent" },
          );

          contenders = niceeval.start(["exp", "shared-state-lane", "--rerun", "all", "--max-concurrency", "2", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 120_000,
          });
          independentEnteredBeforeLeaseRelease = await appearsWithin(
            join(barrierRoot, "lane-independent-agent-started"),
            60_000,
            "independent exclusive provider Experiment while sharedState waiter is blocked",
          );
          waiterEnteredSetupBeforeLeaseRelease = await appearsWithin(
            join(barrierRoot, "lane-waiter-setup-attempted"),
            200,
            "sharedState waiter setup before current holder releases",
          );
        } catch (error) {
          setupError = error;
        } finally {
          await writeFile(join(barrierRoot, "release-lease-holder"), "");
        }

        const holderResult = await holder.done;
        const contendersResult = contenders === undefined ? undefined : await contenders.done;
        if (setupError !== undefined) throw setupError;

        expect(independentEnteredBeforeLeaseRelease).toBe(true);
        expect(waiterEnteredSetupBeforeLeaseRelease).toBe(false);
        expect(holderResult.exitCode, holderResult.diagnostic()).toBe(0);
        expect(contendersResult, "provider-lane contenders start after the holder is ready").toBeDefined();
        expect(contendersResult!.exitCode, contendersResult!.diagnostic()).toBe(0);
        expect(await exists(join(barrierRoot, "lane-waiter-setup-complete"))).toBe(true);
        expect(await exists(join(barrierRoot, "lane-waiter-agent-started"))).toBe(true);
      });
    },
  );
});
