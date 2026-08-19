// owner: docs/engineering/testing/e2e/cli.md#cli-provider-error-feedback
// regression: memory/human-error-feedback-folds-provider-messages.md
// rerun: pnpm e2e --repo cli -- --run test/provider-error-feedback.test.ts

import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

const E2B_ERROR = "401 Unauthorized — E2B rejected the sandbox request because the supplied API key is invalid for request req_e2b_feedback_123";
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
          },
        },
      );

      expect(result.exitCode, result.diagnostic()).toBe(1);
      expect(result.stderr).toBe("");
      const compact = result.stdout.replace(/\s+/gu, " ");
      expect(compact).toContain(`error: ${E2B_ERROR}`);
      expect(compact).toContain(`error: ${VERCEL_ERROR}`);
      expect(compact).toContain(PRIMARY_ERROR_HEAD);
      expect(compact).toContain(PRIMARY_ERROR_TAIL);
      expect(compact).toContain(SECONDARY_ERROR_HEAD);
      expect(compact).toContain(SECONDARY_ERROR_TAIL);
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
    },
  );
});
