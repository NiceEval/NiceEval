// owner: docs/engineering/testing/e2e/runner.md#runner-shared-state-recovery
// rerun: pnpm e2e --repo runner -- --run test/shared-state-recovery.test.ts
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

function heartbeatFromPublicRecoveryInspection(stderr: string): string {
  const match = stderr.match(/heartbeat:\s*([^\r\n]+)/u);
  expect(match, stderr).not.toBeNull();
  const heartbeatAt = match![1]!;
  expect(Date.parse(heartbeatAt), stderr).not.toBeNaN();
  return heartbeatAt;
}

test("暂停的 owner 不会因 heartbeat 年龄失权，等待者可 SIGINT 取消且恢复后才交接", async () => {
  await runnerE2E.case(
    "shared-state-pause-resume-cancel",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-pause-", async (barrierRoot) => {
        const holder = niceeval.start(["exp", "shared-state-pause-holder", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 120_000,
        });
        let waiter: ReturnType<typeof niceeval.start> | undefined;
        let next: ReturnType<typeof niceeval.start> | undefined;
        try {
          await pollUntil(
            async () => (await exists(join(barrierRoot, "pause-holder-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "paused holder reaches its Attempt" },
          );

          // Inspection is the public CLI-only observation surface. The
          // immutable generation remains the authority, but its diagnostic
          // sidecar must advance while the holder is actively running.
          const initialInspection = await niceeval.run([
            "exp", "shared-state-pause-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-pause",
          ]);
          expect(initialInspection.exitCode, initialInspection.diagnostic()).toBe(1);
          const initialHeartbeat = heartbeatFromPublicRecoveryInspection(initialInspection.stderr);
          const advancedHeartbeat = await pollUntil(
            async () => {
              const inspection = await niceeval.run([
                "exp", "shared-state-pause-holder", "--teardown",
                "--recover-shared-state", "runner/shared-state-pause",
              ]);
              if (inspection.exitCode !== 1) return undefined;
              const heartbeatAt = heartbeatFromPublicRecoveryInspection(inspection.stderr);
              return Date.parse(heartbeatAt) > Date.parse(initialHeartbeat) ? heartbeatAt : undefined;
            },
            { timeoutMs: 25_000, intervalMs: 250, label: "public sharedState heartbeat advances while holder runs" },
          );
          expect(Date.parse(advancedHeartbeat)).toBeGreaterThan(Date.parse(initialHeartbeat));

          expect(holder.signal("SIGSTOP")).toBe(true);

          waiter = niceeval.start(["exp", "shared-state-pause-waiter", "--rerun", "all", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 75_000,
          });
          // The former automatic-takeover cutoff was three 10s heartbeats.
          // A stopped holder must remain authoritative across that whole age.
          expect(await appearsWithin(
            join(barrierRoot, "pause-waiter-setup-attempted"),
            35_000,
            "waiter setup while holder is SIGSTOPed beyond the old expiry",
          )).toBe(false);
          const pausedInspection = await niceeval.run([
            "exp", "shared-state-pause-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-pause",
          ]);
          expect(pausedInspection.exitCode, pausedInspection.diagnostic()).toBe(1);
          // SIGSTOP prevents the holder from writing another sidecar update;
          // its stale diagnostic timestamp is never an automatic-takeover
          // condition, as proved by the blocked waiter above.
          expect(heartbeatFromPublicRecoveryInspection(pausedInspection.stderr)).toBe(advancedHeartbeat);

          const interruptedAt = Date.now();
          expect(waiter.signal("SIGINT")).toBe(true);
          const interrupted = await waiter.done;
          expect(Date.now() - interruptedAt, interrupted.diagnostic()).toBeLessThan(5_000);
          expect(interrupted.timedOut, interrupted.diagnostic()).toBe(false);
          expect(await exists(join(barrierRoot, "pause-waiter-setup-attempted"))).toBe(false);

          expect(holder.signal("SIGCONT")).toBe(true);
          await writeFile(join(barrierRoot, "release-pause-holder"), "");
          const holderResult = await holder.done;
          expect(holderResult.exitCode, holderResult.diagnostic()).toBe(0);

          next = niceeval.start(["exp", "shared-state-pause-waiter", "--rerun", "all", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 45_000,
          });
          const nextResult = await next.done;
          expect(nextResult.exitCode, nextResult.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "pause-waiter-setup-complete"))).toBe(true);
          expect(await exists(join(barrierRoot, "pause-waiter-agent-started"))).toBe(true);
        } finally {
          holder.signal("SIGCONT");
          await writeFile(join(barrierRoot, "release-pause-holder"), "").catch(() => undefined);
          await holder.dispose().catch(() => undefined);
          await waiter?.dispose().catch(() => undefined);
          await next?.dispose().catch(() => undefined);
        }
      });
    },
  );
});

