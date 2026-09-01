// rerun: pnpm e2e test --repo runner -- --run test/shared-state-startup-authority.test.ts
import { pollUntil, waitForOutput, withTempDir } from "@niceeval/testkit";
import { access, rm, writeFile } from "node:fs/promises";
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

function ownerTokenFromInspection(stderr: string): string {
  const match = stderr.match(/owner token:\s*(\S+)/u);
  expect(match, stderr).not.toBeNull();
  return match![1]!;
}

test("启动期遗留 teardown 先取得同 key authority，健康等待只发无 token 的 info [necase_YJQZERNET06GJ98S]", async () => {
  await runnerE2E.case(
    "shared-state-startup-authority",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-startup-authority-", async (barrierRoot) => {
        const env = { NICEEVAL_SHARED_STATE_STARTUP_AUTHORITY_BARRIER: barrierRoot };
        const holder = niceeval.start(
          ["exp", "shared-state-startup-authority", "--rerun", "all", "--json"],
          { env, timeoutMs: 60_000 },
        );
        let restarting: ReturnType<typeof niceeval.start> | undefined;
        let ownerToken: string | undefined;
        let recovered = false;
        try {
          let initialOwnerReachedAgent = false;
          const holderReady = pollUntil(
            async () => (await exists(join(barrierRoot, "startup-authority-agent-started"))) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "initial owner reaches its Agent" },
          );
          const holderExited = holder.done.then((result) => {
            if (!initialOwnerReachedAgent) {
              throw new Error(`initial owner exited before reaching its Agent:\n${result.diagnostic()}`);
            }
          });
          await Promise.race([holderReady, holderExited]);
          initialOwnerReachedAgent = true;
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;

          const inspectionArgs = [
            "exp", "shared-state-startup-authority", "--teardown",
            "--recover-shared-state", "runner/shared-state-startup-authority",
          ];
          const inspection = await niceeval.run(inspectionArgs, { env });
          expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
          ownerToken = ownerTokenFromInspection(inspection.stderr);

          restarting = niceeval.start(
            ["exp", "shared-state-startup-authority", "--rerun", "all", "--json"],
            { env, timeoutMs: 60_000 },
          );
          expect(await appearsWithin(
            join(barrierRoot, "startup-authority-recovery-teardown-started"),
            3_000,
            "automatic stale teardown before the active sharedState generation is released",
          )).toBe(false);
          await waitForOutput(
            restarting,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "restarting invocation waits for sharedState startup authority" },
          );

          const recoveredResult = await niceeval.run([
            ...inspectionArgs,
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ], { env, timeoutMs: 60_000 });
          recovered = true;
          expect(recoveredResult.exitCode, recoveredResult.diagnostic()).toBe(0);

          await writeFile(join(barrierRoot, "release-startup-authority-agent"), "");
          const restartedResult = await restarting.done;
          expect(restartedResult.exitCode, restartedResult.diagnostic()).toBe(0);
          const stream = JSON.stringify(restartedResult.ndjson<unknown>());
          expect(stream).toContain("state-lease-waiting");
          expect(stream).not.toContain("state-lease-recovery-required");
          expect(stream).not.toContain(ownerToken);
        } finally {
          await writeFile(join(barrierRoot, "release-startup-authority-agent"), "").catch(() => undefined);
          if (!recovered && ownerToken !== undefined) {
            await niceeval.run([
              "exp", "shared-state-startup-authority", "--teardown",
              "--recover-shared-state", "runner/shared-state-startup-authority",
              "--owner-token", ownerToken,
              "--confirm-owner-terminated", "--confirm-remote-quiesced",
            ], { env, timeoutMs: 60_000 }).catch(() => undefined);
          }
          await holder.dispose().catch(() => undefined);
          await restarting?.dispose().catch(() => undefined);
        }
      });
    },
  );
});

test("full-carry 的 selected Experiment 也在同 key authority 后才补遗留 teardown [necase_MZECYXY0CYDG8HFQ]", async () => {
  await runnerE2E.case(
    "shared-state-startup-authority-full-carry",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-shared-state-startup-authority-carry-", async (barrierRoot) => {
        const env = { NICEEVAL_SHARED_STATE_STARTUP_AUTHORITY_BARRIER: barrierRoot };
        const experiment = "shared-state-startup-authority";
        const key = "runner/shared-state-startup-authority";
        const releasePath = join(barrierRoot, "release-startup-authority-agent");
        const agentStartedPath = join(barrierRoot, "startup-authority-agent-started");
        const recoveryStartedPath = join(barrierRoot, "startup-authority-recovery-teardown-started");
        const cleanupRoundMarkers = async (): Promise<void> => {
          await Promise.all([
            releasePath,
            agentStartedPath,
            recoveryStartedPath,
            join(barrierRoot, "startup-authority-recovery-teardown-complete"),
            join(barrierRoot, "startup-authority-setup-attempted"),
            join(barrierRoot, "startup-authority-setup-complete"),
            join(barrierRoot, "startup-authority-external-state"),
          ].map((path) => rm(path, { force: true })));
        };
        await writeFile(releasePath, "");
        const seed = await niceeval.run(["exp", experiment, "--rerun", "all", "--json"], { env, timeoutMs: 60_000 });
        expect(seed.exitCode, seed.diagnostic()).toBe(0);
        await cleanupRoundMarkers();

        const holder = niceeval.start(["exp", experiment, "--rerun", "all", "--json"], { env, timeoutMs: 60_000 });
        let carrying: ReturnType<typeof niceeval.start> | undefined;
        let ownerToken: string | undefined;
        let recovered = false;
        try {
          await pollUntil(
            async () => (await exists(agentStartedPath)) || undefined,
            { timeoutMs: 30_000, intervalMs: 20, label: "rerun owner reaches its Agent before it is killed" },
          );
          expect(holder.signal("SIGKILL")).toBe(true);
          await holder.done;
          await rm(agentStartedPath, { force: true });

          const inspectionArgs = ["exp", experiment, "--teardown", "--recover-shared-state", key];
          const inspection = await niceeval.run(inspectionArgs, { env });
          expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
          ownerToken = ownerTokenFromInspection(inspection.stderr);

          carrying = niceeval.start(["exp", experiment, "--json"], { env, timeoutMs: 60_000 });
          expect(await appearsWithin(
            recoveryStartedPath,
            3_000,
            "automatic stale teardown for a full-carry selected Experiment before explicit recovery",
          )).toBe(false);
          await waitForOutput(
            carrying,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "full-carry invocation waits for sharedState startup authority" },
          );

          const recoveredResult = await niceeval.run([
            ...inspectionArgs,
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ], { env, timeoutMs: 60_000 });
          recovered = true;
          expect(recoveredResult.exitCode, recoveredResult.diagnostic()).toBe(0);

          const carryingResult = await carrying.done;
          expect(carryingResult.exitCode, carryingResult.diagnostic()).toBe(0);
          const stream = JSON.stringify(carryingResult.ndjson<unknown>());
          expect(stream).toContain("state-lease-waiting");
          expect(stream).not.toContain(ownerToken);
          expect(await exists(agentStartedPath)).toBe(false);
        } finally {
          if (!recovered && ownerToken !== undefined) {
            await niceeval.run([
              "exp", experiment, "--teardown", "--recover-shared-state", key,
              "--owner-token", ownerToken,
              "--confirm-owner-terminated", "--confirm-remote-quiesced",
            ], { env, timeoutMs: 60_000 }).catch(() => undefined);
          }
          await holder.dispose().catch(() => undefined);
          await carrying?.dispose().catch(() => undefined);
        }
      });
    },
  );
});
