import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

// @feature docs/feature/experiments/README.md
test.concurrent("JSON 汇总采用完整 Adapter 用量并省略未知 token 总量", async () => {
  await cliE2E.case("usage-summary", async ({ paths, commands: { niceeval } }) => {
    await writeFile(
      join(paths.projectRoot, "usage-adapter.ts"),
      `
      import { defineAdapter } from "niceeval";
      export const adapter = defineAdapter({ name: "usage-summary", create(ctx) {
        return { record(complete) {
          ctx.recordUsage({ callId: "one", model: "fixture", provider: "fixture",
            status: "succeeded", inputTokens: 70, cacheReadTokens: 30,
            inputTotalTokens: 100, outputTokens: 20 });
          ctx.sealUsage(complete ? { state: "complete" } : { state: "partial", reason: "fixture-missing-call" });
        } };
      } });
    `,
    );
    await writeFile(
      join(paths.projectRoot, "experiments", "usage-summary.ts"),
      `
      import { defineExperiment } from "niceeval";
      import { adapter } from "../usage-adapter.ts";
      export default defineExperiment({ adapter, attempts: 1, evals: ["usage-summary"] });
    `,
    );
    for (const complete of [true, false]) {
      await writeFile(
        join(paths.projectRoot, "evals", "usage-summary.eval.ts"),
        `
        import { adapter } from "../usage-adapter.ts";
        export default adapter.defineScoreEval({ test(t) { t.record(${complete}); t.score(1); } });
      `,
      );
      const run = await niceeval.run(["exp", "usage-summary", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const summary = run.expTerminal().summary;
      expect(summary.inputTokens, run.diagnostic()).toBe(complete ? 70 : undefined);
      expect(summary.outputTokens, run.diagnostic()).toBe(complete ? 20 : undefined);
    }
  });
});
