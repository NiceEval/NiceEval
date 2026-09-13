// rerun: pnpm e2e test --repo inspection -- --run test/show-experiment-spacing.test.ts

import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @concord-case necase_NRD2EXM6620FRXHN
// @concord-owner docs/engineering/testing/e2e/inspection.md#show-terminal-review
// @concord-regression memory/show-experiment-heading-detached-from-table.md
// @concord-test-file e2e/inspection/test/show-experiment-spacing.test.ts
test.concurrent("Show 把 Experiment 标题和自己的内容排在同一段 [necase_NRD2EXM6620FRXHN]", async () => {
  await inspectionE2E.case(
    "show-experiment-spacing",
    async ({ commands: { niceeval } }) => {
      for (const experimentId of ["harness/alternate", "harness/canary"]) {
        const produced = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
        expect(produced.exitCode, produced.diagnostic()).toBe(0);
      }

      const overview = await niceeval.run(["show"]);
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      expect(overview.stdout).toContain([
        "Attempts · harness",
        "  Experiment harness/alternate",
        "  1 scored Attempts hidden",
        "  See more  niceeval show --experiment harness/alternate",
        "  ",
        "  Experiment harness/canary",
        "  1 scored Attempts hidden",
        "  See more  niceeval show --experiment harness/canary",
      ].join("\n"));
    },
  );
});
