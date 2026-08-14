// owner: docs/engineering/testing/e2e/report.md#report-execution-evidence
// rerun: pnpm e2e --repo report -- --run test/report-execution.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
}

test("show --execution 呈现本轮 conversation 与工具入参", async () => {
  await reportE2E.case(
    "execution",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);

      const toolCall = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "tool-call" && event.locator !== undefined,
        run.diagnostic(),
      );

      const shown = await niceeval.run(
        ["show", toolCall.locator!, "--execution"],
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("Deterministic report fixture response.");
      expect(shown.stdout).toContain("write_file");
      expect(shown.stdout).toContain("report-notes.txt");
      expect(shown.stdout).toContain("report-execution-sentinel-914");
      expect(shown.stdout).toMatch(/\bconversation\b/i);
      expect(shown.stdout).toMatch(/\bcompleted\b/i);
      expect(shown.stdout).toContain("Trace overview");
      expect(shown.stdout).toContain("Duration");
      expect(shown.stdout).toContain("Turns");
      expect(shown.stdout).toContain("Calls");

      const filtered = await niceeval.run([
        "show",
        toolCall.locator!,
        "--execution",
        "--grep",
        "report-execution-sentinel-914",
      ]);
      expect(filtered.exitCode, filtered.diagnostic()).toBe(0);
      expect(filtered.stdout).toContain("Filter · /report-execution-sentinel-914/");
      expect(filtered.stdout).toContain("report-execution-sentinel-914");
    },
  );
});

test("show --timing 呈现本轮的阶段树", async () => {
  await reportE2E.case(
    "timing",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);

      const toolCall = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "tool-call" && event.locator !== undefined,
        run.diagnostic(),
      );
      const shown = await niceeval.run(
        ["show", toolCall.locator!, "--timing"],
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("eval.run");
      expect(shown.stdout).toContain("agent.send");
      expect(shown.stdout).toMatch(/turn\s+turn1\b/);
    },
  );
});
