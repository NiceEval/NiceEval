// rerun: pnpm e2e test --repo runner -- --run test/attempt-publication-failure.test.ts
import { expect, test } from "vitest";
import { runnerE2E, writeInspectionRequest } from "./context.ts";

test("Attempt publication 失败保留 cause 与 locator，但不公开未完成的 Attempt [necase_MJKBRQFQP8P4EWH5]", async () => {
  await runnerE2E.case(
    "attempt-publication-failure",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const run = await niceeval.run([
        "exp", "attempt-publication-failure", "--rerun", "all", "--json",
      ]);
      expect(run.exitCode, run.diagnostic()).toBe(1);

      const terminalOutput = `${run.stdout}\n${run.stderr}`;
      const affectedLocator = terminalOutput.match(/@1[0-9A-HJKMNP-TV-Z]{12}/)?.[0];
      expect(affectedLocator, run.diagnostic()).toBeDefined();
      expect(terminalOutput).toContain("fixture rejected attempt publication");
      const request = await writeInspectionRequest(
        paths.projectRoot,
        "unpublished-attempt-trace",
        { kind: "attempt.trace", locator: affectedLocator! },
      );
      const queried = await niceeval.run(["query", "run", "--request", request]);
      expect(queried.exitCode, queried.diagnostic()).not.toBe(0);
      expect(`${queried.stdout}\n${queried.stderr}`).toMatch(
        /not found|not-found|inspection-source-invalid/i,
      );
      expect(terminalOutput).toMatch(/publication|persistence/i);
    },
  );
});
