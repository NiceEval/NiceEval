// rerun: pnpm e2e test --repo cli -- --run test/failure-error-results.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

// Regression note: Judge 预检失败曾只输出通用消息，无法定位受影响的用例和次数。
// @feature docs/feature/experiments/README.md
test.concurrent("Judge 调用错误可从 CLI 汇总追溯每次 Attempt", async () => {
  await cliE2E.case(
    "judge-precheck-error",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const result = await niceeval.run(["exp", "judge-precheck-error", "--rerun", "all", "--json"], {
        env: { CLI_JUDGE_TEST_KEY: "fixture-key" },
      });

      expect(result.exitCode, result.diagnostic()).toBe(1);
      expect(result.expEvalEvents()).toEqual([
        expect.objectContaining({
          evalId: "judge-precheck/unreachable",
          verdict: "errored",
          attempts: 2,
          passed: 0,
        }),
      ]);
      const receipt = result.expReceipt();
      expect(receipt).toMatchObject({ completion: "completed" });

      const query = await niceeval.run(["show", `run:${receipt.createdRunIds[0]!}`, "--json"]);
      expect(query.exitCode, query.diagnostic()).toBe(0);
      const members = query.run().run.plannedAttempts;
      expect(members).toHaveLength(2);
      for (const member of members)
        expect(member).toMatchObject({
          state: "executed",
          verdict: "errored",
          publication: { state: "published", attemptLocator: expect.any(String) },
        });
      expect(
        new Set(
          members.flatMap(({ publication }) => (publication.state === "published" ? [publication.attemptLocator] : [])),
        ).size,
      ).toBe(2);
    },
  );
});

// Regression note: Assertions writer 的具体原因曾使用与其它 CLI 运行错误不同的 `niceeval error:` 前缀。
// @feature docs/feature/experiments/README.md

test.concurrent("Assertions document 无法发布时使用统一 error 前缀", async () => {
  await cliE2E.case(
    "assertions-document-error",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      const result = await niceeval.run(["exp", "assertions-document-error", "--rerun", "all"]);

      expect(result.exitCode, result.diagnostic()).toBe(1);
      expect(result.stderr).toMatch(/^error: Assertions could not be saved/u);
      expect(result.stderr).not.toContain("niceeval error:");
      expect(result.stdout).not.toContain("niceeval error:");
    },
  );
});

// feature: Human 结束摘要按 Eval 类型展示 score 或 pass 主读数。
// @feature docs/feature/experiments/README.md

test.concurrent("计分制与通过制 Human 结束摘要显示各自主读数", async () => {
  await cliE2E.case(
    "score-human-results",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const scored = await niceeval.run(["exp", "deliberate-score", "--rerun", "all"]);
      expect(scored.exitCode, scored.diagnostic()).toBe(0);
      expect(scored.stderr).toBe("");
      expect(scored.stdout).not.toMatch(/[\x1b\x08]/);
      expect(scored.stdout).toContain("SCORED");
      expect(scored.stdout).toContain("RESULTS");
      expect(scored.stdout).toContain("deliberate-score/scored  2 score · 1/1 ranked");
      expect(scored.stdout).toContain("1 scored · 0 failed · 0 skipped · 0 errored");
      expect(scored.stdout).not.toContain("1 passed · 0 failed");

      const zero = await niceeval.run(["exp", "score-feedback", "score-feedback/zero", "--rerun", "all"]);
      expect(zero.exitCode, zero.diagnostic()).toBe(0);
      expect(zero.stdout).toContain("SCORED");
      expect(zero.stdout).toContain("0 score · 1/1 ranked");
      expect(zero.stdout).not.toContain("1 passed");

      const zeroJson = await niceeval.run(["exp", "score-feedback", "score-feedback/zero", "--rerun", "all", "--json"]);
      expect(zeroJson.exitCode, zeroJson.diagnostic()).toBe(0);
      const zeroEval = only(zeroJson.expEvalEvents(), (event) => event.evalId === "score-feedback/zero");
      expect(zeroEval.verdict).toBe("passed");
      const zeroShow = await niceeval.run(["show", zeroEval.locator!]);
      expect(zeroShow.exitCode, zeroShow.diagnostic()).toBe(0);
      expect(zeroShow.stdout).toMatch(/scored|score completed/iu);

      const gated = await niceeval.run(["exp", "score-feedback", "score-feedback/gated", "--rerun", "all"]);
      expect(gated.exitCode, gated.diagnostic()).toBe(1);
      expect(gated.stdout).toContain("FAILED");
      expect(gated.stdout).toContain("2 score · failed · unranked");
      expect(gated.stdout).toContain("0 scored · 1 failed");
      expect(gated.stdout).not.toContain("SCORED");

      const partial = await niceeval.run(["exp", "score-feedback", "score-feedback/partial", "--rerun", "all"]);
      expect(partial.exitCode, partial.diagnostic()).toBe(1);
      expect(partial.stdout).toContain("ERRORED");
      expect(partial.stdout).toContain("≥3 score · partial");
      expect(partial.stdout).toContain("0 scored");
      expect(partial.stdout).not.toContain("SCORED");

      const passed = await niceeval.run(["exp", "normal", "greet", "--rerun", "all"]);
      expect(passed.exitCode, passed.diagnostic()).toBe(0);
      expect(passed.stderr).toBe("");
      expect(passed.stdout).toContain("PASSED");
      expect(passed.stdout).toContain("RESULTS");
      expect(passed.stdout).toContain("greet/hello  1/1 passed");
      expect(passed.stdout).not.toContain("SCORED");

      const freshForCarry = await niceeval.run(["exp", "normal", "greet", "--rerun", "all", "--json"]);
      expect(freshForCarry.exitCode, freshForCarry.diagnostic()).toBe(0);
      const freshForCarryEval = only(
        freshForCarry.expEvalEvents(),
        (event) => event.evalId === "greet/hello",
        freshForCarry.diagnostic(),
      );
      const carried = await niceeval.run(["exp", "normal", "greet", "--json"]);
      expect(carried.exitCode, carried.diagnostic()).toBe(0);

      const carriedSummary = await niceeval.run(["show", `run:${carried.expReceipt().createdRunIds[0]!}`, "--json"]);
      expect(carriedSummary.exitCode, carriedSummary.diagnostic()).toBe(0);
      expect(carriedSummary.run().run.plannedAttempts).toEqual([
        expect.objectContaining({
          publication: expect.objectContaining({ state: "published", attemptLocator: freshForCarryEval.locator }),
          state: "carried",
          verdict: "passed",
        }),
      ]);
    },
  );
});
