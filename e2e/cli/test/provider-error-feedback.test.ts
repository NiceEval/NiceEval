// owner: docs/engineering/testing/e2e/cli.md#cli-provider-error-feedback
// regression: memory/human-error-feedback-folds-provider-messages.md
// rerun: pnpm e2e --repo cli -- --run test/provider-error-feedback.test.ts

import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

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

      const attemptDetails = [...result.stdout.matchAll(/details: niceeval show (@[A-Z0-9]+)/gu)];
      expect(attemptDetails).toHaveLength(2);
      for (const match of attemptDetails) {
        const shown = await niceeval.run(["show", match[1]!, "--record", ".niceeval/record"]);
        expect(shown.exitCode, shown.diagnostic()).toBe(0);
        expect(shown.stdout).toContain("Attempt overview");
        expect(shown.stdout).toMatch(/401 Unauthorized|403 Forbidden/u);
      }

      const runDetails = [...compact.matchAll(
        /(provider-error\/sandbox(?:-secondary)?)\s+details: niceeval show --run\s+([0-9a-f-]{36})/gu,
      )];
      expect(runDetails, result.diagnostic()).toHaveLength(2);
      for (const match of runDetails) {
        const shownRun = await niceeval.run(["show", "--run", match[2]!, "--record", ".niceeval/record"]);
        expect(shownRun.exitCode, shownRun.diagnostic()).toBe(0);
        const shown = shownRun.stdout.replace(/\s+/gu, " ");
        expect(shown).toContain("Run results");
        expect(shown).toContain("Run errors");
        expect(shown).toContain("1 attempt not started");
        if (match[1] === "provider-error/sandbox") {
          expect(shown).toContain(PRIMARY_ERROR_HEAD);
          expect(shown).toContain(PRIMARY_ERROR_TAIL);
        } else {
          expect(shown).toContain(SECONDARY_ERROR_HEAD);
          expect(shown).toContain(SECONDARY_ERROR_TAIL);
        }
        expect(shown).not.toMatch(
          /Pass rate|Included attempts|Assessment evidence|Analysis notes|Membership|Shared failure|Selected run|\bSlot\b|\bRelation\b|\bfix:/u,
        );
      }

      const judge = await niceeval.run(
        ["exp", "judge-precheck-error", "--rerun", "all", "--json"],
        { env: { CLI_JUDGE_TEST_KEY: "fixture-key" } },
      );
      expect(judge.exitCode, judge.diagnostic()).toBe(1);
      const judgeRunId = judge.expReceipt().runIds[0]!;
      const sandboxRunId = runDetails.find((match) => match[1] === "provider-error/sandbox")?.[2];
      expect(sandboxRunId).toBeTruthy();
      const combined = await niceeval.run([
        "show",
        "--run",
        sandboxRunId!,
        "--run",
        judgeRunId,
        "--record",
        ".niceeval/record",
      ]);
      expect(combined.exitCode, combined.diagnostic()).toBe(0);
      const combinedText = combined.stdout.replace(/\s+/gu, " ");
      // regression: Run errors 只统计它展示的 Sandbox build 影响，不吸收另一 Run 的 Judge 未启动项。
      expect(combinedText).toContain("Run errors 1 attempt not started");
    },
  );
});
