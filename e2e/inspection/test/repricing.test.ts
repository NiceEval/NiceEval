import { only } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { judgeUsageChatResponse, judgeUsageHttp } from "../fixtures/judge-usage-http.ts";
import { inspectionE2E } from "./support.ts";

// @use-case docs/feature/inspection/use-case/inspection-compare-quality-cost.md
test.concurrent("按两个价格版本重计历史成本，保留用量缺口和原始结果", async () => {
  await inspectionE2E.case("historical-repricing", async ({ paths, commands: { niceeval } }) => {
    const fixture = judgeUsageHttp([{ status: 200, body: judgeUsageChatResponse({
      prompt_tokens: 120, completion_tokens: 30, total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 20 },
    }) }]);
    try {
      const env = { NICEEVAL_E2E_JUDGE_USAGE_URL: await fixture.listen() };
      const run = await niceeval.run(["exp", "judge-usage-pricing", "--rerun", "all", "--json"], { env });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const event = only(run.expEvalEvents(), (item) => item.experimentId === "judge-usage-pricing", run.diagnostic());
      const request = join(paths.projectRoot, "reprice.request.json");
      const before = await niceeval.run(["show", event.locator, "--json"]);
      expect(before.exitCode, before.diagnostic()).toBe(0);

      const original = await niceeval.run(["show", event.locator, "usage", "--json"]);
      expect(original.exitCode, original.diagnostic()).toBe(0);
      for (const multiplier of [1, 2]) {
        await writeFile(request, JSON.stringify( Object.fromEntries(["application-model", "inspection-fixture-v1"].map((model) => [model, {
            inputPerMTok: 2 * multiplier, outputPerMTok: 8 * multiplier,
            cacheReadPerMTok: multiplier, cacheWritePerMTok: 2 * multiplier,
            source: { id: `comparison-${multiplier}` },
          }])),
        ));
        const read = await niceeval.run(["show", event.locator, "usage", "--reprice", request, "--json"]);
        expect(read.exitCode, read.diagnostic()).toBe(0);
        const pricingPath = join(paths.projectRoot, "pricing.json");
        const pricing = Object.fromEntries(["application-model", "inspection-fixture-v1"].map((model) => [model, {
          inputPerMTok: 2 * multiplier, outputPerMTok: 8 * multiplier,
          cacheReadPerMTok: multiplier, cacheWritePerMTok: 2 * multiplier, source: { id: `comparison-${multiplier}` },
        }]));
        await writeFile(pricingPath, JSON.stringify(pricing));
        const shown = await niceeval.run(["show", event.locator, "--reprice", pricingPath, "--json", "usage"]);
        expect(shown.exitCode, shown.diagnostic()).toBe(0);
        expect(shown.stdout).toBe(read.stdout);
        const repricing = read.inspectionSuccess("attempt.reprice").repricing;
        expect(repricing.application).toMatchObject({
          state: "complete", collection: "complete", callCount: 1,
          amount: multiplier === 1 ? "0.000016" : "0.000032", missingCallIds: [],
        });
        expect(repricing.judge).toMatchObject({
          state: "partial", collection: "complete", callCount: 1,
          amount: multiplier === 1 ? "0.00026" : "0.00052",
        });
        expect(repricing.total).toEqual({ state: "partial", currency: "USD",
          amount: multiplier === 1 ? "0.000276" : "0.000552" });
        expect(only(repricing.judge.estimates, () => true).missing).toEqual([
          { bucket: "input", reason: "tokens-unknown" },
          { bucket: "cache-write", reason: "tokens-unknown" },
        ]);
      }
      await writeFile(request, JSON.stringify( { "unmatched-model": { inputPerMTok: 1, outputPerMTok: 1, source: { id: "unmatched" } } },
      ));
      const missing = await niceeval.run(["show", event.locator, "usage", "--reprice", request, "--json"]);
      expect(missing.exitCode, missing.diagnostic()).toBe(0);
      expect(missing.inspectionSuccess("attempt.reprice").repricing.total).toEqual({
        state: "unavailable", currency: "USD", amount: null,
      });
      expect(missing.inspectionSuccess("attempt.reprice").repricing.application.missingCallIds).toEqual(["application-1"]);

      const unchanged = await niceeval.run(["show", event.locator, "usage", "--json"]);
      expect(unchanged.exitCode, unchanged.diagnostic()).toBe(0);
      expect(unchanged.inspectionSuccess("attempt.usage")).toEqual(original.inspectionSuccess("attempt.usage"));
      const after = await niceeval.run(["show", event.locator, "--json"]);
      expect(after.exitCode, after.diagnostic()).toBe(0);
      expect(after.stdout).toBe(before.stdout);
      expect(fixture.requests).toHaveLength(1);
    } finally {
      expect(await fixture.close()).toEqual({ listening: false, openConnections: 0 });
    }
  });
});
