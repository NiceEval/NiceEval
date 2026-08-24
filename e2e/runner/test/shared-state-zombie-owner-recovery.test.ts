// owner: docs/engineering/testing/e2e/runner.md#runner-shared-state-zombie-owner-recovery
// regression: memory/shared-state-zombie-owner-recovery.md
// rerun: pnpm e2e test --repo runner -- --run test/shared-state-zombie-owner-recovery.test.ts -t "terminal Linux zombie owner"
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pollUntil, withTempDir } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

interface ZombieOwnerStatus {
  readonly pid: number;
  readonly state: "Z";
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseZombieOwnerStatus(text: string): ZombieOwnerStatus {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`zombie-owner fixture did not emit JSON: ${text}\n${String(error)}`);
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`zombie-owner fixture did not emit an object: ${text}`);
  }
  const status = value as Record<string, unknown>;
  if (status.state !== "Z") {
    throw new Error(`zombie-owner fixture did not report Z state: ${text}`);
  }
  return Object.freeze({ pid: positiveInteger(status.pid, "zombie owner PID"), state: "Z" });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function linuxProcessState(pid: number): Promise<string> {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  const closing = stat.lastIndexOf(")");
  if (closing < 0 || stat[closing + 1] !== " ") {
    throw new Error(`cannot parse /proc/${pid}/stat`);
  }
  const state = stat.slice(closing + 2).trim().split(/\s+/u)[0];
  if (state === undefined || state.length !== 1) {
    throw new Error(`cannot parse process state from /proc/${pid}/stat`);
  }
  return state;
}

function ownerTokenFromInspection(stderr: string): string {
  const match = stderr.match(/owner token:\s*(\S+)/u);
  expect(match, stderr).not.toBeNull();
  return match![1]!;
}

test.skipIf(process.platform !== "linux")(
  "explicit recovery accepts a terminal Linux zombie owner but still runs its compensating teardown",
  async () => {
    await runnerE2E.case(
      "shared-state-zombie-owner-recovery",
      { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
      async ({ commands: { niceeval }, paths, start }) => {
        await withTempDir("niceeval-runner-shared-state-zombie-", async (barrierRoot) => {
          const statusPath = join(barrierRoot, "zombie-owner.json");
          const env = { NICEEVAL_SHARED_STATE_ZOMBIE_BARRIER: barrierRoot };
          const holder = start(
            [
              "python3",
              join(paths.projectRoot, "fixtures", "shared-state-zombie-owner.py"),
              statusPath,
              join(paths.projectRoot, "node_modules", ".bin", "niceeval"),
              "exp", "shared-state-zombie-owner-recovery", "--rerun", "all", "--json",
            ],
            { env, timeoutMs: 90_000 },
          );

          const zombie = await pollUntil(
            async () => {
              try {
                return parseZombieOwnerStatus(await readFile(statusPath, "utf8"));
              } catch (error) {
                if (errorCode(error) === "ENOENT") return undefined;
                throw error;
              }
            },
            { timeoutMs: 60_000, intervalMs: 20, label: "installed sharedState owner to become a zombie" },
          );
          expect(zombie.state).toBe("Z");
          expect(await linuxProcessState(zombie.pid)).toBe("Z");
          expect(await exists(join(barrierRoot, "zombie-owner-external-state"))).toBe(true);

          const inspectionArgs = [
            "exp", "shared-state-zombie-owner-recovery", "--teardown",
            "--recover-shared-state", "runner/shared-state-zombie-owner",
          ];
          const inspection = await niceeval.run(inspectionArgs, { env });
          expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
          const ownerToken = ownerTokenFromInspection(inspection.stderr);

          const recovered = await niceeval.run([
            ...inspectionArgs,
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ], { env });
          expect(recovered.exitCode, recovered.diagnostic()).toBe(0);
          expect(recovered.stderr).toContain("explicitly recovered sharedState key runner/shared-state-zombie-owner");
          expect(await exists(join(barrierRoot, "zombie-owner-recovery-teardown-complete"))).toBe(true);
          expect(await exists(join(barrierRoot, "zombie-owner-external-state"))).toBe(false);

          await holder.dispose();
          const holderResult = await holder.done;
          expect(holderResult.exitCode, holderResult.diagnostic()).toBe(0);
          await pollUntil(
            async () => {
              try {
                await access(`/proc/${zombie.pid}`);
                return undefined;
              } catch (error) {
                if (errorCode(error) === "ENOENT") return true;
                throw error;
              }
            },
            { timeoutMs: 5_000, intervalMs: 20, label: "zombie-owner wrapper to reap its owned child" },
          );
        });
      },
    );
  },
);
