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

const REUSABLE_SANDBOX_READY_TIMEOUT_MS = 60_000;

function ownerTokenFromPublicRecoveryInspection(stderr: string): string {
  const match = stderr.match(/owner token:\s*(\S+)/u);
  expect(match, stderr).not.toBeNull();
  return match![1]!;
}

export function registerSharedStateLifecycleOwner(): void {
test.concurrent("相同 sharedState.key 在前一 Experiment teardown 后才允许下一 Experiment 进入 setup [necase_400VHE4GK3DNPNPC]", async () => {
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

        try {
          await pollUntil(
            async () => (await exists(join(barrierRoot, "first-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 10, label: "first Experiment reaches its agent" },
          );

          second = niceeval.start(["exp", "shared-state-second", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 60_000,
          });

          await waitForOutput(
            second,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "second Experiment reaches the sharedState lease seam" },
          );
          expect(await exists(join(barrierRoot, "second-setup-attempted"))).toBe(false);
        } finally {
          await writeFile(join(barrierRoot, "release-first-agent"), "");
        }

        const [firstResult, secondResult] = await Promise.all([first.done, second!.done]);
        expect(firstResult.exitCode, firstResult.diagnostic()).toBe(0);
        expect(secondResult.exitCode, secondResult.diagnostic()).toBe(0);
        expect(await exists(join(barrierRoot, "first-teardown-complete"))).toBe(true);
        expect(await exists(join(barrierRoot, "second-observed-first-teardown-complete"))).toBe(true);
        expect(await exists(join(barrierRoot, "second-setup-complete"))).toBe(true);
        expect(await exists(join(barrierRoot, "second-agent-started"))).toBe(true);
      });
    },
  );
});

test.concurrent("复用 Sandbox 的每条 Attempt after 与 Experiment teardown 完成后才交出 sharedState [necase_JDW5GFSRDDAP19P8]", async () => {
  await runnerE2E.case(
    "shared-state-reuse-lifecycle",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-pool-", async (barrierRoot) => {
        const first = niceeval.start(["exp", "shared-state-pool-first", "--rerun", "all", "--json"], {
          env: {
            NICEEVAL_SHARED_STATE_BARRIER: barrierRoot,
            NICEEVAL_SHARED_STATE_ROLE: "pool-first",
          },
          timeoutMs: 90_000,
        });
        let second: ReturnType<typeof niceeval.start> | undefined;
        try {
          await pollUntil(
            async () => (await exists(join(barrierRoot, "sandbox-after-attempt-1-started"))) || undefined,
            {
              timeoutMs: REUSABLE_SANDBOX_READY_TIMEOUT_MS,
              intervalMs: 20,
              label: "first Attempt after starts",
            },
          );
          second = niceeval.start(["exp", "shared-state-pool-second", "--rerun", "all", "--json"], {
            env: {
              NICEEVAL_SHARED_STATE_BARRIER: barrierRoot,
              NICEEVAL_SHARED_STATE_ROLE: "pool-second",
            },
            timeoutMs: 90_000,
          });
          await waitForOutput(
            second,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "second Experiment reaches the sharedState lease seam" },
          );
          expect(await exists(join(barrierRoot, "pool-second-setup-attempted"))).toBe(false);

          await writeFile(join(barrierRoot, "release-sandbox-after-attempt-1"), "");
          await pollUntil(
            async () => (await exists(join(barrierRoot, "sandbox-after-attempt-2-started"))) || undefined,
            {
              timeoutMs: REUSABLE_SANDBOX_READY_TIMEOUT_MS,
              intervalMs: 20,
              label: "second Attempt after starts",
            },
          );
          const [firstSandbox, secondSandbox] = await Promise.all([
            (await import("node:fs/promises")).readFile(join(barrierRoot, "pool-first-attempt-1"), "utf8"),
            (await import("node:fs/promises")).readFile(join(barrierRoot, "pool-first-attempt-2"), "utf8"),
          ]);
          expect(firstSandbox).toMatch(/.+/u);
          expect(secondSandbox).toBe(firstSandbox);
          expect(await exists(join(barrierRoot, "pool-second-setup-attempted"))).toBe(false);

          await writeFile(join(barrierRoot, "release-sandbox-after-attempt-2"), "");
          await pollUntil(
            async () => (await exists(join(barrierRoot, "experiment-teardown-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "Experiment teardown starts after all Attempt after callbacks" },
          );
          expect(await exists(join(barrierRoot, "pool-second-setup-attempted"))).toBe(false);

          await writeFile(join(barrierRoot, "release-experiment-teardown"), "");
          const [firstResult, secondResult] = await Promise.all([first.done, second.done]);
          expect(firstResult.exitCode, firstResult.diagnostic()).toBe(0);
          expect(secondResult.exitCode, secondResult.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "pool-second-observed-pool-first-teardown-complete"))).toBe(true);
          expect(await exists(join(barrierRoot, "pool-second-setup-complete"))).toBe(true);
          expect(await exists(join(barrierRoot, "pool-second-attempt-1"))).toBe(true);
        } finally {
          await writeFile(join(barrierRoot, "release-sandbox-after-attempt-1"), "").catch(() => undefined);
          await writeFile(join(barrierRoot, "release-sandbox-after-attempt-2"), "").catch(() => undefined);
          await writeFile(join(barrierRoot, "release-experiment-teardown"), "").catch(() => undefined);
          await first.dispose().catch(() => undefined);
          await second?.dispose().catch(() => undefined);
        }
      });
    },
  );
});

