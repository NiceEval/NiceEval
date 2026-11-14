import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/experiments/README.md
test.concurrent("普通业务函数无需 Adapter 即可完成评测并公开断言结果", async () => {
  await evalE2E.case("direct-call", async ({ paths: { projectRoot }, commands: { niceeval, tsc } }) => {
    await writeFile(join(projectRoot, "fixtures", "direct-business.ts"), `
      export function total(prices: readonly number[]): number {
        return prices.reduce((sum, price) => sum + price, 0);
      }
    `);
    await writeFile(join(projectRoot, "experiments", "direct-call.ts"), `
      import { defineExperiment } from "niceeval";
      export default defineExperiment({ evals: ["direct-call"], flags: { currency: "USD" } });
    `);
    await writeFile(join(projectRoot, "evals", "direct-call.eval.ts"), `
      import { defineEval } from "niceeval";
      import { equals } from "niceeval/expect";
      import { total } from "../fixtures/direct-business.ts";
      export default defineEval({ test(t) {
        t.check(total([2, 3, 5]), equals(10)).label("business total");
        t.check(t.flags.currency, equals("USD")).label("experiment flags");
        t.note("total", total([2, 3, 5]));
      }});
    `);
    const run = await niceeval.run(["exp", "direct-call", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expReceipt().completion).toBe("completed");
    const event = only(run.expEvalEvents(), (entry) => entry.evalId === "direct-call", run.diagnostic());
    expect(event).toMatchObject({ verdict: "passed", attempts: 1, passed: 1 });
    if (event.locator === undefined) throw new Error("Direct-call Attempt must be published");

    const show = await niceeval.run(["show", event.locator, "--json"]);
    expect(show.exitCode, show.diagnostic()).toBe(0);
    const attempt = show.inspectionSuccess("attempt.get").attempt;
    expect(attempt.originRun.context.execution.adapter).toBeNull();
    expect(attempt.core.outcome).toBe("completed");
    expect(attempt.verdict).toBe("passed");
    expect(attempt.assertions.entries.map(({ display }) => display.label)).toEqual([
      "business total", "experiment flags",
    ]);
    expect(attempt.notes).toEqual([{ label: "total", sequence: 0, value: 10 }]);
    const human = await niceeval.run(["show", event.locator]);
    expect(human.exitCode, human.diagnostic()).toBe(0);
    expect(human.stdout).toContain("business total");
    const types = await tsc.run([
      "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext",
      "--skipLibCheck", "--allowImportingTsExtensions", "--types", "node",
      "experiments/direct-call.ts", "evals/direct-call.eval.ts",
    ]);
    expect(types.exitCode, types.diagnostic()).toBe(0);
  });
});
