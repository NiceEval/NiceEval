import { rm } from "node:fs/promises";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import {
  createJudgeProject,
  planAndRunExperiment,
  readAssertionDetail,
  readAssertionsList,
  startModelEmulator,
} from "./fixtures/judge-harness/harness.ts";

import { selectInspectionOperation, withOperational } from "./fixtures/adapter-trace-usage-harness/harness.ts";

const KNOWN_CASES = [
  { model: "gpt-5", base: "gpt-5", expectedUSD: 11.25 },
  { model: "gpt-5-20990101", base: "gpt-5", expectedUSD: 11.25 },
  { model: "gateway/gpt-5", base: "gpt-5", expectedUSD: 11.25 },
  { model: "gateway/gpt-5-2099-01-01", base: "gpt-5", expectedUSD: 11.25 },
  { model: "claude-sonnet-4-5", base: "claude-sonnet-4-5", expectedUSD: 18 },
  { model: "claude-sonnet-4-5-2099-01-01", base: "claude-sonnet-4-5", expectedUSD: 18 },
  { model: "gateway/claude-sonnet-4-5", base: "claude-sonnet-4-5", expectedUSD: 18 },
  { model: "gateway/claude-sonnet-4-5-20990101", base: "claude-sonnet-4-5", expectedUSD: 18 },
] as const;

const UNKNOWN_MODELS = ["unknown-model", "gateway/unknown-model-20990101", "toString", "__proto__"] as const;

describe("Builtin model catalog normalization for pricing and context windows", () => {
  let server: Awaited<ReturnType<typeof startModelEmulator>>;
  let cwd = "";
  const estimatedByModel = new Map<string, number | undefined>();
  const contextRejection = new Map<string, { result: string; detail: string }>();

  beforeAll(async () => {
    server = await startModelEmulator([
      {
        id: "unknown-context-ok",
        match: { model: "unknown-model", tool: "record_score_match" },
        reply: [{ type: "tool_call", name: "record_score_match", arguments: { measurement: 1, rationale: "ok" } }],
      },
    ]);

    const variants = [
      ...KNOWN_CASES.map((entry) => entry.model),
      ...UNKNOWN_MODELS,
    ];

    const experiments: Record<string, string> = {};
    for (const [idx, model] of variants.entries()) {
      experiments[`m-${idx}.ts`] = `
        import { defineExperiment } from "niceeval";
        import agent from "../agent.ts";
        export default defineExperiment({ adapter: agent, model: ${JSON.stringify(model)}, evals: ["price"], attempts: 1 });
      `;
    }
    experiments["ctx-known.ts"] = `
      import { defineExperiment } from "niceeval";
      import { OpenAIProvider } from "niceeval/judge";
      import agent from "../agent.ts";
      export default defineExperiment({
        adapter: agent,
        judge: OpenAIProvider({ model: "gateway/claude-sonnet-4-5-2099-01-01", baseUrl: ${JSON.stringify(server.baseUrl)}, apiKey: "k" }),
        evals: ["ctx"],
        attempts: 1,
      });
    `;
    experiments["ctx-unknown.ts"] = `
      import { defineExperiment } from "niceeval";
      import { OpenAIProvider } from "niceeval/judge";
      import agent from "../agent.ts";
      export default defineExperiment({
        adapter: agent,
        judge: OpenAIProvider({ model: "unknown-model", baseUrl: ${JSON.stringify(server.baseUrl)}, apiKey: "k" }),
        evals: ["ctx"],
        attempts: 1,
      });
    `;

    cwd = await createJudgeProject("niceeval-builtin-models-", {
      config: "export default {};",
      agent: `
        import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
        export default defineAgent({
          name: "catalog-agent",
          evidenceCoverage: completeEvidenceCoverage,
          send: async () => ({
            status: "completed",
            events: [],
            usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
          }),
        });
      `,
      evals: {
        "price.eval.ts": `
          import { defineEval } from "niceeval";
          import { equals } from "niceeval/expect";
          export default defineEval({
            async test(t) {
              await t.send("price");
              t.check(1, equals(1));
            },
          });
        `,
        "ctx.eval.ts": `
          import { defineEval } from "niceeval";
          import { defineJudge } from "niceeval/expect";
          export default defineEval({
            test(t) {
              t.judge({ huge: "x".repeat(650_000) }, defineJudge({ rubric: "Check context" })).label("ctx");
            },
          });
        `,
      },
      experiments,
    });

    for (const [idx, model] of variants.entries()) {
      const planned = await Effect.runPromise(
        experimentHost.invocation.plan({
          cwd,
          experimentSelector: `m-${idx}`,
          config: { maxConcurrency: 1 },
          overrides: { rerun: "all" },
        }),
      );
      if (planned.status !== "ready") throw new Error(`Could not plan m-${idx}`);
      const res = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
      const runId = res.receipt.createdRunIds[0]!;
      const runDoc = await withOperational(
        cwd,
        (facts) => selectInspectionOperation(facts, { kind: "run.get", runId: runId as never }),
      );
      const costUSD = runDoc.run.plannedAttempts[0]!.costUSD;
      estimatedByModel.set(model, costUSD.state === "available" ? (costUSD.value ?? undefined) : undefined);
    }

    for (const key of ["ctx-known", "ctx-unknown"] as const) {
      const res = await planAndRunExperiment(cwd, key, { rerun: "all" });
      const slot = res.run?.slots[0];
      if (slot?.publication.state !== "published") throw new Error(`Missing slot for ${key}`);
      const entries = await readAssertionsList(cwd, slot.publication.attemptLocator);
      const detail = await readAssertionDetail(cwd, slot.publication.attemptLocator, entries[0]!.entryId);
      contextRejection.set(key, {
        result: entries[0]!.entry.decision.result,
        detail: JSON.stringify(detail),
      });
    }
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/adapters/README.md#usage-and-cost-projection
  test("pricing lookup normalizes gateway prefixes and date suffixes while preserving unknown models", () => {
    fc.assert(
      fc.property(fc.constantFrom(...KNOWN_CASES), (entry) => {
        expect(estimatedByModel.get(entry.model)).toBe(entry.expectedUSD);
      }),
      { numRuns: KNOWN_CASES.length },
    );

    fc.assert(
      fc.property(fc.constantFrom(...UNKNOWN_MODELS), (model) => {
        expect(estimatedByModel.get(model)).toBeUndefined();
      }),
      { numRuns: UNKNOWN_MODELS.length },
    );
  });

  // @feature docs/feature/judge/README.md#material-admission
  test("builtin context window lookup enforces normalized model limits before transport while passing unknown models", () => {
    const known = contextRejection.get("ctx-known")!;
    expect(known.result).toBe("unavailable");
    expect(known.detail).toContain("judge-material-exceeds-context");

    const unknown = contextRejection.get("ctx-unknown")!;
    expect(unknown.result).toBe("matched");
  });
});
