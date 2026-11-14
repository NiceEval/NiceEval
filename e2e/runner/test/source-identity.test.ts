// rerun: pnpm e2e test --candidate built --repo runner -- --run test/source-identity.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @use-case docs/feature/experiments/use-case/cache-modify-eval-source.md
test.concurrent("普通注释和保持换行的排版允许沿用 Eval，代码变化仍重跑", async () => {
  await runnerE2E.case("source-identity-trivia", async ({ commands: { niceeval }, paths }) => {
    const path = join(paths.projectRoot, "evals/simple/alpha.eval.ts");
    const original = readFileSync(path, "utf8");
    const baseline = await niceeval.run(["exp", "carry", "simple/alpha", "--json"]);
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    writeFileSync(path, original.replace('description: "runner carry alpha",', '  description: /* ordinary note */ "runner carry alpha",') + '\n// agentJudge( is documentation, not a capability\n');
    const dry = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"]);
    expect(dry.exitCode, dry.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(dry.json())).toMatchObject({ reused: 1 });
    writeFileSync(path, original.replace('"runner carry alpha"', '"runner carry alpha changed"'));
    const changed = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"]);
    expect(changed.exitCode, changed.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(changed.json()).matrix[0]!.slots).toMatchObject([{ state: "gap", reason: "identity-mismatch" }]);
  });
});
