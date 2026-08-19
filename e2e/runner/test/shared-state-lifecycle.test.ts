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

async function appearsWithin(path: string, timeoutMs: number, label: string): Promise<boolean> {
  return pollUntil(
    async () => await exists(path) ? true : undefined,
    { timeoutMs, intervalMs: 20, label },
  ).then(() => true).catch(() => false);
}

function ownerTokenFromPublicRecoveryInspection(stderr: string): string {
  const match = stderr.match(/owner token:\s*(\S+)/u);
  expect(match, stderr).not.toBeNull();
  return match![1]!;
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

test("复用的同一物理 Sandbox 完成 Sandbox lifecycle/finalizer scope 和 Experiment teardown 后才交出 sharedState", async () => {
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
            async () => {
              const firstAttempt = join(barrierRoot, "pool-first-attempt-1");
              const secondAttempt = join(barrierRoot, "pool-first-attempt-2");
              return await exists(firstAttempt) && await exists(secondAttempt) ? true : undefined;
            },
            { timeoutMs: 45_000, intervalMs: 20, label: "two attempts use the reusable Sandbox" },
          );
          const [firstSandbox, secondSandbox] = await Promise.all([
            (await import("node:fs/promises")).readFile(join(barrierRoot, "pool-first-attempt-1"), "utf8"),
            (await import("node:fs/promises")).readFile(join(barrierRoot, "pool-first-attempt-2"), "utf8"),
          ]);
          expect(firstSandbox).toMatch(/.+/u);
          expect(secondSandbox).toBe(firstSandbox);

          await pollUntil(
            async () => (await exists(join(barrierRoot, "sandbox-lifecycle-scope-started"))) || undefined,
            { timeoutMs: 45_000, intervalMs: 20, label: "Sandbox lifecycle/finalizer scope starts after the last Attempt" },
          );
          second = niceeval.start(["exp", "shared-state-pool-second", "--rerun", "all", "--json"], {
            env: {
              NICEEVAL_SHARED_STATE_BARRIER: barrierRoot,
              NICEEVAL_SHARED_STATE_ROLE: "pool-second",
            },
            timeoutMs: 90_000,
          });
          const enteredDuringSandboxLifecycleScope = await pollUntil(
            async () => (await exists(join(barrierRoot, "pool-second-setup-attempted"))) || undefined,
            { timeoutMs: 2_000, intervalMs: 20, label: "second setup during Sandbox lifecycle/finalizer scope" },
          ).then(() => true).catch(() => false);
          expect(enteredDuringSandboxLifecycleScope).toBe(false);

          await writeFile(join(barrierRoot, "release-sandbox-lifecycle-scope"), "");
          await pollUntil(
            async () => (await exists(join(barrierRoot, "experiment-teardown-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "Experiment teardown starts after Sandbox lifecycle/finalizer scope" },
          );
          const enteredDuringExperimentTeardown = await pollUntil(
            async () => (await exists(join(barrierRoot, "pool-second-setup-attempted"))) || undefined,
            { timeoutMs: 2_000, intervalMs: 20, label: "second setup during Experiment teardown" },
          ).then(() => true).catch(() => false);
          expect(enteredDuringExperimentTeardown).toBe(false);

          await writeFile(join(barrierRoot, "release-experiment-teardown"), "");
          const [firstResult, secondResult] = await Promise.all([first.done, second.done]);
          expect(firstResult.exitCode, firstResult.diagnostic()).toBe(0);
          expect(secondResult.exitCode, secondResult.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "pool-second-setup-complete"))).toBe(true);
          expect(await exists(join(barrierRoot, "pool-second-attempt-1"))).toBe(true);
        } finally {
          await writeFile(join(barrierRoot, "release-sandbox-lifecycle-scope"), "").catch(() => undefined);
          await writeFile(join(barrierRoot, "release-experiment-teardown"), "").catch(() => undefined);
          await first.dispose().catch(() => undefined);
          await second?.dispose().catch(() => undefined);
        }
      });
    },
  );
});

test("提前 retire 的 Sandbox lifecycle Scope 失败也会保留 sharedState，直到公开显式恢复", async () => {
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
        // The failed Sandbox scope was retired before terminal stop. This
        // marker is public fixture evidence that the early physical finalizer
        // path—not the later Experiment hook—is the failure under test.
        expect(await exists(join(barrierRoot, "pool-retire-scope-finalizer-started")), failed.diagnostic()).toBe(true);

        const waiter = niceeval.start(["exp", "shared-state-pool-retire-waiter", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        try {
          expect(await appearsWithin(
            join(barrierRoot, "pool-retire-waiter-setup-attempted"),
            3_000,
            "waiter setup after early reusable Sandbox cleanup failure",
          )).toBe(false);

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
          expect(await exists(join(barrierRoot, "pool-retire-waiter-agent-started"))).toBe(true);
        } finally {
          await waiter.dispose().catch(() => undefined);
        }
      });
    },
  );
});

test("fresh Sandbox lifecycle cleanup 失败也保留 sharedState，直到公开显式恢复", async () => {
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
        expect(await exists(join(barrierRoot, "fresh-sandbox-lifecycle-teardown-started")), failed.diagnostic()).toBe(true);

        const waiter = niceeval.start(["exp", "shared-state-fresh-cleanup-waiter", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        try {
          expect(await appearsWithin(
            join(barrierRoot, "fresh-cleanup-waiter-setup-attempted"),
            3_000,
            "waiter setup after fresh Sandbox lifecycle cleanup failure",
          )).toBe(false);

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
          expect(await exists(join(barrierRoot, "fresh-cleanup-waiter-agent-started"))).toBe(true);
        } finally {
          await waiter.dispose().catch(() => undefined);
        }
      });
    },
  );
});

test("等待 sharedState 不占用同一 exclusive provider lane，无关 Experiment 仍可进入 Agent", async () => {
  await runnerE2E.case(
    "shared-state-exclusive-provider-lane",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-exclusive-lane-", async (barrierRoot) => {
        const holder = niceeval.start(["exp", "shared-state-lease-holder", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        let contenders: ReturnType<typeof niceeval.start> | undefined;
        let independentEnteredBeforeLeaseRelease = false;
        let waiterEnteredSetupBeforeLeaseRelease = false;
        let setupError: unknown;

        try {
          await pollUntil(
            async () => (await exists(join(barrierRoot, "lease-holder-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 10, label: "sharedState holder reaches its Agent" },
          );

          contenders = niceeval.start(["exp", "shared-state-lane", "--rerun", "all", "--max-concurrency", "2", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 60_000,
          });
          independentEnteredBeforeLeaseRelease = await appearsWithin(
            join(barrierRoot, "lane-independent-agent-started"),
            3_000,
            "independent local provider Experiment while sharedState waiter is blocked",
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
