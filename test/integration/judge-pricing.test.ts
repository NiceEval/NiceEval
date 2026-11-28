import { rm } from "node:fs/promises";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { selectInspectionOperation, withOperational } from "./fixtures/adapter-trace-usage-harness/harness.ts";
import {
  createJudgeProject,
  invokeCli,
  narrowInspectionSuccess,
  OpenRouterProvider,
  planAndRunExperiment,
  showJsonDocuments,
  startHttpServer,
} from "./fixtures/judge-harness/harness.ts";
import { judgeUsageChatResponse } from "./fixtures/inspection-core/judge-http.ts";

const models = {
  builtin: "gpt-6.2-sol",
  normalized: "fixture/gpt-6.2-sol-20261118",
  configured: "openai/gpt-6.2-sol",
  reported: "azure/gpt-6.2-sol",
  zero: "aws-mantle/gpt-6.2-sol",
  unknown: "fixture/judge-pricing-unknown",
};
const reports = { [models.reported]: "0.125", [models.zero]: "0" };
const configuredPrice = { inputPerMTok: 5, outputPerMTok: 20, cacheReadPerMTok: 1, cacheWritePerMTok: 3 };
const cases = Object.keys(models);
const locators = new Map<string, string>();
let cwd: string;
let server: Awaited<ReturnType<typeof startHttpServer>>;

beforeAll(async () => {
  server = await startHttpServer((_request, body, response) => {
    const { model } = JSON.parse(body);
    const reported = reports[model];
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify(
        judgeUsageChatResponse(
          {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_tokens_details: { cached_tokens: 10, cache_write_tokens: 5 },
            ...(reported === undefined ? {} : { cost: reported }),
          },
          { screenshot: true },
        ),
      ),
    );
  });
  cwd = await createJudgeProject("niceeval-judge-pricing-", {
    evals: Object.fromEntries(
      Object.entries(models).map(([id, model]) => [
        `${id}.eval.ts`,
        `
      import { defineScoreEval } from "niceeval";
      import { defineJudge } from "niceeval/expect";
      export default defineScoreEval({ judge: ${JSON.stringify(model)}, async test(t) {
        t.judge({ answer: "Paris" }, defineJudge({
          rubric: "Score the answer.",
          anchors: [{ measurement: 0, description: "Incorrect" }, { measurement: 1, description: "Correct" }],
        })).score(1);
      } });
    `,
      ]),
    ),
    experiments: {
      "pricing.ts": `import { defineExperiment } from "niceeval";
        export default defineExperiment({ evals: ${JSON.stringify(cases)} });`,
    },
  });
  const run = await planAndRunExperiment(cwd, "pricing", {
    config: {
      maxConcurrency: 2,
      judgeProvider: OpenRouterProvider({ model: models.builtin, apiKey: "fixture", baseUrl: server.baseUrl }),
      pricing: Object.fromEntries(
        [models.configured, models.reported, models.zero].map((model) => [model, configuredPrice]),
      ),
    },
  });
  for (const slot of run.run?.slots ?? []) {
    if (slot.publication.state === "published") locators.set(slot.evalId, slot.publication.attemptLocator);
  }
  expect([...locators.keys()].sort()).toEqual([...cases].sort());
});

afterAll(async () => {
  await server?.close();
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

// @feature docs/feature/judge/README.md#usage-price-source
test("Judge ledger retains the first available price source for each request model", async () => {
  await withOperational(cwd, (facts) => {
    fc.assert(
      fc.property(fc.constantFrom("builtin", "normalized", "configured", "reported", "zero", "unknown"), (id) => {
        const locator = locators.get(id)!;
        const { judgeUsage, totalCosts } = selectInspectionOperation(facts, { kind: "attempt.usage", locator }).usage;
        if (!("calls" in judgeUsage)) throw new Error(`Judge ledger unavailable for ${id}: ${judgeUsage.reason}`);
        expect(judgeUsage.calls).toHaveLength(1);
        expect(judgeUsage.calls[0]?.requestModel).toBe(models[id]);
        if (id === "unknown") {
          expect(judgeUsage.priceReceipts).toEqual([]);
          expect(totalCosts.gaps).toContainEqual(
            expect.objectContaining({
              source: "judge",
              reason: "no-pricing-profile",
              models: [models.unknown],
            }),
          );
          return;
        }
        if (id === "reported" || id === "zero") {
          expect(judgeUsage.calls[0]?.cost).toMatchObject({
            amount: reports[models[id]],
            source: { kind: "reported" },
          });
          expect(judgeUsage.priceReceipts).toEqual([]);
          return;
        }
        const configured = id === "configured";
        expect(judgeUsage.calls[0]?.cost).toBeNull();
        expect(judgeUsage.priceReceipts).toEqual([
          expect.objectContaining({
            state: "complete",
            amount: configured ? "0.00085" : "0.0003835",
            pricing: expect.objectContaining({
              requestModel: models[id],
              selector: configured ? models.configured : models.builtin,
              source: expect.objectContaining(
                configured
                  ? { kind: "configured-profile" }
                  : { kind: "builtin-catalog", id: "models.dev", asOf: expect.any(Number) },
              ),
            }),
          }),
        ]);
      }),
      { numRuns: 6, examples: [["builtin"], ["normalized"], ["configured"], ["reported"], ["zero"], ["unknown"]] },
    );
  });
});

// @feature docs/feature/judge/README.md#usage-price-source
test("show usage identifies built-in catalog estimates in text and JSON", async () => {
  const locator = locators.get("builtin")!;
  const text = await invokeCli(cwd, ["show", locator, "usage"]);
  expect(text.code).toBe(0);
  expect(text.stdout).toContain("Built-in catalog estimate");
  const [document] = await showJsonDocuments(cwd, [locator, "usage"]);
  const usage = narrowInspectionSuccess(document!, "attempt.usage");
  if (!usage.success) throw new Error(usage.reason);
  expect(usage.value.usage.judgeUsage).toMatchObject({
    builtinCatalogCalls: 1,
    priceReceipts: [{ pricing: { source: { kind: "builtin-catalog" } } }],
  });
});
