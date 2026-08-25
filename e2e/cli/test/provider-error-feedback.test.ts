// owner: docs/engineering/testing/e2e/cli.md#cli-provider-error-feedback
// regression: memory/human-error-feedback-folds-provider-messages.md
// rerun: pnpm e2e test --repo cli -- --run test/provider-error-feedback.test.ts

import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E, writeInspectionRequest } from "./context.ts";

const E2B_ERROR_HEAD = "401 Unauthorized — E2B";
const E2B_ERROR_TAIL = "request req_e2b_feedback_123";
const VERCEL_ERROR = "403 Forbidden — Vercel rejected the sandbox request because team access is required for request iad1::feedback-456";
const PRIMARY_ERROR_HEAD = "502 Bad Gateway · DOCKER_PROVIDER_TIMEOUT";
const PRIMARY_ERROR_TAIL = "request req_docker_primary_789";
const SECONDARY_ERROR_HEAD = "409 Conflict · DOCKER_BUILD_DENIED";
const SECONDARY_ERROR_TAIL = "request req_docker_secondary_987";

test("provider 与 sandbox 错误只展示真实问题并给出所属 details", async () => {
  await cliE2E.case(
    "provider-error-feedback",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const fakeBin = join(paths.projectRoot, "fixtures/provider-error-sandbox/bin");
      const result = await niceeval.run(
        ["exp", "provider-error", "--rerun", "all"],
        {
          env: {
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
            DOCKER_DEFAULT_PLATFORM: "linux/amd64",
            XDG_STATE_HOME: join(paths.projectRoot, "state"),
          },
        },
      );

      expect(result.exitCode, result.diagnostic()).toBe(1);
      expect(result.stderr).toBe("");
      const compact = result.stdout.replace(/\s+/gu, " ");
      expect(compact).toContain(`error: ${E2B_ERROR_HEAD}`);
      expect(compact).toContain(E2B_ERROR_TAIL);
      const failurePanel = compact.slice(compact.indexOf("FAILURES"));
      const e2bHumanError = /error: (401 Unauthorized .*?request req_e2b_feedback_123) details:/u.exec(failurePanel)?.[1];
      expect(e2bHumanError, result.diagnostic()).toBeTruthy();
      // regression: Human 限额按 UTF-8 bytes 计算，且不在 emoji surrogate pair 中间截断。
      expect(new TextEncoder().encode(e2bHumanError!).byteLength).toBeLessThanOrEqual(240);
      expect(e2bHumanError).not.toContain("�");
      expect(compact).toContain(`error: ${VERCEL_ERROR}`);
      expect(compact).toContain(PRIMARY_ERROR_HEAD);
      expect(compact).toContain(PRIMARY_ERROR_TAIL);
      expect(compact).toContain(SECONDARY_ERROR_HEAD);
      expect(compact).toContain(SECONDARY_ERROR_TAIL);
      expect(compact, result.diagnostic()).toContain("checking build cache");
      expect(compact.match(/checking build cache · docker:dockerfile:greet\/hello · 1 attempt/gu) ?? []).toHaveLength(2);
      expect(compact.match(/build failed · docker:dockerfile:greet\/hello · 1 attempt/gu) ?? []).toHaveLength(2);
      expect(compact).toContain("2 attempts not started");
      expect(result.stdout).not.toContain("e2b-cause-secret-must-not-reach-human");
      expect(result.stdout).not.toContain("vercel-cause-secret-must-not-reach-human");
      expect(result.stdout).not.toMatch(/shared failure:|\bBuildKey\b|\btiming node\b|\bfailureId\b|\bcause:|\bfix:/u);

      const snapshot = join(paths.projectRoot, "provider-errors.record-snapshot.sqlite");
      const exported = await niceeval.run(["record", "snapshot", "--output", snapshot]);
      expect(exported.exitCode, exported.diagnostic()).toBe(0);
      const listRequest = await writeInspectionRequest(paths.projectRoot, "provider-error-runs", {
        kind: "runs.list",
      });
      const listed = await niceeval.run(["query", "run", "--record", snapshot, "--request", listRequest]);
      expect(listed.exitCode, listed.diagnostic()).toBe(0);
      const runIds = listed.json<{
        readonly operation: "runs.list";
        readonly selection: { readonly selectedRunIds: readonly string[] };
      }>().selection.selectedRunIds;
      expect(runIds).toHaveLength(4);
      const summaries = await Promise.all(runIds.map(async (runId, index) => {
        const request = await writeInspectionRequest(paths.projectRoot, `provider-error-${index}-summary`, {
          kind: "run.summary", runId,
        });
        const queried = await niceeval.run(["query", "run", "--record", snapshot, "--request", request]);
        expect(queried.exitCode, queried.diagnostic()).toBe(0);
        return queried.json<{
          readonly operation: string;
          readonly issues: readonly unknown[];
          readonly summary: { readonly members: readonly { readonly locator: string | null; readonly state: string }[] };
        }>();
      }));
      expect(summaries).toEqual(expect.arrayContaining([expect.objectContaining({ operation: "run.summary", issues: [] })]));
      const errorLocators = summaries.flatMap(({ summary }) => summary.members)
        .flatMap(({ locator, state }) => locator !== null && state === "executed" ? [locator] : []);
      expect(errorLocators).toHaveLength(2);
      for (const [index, locator] of errorLocators.entries()) {
        const request = await writeInspectionRequest(paths.projectRoot, `provider-error-attempt-${index}`, {
          kind: "attempt.get", locator,
        });
        const queried = await niceeval.run(["query", "run", "--record", snapshot, "--request", request]);
        expect(queried.exitCode, queried.diagnostic()).toBe(0);
        const document = queried.json<{ readonly operation: string; readonly issues: readonly unknown[]; readonly attempt: unknown }>();
        expect(document).toMatchObject({ operation: "attempt.get", issues: [] });
        expect(JSON.stringify(document.attempt)).toMatch(/401 Unauthorized|403 Forbidden/u);
      }

      const judge = await niceeval.run(
        ["exp", "judge-precheck-error", "--rerun", "all", "--json"],
        { env: { CLI_JUDGE_TEST_KEY: "fixture-key" } },
      );
      expect(judge.exitCode, judge.diagnostic()).toBe(1);
      const judgeRunId = judge.expReceipt().runIds[0]!;
      expect(judgeRunId).toMatch(/^[0-9a-f-]{36}$/u);
    },
  );
});