test.concurrent("复用 Sandbox 的 Attempt after 失败也会保留 sharedState，直到公开显式恢复 [necase_FFVQ9YEXTRJGGVA5]", async () => {
  await runnerE2E.case(
    "shared-state-pool-retire-cleanup-failure",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-pool-retire-", async (barrierRoot) => {
        const failed = await niceeval.run(
          ["exp", "shared-state-pool-retire-fails", "--rerun", "all", "--json"],
          {
            env: {
              NICEEVAL_SHARED_STATE_BARRIER: barrierRoot,
              NICEEVAL_SHARED_STATE_ROLE: "pool-retire-fails",
            },
            timeoutMs: 90_000,
          },
        );
        // The author after fails before the reusable Case is retired. This
        // marker keeps the failure distinct from the later Experiment hook.
        expect(await exists(join(barrierRoot, "pool-retire-after-started")), failed.diagnostic()).toBe(true);

        const waiter = niceeval.start(["exp", "shared-state-pool-retire-waiter", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        try {
          await waitForOutput(
            waiter,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "waiter reaches retained reusable Sandbox sharedState lease" },
          );
          expect(await exists(join(barrierRoot, "pool-retire-waiter-setup-attempted"))).toBe(false);

          // Recovery inspection obtains the immutable owner token only through
          // the public CLI; this test never reads coordination files.
          const inspection = await niceeval.run([
            "exp", "shared-state-pool-retire-fails", "--teardown",
            "--recover-shared-state", "runner/shared-state-pool-retire",
          ]);
          expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
          const ownerToken = ownerTokenFromPublicRecoveryInspection(inspection.stderr);

          const recovered = await niceeval.run([
            "exp", "shared-state-pool-retire-fails", "--teardown",
            "--recover-shared-state", "runner/shared-state-pool-retire",
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ], { env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot }, timeoutMs: 60_000 });
          expect(recovered.exitCode, recovered.diagnostic()).toBe(0);
          expect(recovered.stderr).toContain("explicitly recovered sharedState key runner/shared-state-pool-retire");

          const waiterResult = await waiter.done;
          expect(waiterResult.exitCode, waiterResult.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "pool-retire-waiter-observed-pool-retire-fails-teardown-complete"))).toBe(true);
          expect(await exists(join(barrierRoot, "pool-retire-waiter-agent-started"))).toBe(true);
        } finally {
          await waiter.dispose().catch(() => undefined);
        }
      });
    },
  );
});

test.concurrent("fresh Sandbox 的 Attempt after 失败也保留 sharedState，直到公开显式恢复 [necase_PV16QF2DMTKR229Z]", async () => {
  await runnerE2E.case(
    "shared-state-fresh-cleanup-failure",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-fresh-cleanup-", async (barrierRoot) => {
        const failed = await niceeval.run(
          ["exp", "shared-state-fresh-cleanup-fails", "--rerun", "all", "--json"],
          {
            env: {
              NICEEVAL_SHARED_STATE_BARRIER: barrierRoot,
              NICEEVAL_SHARED_STATE_ROLE: "fresh-cleanup-fails",
            },
            timeoutMs: 90_000,
          },
        );
        expect(await exists(join(barrierRoot, "fresh-sandbox-after-started")), failed.diagnostic()).toBe(true);

        const waiter = niceeval.start(["exp", "shared-state-fresh-cleanup-waiter", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        try {
          await waitForOutput(
            waiter,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "waiter reaches retained fresh Sandbox sharedState lease" },
          );
          expect(await exists(join(barrierRoot, "fresh-cleanup-waiter-setup-attempted"))).toBe(false);

          const inspection = await niceeval.run([
            "exp", "shared-state-fresh-cleanup-fails", "--teardown",
            "--recover-shared-state", "runner/shared-state-fresh-cleanup",
          ]);
          expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
          const ownerToken = ownerTokenFromPublicRecoveryInspection(inspection.stderr);

          const recovered = await niceeval.run([
            "exp", "shared-state-fresh-cleanup-fails", "--teardown",
            "--recover-shared-state", "runner/shared-state-fresh-cleanup",
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ], { env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot }, timeoutMs: 60_000 });
          expect(recovered.exitCode, recovered.diagnostic()).toBe(0);
          expect(recovered.stderr).toContain("explicitly recovered sharedState key runner/shared-state-fresh-cleanup");

          const waiterResult = await waiter.done;
          expect(waiterResult.exitCode, waiterResult.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "fresh-cleanup-waiter-observed-fresh-cleanup-fails-teardown-complete"))).toBe(true);
          expect(await exists(join(barrierRoot, "fresh-cleanup-waiter-agent-started"))).toBe(true);
        } finally {
          await waiter.dispose().catch(() => undefined);
        }
      });
    },
  );
});
}
