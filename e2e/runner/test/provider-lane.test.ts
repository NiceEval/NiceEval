// rerun: pnpm e2e test --repo runner -- --run test/provider-lane.test.ts
import { pollUntil, waitForOutput, withTempDir } from "@niceeval/testkit";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

test.concurrent("等待 sharedState 不占用同一 exclusive provider lane，无关 Experiment 仍可进入 Agent [necase_EZDHV0MV2FA9SX7X]", async () => {
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
          await waitForOutput(
            contenders,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "contender reaches the held sharedState lease" },
          );
          expect(await exists(join(barrierRoot, "lane-waiter-setup-attempted"))).toBe(false);
          await pollUntil(
            async () => (await exists(join(barrierRoot, "lane-independent-agent-started"))) || undefined,
            {
              timeoutMs: 60_000,
              intervalMs: 20,
              label: "independent exclusive provider Experiment enters while sharedState waiter is blocked",
            },
          );
          expect(await exists(join(barrierRoot, "lane-waiter-setup-attempted"))).toBe(false);
        } catch (error) {
          setupError = error;
        } finally {
          await writeFile(join(barrierRoot, "release-lease-holder"), "");
        }

        const holderResult = await holder.done;
        const contendersResult = contenders === undefined ? undefined : await contenders.done;
        if (setupError !== undefined) throw setupError;

        expect(holderResult.exitCode, holderResult.diagnostic()).toBe(0);
        expect(contendersResult, "provider-lane contenders start after the holder is ready").toBeDefined();
        expect(contendersResult!.exitCode, contendersResult!.diagnostic()).toBe(0);
        expect(await exists(join(barrierRoot, "lane-waiter-observed-lease-holder-teardown-complete"))).toBe(true);
        expect(await exists(join(barrierRoot, "lane-waiter-setup-complete"))).toBe(true);
        expect(await exists(join(barrierRoot, "lane-waiter-agent-started"))).toBe(true);
      });
    },
  );
});
