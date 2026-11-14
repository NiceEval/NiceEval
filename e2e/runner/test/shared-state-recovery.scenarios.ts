import { pollUntil, waitForOutput, waitForPathOrProcessExit, withTempDir } from "@niceeval/testkit";
import { access, readFile, writeFile } from "node:fs/promises";
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

// @use-case docs/feature/experiments/use-case/concurrency-resume-interrupted-run.md
// @test-file e2e/runner/test/shared-state-recovery.test.ts
// @native niceeval:%7B%22executor%22%3A%22vitest%22%2C%22repo%22%3A%22runner%22%2C%22file%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.scenarios.ts%22%2C%22nativeFile%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.test.ts%22%2C%22project%22%3A%22default%22%2C%22titlePath%22%3A%5B%22%E6%9A%82%E5%81%9C%E7%9A%84%20owner%20%E4%B8%8D%E4%BC%9A%E5%9B%A0%20heartbeat%20%E5%B9%B4%E9%BE%84%E5%A4%B1%E6%9D%83%EF%BC%8C%E7%AD%89%E5%BE%85%E8%80%85%E5%8F%AF%20SIGINT%20%E5%8F%96%E6%B6%88%E4%B8%94%E6%81%A2%E5%A4%8D%E5%90%8E%E6%89%8D%E4%BA%A4%E6%8E%A5%22%5D%7D
test.concurrent("暂停的 owner 不会因 heartbeat 年龄失权，等待者可 SIGINT 取消且恢复后才交接", async () => {
  await runnerE2E.case(
    "shared-state-pause-resume-cancel",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-pause-", async (barrierRoot) => {
        // The scenario deliberately pauses the Attempt beyond the old 30s
        // takeover window; its product deadline must sit outside that probe.
        const holder = niceeval.start(
          ["exp", "shared-state-pause-holder", "--rerun", "all", "--timeout", "90000", "--json"],
          {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 120_000,
          },
        );
        let waiter: ReturnType<typeof niceeval.start> | undefined;
        let next: ReturnType<typeof niceeval.start> | undefined;
        try {
          await pollUntil(async () => (await exists(join(barrierRoot, "pause-holder-agent-started"))) || undefined, {
            timeoutMs: 30_000,
            intervalMs: 20,
            label: "paused holder reaches its Attempt",
          });

          // Inspection is the public CLI-only observation surface. The
          // immutable generation remains the authority, but its diagnostic
          // sidecar must advance while the holder is actively running.
          const initialInspection = await niceeval.run([
            "exp",
            "shared-state-pause-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-pause",
          ]);
          expect(initialInspection.exitCode, initialInspection.diagnostic()).toBe(1);
          const initialHeartbeat = heartbeatFromPublicRecoveryInspection(initialInspection.stderr);
          const advancedHeartbeat = await pollUntil(
            async () => {
              const inspection = await niceeval.run([
                "exp",
                "shared-state-pause-holder",
                "--after",
                "--recover-shared-state",
                "runner/shared-state-pause",
              ]);
              if (inspection.exitCode !== 1) return undefined;
              const heartbeatAt = heartbeatFromPublicRecoveryInspection(inspection.stderr);
              return Date.parse(heartbeatAt) > Date.parse(initialHeartbeat) ? heartbeatAt : undefined;
            },
            { timeoutMs: 25_000, intervalMs: 250, label: "public sharedState heartbeat advances while holder runs" },
          );
          expect(Date.parse(advancedHeartbeat)).toBeGreaterThan(Date.parse(initialHeartbeat));

          expect(holder.signal("SIGSTOP")).toBe(true);

          // The last running sample can advance before SIGSTOP takes effect.
          // Establish the frozen baseline through the same public inspection.
          const pausedBaselineInspection = await niceeval.run([
            "exp",
            "shared-state-pause-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-pause",
          ]);
          expect(pausedBaselineInspection.exitCode, pausedBaselineInspection.diagnostic()).toBe(1);
          const pausedHeartbeat = heartbeatFromPublicRecoveryInspection(pausedBaselineInspection.stderr);
          expect(Date.parse(pausedHeartbeat)).toBeGreaterThanOrEqual(Date.parse(advancedHeartbeat));

          waiter = niceeval.start(["exp", "shared-state-pause-waiter", "--rerun", "all", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 75_000,
          });
          await waitForOutput(waiter, "stdout", /"code":"state-lease-waiting"/u, {
            timeoutMs: 30_000,
            label: "paused-owner waiter reaches the sharedState lease seam",
          });
          // The former automatic-takeover cutoff was three 10s heartbeats.
          // Wait for that age as a positive clock condition after observing the
          // public wait event; marker absence alone is not the rendezvous.
          await pollUntil(async () => (Date.now() - Date.parse(pausedHeartbeat) >= 35_000 ? true : undefined), {
            timeoutMs: 40_000,
            intervalMs: 50,
            label: "paused owner exceeds the former heartbeat expiry",
          });
          expect(await exists(join(barrierRoot, "pause-waiter-setup-attempted"))).toBe(false);
          const pausedInspection = await niceeval.run([
            "exp",
            "shared-state-pause-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-pause",
          ]);
          expect(pausedInspection.exitCode, pausedInspection.diagnostic()).toBe(1);
          // SIGSTOP prevents the holder from writing another sidecar update;
          // its stale diagnostic timestamp is never an automatic-takeover
          // condition, as proved by the blocked waiter above.
          expect(heartbeatFromPublicRecoveryInspection(pausedInspection.stderr)).toBe(pausedHeartbeat);

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
          expect(await exists(join(barrierRoot, "pause-waiter-observed-pause-holder-teardown-complete"))).toBe(true);
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
// @use-case docs/feature/experiments/use-case/concurrency-resume-interrupted-run.md
// @regression memory/concurrent-run-publication-recovery-race.md
// @test-file e2e/runner/test/shared-state-recovery.test.ts
// @native niceeval:%7B%22executor%22%3A%22vitest%22%2C%22repo%22%3A%22runner%22%2C%22file%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.scenarios.ts%22%2C%22nativeFile%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.test.ts%22%2C%22project%22%3A%22default%22%2C%22titlePath%22%3A%5B%22%E5%B4%A9%E6%BA%83%E7%9A%84%20recovery%20%E5%8F%AF%E7%94%B1%E6%96%B0%20actor%20%E6%98%BE%E5%BC%8F%E7%BB%AD%E6%8E%A5%EF%BC%8C%E6%97%A7%20token%20%E4%B8%8D%E4%BC%9A%E5%88%A0%E9%99%A4%E6%96%B0%20holder%22%5D%7D
test.concurrent("崩溃的 recovery 可由新 actor 显式续接，旧 token 不会删除新 holder", async () => {
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
          await pollUntil(async () => (await exists(join(barrierRoot, "crash-holder-agent-started"))) || undefined, {
            timeoutMs: 30_000,
            intervalMs: 20,
            label: "crash holder reaches its Attempt",
          });
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          waiter = niceeval.start(["exp", "shared-state-crash-waiter", "--rerun", "all", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            // This process intentionally waits across every public recovery
            // probe, then becomes the live holder for the ABA check below.
            // Keep its harness lifetime inside the case deadline but outside
            // that whole owner-local lifecycle; the product timeout remains
            // the configured 60s Attempt deadline.
            timeoutMs: 180_000,
          });
          await waitForOutput(waiter, "stdout", /"code":"state-lease-waiting"/u, {
            timeoutMs: 30_000,
            label: "crash waiter reaches the retained sharedState lease",
          });
          expect(await exists(join(barrierRoot, "crash-waiter-setup-attempted"))).toBe(false);

          // The no-confirmation form is inspection only. It is the public way
          // to obtain exact owner evidence without private-file access.
          const inspection = await niceeval.run([
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
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
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
            "--owner-token",
            "not-the-owner-token",
            "--confirm-owner-terminated",
            "--confirm-remote-quiesced",
          ]);
          expect(wrongToken.exitCode, wrongToken.diagnostic()).toBe(1);
          expect(await exists(join(barrierRoot, "crash-waiter-setup-attempted"))).toBe(false);
          const afterWrongToken = await niceeval.run([
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
          ]);
          expect(afterWrongToken.exitCode, afterWrongToken.diagnostic()).toBe(1);
          expect(ownerTokenFromPublicRecoveryInspection(afterWrongToken.stderr)).toBe(ownerToken);

          const recoveryArgs = [
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
            "--owner-token",
            ownerToken,
            "--confirm-owner-terminated",
            "--confirm-remote-quiesced",
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

          await pollUntil(async () => (await exists(join(barrierRoot, "crash-waiter-agent-started"))) || undefined, {
            timeoutMs: 30_000,
            intervalMs: 20,
            label: "new holder starts only after explicit recovery",
          });

          // Establish the third Invocation behind the new holder before the
          // stale-token attempt. It must remain fenced throughout that public
          // ABA probe rather than racing a holder whose harness deadline may
          // already have ended it.
          third = niceeval.start(["exp", "shared-state-crash-third", "--rerun", "all", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 60_000,
          });
          await waitForOutput(third, "stdout", /"code":"state-lease-waiting"/u, {
            timeoutMs: 30_000,
            label: "third waiter reaches the new holder's sharedState lease",
          });
          expect(await exists(join(barrierRoot, "crash-third-setup-attempted"))).toBe(false);

          const staleToken = await niceeval.run([
            "exp",
            "shared-state-crash-waiter",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
            "--owner-token",
            ownerToken,
            "--confirm-owner-terminated",
            "--confirm-remote-quiesced",
          ]);
          expect(staleToken.exitCode, staleToken.diagnostic()).toBe(1);
          const afterStaleToken = await niceeval.run([
            "exp",
            "shared-state-crash-waiter",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
          ]);
          expect(afterStaleToken.exitCode, afterStaleToken.diagnostic()).toBe(1);
          expect(ownerTokenFromPublicRecoveryInspection(afterStaleToken.stderr)).not.toBe(ownerToken);
          expect(await exists(join(barrierRoot, "crash-third-setup-attempted"))).toBe(false);

          await writeFile(join(barrierRoot, "release-crash-waiter"), "");
          const waiterResult = await waiter.done;
          expect(waiterResult.exitCode, waiterResult.diagnostic()).toBe(0);
          const thirdResult = await third.done;
          expect(thirdResult.exitCode, thirdResult.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "crash-third-observed-crash-waiter-teardown-complete"))).toBe(true);
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
// @use-case docs/feature/experiments/use-case/concurrency-resume-interrupted-run.md
// @test-file e2e/runner/test/shared-state-recovery.test.ts
// @native niceeval:%7B%22executor%22%3A%22vitest%22%2C%22repo%22%3A%22runner%22%2C%22file%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.scenarios.ts%22%2C%22nativeFile%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.test.ts%22%2C%22project%22%3A%22default%22%2C%22titlePath%22%3A%5B%22%E5%AE%9E%E9%99%85%20Experiment%20teardown%20%E5%A4%B1%E8%B4%A5%E4%BC%9A%E4%BF%9D%E7%95%99%20lease%EF%BC%8C%E7%AD%89%E5%BE%85%E8%80%85%E5%8F%AA%E8%83%BD%E5%8F%96%E6%B6%88%E6%88%96%E8%B5%B0%E6%98%BE%E5%BC%8F%E6%81%A2%E5%A4%8D%22%5D%7D
test.concurrent("实际 Experiment teardown 失败会保留 lease，等待者只能取消或走显式恢复", async () => {
  await runnerE2E.case(
    "shared-state-cleanup-failure-retains-lease",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-cleanup-failure-", async (barrierRoot) => {
        const failedCleanup = await niceeval.run(["exp", "shared-state-cleanup-fails", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 45_000,
        });
        expect(failedCleanup.exitCode, failedCleanup.diagnostic()).toBe(0);
        expect(await exists(join(barrierRoot, "cleanup-failure-teardown-started"))).toBe(true);

        const waiter = niceeval.start(["exp", "shared-state-cleanup-waiter", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 45_000,
        });
        try {
          await waitForOutput(waiter, "stdout", /"code":"state-lease-waiting"/u, {
            timeoutMs: 30_000,
            label: "waiter reaches the lease retained by failed cleanup",
          });
          expect(await exists(join(barrierRoot, "cleanup-waiter-setup-attempted"))).toBe(false);
          const inspection = await niceeval.run([
            "exp",
            "shared-state-cleanup-fails",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-cleanup-failure",
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
// @use-case docs/feature/experiments/use-case/concurrency-resume-interrupted-run.md
// @test-file e2e/runner/test/shared-state-recovery.test.ts
// @native niceeval:%7B%22executor%22%3A%22vitest%22%2C%22repo%22%3A%22runner%22%2C%22file%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.scenarios.ts%22%2C%22nativeFile%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.test.ts%22%2C%22project%22%3A%22default%22%2C%22titlePath%22%3A%5B%22%E7%BC%BA%E5%B0%91%20teardown%20%E7%9A%84%E6%98%BE%E5%BC%8F%20recovery%20%E4%B8%8D%E6%94%B9%E5%8F%98%20active%20generation%22%5D%7D
test.concurrent("缺少 teardown 的显式 recovery 不改变 active generation", async () => {
  await runnerE2E.case(
    "shared-state-recovery-requires-declared-teardown",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-missing-teardown-", async (barrierRoot) => {
        const holder = niceeval.start(["exp", "shared-state-recovery-without-teardown", "--rerun", "all", "--json"], {
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
            "exp",
            "shared-state-recovery-without-teardown",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-recovery-without-teardown",
          ];
          const before = await niceeval.run(inspectionArgs);
          expect(before.exitCode, before.diagnostic()).toBe(1);
          const ownerToken = ownerTokenFromPublicRecoveryInspection(before.stderr);

          const rejected = await niceeval.run([
            ...inspectionArgs,
            "--owner-token",
            ownerToken,
            "--confirm-owner-terminated",
            "--confirm-remote-quiesced",
          ]);
          expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
          expect(rejected.stderr).toContain("to declare after");

          const after = await niceeval.run(inspectionArgs);
          expect(after.exitCode, after.diagnostic()).toBe(1);
          expect(ownerTokenFromPublicRecoveryInspection(after.stderr)).toBe(ownerToken);

          waiter = niceeval.start(
            ["exp", "shared-state-recovery-without-teardown-waiter", "--rerun", "all", "--json"],
            {
              env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
              timeoutMs: 45_000,
            },
          );
          await waitForOutput(waiter, "stdout", /"code":"state-lease-waiting"/u, {
            timeoutMs: 30_000,
            label: "waiter reaches active generation after rejected recovery",
          });
          expect(await exists(join(barrierRoot, "recovery-without-teardown-waiter-setup-attempted"))).toBe(false);
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
// @use-case docs/feature/experiments/use-case/concurrency-resume-interrupted-run.md
// @test-file e2e/runner/test/shared-state-recovery.test.ts
// @native niceeval:%7B%22executor%22%3A%22vitest%22%2C%22repo%22%3A%22runner%22%2C%22file%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.scenarios.ts%22%2C%22nativeFile%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.test.ts%22%2C%22project%22%3A%22default%22%2C%22titlePath%22%3A%5B%22%E6%98%BE%E5%BC%8F%20recovery%20%E6%8B%92%E7%BB%9D%20JSON%EF%BC%8C%E5%B9%B6%E5%9C%A8%E4%B8%A4%E7%A7%8D%E5%B8%AE%E5%8A%A9%E5%85%A5%E5%8F%A3%E5%85%AC%E5%BC%80%E5%85%A8%E9%83%A8%E5%8F%82%E6%95%B0%22%5D%7D
test.concurrent("显式 recovery 拒绝 JSON，并在两种帮助入口公开全部参数", async () => {
  await runnerE2E.case("shared-state-recovery-human-only-interface", async ({ commands: { niceeval } }) => {
    const jsonRecovery = await niceeval.run([
      "exp",
      "shared-state-recovery-without-teardown",
      "--after",
      "--recover-shared-state",
      "runner/shared-state-recovery-without-teardown",
      "--owner-token",
      "fixture-owner-token",
      "--confirm-owner-terminated",
      "--confirm-remote-quiesced",
      "--json",
    ]);
    expect(jsonRecovery.exitCode, jsonRecovery.diagnostic()).toBe(1);
    expect(jsonRecovery.stderr).toContain("does not support --json");
    expect(jsonRecovery.stdout).toBe("");

    const [rootHelp, expHelp] = await Promise.all([niceeval.run(["--help"]), niceeval.run(["exp", "help"])]);
    const recoveryFlags = [
      "--recover-shared-state <key>",
      "--owner-token <token>",
      "--confirm-owner-terminated",
      "--confirm-remote-quiesced",
    ];
    expect(
      [rootHelp, expHelp].map(({ exitCode, stdout }) => ({
        exitCode,
        hasFullRecoveryUsage: recoveryFlags.every((flag) => stdout.includes(flag)),
      })),
    ).toEqual([
      { exitCode: 0, hasFullRecoveryUsage: true },
      { exitCode: 0, hasFullRecoveryUsage: true },
    ]);
  });
});
// @use-case docs/feature/experiments/use-case/concurrency-resume-interrupted-run.md
// @test-file e2e/runner/test/shared-state-recovery.test.ts
// @native niceeval:%7B%22executor%22%3A%22vitest%22%2C%22repo%22%3A%22runner%22%2C%22file%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.scenarios.ts%22%2C%22nativeFile%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.test.ts%22%2C%22project%22%3A%22default%22%2C%22titlePath%22%3A%5B%22SQLite%20recovery%20%E5%8E%9F%E5%AD%90%E6%B8%85%E7%90%86%20teardown%20%E7%99%BB%E8%AE%B0%E5%90%8E%E6%89%8D%E5%BC%80%E6%94%BE%E7%AD%89%E5%BE%85%E8%80%85%22%5D%7D
test.concurrent("SQLite recovery 原子清理 teardown 登记后才开放等待者", async () => {
  await runnerE2E.case(
    "shared-state-recovery-registration-before-free",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      await withTempDir("niceeval-runner-shared-state-registration-before-free-", async (barrierRoot) => {
        const experimentPath = join(paths.projectRoot, "experiments", "shared-state-crash-holder.ts");
        const originalExperiment = await readFile(experimentPath, "utf8");
        const holder = niceeval.start(["exp", "shared-state-crash-holder", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        let waiter: ReturnType<typeof niceeval.start> | undefined;
        try {
          await waitForPathOrProcessExit(
            join(barrierRoot, "crash-holder-agent-started"),
            holder.done,
            "registration owner reaches its Attempt",
          );
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          const inspection = await niceeval.run([
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
          ]);
          expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
          const ownerToken = ownerTokenFromPublicRecoveryInspection(inspection.stderr);

          // Teardown registration and shared-state authority now share the
          // canonical SQLite transaction boundary. The public waiter may
          // enter only after recovery clears that exact durable generation.
          await writeFile(
            experimentPath,
            `
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineExperiment } from "niceeval";
import { sharedStateAgent } from "../agents/shared-state.ts";

export default defineExperiment({
  adapter: sharedStateAgent,
  flags: { role: "recovery-registration-before-free" },
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-crash" },
  after: async () => {
    const barrierRoot = process.env.NICEEVAL_SHARED_STATE_BARRIER;
    if (!barrierRoot) throw new Error("NICEEVAL_SHARED_STATE_BARRIER is required");
    await writeFile(join(barrierRoot, "registration-removal-teardown-complete"), "");
  },
});
`.trimStart(),
          );

          const recoveryArgs = [
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
            "--owner-token",
            ownerToken,
            "--confirm-owner-terminated",
            "--confirm-remote-quiesced",
          ];
          const recovered = await niceeval.run(recoveryArgs, {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          });
          expect(recovered.exitCode, recovered.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "registration-removal-teardown-complete"))).toBe(true);

          waiter = niceeval.start(["exp", "shared-state-crash-waiter", "--rerun", "all", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 45_000,
          });
          await pollUntil(async () => (await exists(join(barrierRoot, "crash-waiter-setup-attempted"))) || undefined, {
            timeoutMs: 15_000,
            intervalMs: 20,
            label: "waiter setup after durable teardown registration is cleared",
          });
          const completed = await waiter.done;
          expect(completed.timedOut, completed.diagnostic()).toBe(false);
        } finally {
          await writeFile(experimentPath, originalExperiment).catch(() => undefined);
          await holder.dispose().catch(() => undefined);
          await waiter?.dispose().catch(() => undefined);
        }
      });
    },
  );
});
// @use-case docs/feature/experiments/use-case/concurrency-resume-interrupted-run.md
// @test-file e2e/runner/test/shared-state-recovery.test.ts
// @native niceeval:%7B%22executor%22%3A%22vitest%22%2C%22repo%22%3A%22runner%22%2C%22file%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.scenarios.ts%22%2C%22nativeFile%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.test.ts%22%2C%22project%22%3A%22default%22%2C%22titlePath%22%3A%5B%22%E4%BD%9C%E8%80%85%E6%94%B9%E6%8E%89%20sharedState%20key%20%E5%90%8E%EF%BC%8C%E6%97%A7%20key%20%E4%BB%8D%E4%BB%A5%20immutable%20evidence%20%E5%8F%AA%E6%B8%85%E7%90%86%E8%87%AA%E5%B7%B1%E7%9A%84%20teardown%20%E7%99%BB%E8%AE%B0%22%5D%7D
test.concurrent("作者改掉 sharedState key 后，旧 key 仍以 immutable evidence 只清理自己的 teardown 登记", async () => {
  await runnerE2E.case(
    "shared-state-recovery-changed-key",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      await withTempDir("niceeval-runner-shared-state-recovery-changed-key-", async (barrierRoot) => {
        const experimentPath = join(paths.projectRoot, "experiments", "shared-state-crash-holder.ts");
        const originalExperiment = await readFile(experimentPath, "utf8");
        const holder = niceeval.start(["exp", "shared-state-crash-holder", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        try {
          await pollUntil(async () => (await exists(join(barrierRoot, "crash-holder-agent-started"))) || undefined, {
            timeoutMs: 30_000,
            intervalMs: 20,
            label: "original sharedState owner reaches its Attempt",
          });
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          const originalInspection = await niceeval.run([
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
          ]);
          expect(originalInspection.exitCode, originalInspection.diagnostic()).toBe(1);
          const originalOwnerToken = ownerTokenFromPublicRecoveryInspection(originalInspection.stderr);

          await writeFile(
            experimentPath,
            `
import { defineExperiment } from "niceeval";
import { sharedStateAgent, sharedStateHooks } from "../agents/shared-state.ts";

export default defineExperiment({
  adapter: sharedStateAgent,
  flags: { role: "recovery-changed-key" },
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-changed-key" },
  ...sharedStateHooks("recovery-changed-key"),
});
`.trimStart(),
          );

          // The input key selects immutable evidence before the current
          // declaration is checked. The inspection must remain available even
          // though this Experiment now declares a different key.
          const afterChangeInspection = await niceeval.run([
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
          ]);
          expect(afterChangeInspection.exitCode, afterChangeInspection.diagnostic()).toBe(1);
          expect(afterChangeInspection.stderr).toContain("key: runner/shared-state-crash");
          expect(ownerTokenFromPublicRecoveryInspection(afterChangeInspection.stderr)).toBe(originalOwnerToken);

          const recoveryArgs = [
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
            "--owner-token",
            originalOwnerToken,
            "--confirm-owner-terminated",
            "--confirm-remote-quiesced",
          ];
          const recovered = await niceeval.run(recoveryArgs, {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          });
          expect(recovered.exitCode, recovered.diagnostic()).toBe(0);
          expect(recovered.stderr).toContain("explicitly recovered sharedState key runner/shared-state-crash");

          // A repeated exact token reaches AlreadyReleased without running a
          // second teardown for the now-free immutable generation.
          const alreadyReleased = await niceeval.run(recoveryArgs, {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          });
          expect(alreadyReleased.exitCode, alreadyReleased.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "recovery-changed-key-teardown-complete"))).toBe(true);
        } finally {
          await writeFile(experimentPath, originalExperiment).catch(() => undefined);
          await holder.dispose().catch(() => undefined);
        }
      });
    },
  );
});
// @use-case docs/feature/experiments/use-case/concurrency-resume-interrupted-run.md
// @test-file e2e/runner/test/shared-state-recovery.test.ts
// @native niceeval:%7B%22executor%22%3A%22vitest%22%2C%22repo%22%3A%22runner%22%2C%22file%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.scenarios.ts%22%2C%22nativeFile%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.test.ts%22%2C%22project%22%3A%22default%22%2C%22titlePath%22%3A%5B%22%E4%BD%9C%E8%80%85%E5%88%A0%E9%99%A4%20sharedState%20%E5%A3%B0%E6%98%8E%E5%90%8E%E4%BB%8D%E5%8F%AF%E6%8C%89%E9%81%97%E7%95%99%20key%20%E6%89%A7%E8%A1%8C%E4%B8%80%E6%AC%A1%E5%85%AC%E5%BC%80%E6%81%A2%E5%A4%8D%22%5D%7D
test.concurrent("作者删除 sharedState 声明后仍可按遗留 key 执行一次公开恢复", async () => {
  await runnerE2E.case(
    "shared-state-recovery-removed-key",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      await withTempDir("niceeval-runner-shared-state-recovery-removed-key-", async (barrierRoot) => {
        const experimentPath = join(paths.projectRoot, "experiments", "shared-state-crash-holder.ts");
        const originalExperiment = await readFile(experimentPath, "utf8");
        const holder = niceeval.start(["exp", "shared-state-crash-holder", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        try {
          await pollUntil(async () => (await exists(join(barrierRoot, "crash-holder-agent-started"))) || undefined, {
            timeoutMs: 30_000,
            intervalMs: 20,
            label: "removed-key owner reaches its Attempt",
          });
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          const beforeRemoval = await niceeval.run([
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
          ]);
          expect(beforeRemoval.exitCode, beforeRemoval.diagnostic()).toBe(1);
          const ownerToken = ownerTokenFromPublicRecoveryInspection(beforeRemoval.stderr);

          await writeFile(
            experimentPath,
            `
import { defineExperiment } from "niceeval";
import { sharedStateAgent, sharedStateHooks } from "../agents/shared-state.ts";

export default defineExperiment({
  adapter: sharedStateAgent,
  flags: { role: "recovery-removed-key" },
  evals: ["shared-state/"],
  ...sharedStateHooks("recovery-removed-key"),
});
`.trimStart(),
          );

          const afterRemovalInspection = await niceeval.run([
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
          ]);
          expect(afterRemovalInspection.exitCode, afterRemovalInspection.diagnostic()).toBe(1);
          expect(afterRemovalInspection.stderr).toContain("key: runner/shared-state-crash");
          expect(ownerTokenFromPublicRecoveryInspection(afterRemovalInspection.stderr)).toBe(ownerToken);

          const recovered = await niceeval.run(
            [
              "exp",
              "shared-state-crash-holder",
              "--after",
              "--recover-shared-state",
              "runner/shared-state-crash",
              "--owner-token",
              ownerToken,
              "--confirm-owner-terminated",
              "--confirm-remote-quiesced",
            ],
            { env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot } },
          );
          expect(recovered.exitCode, recovered.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "recovery-removed-key-teardown-complete"))).toBe(true);
        } finally {
          await writeFile(experimentPath, originalExperiment).catch(() => undefined);
          await holder.dispose().catch(() => undefined);
        }
      });
    },
  );
});
// @use-case docs/feature/experiments/use-case/concurrency-resume-interrupted-run.md
// @test-file e2e/runner/test/shared-state-recovery.test.ts
// @native niceeval:%7B%22executor%22%3A%22vitest%22%2C%22repo%22%3A%22runner%22%2C%22file%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.scenarios.ts%22%2C%22nativeFile%22%3A%22e2e%2Frunner%2Ftest%2Fshared-state-recovery.test.ts%22%2C%22project%22%3A%22default%22%2C%22titlePath%22%3A%5B%22%E9%9D%9E%E5%87%BD%E6%95%B0%20teardown%20%E8%A2%AB%E5%85%AC%E5%BC%80%20CLI%20%E6%8B%92%E7%BB%9D%EF%BC%8C%E9%81%97%E7%95%99%20owner%20%E4%B8%8D%E4%BC%9A%E8%A2%AB%E9%87%8A%E6%94%BE%22%5D%7D
test.concurrent("非函数 teardown 被公开 CLI 拒绝，遗留 owner 不会被释放", async () => {
  await runnerE2E.case(
    "shared-state-recovery-invalid-teardown",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      await withTempDir("niceeval-runner-shared-state-recovery-invalid-teardown-", async (barrierRoot) => {
        const experimentPath = join(paths.projectRoot, "experiments", "shared-state-crash-holder.ts");
        const originalExperiment = await readFile(experimentPath, "utf8");
        const holder = niceeval.start(["exp", "shared-state-crash-holder", "--rerun", "all", "--json"], {
          env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
          timeoutMs: 60_000,
        });
        let waiter: ReturnType<typeof niceeval.start> | undefined;
        try {
          await pollUntil(async () => (await exists(join(barrierRoot, "crash-holder-agent-started"))) || undefined, {
            timeoutMs: 30_000,
            intervalMs: 20,
            label: "invalid-teardown owner reaches its Attempt",
          });
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          const inspection = await niceeval.run([
            "exp",
            "shared-state-crash-holder",
            "--after",
            "--recover-shared-state",
            "runner/shared-state-crash",
          ]);
          expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
          const ownerToken = ownerTokenFromPublicRecoveryInspection(inspection.stderr);

          await writeFile(
            experimentPath,
            `
import { defineExperiment } from "niceeval";
import { sharedStateAgent } from "../agents/shared-state.ts";

export default defineExperiment({
  adapter: sharedStateAgent,
  flags: { role: "invalid-teardown" },
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-crash" },
  after: null as unknown as () => void,
});
`.trimStart(),
          );

          const rejected = await niceeval.run(
            [
              "exp",
              "shared-state-crash-holder",
              "--after",
              "--recover-shared-state",
              "runner/shared-state-crash",
              "--owner-token",
              ownerToken,
              "--confirm-owner-terminated",
              "--confirm-remote-quiesced",
            ],
            { env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot } },
          );
          expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
          expect(rejected.stderr).toContain("Experiment after must be a function");

          await writeFile(experimentPath, originalExperiment);
          waiter = niceeval.start(["exp", "shared-state-crash-waiter", "--rerun", "all", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 45_000,
          });
          await waitForOutput(waiter, "stdout", /"code":"state-lease-waiting"/u, {
            timeoutMs: 30_000,
            label: "waiter reaches retained lease after invalid recovery declaration",
          });
          expect(await exists(join(barrierRoot, "crash-waiter-setup-attempted"))).toBe(false);
          expect(waiter.signal("SIGINT")).toBe(true);
          const cancelled = await waiter.done;
          expect(cancelled.timedOut, cancelled.diagnostic()).toBe(false);
        } finally {
          await writeFile(experimentPath, originalExperiment).catch(() => undefined);
          await holder.dispose().catch(() => undefined);
          await waiter?.dispose().catch(() => undefined);
        }
      });
    },
  );
});
