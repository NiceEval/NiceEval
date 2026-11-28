import { rm } from "node:fs/promises";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { selectInspectionOperation, withOperational } from "./fixtures/adapter-trace-usage-harness/harness.ts";
import {
  createJudgeProject,
  invokeCli,
  narrowInspectionSuccess,
  OpenAIProvider,
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

const chatCases = [
  { id: "both", read: 10, write: 5, tokens: [85, 100, 10, 5], amount: "0.00087" },
  { id: "read-zero", read: 0, write: 5, tokens: [95, 100, 0, 5], amount: "0.00091" },
  { id: "write-zero", read: 10, write: 0, tokens: [90, 100, 10, 0], amount: "0.00086" },
  { id: "totals-only", tokens: [null, 100, null, null], amount: "0.0004", ranged: true },
  { id: "totals-input-higher", tokens: [null, 100, null, null], amount: "0.0004", ranged: true },
  { id: "read-absent", write: 5, tokens: [null, 100, null, 5], amount: "0.000435", ranged: true },
  { id: "write-absent", read: 10, tokens: [null, 100, 10, null], amount: "0.00041", ranged: true },
  {
    id: "read-negative",
    read: -1,
    write: 5,
    tokens: [null, 100, null, 5],
    amount: "0.000435",
    invalid: true,
    ranged: true,
  },
  {
    id: "write-negative",
    read: 10,
    write: -1,
    tokens: [null, 100, 10, null],
    amount: "0.00041",
    invalid: true,
    ranged: true,
  },
  { id: "read-over-total", read: 101, tokens: [null, null, null, null], amount: "0.0004", invalid: true },
  { id: "write-over-total", write: 101, tokens: [null, null, null, null], amount: "0.0004", invalid: true },
  { id: "sum-over-total", read: 60, write: 50, tokens: [null, null, null, null], amount: "0.0004", invalid: true },
];
const chatRange = { currency: "USD", lower: "0.0005", upper: "0.0011" };

describe("OpenAI Chat cache buckets and read-side price ranges", () => {
  let cwd: string;
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  const locators = new Map<string, string>();

  beforeAll(async () => {
    server = await startHttpServer((_request, body, response) => {
      const { model } = JSON.parse(body);
      const sample = chatCases.find(({ id }) => model === `fixture/${id}`);
      if (sample === undefined) throw new Error(`Unexpected Chat fixture model ${model}`);
      const { read, write } = sample;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify(
          judgeUsageChatResponse(
            {
              prompt_tokens: 100,
              completion_tokens: 20,
              total_tokens: 120,
              ...(read === undefined && write === undefined
                ? {}
                : {
                    prompt_tokens_details: { cached_tokens: read, cache_write_tokens: write },
                  }),
            },
            { screenshot: true },
          ),
        ),
      );
    });
    const multiple = "multiple";
    const evals = [...chatCases.map(({ id }) => ({ id, count: 1 })), { id: multiple, count: 2 }];
    const provider = { model: "fixture/both", apiKey: "fixture", baseUrl: server.baseUrl };
    const pricing = {
      "fixture/totals-input-higher": configuredPrice,
      "fixture/*": { ...configuredPrice, cacheWritePerMTok: 7 },
    };
    cwd = await createJudgeProject("niceeval-openai-chat-pricing-", {
      config: `import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({ judgeProvider: OpenAIProvider(${JSON.stringify(provider)}), pricing: ${JSON.stringify(pricing)} });`,
      evals: Object.fromEntries(
        evals.map(({ id, count }) => [
          `${id}.eval.ts`,
          `
        import { defineScoreEval } from "niceeval";
        import { defineJudge } from "niceeval/expect";
        export default defineScoreEval({ judge: ${JSON.stringify(`fixture/${id === multiple ? "totals-only" : id}`)}, async test(t) {
          for (let index = 0; index < ${count}; index++) {
            t.judge({ answer: "Paris" }, defineJudge({
              rubric: "Score the answer.",
              anchors: [{ measurement: 0, description: "Incorrect" }, { measurement: 1, description: "Correct" }],
            })).score(1);
          }
        } });
      `,
        ]),
      ),
      experiments: {
        "chat-pricing.ts": `import { defineExperiment } from "niceeval";
          export default defineExperiment({ evals: ${JSON.stringify(evals.map(({ id }) => id))} });`,
      },
    });
    const run = await planAndRunExperiment(cwd, "chat-pricing", {
      config: {
        maxConcurrency: 2,
        judgeProvider: OpenAIProvider(provider),
        pricing,
      },
    });
    for (const slot of run.run?.slots ?? []) {
      if (slot.publication.state === "published") locators.set(slot.evalId, slot.publication.attemptLocator);
    }
    expect([...locators.keys()].sort()).toEqual(evals.map(({ id }) => id).sort());
  });

  afterAll(async () => {
    await server?.close();
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/judge/README.md#usage-price-source
  test("keeps each supported Chat cache scalar and prices provable buckets", async () => {
    await withOperational(cwd, (facts) => {
      fc.assert(
        fc.property(fc.constantFrom(...chatCases), (sample) => {
          const locator = locators.get(sample.id)!;
          const { judgeUsage, totalCosts } = selectInspectionOperation(facts, { kind: "attempt.usage", locator }).usage;
          if (!("calls" in judgeUsage)) throw new Error(judgeUsage.reason);
          expect(judgeUsage.calls).toHaveLength(1);
          const call = judgeUsage.calls[0]!;
          expect([call.inputTokens, call.inputTotalTokens, call.cacheReadTokens, call.cacheWriteTokens]).toEqual(
            sample.tokens,
          );
          expect(call.receipt.reason).toBe(sample.invalid ? "invalid-usage" : null);
          expect(call.receipt.fields.filter(({ path }) => path.startsWith("usage.prompt_tokens_details."))).toEqual([
            ...(sample.write === undefined || sample.write < 0
              ? []
              : [{ path: "usage.prompt_tokens_details.cache_write_tokens", value: sample.write }]),
            ...(sample.read === undefined || sample.read < 0
              ? []
              : [{ path: "usage.prompt_tokens_details.cached_tokens", value: sample.read }]),
          ]);
          expect(judgeUsage.priceReceipts).toMatchObject([
            {
              state: sample.tokens[0] === null ? "partial" : "complete",
              amount: sample.amount,
            },
          ]);
          expect(totalCosts).toMatchObject({
            values: [{ currency: "USD", value: sample.amount, source: "estimated" }],
          });
          if (sample.ranged) {
            const estimatedRange = sample.id === "totals-input-higher" ? { ...chatRange, upper: "0.0009" } : chatRange;
            expect(call).toMatchObject({ estimatedRange });
            expect(judgeUsage.totals).toMatchObject({ estimatedRange });
            expect(totalCosts).toMatchObject({ estimatedRange });
          } else {
            expect(call).not.toHaveProperty("estimatedRange");
            expect(totalCosts).not.toHaveProperty("estimatedRange");
          }
        }),
        { numRuns: chatCases.length, examples: chatCases.map((sample) => [sample]) },
      );
    });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("reads the historical Chat whitelist shape and shows ranges beside subtotals", async () => {
    const locator = locators.get("totals-only")!;
    const [document] = await showJsonDocuments(cwd, [locator, "usage"]);
    const usage = narrowInspectionSuccess(document!, "attempt.usage");
    if (!usage.success) throw new Error(usage.reason);
    expect(usage.value.usage.judgeUsage).toMatchObject({
      calls: [
        {
          estimatedRange: chatRange,
          receipt: {
            fields: [
              { path: "model", value: "judge-usage-served" },
              { path: "usage.completion_tokens", value: 20 },
              { path: "usage.prompt_tokens", value: 100 },
              { path: "usage.total_tokens", value: 120 },
            ],
          },
        },
      ],
    });
    await withOperational(cwd, (facts) => {
      const { judgeUsage, totalCosts } = selectInspectionOperation(facts, {
        kind: "attempt.usage",
        locator: locators.get("multiple")!,
      }).usage;
      expect(judgeUsage).toMatchObject({ calls: [{ estimatedRange: chatRange }, { estimatedRange: chatRange }] });
      expect(totalCosts).toMatchObject({
        values: [{ currency: "USD", value: "0.0008", source: "estimated" }],
        estimatedRange: { currency: "USD", lower: "0.001", upper: "0.0022" },
      });
    });
    const [experimentDoc] = await showJsonDocuments(cwd, ["exp:chat-pricing"]);
    const experiment = narrowInspectionSuccess(experimentDoc!, "experiment.get");
    if (!experiment.success) throw new Error(experiment.reason);
    expect(experiment.value.experiment.costSummary.totalCosts).toMatchObject({
      state: "partial",
      values: [{ currency: "USD", value: "0.00713", source: "estimated" }],
      estimatedRange: { currency: "USD", lower: "0.00784", upper: "0.01244" },
    });
    const output = await invokeCli(cwd, ["show", locator, "usage"]);
    expect(output.code).toBe(0);
    expect(output.stdout).toContain("Known subtotal");
    expect(output.stdout).toContain("Estimated cost range");
    expect(output.stdout).toContain("USD 0.0005–0.0011");
    const experimentOutput = await invokeCli(cwd, ["show", "exp:chat-pricing"]);
    expect(experimentOutput.code, experimentOutput.stderr + experimentOutput.stdout).toBe(0);
    expect(experimentOutput.stdout).toContain("Experiment known subtotal");
    expect(experimentOutput.stdout).toContain("USD 0.00784–0.01244");
  });
});
