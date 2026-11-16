// rerun: pnpm e2e test --repo runner -- --run test/attempt-publication-failure.test.ts
import { expect, test } from "vitest";
import { clearAttemptPublicationFault } from "../agents/sqlite-fault-support.ts";
import { runnerE2E } from "./context.ts";
// @feature docs/feature/experiments/README.md
// @regression memory/attempt-publication-diagnostic-context.md

test("Attempt publication 失败保留 cause 与 locator，但不公开未完成的 Attempt", async () => {
  await runnerE2E.case(
    "attempt-publication-failure",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const run = await niceeval.run(["exp", "attempt-publication-failure", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(1);

      const terminalOutput = `${run.stdout}\n${run.stderr}`;
      const affectedLocator = terminalOutput.match(/@1[0-9A-HJKMNP-TV-Z]{12}/)?.[0];
      expect(affectedLocator, run.diagnostic()).toBeDefined();
      expect(terminalOutput).toContain("fixture rejected attempt publication");

      // The injected trigger is not part of a valid Record schema. Remove the
      // fault so the public query checks publication visibility, not schema rejection.
      clearAttemptPublicationFault(paths.projectRoot);
      const queried = await niceeval.run(["show", affectedLocator!, "execution", "--json"]);
      expect(queried.exitCode, queried.diagnostic()).not.toBe(0);
      expect(queried.inspectionFailure().failure).toMatchObject({
        code: "inspection-selection-missing",
        reason: expect.stringContaining("not found"),
      });
      expect(queried.stderr).not.toMatch(/older.*NiceEval/i);
      expect(terminalOutput).toMatch(/publication|persistence/i);
    },
  );
});
