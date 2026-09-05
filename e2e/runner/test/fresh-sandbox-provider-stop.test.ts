// rerun: pnpm e2e test --repo runner -- --run test/fresh-sandbox-provider-stop.test.ts
import { waitForOutput, withTempDir } from "@niceeval/testkit";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E, writeInspectionRequest } from "./context.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function ownerTokenFromInspection(stderr: string): string {
  const match = stderr.match(/owner token:\s*(\S+)/u);
  expect(match, stderr).not.toBeNull();
  return match![1]!;
}

test.concurrent("fresh custom Provider group.stop 失败保留 sharedState，普通输出与 Run diagnostic 不泄露 owner token [necase_9E2KVHJXB3FTA8AE]", async () => {
  await runnerE2E.case(
    "shared-state-provider-stop-failure",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths, run }) => {
      const types = await run([
        join(paths.projectRoot, "node_modules", ".bin", "tsc"),
        "--project", "fixtures/tsconfig.custom-provider.json", "--pretty", "false",
      ], { timeoutMs: 30_000 });
      expect(types.exitCode, types.diagnostic()).toBe(0);
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
          await waitForOutput(
            waiter,
            "stdout",
            /"code":"state-lease-waiting"/u,
            { timeoutMs: 30_000, label: "waiter reaches lease retained by failed Provider group.stop" },
          );
          expect(await exists(join(barrierRoot, "provider-stop-waiter-setup-attempted"))).toBe(false);

          const recovered = await niceeval.run([
            ...inspectionArgs,
            "--owner-token", ownerToken,
            "--confirm-owner-terminated", "--confirm-remote-quiesced",
          ], { env: { NICEEVAL_SHARED_STATE_PROVIDER_STOP_BARRIER: barrierRoot }, timeoutMs: 60_000 });
          expect(recovered.exitCode, recovered.diagnostic()).toBe(0);

          const waiterResult = await waiter.done;
          expect(waiterResult.exitCode, waiterResult.diagnostic()).toBe(0);
          // The existing fixture removes its wx-owned external-state marker in
          // recovery teardown; waiter setup can complete only after replacing it.
          expect(await exists(join(barrierRoot, "provider-stop-fails-teardown-complete"))).toBe(true);
          expect(await exists(join(barrierRoot, "provider-stop-waiter-setup-complete"))).toBe(true);
          expect(await exists(join(barrierRoot, "provider-stop-waiter-agent-started"))).toBe(true);
        } finally {
          await waiter.dispose().catch(() => undefined);
        }
      });
    },
  );
});
