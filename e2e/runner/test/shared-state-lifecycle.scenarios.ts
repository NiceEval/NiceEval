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

const REUSABLE_SANDBOX_READY_TIMEOUT_MS = 60_000;

function ownerTokenFromPublicRecoveryInspection(stderr: string): string {
  const match = stderr.match(/owner token:\s*(\S+)/u);
  expect(match, stderr).not.toBeNull();
  return match![1]!;
}

export function registerSharedStateLifecycleOwner(titles: {
  readonly serializedSetup: string;
  readonly reusableCompletion: string;
  readonly reusableFailure: string;
  readonly freshFailure: string;
}): void {
test(titles.serializedSetup, async () => {
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

test(titles.reusableCompletion, async () => {
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
          const enteredDuringFirstAfter = await pollUntil(
            async () => (await exists(join(barrierRoot, "pool-second-setup-attempted"))) || undefined,
            { timeoutMs: 2_000, intervalMs: 20, label: "second setup during first Attempt after" },
          ).then(() => true).catch(() => false);
          expect(enteredDuringFirstAfter).toBe(false);

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
          const enteredDuringSecondAfter = await pollUntil(
            async () => (await exists(join(barrierRoot, "pool-second-setup-attempted"))) || undefined,
            { timeoutMs: 2_000, intervalMs: 20, label: "second setup during second Attempt after" },
          ).then(() => true).catch(() => false);
          expect(enteredDuringSecondAfter).toBe(false);

          await writeFile(join(barrierRoot, "release-sandbox-after-attempt-2"), "");
          await pollUntil(
            async () => (await exists(join(barrierRoot, "experiment-teardown-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "Experiment teardown starts after all Attempt after callbacks" },
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

test(titles.reusableFailure, async () => {
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

test(titles.freshFailure, async () => {
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
          expect(await appearsWithin(
            join(barrierRoot, "fresh-cleanup-waiter-setup-attempted"),
            3_000,
            "waiter setup after fresh Sandbox after failure",
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
}
