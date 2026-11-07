// Regression note: memory/human-error-feedback-folds-provider-messages.md
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
// @feature docs/feature/experiments/README.md
// @regression memory/human-short-error-and-score-summary.md
// @regression memory/pre-dispatch-run-diagnostics.md

test.concurrent("provider 与 sandbox 错误只展示真实问题并给出所属 details", async () => {
  await cliE2E.case(
    "provider-error-feedback",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const fakeBin = join(paths.projectRoot, "fixtures/provider-error-sandbox/bin");
      const providerEnvironment = {
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        DOCKER_DEFAULT_PLATFORM: "linux/amd64",
        XDG_STATE_HOME: join(paths.projectRoot, "state"),
        NICEEVAL_HOME: join(paths.projectRoot, "user"),
        NICEEVAL_INCUS_DESCRIPTOR: join(paths.projectRoot, "fixtures/provider-error-sandbox/incus-provider.json"),
      };
      const shortError = await niceeval.run(["exp", "short-error", "--rerun", "all"], { env: providerEnvironment });
      expect(shortError.exitCode, shortError.diagnostic()).toBe(1);
      expect(shortError.stderr, shortError.diagnostic()).toBe("");
      const shortOutput = shortError.stdout.replace(/\s+/gu, " ");
      const shortFailures = shortOutput.slice(shortOutput.indexOf("FAILURES"));
      expect.soft(shortFailures, shortError.diagnostic()).toContain("error: Missing API_KEY; configure the provider before running");
      expect.soft(shortFailures).toContain("2 total · 2 entries");
      expect.soft(shortFailures.match(/error:/gu)).toHaveLength(2);
      expect.soft(shortOutput).toContain("0 scored · 0 failed · 0 skipped · 2 errored · 1 not started");

      const result = await niceeval.run(
        ["exp", "provider-error", "--rerun", "all"],
        { env: providerEnvironment },
      );

      expect(result.exitCode, result.diagnostic()).toBe(1);
      expect(result.stderr, result.diagnostic()).toBe("");
      const compact = result.stdout.replace(/\s+/gu, " ");
      expect(compact).toContain(`error: ${E2B_ERROR_HEAD}`);
      expect(compact).toContain(E2B_ERROR_TAIL);
      const failurePanel = compact.slice(compact.indexOf("FAILURES"));
      const e2bHumanError = /error: (401 Unauthorized .*?request req_e2b_feedback_123) details:/u.exec(failurePanel)?.[1];
      expect(e2bHumanError, result.diagnostic()).toBeTruthy();
      // regression: Human 限额按 UTF-8 bytes 计算，且不在 emoji surrogate pair 中间截断。
      expect(new TextEncoder().encode(e2bHumanError!).byteLength).toBeLessThanOrEqual(240);
      expect(e2bHumanError).not.toContain("�");
      expect.soft(e2bHumanError).toMatch(/\[\d+ bytes omitted\]/u);
      expect(compact).toContain(`error: ${VERCEL_ERROR}`);
      expect(compact).toContain(PRIMARY_ERROR_HEAD);
      expect(compact).toContain(PRIMARY_ERROR_TAIL);
      expect(compact).toContain(SECONDARY_ERROR_HEAD);
      expect(compact).toContain(SECONDARY_ERROR_TAIL);
      expect(compact, result.diagnostic()).toContain("checking build cache");
      expect(compact.match(/checking build cache · docker:dockerfile:greet\/hello · 1 attempt/gu) ?? []).toHaveLength(2);
      expect(compact.match(/build failed · docker:dockerfile:greet\/hello · 1 attempt/gu) ?? []).toHaveLength(2);
      expect.soft(compact, result.diagnostic()).toContain("7 attempts not started");
      expect(compact).toContain("req_prefix_capacity_123");
      expect(result.stdout).not.toContain("e2b-cause-secret-must-not-reach-human");
      expect(result.stdout).not.toContain("vercel-cause-secret-must-not-reach-human");
      expect(result.stdout).not.toMatch(/shared failure:|\bBuildKey\b|\btiming node\b|\bfailureId\b|\bcause:|\bfix:/u);

      const listRequest = await writeInspectionRequest(paths.projectRoot, "provider-error-runs", {
        kind: "run.list",
      });
      const listed = await niceeval.run(["query", "run", "--request", listRequest]);
      expect(listed.exitCode, listed.diagnostic()).toBe(0);
      const runIds = listed.runsList().selection.selectedRunIds;
      expect(runIds).toHaveLength(7);
      const summaries = await Promise.all(runIds.map(async (runId, index) => {
        const request = await writeInspectionRequest(paths.projectRoot, `provider-error-${index}-summary`, {
          kind: "run.get", runId,
        });
        const queried = await niceeval.run(["query", "run", "--request", request]);
        expect(queried.exitCode, queried.diagnostic()).toBe(0);
        return queried.run();
      }));
      expect(summaries).toEqual(expect.arrayContaining([expect.objectContaining({ operation: "run.get", issues: [] })]));
      for (const { run: detail } of summaries) {
        const run = detail.value;
        if (run.experimentId === "provider-error/prefix") {
          expect.soft(detail).toMatchObject({
            denominator: { expected: 3, published: 0, missing: 3 },
            diagnostics: [expect.objectContaining({
              code: "sandbox-before-cache-failed",
              phase: "run.dispatch",
              summary: expect.stringContaining("req_prefix_capacity_123"),
              affectedPlannedAttemptIds: expect.arrayContaining(detail.plannedAttempts.map((member) => member.plannedAttemptId)),
            })],
          });
          expect.soft(detail.diagnostics[0]?.affectedPlannedAttemptIds).toHaveLength(3);
          const shown = await niceeval.run(["show", "--run", run.runId]);
          expect(shown.exitCode, shown.diagnostic()).toBe(0);
          expect.soft(shown.stdout).toContain("Run error");
          expect.soft(shown.stdout).toContain("Before dispatch");
          expect.soft(shown.stdout).toContain("Affected attempt count");
          expect.soft(shown.stdout).toContain("greet/hello");
          expect.soft(shown.stdout).not.toContain("sandbox-before-cache-failed");
          expect.soft(shown.stdout).not.toContain("run.dispatch");
          expect.soft(shown.stdout).toContain("req_prefix_capacity_123");
        }
        if (run.experimentId === "provider-error/before") {
          expect.soft(detail).toMatchObject({
            denominator: { expected: 2, published: 0, missing: 2 },
            diagnostics: [expect.objectContaining({
              code: "experiment-setup-failed",
              phase: "run.before",
              summary: "Experiment before failed: request req_before_123",
              affectedPlannedAttemptIds: expect.arrayContaining(detail.plannedAttempts.map((member) => member.plannedAttemptId)),
            })],
          });
          expect.soft(detail.diagnostics[0]?.affectedPlannedAttemptIds).toHaveLength(2);
        }
        if (run.experimentId === "provider-error/sandbox" || run.experimentId === "provider-error/sandbox-secondary") {
          expect.soft(detail).toMatchObject({
            diagnostics: [expect.objectContaining({
              code: "sandbox-build-failed",
              affectedPlannedAttemptIds: [detail.plannedAttempts[0]!.plannedAttemptId],
            })],
          });
        }
        const output = run.experimentId === "short-error" ? shortOutput : compact;
        expect(output).toContain(
          `${run.experimentId} show: niceeval show --run ${run.runId} view: niceeval view --run ${run.runId}`,
        );
        for (const member of detail.plannedAttempts) {
          if (member.publication.state === "published" && member.state === "executed") {
            expect(output).toContain(`details: niceeval show ${member.publication.attemptLocator}`);
          }
        }
      }
      expect(shortOutput).not.toContain("details: niceeval view");
      expect(compact).not.toContain("details: niceeval view");
      const errorLocators = summaries.flatMap(({ run }) => run.plannedAttempts)
        .flatMap(({ publication, state }) => publication.state === "published" && state === "executed" ? [publication.attemptLocator] : []);
      expect(errorLocators).toHaveLength(4);
      for (const [index, locator] of errorLocators.entries()) {
        const request = await writeInspectionRequest(paths.projectRoot, `provider-error-attempt-${index}`, {
          kind: "attempt.trace", locator,
        });
        const queried = await niceeval.run(["query", "run", "--request", request]);
        expect(queried.exitCode, queried.diagnostic()).toBe(0);
        const document = queried.attemptTrace();
        expect(document).toMatchObject({ operation: "attempt.trace", issues: [] });
        expect(JSON.stringify(document.trace)).toMatch(/401 Unauthorized|403 Forbidden|Missing API_KEY/u);
      }

      const prefixJson = await niceeval.run(["exp", "provider-error/prefix", "--rerun", "all", "--json"], {
        env: providerEnvironment,
      });
      expect(prefixJson.exitCode, prefixJson.diagnostic()).toBe(1);
      expect.soft(prefixJson.expEvents()).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: "diagnostic", code: "sandbox-before-cache-failed", message: expect.stringContaining("req_prefix_capacity_123") }),
      ]));
      expect(prefixJson.expReceipt().createdRunIds).toHaveLength(1);

      const judge = await niceeval.run(
        ["exp", "judge-precheck-error", "--rerun", "all", "--json"],
        { env: { ...providerEnvironment, CLI_JUDGE_TEST_KEY: "fixture-key" } },
      );
      expect(judge.exitCode, judge.diagnostic()).toBe(1);
      const judgeRunId = judge.expReceipt().createdRunIds[0]!;
      expect(judgeRunId).toMatch(/^[0-9a-f-]{36}$/u);
    },
  );
});
