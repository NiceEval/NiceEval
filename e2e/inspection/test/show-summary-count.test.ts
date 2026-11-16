import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @issue docs/issues/show-summary-entry-count.md
test.concurrent("Attempt 概览以固定标签显示断言数量", async () => {
  await inspectionE2E.case(
    "show-summary-count",
    { artifacts: inspectionCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "usage-seal-empty", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const event = only(run.expEvalEvents(), (item) => item.evalId === "usage-seal-empty", run.diagnostic());
      const shown = await niceeval.run(["show", event.locator]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toMatch(/Summary\s+[^\n]*entries: 1/u);
      expect(shown.stdout).not.toContain("entrys");
    },
  );
});
