import { pollUntil, waitForOutput, withTempDir } from "@niceeval/testkit";
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

export function registerSharedStateRecoveryOwner(): void {
test.concurrent("暂停的 owner 不会因 heartbeat 年龄失权，等待者可 SIGINT 取消且恢复后才交接 [necase_933F8H9VHA6V8153]", async () => {
  await runnerE2E.case(
    "shared-state-pause-resume-cancel",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-pause-", async (barrierRoot) => {
        // The scenario deliberately pauses the Attempt beyond the old 30s
        // takeover window; its product deadline must sit outside that probe.
        const holder = niceeval.start([
          "exp", "shared-state-pause-holder", "--rerun", "all", "--timeout", "90000", "--json",
        ], {
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
          await waitForOutput(
            waiter,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "paused-owner waiter reaches the sharedState lease seam" },
          );
          // The former automatic-takeover cutoff was three 10s heartbeats.
          // Wait for that age as a positive clock condition after observing the
          // public wait event; marker absence alone is not the rendezvous.
          await pollUntil(
            async () => Date.now() - Date.parse(advancedHeartbeat) >= 35_000 ? true : undefined,
            { timeoutMs: 40_000, intervalMs: 50, label: "paused owner exceeds the former heartbeat expiry" },
          );
          expect(await exists(join(barrierRoot, "pause-waiter-setup-attempted"))).toBe(false);
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

test.concurrent("崩溃的 recovery 可由新 actor 显式续接，旧 token 不会删除新 holder [necase_7XAMTKFQJZ58EZQ5]", async () => {
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
            // This process intentionally waits across every public recovery
            // probe, then becomes the live holder for the ABA check below.
            // Keep its harness lifetime inside the case deadline but outside
            // that whole owner-local lifecycle; the product timeout remains
            // the configured 60s Attempt deadline.
            timeoutMs: 180_000,
          });
          await waitForOutput(
            waiter,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "crash waiter reaches the retained sharedState lease" },
          );
          expect(await exists(join(barrierRoot, "crash-waiter-setup-attempted"))).toBe(false);

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

          // Establish the third Invocation behind the new holder before the
          // stale-token attempt. It must remain fenced throughout that public
          // ABA probe rather than racing a holder whose harness deadline may
          // already have ended it.
          third = niceeval.start(["exp", "shared-state-crash-third", "--rerun", "all", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 60_000,
          });
          await waitForOutput(
            third,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "third waiter reaches the new holder's sharedState lease" },
          );
          expect(await exists(join(barrierRoot, "crash-third-setup-attempted"))).toBe(false);

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

test.concurrent("实际 Experiment teardown 失败会保留 lease，等待者只能取消或走显式恢复 [necase_BXJ9903T6J56JE4K]", async () => {
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
          await waitForOutput(
            waiter,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "waiter reaches the lease retained by failed cleanup" },
          );
          expect(await exists(join(barrierRoot, "cleanup-waiter-setup-attempted"))).toBe(false);
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

test.concurrent("缺少 teardown 的显式 recovery 不改变 active generation [necase_KWHHT498E861HWMH]", async () => {
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
          await waitForOutput(
            waiter,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "waiter reaches active generation after rejected recovery" },
          );
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

test.concurrent("显式 recovery 拒绝 JSON，并在两种帮助入口公开全部参数 [necase_8JE0MDKWV5A2SWA2]", async () => {
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

test.concurrent("SQLite recovery 原子清理 teardown 登记后才开放等待者 [necase_X1F0QN5F124T2HQH]", async () => {
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
          await pollUntil(
            async () => (await exists(join(barrierRoot, "crash-holder-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "registration owner reaches its Attempt" },
          );
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          const inspection = await niceeval.run([
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
          ]);
          expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
          const ownerToken = ownerTokenFromPublicRecoveryInspection(inspection.stderr);

          // Teardown registration and shared-state authority now share the
          // canonical SQLite transaction boundary. The public waiter may
          // enter only after recovery clears that exact durable generation.
          await writeFile(experimentPath, `
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineExperiment } from "niceeval";
import { sharedStateAgent } from "../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateAgent,
  flags: { role: "recovery-registration-before-free" },
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-crash" },
  teardown: async () => {
    const barrierRoot = process.env.NICEEVAL_SHARED_STATE_BARRIER;
    if (!barrierRoot) throw new Error("NICEEVAL_SHARED_STATE_BARRIER is required");
    await writeFile(join(barrierRoot, "registration-removal-teardown-complete"), "");
  },
});
`.trimStart());

          const recoveryArgs = [
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
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
          await pollUntil(
            async () => (await exists(join(barrierRoot, "crash-waiter-setup-attempted"))) || undefined,
            { timeoutMs: 15_000, intervalMs: 20, label: "waiter setup after durable teardown registration is cleared" },
          );
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

test.concurrent("作者改掉 sharedState key 后，旧 key 仍以 immutable evidence 只清理自己的 teardown 登记 [necase_A2699428EFNX2V13]", async () => {
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
          await pollUntil(
            async () => (await exists(join(barrierRoot, "crash-holder-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "original sharedState owner reaches its Attempt" },
          );
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          const originalInspection = await niceeval.run([
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
          ]);
          expect(originalInspection.exitCode, originalInspection.diagnostic()).toBe(1);
          const originalOwnerToken = ownerTokenFromPublicRecoveryInspection(originalInspection.stderr);

          await writeFile(experimentPath, `
import { defineExperiment } from "niceeval";
import { sharedStateAgent, sharedStateHooks } from "../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateAgent,
  flags: { role: "recovery-changed-key" },
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-changed-key" },
  ...sharedStateHooks("recovery-changed-key"),
});
`.trimStart());

          // The input key selects immutable evidence before the current
          // declaration is checked. The inspection must remain available even
          // though this Experiment now declares a different key.
          const afterChangeInspection = await niceeval.run([
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
          ]);
          expect(afterChangeInspection.exitCode, afterChangeInspection.diagnostic()).toBe(1);
          expect(afterChangeInspection.stderr).toContain("key: runner/shared-state-crash");
          expect(ownerTokenFromPublicRecoveryInspection(afterChangeInspection.stderr)).toBe(originalOwnerToken);

          const recoveryArgs = [
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
            "--owner-token", originalOwnerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
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

test.concurrent("作者删除 sharedState 声明后仍可按遗留 key 执行一次公开恢复 [necase_PKDDGWJF9WG1GKMC]", async () => {
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
          await pollUntil(
            async () => (await exists(join(barrierRoot, "crash-holder-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "removed-key owner reaches its Attempt" },
          );
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          const beforeRemoval = await niceeval.run([
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
          ]);
          expect(beforeRemoval.exitCode, beforeRemoval.diagnostic()).toBe(1);
          const ownerToken = ownerTokenFromPublicRecoveryInspection(beforeRemoval.stderr);

          await writeFile(experimentPath, `
import { defineExperiment } from "niceeval";
import { sharedStateAgent, sharedStateHooks } from "../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateAgent,
  flags: { role: "recovery-removed-key" },
  evals: ["shared-state/"],
  ...sharedStateHooks("recovery-removed-key"),
});
`.trimStart());

          const afterRemovalInspection = await niceeval.run([
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
          ]);
          expect(afterRemovalInspection.exitCode, afterRemovalInspection.diagnostic()).toBe(1);
          expect(afterRemovalInspection.stderr).toContain("key: runner/shared-state-crash");
          expect(ownerTokenFromPublicRecoveryInspection(afterRemovalInspection.stderr)).toBe(ownerToken);

          const recovered = await niceeval.run([
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ], { env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot } });
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

test.concurrent("非函数 teardown 被公开 CLI 拒绝，遗留 owner 不会被释放 [necase_8GR53E938YVF6VVW]", async () => {
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
          await pollUntil(
            async () => (await exists(join(barrierRoot, "crash-holder-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "invalid-teardown owner reaches its Attempt" },
          );
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          const inspection = await niceeval.run([
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
          ]);
          expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
          const ownerToken = ownerTokenFromPublicRecoveryInspection(inspection.stderr);

          await writeFile(experimentPath, `
import { defineExperiment } from "niceeval";
import { sharedStateAgent } from "../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateAgent,
  flags: { role: "invalid-teardown" },
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-crash" },
  teardown: null as unknown as () => void,
});
`.trimStart());

          const rejected = await niceeval.run([
            "exp", "shared-state-crash-holder", "--teardown",
            "--recover-shared-state", "runner/shared-state-crash",
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ], { env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot } });
          expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
          expect(rejected.stderr).toContain("Experiment teardown must be a function");

          await writeFile(experimentPath, originalExperiment);
          waiter = niceeval.start(["exp", "shared-state-crash-waiter", "--rerun", "all", "--json"], {
            env: { NICEEVAL_SHARED_STATE_BARRIER: barrierRoot },
            timeoutMs: 45_000,
          });
          await waitForOutput(
            waiter,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "waiter reaches retained lease after invalid recovery declaration" },
          );
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
}
