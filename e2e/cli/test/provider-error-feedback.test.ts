// owner: docs/engineering/testing/e2e/cli.md#cli-provider-error-feedback
// rerun: pnpm e2e --repo cli -- --run test/provider-error-feedback.test.ts

import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

const E2B_ERROR = "401 Unauthorized — E2B rejected the sandbox request because the supplied API key is invalid for request req_e2b_feedback_123";
const VERCEL_ERROR = "403 Forbidden — Vercel rejected the sandbox request because team access is required for request iad1::feedback-456";
const SANDBOX_ERROR = "sandbox builder transport failed while contacting unix:///fixture/docker.sock: provider feedback sentinel appears at the end of this deliberately long single-line stderr";

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
      expect(compact).toContain(SANDBOX_ERROR);
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

      const runDetail = /provider-error\/sandbox\s+details: niceeval show --run\s+([0-9a-f-]{36})/u.exec(compact);
      expect(runDetail, result.diagnostic()).not.toBeNull();
      const shownRun = await niceeval.run(["show", "--run", runDetail![1]!, "--record", ".niceeval/record"]);
      expect(shownRun.exitCode, shownRun.diagnostic()).toBe(0);
      expect(shownRun.stdout).toContain("Run membership overview");
      expect(shownRun.stdout.replace(/\s+/gu, " ")).toContain(SANDBOX_ERROR);
    },
  );
});