test("崩溃的 recovery 可由新 actor 显式续接，旧 token 不会删除新 holder", async () => {
  await runnerE2E.case(
    "shared-state-crash-recovery-aba",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-recovery-", async (barrierRoot) => {
        const holder = niceeval.start(["exp", "shared-state-crash-holder", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        let waiter: ReturnType<typeof niceeval.start> | undefined;
        let third: ReturnType<typeof niceeval.start> | undefined;
        let recovery: ReturnType<typeof niceeval.start> | undefined;
        let resumedRecovery: ReturnType<typeof niceeval.start> | undefined;
        let competingRecovery: ReturnType<typeof niceeval.start> | undefined;
        try {
          await pollUntil(
            async () => (await exists(join(barrierRoot, "crash-holder-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "crash holder reaches its Attempt" },
          );
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          waiter = niceeval.start(["exp", "shared-state-crash-waiter", "--rerun", "all", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 90_000,
          });
          expect(await appearsWithin(
            join(barrierRoot, "crash-waiter-setup-attempted"),
            3_000,
            "automatic takeover after a crash",
          )).toBe(false);

          // The no-confirmation form is inspection only. It is the public way
          // to obtain exact owner evidence without private-file access.
          const inspection = await niceeval.run([
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
          ]);
          expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
          expect(inspection.stderr).toContain("key: runner/shared-state-crash");
          expect(inspection.stderr).toContain("experiment: shared-state-crash-holder");
          expect(inspection.stderr).toContain("host:");
          expect(inspection.stderr).toContain("PID:");
          expect(inspection.stderr).toContain("process identity:");
          expect(inspection.stderr).toContain("heartbeat:");
          const ownerToken = ownerTokenFromPublicRecoveryInspection(inspection.stderr);

          const wrongToken = await niceeval.run([
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
            "--owner-token", "not-the-owner-token",
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ]);
          expect(wrongToken.exitCode, wrongToken.diagnostic()).toBe(1);
          expect(await exists(join(barrierRoot, "crash-waiter-setup-attempted"))).toBe(false);
          const afterWrongToken = await niceeval.run([
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
          ]);
          expect(afterWrongToken.exitCode, afterWrongToken.diagnostic()).toBe(1);
          expect(ownerTokenFromPublicRecoveryInspection(afterWrongToken.stderr)).toBe(ownerToken);

          const recoveryArgs = [
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ];
          recovery = niceeval.start(recoveryArgs, {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 60_000,
          });
          await pollUntil(
            async () => (await exists(join(barrierRoot, "crash-recovery-teardown-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "first public recovery holds its generation" },
          );
          // This is a real concurrent public recovery attempt. It must not
          // replace the live immutable recovery generation.
          competingRecovery = niceeval.start(recoveryArgs, {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 30_000,
          });
          const competingResult = await competingRecovery.done;
          expect(competingResult.exitCode, competingResult.diagnostic()).toBe(1);
          expect(competingResult.stderr).toContain("prior sharedState recovery is still live");
          expect(await exists(join(barrierRoot, "crash-waiter-setup-attempted"))).toBe(false);

          // A recovery process can itself crash after publishing its immutable
          // recovering generation. A new exact recovery must advance to a new
          // recovery id/actor rather than remain permanently fenced by it.
          expect(recovery.signal("SIGKILL")).toBe(true);
          await recovery.done;
          resumedRecovery = niceeval.start(recoveryArgs, {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 60_000,
          });
          await writeFile(join(barrierRoot, "release-crash-recovery-teardown"), "");
          const recovered = await resumedRecovery.done;
          expect(recovered.exitCode, recovered.diagnostic()).toBe(0);
          expect(recovered.stderr).toContain("explicitly recovered sharedState key runner/shared-state-crash");

          await pollUntil(
            async () => (await exists(join(barrierRoot, "crash-waiter-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "new holder starts only after explicit recovery" },
          );
          const staleToken = await niceeval.run([
            "exp", "shared-state-crash-waiter", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ]);
          expect(staleToken.exitCode, staleToken.diagnostic()).toBe(1);
          const afterStaleToken = await niceeval.run([
            "exp", "shared-state-crash-waiter", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
          ]);
          expect(afterStaleToken.exitCode, afterStaleToken.diagnostic()).toBe(1);
          expect(ownerTokenFromPublicRecoveryInspection(afterStaleToken.stderr)).not.toBe(ownerToken);

          third = niceeval.start(["exp", "shared-state-crash-third", "--rerun", "all", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 60_000,
          });
          expect(await appearsWithin(
            join(barrierRoot, "crash-third-setup-attempted"),
            3_000,
            "third waiter while new holder owns the lease",
          )).toBe(false);

          await writeFile(join(barrierRoot, "release-crash-waiter"), "");
          const waiterResult = await waiter.done;
          expect(waiterResult.exitCode, waiterResult.diagnostic()).toBe(0);
          const thirdResult = await third.done;
          expect(thirdResult.exitCode, thirdResult.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "crash-third-agent-started"))).toBe(true);
        } finally {
          await writeFile(join(barrierRoot, "release-crash-holder"), "").catch(() => undefined);
          await writeFile(join(barrierRoot, "release-crash-waiter"), "").catch(() => undefined);
          await writeFile(join(barrierRoot, "release-crash-recovery-teardown"), "").catch(() => undefined);
          await holder.dispose().catch(() => undefined);
          await waiter?.dispose().catch(() => undefined);
          await third?.dispose().catch(() => undefined);
          await recovery?.dispose().catch(() => undefined);
          await resumedRecovery?.dispose().catch(() => undefined);
          await competingRecovery?.dispose().catch(() => undefined);
        }
      });
    },
  );
});

test("实际 Experiment teardown 失败会保留 lease，等待者只能取消或走显式恢复", async () => {
  await runnerE2E.case(
    "shared-state-cleanup-failure-retains-lease",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-cleanup-failure-", async (barrierRoot) => {
        const failedCleanup = await niceeval.run(
          ["exp", "shared-state-cleanup-fails", "--rerun", "all", "--json"],
          { env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot }, timeoutMs: 45_000 },
        );
        expect(failedCleanup.exitCode, failedCleanup.diagnostic()).toBe(0);
        expect(await exists(join(barrierRoot, "cleanup-failure-teardown-started"))).toBe(true);

        const waiter = niceeval.start(["exp", "shared-state-cleanup-waiter", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 45_000,
        });
        try {
          expect(await appearsWithin(
            join(barrierRoot, "cleanup-waiter-setup-attempted"),
            3_000,
            "waiter after failed cleanup",
          )).toBe(false);
          const inspection = await niceeval.run([
            "exp", "shared-state-cleanup-fails", "--teardown",
            "--recover-shared-state", "runner/shared-state-cleanup-failure",
          ]);
          expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
          expect(inspection.stderr).toContain("owner token:");
          expect(inspection.stderr).toContain("sharedState recovery requires");
          expect(waiter.signal("SIGINT")).toBe(true);
          const cancelled = await waiter.done;
          expect(cancelled.timedOut, cancelled.diagnostic()).toBe(false);
        } finally {
          await waiter.dispose().catch(() => undefined);
        }
      });
    },
  );
});

test("缺少 teardown 的显式 recovery 不改变 active generation", async () => {
  await runnerE2E.case(
    "shared-state-recovery-requires-declared-teardown",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-missing-teardown-", async (barrierRoot) => {
        const holder = niceeval.start([
          "exp", "shared-state-recovery-without-teardown", "--rerun", "all", "--json",
        ], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        let waiter: ReturnType<typeof niceeval.start> | undefined;
        try {
          await pollUntil(
            async () => (await exists(join(barrierRoot, "recovery-without-teardown-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "holder without teardown reaches its Attempt" },
          );
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          const inspectionArgs = [
            "exp", "shared-state-recovery-without-teardown", "--teardown",
            "--recover-shared-state", "runner/shared-state-recovery-without-teardown",
          ];
          const before = await niceeval.run(inspectionArgs);
          expect(before.exitCode, before.diagnostic()).toBe(1);
          const ownerToken = ownerTokenFromPublicRecoveryInspection(before.stderr);

          const rejected = await niceeval.run([
            ...inspectionArgs,
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ]);
          expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
          expect(rejected.stderr).toContain("to declare teardown");

          const after = await niceeval.run(inspectionArgs);
          expect(after.exitCode, after.diagnostic()).toBe(1);
          expect(ownerTokenFromPublicRecoveryInspection(after.stderr)).toBe(ownerToken);

          waiter = niceeval.start([
            "exp", "shared-state-recovery-without-teardown-waiter", "--rerun", "all", "--json",
          ], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 45_000,
          });
          expect(await appearsWithin(
            join(barrierRoot, "recovery-without-teardown-waiter-setup-attempted"),
            3_000,
            "waiter setup after rejected recovery",
          )).toBe(false);
          expect(waiter.signal("SIGINT")).toBe(true);
          const cancelled = await waiter.done;
          expect(cancelled.timedOut, cancelled.diagnostic()).toBe(false);
        } finally {
          await writeFile(join(barrierRoot, "release-recovery-without-teardown"), "").catch(() => undefined);
          await holder.dispose().catch(() => undefined);
          await waiter?.dispose().catch(() => undefined);
        }
      });
    },
  );
});

test("显式 recovery 拒绝 JSON，并在两种帮助入口公开全部参数", async () => {
  await runnerE2E.case(
    "shared-state-recovery-human-only-interface",
    async ({ commands: { niceeval } }) => {
      const jsonRecovery = await niceeval.run([
        "exp", "shared-state-recovery-without-teardown", "--teardown",
        "--recover-shared-state", "runner/shared-state-recovery-without-teardown",
        "--owner-token", "fixture-owner-token",
        "--confirm-owner-terminated", "--confirm-remote-quiesced", "--json",
      ]);
      expect(jsonRecovery.exitCode, jsonRecovery.diagnostic()).toBe(1);
      expect(jsonRecovery.stderr).toContain("does not support --json");
      expect(jsonRecovery.stdout).toBe("");

      const [rootHelp, expHelp] = await Promise.all([
        niceeval.run(["--help"]),
        niceeval.run(["exp", "help"]),
      ]);
      const recoveryFlags = [
        "--recover-shared-state <key>",
        "--owner-token <token>",
        "--confirm-owner-terminated",
        "--confirm-remote-quiesced",
      ];
      expect([rootHelp, expHelp].map(({ exitCode, stdout }) => ({
        exitCode,
        hasFullRecoveryUsage: recoveryFlags.every((flag) => stdout.includes(flag)),
      }))).toEqual([
        { exitCode: 0, hasFullRecoveryUsage: true },
        { exitCode: 0, hasFullRecoveryUsage: true },
      ]);
    },
  );
});
