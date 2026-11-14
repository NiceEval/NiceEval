import { createE2EContext } from "@niceeval/testkit";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const context = createE2EContext({
  repoId: "runner",
  project: { from: process.cwd(), prefix: "niceeval-labels-", omitTopLevel: ["node_modules", "test", ".niceeval", ".e2e-artifacts"], links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }] },
  commands: { niceeval: [resolve("node_modules/.bin/niceeval")] },
});

// @feature docs/feature/sandbox/README.md
test.concurrent("Docker instances identify their first Attempt and Eval unless the Experiment selects run-only labels", async () => {
  await context.case("creation-labels", {}, async ({ commands: { niceeval } }) => {
    for (const mode of ["default", "run-only"]) {
      const result = await niceeval.run(["exp", "creation-labels", "--rerun", "all", "--json"], {
        env: { NICEEVAL_LABEL_MODE: mode }, timeoutMs: 120_000,
      });
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.expEvalEvents(), result.diagnostic()).toEqual([
        expect.objectContaining({ evalId: "creation-labels", verdict: "passed" }),
      ]);
    }
  });
});
