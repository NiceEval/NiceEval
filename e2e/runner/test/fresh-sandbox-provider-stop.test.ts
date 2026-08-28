// owner: docs/engineering/testing/e2e/runner.md#runner-fresh-sandbox-provider-stop
// rerun: pnpm e2e test --repo runner -- --run test/fresh-sandbox-provider-stop.test.ts
import { pollUntil, withTempDir } from "@niceeval/testkit";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E, writeInspectionRequest } from "./context.ts";

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

test("fresh custom Provider group.stop 失败保留 sharedState，普通输出与 Run diagnostic 不泄露 owner token", async () => {
  await runnerE2E.case(
    "shared-state-provider-stop-failure",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      await withTempDir("niceeval-runner-shared-state-provider-stop-", async (barrierRoot) => {
        const failedEnv = {
          NICEEVAL_SHARED_STATE_PROVIDER_STOP_BARRIER: barrierRoot,
          NICEEVAL_SHARED_STATE_PROVIDER_STOP_FAIL: "1",
        };
        const failed = await niceeval.run(
          ["exp", "shared-state-provider-stop-fails", "--rerun", "all", "--json"],
          { env: failedEnv, timeoutMs: 60_000 },
        );
        expect(await exists(join(barrierRoot, "provider-group-stop-started")), failed.diagnostic()).toBe(true);

        const inspectionArgs = [
          "exp", "shared-state-provider-stop-fails", "--teardown",
          "--recover-shared-state", "runner/shared-state-provider-stop",
        ];
        const inspection = await niceeval.run(inspectionArgs, { env: { NICEEVAL_SHARED_STATE_PROVIDER_STOP_BARRIER: barrierRoot } });
        expect(inspection.exitCode, inspection.diagnostic()).toBe(1);
        const ownerToken = ownerTokenFromInspection(inspection.stderr);
        expect(`${failed.stdout}\n${failed.stderr}`).not.toContain(ownerToken);

        const failedRunId = failed.expReceipt().createdRunIds[0]!;
        const request = await writeInspectionRequest(paths.projectRoot, "provider-stop-run-summary", {
          kind: "run.get", runId: failedRunId,
        });
        const queried = await niceeval.run(["query", "run", "--request", request], {
          env: { NICEEVAL_SHARED_STATE_PROVIDER_STOP_BARRIER: barrierRoot },
        });
        expect(queried.exitCode, queried.diagnostic()).toBe(0);
        expect(queried.json<{ readonly operation: "run.get"; readonly issues: readonly unknown[] }>()).toMatchObject({
          operation: "run.get",
          issues: [],
        });
        expect(queried.stdout).not.toContain(ownerToken);

        const waiter = niceeval.start(
          ["exp", "shared-state-provider-stop-waiter", "--rerun", "all", "--json"],
          { env: { NICEEVAL_SHARED_STATE_PROVIDER_STOP_BARRIER: barrierRoot }, timeoutMs: 60_000 },
        );
        try {
          expect(await appearsWithin(
            join(barrierRoot, "provider-stop-waiter-setup-attempted"),
            3_000,
            "waiter setup after failed Provider group.stop",
          )).toBe(false);

          const recovered = await niceeval.run([
            ...inspectionArgs,
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ], { env: { NICEEVAL_SHARED_STATE_PROVIDER_STOP_BARRIER: barrierRoot }, timeoutMs: 60_000 });
          expect(recovered.exitCode, recovered.diagnostic()).toBe(0);

          const waiterResult = await waiter.done;
          expect(waiterResult.exitCode, waiterResult.diagnostic()).toBe(0);
          expect(await exists(join(barrierRoot, "provider-stop-waiter-agent-started"))).toBe(true);
        } finally {
          await waiter.dispose().catch(() => undefined);
        }
      });
    },
  );
});
