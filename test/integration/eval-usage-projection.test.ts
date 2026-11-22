import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import {
  createFixtureProject,
  readJson,
  runSingleAttempt,
  writeJson,
  type FixtureProject,
} from "./fixtures/adapter-trace-usage-harness/harness.ts";

const FILES = {
  "adapters/agent-usage.ts": `
    import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
    import { readFile } from "node:fs/promises";
    import { resolve } from "node:path";

    export const usageAgent = defineAgent({
      name: "eval-usage-agent",
      evidenceCoverage: completeEvidenceCoverage,
      async send(input) {
        const plan = JSON.parse(await readFile(resolve(import.meta.dirname, "..", "agent-plan.json"), "utf8"));
        const step = plan.steps[input.text];
        if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
        if (step.throwError) {
          const err = new Error("agent send failed");
          throw err;
        }
        return {
          status: "completed",
          events: [],
          usage: step.usage,
          evidenceCoverage: step.coverage,
        };
      },
    });
  `,
  "adapters/adapter-usage.ts": `
    import { defineAdapter } from "niceeval";
    import { readFile } from "node:fs/promises";
    import { resolve } from "node:path";

    export const appUsageAdapter = defineAdapter({
      name: "eval-usage-adapter",
      behaviorRevision: "1",
      create(ctx) {
        return {
          async recordAndRead(t) {
            const plan = JSON.parse(await readFile(resolve(import.meta.dirname, "..", "adapter-plan.json"), "utf8"));
            const rejections = [];
            for (const c of plan.calls) {
              try {
                ctx.recordUsage(c);
                rejections.push({ threw: false });
              } catch (err) {
                rejections.push({ threw: true, message: err instanceof Error ? err.message : String(err) });
              }
            }
            ctx.sealUsage({ state: "complete" });
            return { usage: t.usage, rejections };
          },
        };
      },
    });
  `,
  "evals/agent-usage.eval.ts": `
    import { writeFile } from "node:fs/promises";
    import { resolve } from "node:path";
    import { defineEval } from "niceeval";
    import { equals } from "niceeval/expect";

    export default defineEval({
      async test(t) {
        const emptyUsage = t.usage;
        await t.send("withTotal");
        await t.send("buckets");
        const twoTurnUsage = t.usage;

        const s2 = t.newSession();
        const turnZero = await s2.send("zeroInput");
        const zeroUsage = turnZero.usage;

        const sPending = t.newSession();
        const inflight = sPending.send("slow");
        await new Promise((r) => setTimeout(r, 20));
        const pendingSessionUsage = sPending.usage;
        await inflight;

        const sCostAndPending = t.newSession();
        await sCostAndPending.send("costZero");
        const inflight2 = sCostAndPending.send("slow");
        await new Promise((r) => setTimeout(r, 20));
        const costAndPendingUsage = sCostAndPending.usage;
        await inflight2;

        const sPartial = t.newSession();
        try { await sPartial.send("failed"); } catch {}
        await sPartial.send("partial");
        const partialSessionUsage = sPartial.usage;

        const sEmpty = t.newSession();
        await sEmpty.send("emptyObj");
        const emptyObjUsage = sEmpty.usage;

        const sNeg = t.newSession();
        await sNeg.send("negative");
        const negativeUsage = sNeg.usage;

        const sOverflow = t.newSession();
        await sOverflow.send("maxSafe");
        await sOverflow.send("oneToken");
        const overflowUsage = sOverflow.usage;

        const sCost = t.newSession();
        await sCost.send("cost1");
        await sCost.send("cost2");
        await sCost.send("cost3");
        const mutatingSource = { costUSD: 0, inputTokens: 100 };
        await sCost.send("costZero");
        const costUsage = sCost.usage;

        const sWild = t.newSession();
        await sWild.send("exactOrWildcard");
        const wildUsage = sWild.usage;

        const sMissingBucket = t.newSession();
        await sMissingBucket.send("missingBucket");
        const missingBucketUsage = sMissingBucket.usage;

        const sPartialCost = t.newSession();
        await sPartialCost.send("partialCost");
        const partialCostUsage = sPartialCost.usage;

        await writeFile(resolve(import.meta.dirname, "..", "agent-out.json"), JSON.stringify({
          emptyUsage,
          twoTurnUsage,
          zeroUsage,
          pendingSessionUsage,
          costAndPendingUsage,
          partialSessionUsage,
          emptyObjUsage,
          negativeUsage,
          overflowUsage,
          costUsage,
          wildUsage,
          missingBucketUsage,
          partialCostUsage,
          frozen: {
            root: Object.isFrozen(costUsage),
            inputTokens: Object.isFrozen(costUsage.inputTokens),
            provenance: Object.isFrozen(costUsage.inputTokens.provenance),
            costs: Object.isFrozen(costUsage.costs),
            values: Object.isFrozen(costUsage.costs.values),
            firstValue: Object.isFrozen(costUsage.costs.values[0]),
          },
        }));
        t.check(mutatingSource.inputTokens, equals(100));
      },
    });
  `,
  "evals/adapter-usage.eval.ts": `
    import { writeFile } from "node:fs/promises";
    import { resolve } from "node:path";
    import { equals } from "niceeval/expect";
    import { appUsageAdapter } from "../adapters/adapter-usage.ts";

    export default appUsageAdapter.defineEval({
      async test(t) {
        const result = await t.recordAndRead(t);
        await writeFile(resolve(import.meta.dirname, "..", "adapter-out.json"), JSON.stringify(result));
        t.check(result.usage.source, equals("adapter"));
      },
    });
  `,
  "experiments/agent.ts": `
    import { defineExperiment } from "niceeval";
    import { usageAgent } from "../adapters/agent-usage.ts";
    export default defineExperiment({ adapter: usageAgent, model: "provider/model", evals: ["agent-usage"] });
  `,
  "experiments/agent-wildcard.ts": `
    import { defineExperiment } from "niceeval";
    import { usageAgent } from "../adapters/agent-usage.ts";
    export default defineExperiment({ adapter: usageAgent, model: "provider/other", evals: ["agent-usage"] });
  `,
  "experiments/adapter.ts": `
    import { defineExperiment } from "niceeval";
    import { appUsageAdapter } from "../adapters/adapter-usage.ts";
    export default defineExperiment({ adapter: appUsageAdapter, evals: ["adapter-usage"] });
  `,
};

describe("EvalUsage author projection for tokens, bounds, and decimal costs", () => {
  let project: FixtureProject;
  let agentOut: Record<string, any>;
  let wildcardOut: Record<string, any>;
  let adapterBucketsOut: Record<string, any>;
  let adapterPartialOut: Record<string, any>;
  let adapterInvalidOut: Record<string, any>;
  let adapterMultiCurrencyOut: Record<string, any>;

  beforeAll(async () => {
    project = await createFixtureProject("niceeval-eval-usage", FILES);
    await writeJson(project.cwd, "agent-plan.json", {
      steps: {
        withTotal: { usage: { inputTokens: 10, inputTotalTokens: 15, outputTokens: 5, reasoningTokens: 4 } },
        buckets: { usage: { inputTokens: 10, cacheReadTokens: 3, cacheCreationTokens: 2, outputTokens: 5, reasoningTokens: 4 } },
        zeroInput: { usage: { inputTokens: 0 } },
        slow: { delayMs: 60, usage: { inputTokens: 2, outputTokens: 1 } },
        failed: { throwError: true },
        partial: {
          usage: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
          coverage: { usage: { status: "partial", reason: "provider-limited" } },
        },
        emptyObj: { usage: {} },
        negative: { usage: { inputTokens: -1 } },
        maxSafe: { usage: { inputTokens: Number.MAX_SAFE_INTEGER } },
        oneToken: { usage: { inputTokens: 1 } },
        cost1: { usage: { costUSD: 0.1 } },
        cost2: { usage: { costUSD: 0.2 } },
        cost3: { usage: { costUSD: 1e-7 } },
        costZero: { usage: { costUSD: 0, inputTokens: 100 } },
        exactOrWildcard: { usage: { inputTokens: 3, outputTokens: 7, cacheReadTokens: 2, cacheCreationTokens: 0 } },
        missingBucket: { usage: { inputTokens: 3, outputTokens: 7 } },
        partialCost: { usage: { costUSD: 0 }, coverage: { usage: { status: "partial", reason: "missing-internal-send" } } },
      },
    });

    const pricing = {
      "provider/model": { inputPerMTok: 0.1, outputPerMTok: 0.2, cacheReadPerMTok: 0.05 },
      "provider/*": { inputPerMTok: 100, outputPerMTok: 100, cacheReadPerMTok: 100 },
    };
    const runAgentWithPricing = async (selector: string) => {
      const planned = await Effect.runPromise(
        experimentHost.invocation.plan({
          cwd: project.cwd,
          experimentSelector: selector,
          config: { maxConcurrency: 1, pricing },
          overrides: { rerun: "all" },
        }),
      );
      if (planned.status !== "ready") throw new Error("Failed to plan " + selector);
      await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
      return readJson<Record<string, any>>(project.cwd, "agent-out.json");
    };

    agentOut = await runAgentWithPricing("agent");
    wildcardOut = await runAgentWithPricing("agent-wildcard");

    const runAdapterPlan = async (calls: unknown[], usePricing = false) => {
      await writeJson(project.cwd, "adapter-plan.json", { calls });
      if (usePricing) {
        const planned = await Effect.runPromise(
          experimentHost.invocation.plan({
            cwd: project.cwd,
            experimentSelector: "adapter",
            config: {
              maxConcurrency: 1,
              pricing: { "provider/model": { inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 3, cacheWritePerMTok: 4 } },
            },
            overrides: { rerun: "all" },
          }),
        );
        if (planned.status !== "ready") throw new Error("Failed to plan adapter");
        await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
      } else {
        await runSingleAttempt(project.cwd, "adapter");
      }
      return readJson<{ usage: Record<string, any>; rejections: unknown[] }>(project.cwd, "adapter-out.json");
    };

    const baseCall = {
      callId: "call-a",
      modelRole: null,
      provider: "provider",
      model: "provider/model",
      status: "succeeded",
      inputTokens: 10,
      inputTotalTokens: null,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      outputTokens: 5,
    };

    adapterBucketsOut = (await runAdapterPlan([
      baseCall,
      { ...baseCall, callId: "call-b", inputTotalTokens: 15, cacheReadTokens: null, cacheWriteTokens: null },
    ])).usage;
    adapterPartialOut = (await runAdapterPlan([{ ...baseCall, cacheWriteTokens: null }])).usage;
    adapterInvalidOut = await runAdapterPlan([{ ...baseCall, inputTokens: -1 }]);
    adapterMultiCurrencyOut = (await runAdapterPlan(
      [
        { ...baseCall, cost: { amount: "0", currency: "USD", source: { kind: "reported", id: "invoice" } } },
        { ...baseCall, callId: "call-b", cost: { amount: "0.25", currency: "EUR", source: { kind: "reported", id: "invoice" } } },
        { ...baseCall, callId: "call-c" },
      ],
      true,
    )).usage;
  }, 30_000);

  afterAll(async () => {
    await project?.dispose();
  });

  // @feature docs/feature/adapters/README.md#usage-and-cost-projection
  test("aggregates independent totals or exclusive buckets without double-counting reasoning and marks gaps as lower-bound", () => {
    expect(agentOut.twoTurnUsage.inputTotalTokens).toMatchObject({ state: "exact", value: 30 });
    expect(agentOut.twoTurnUsage.totalTokens).toMatchObject({ state: "exact", value: 40 });
    expect(adapterBucketsOut.inputTotalTokens).toMatchObject({ state: "exact", value: 30 });
    expect(adapterBucketsOut.totalTokens).toMatchObject({ state: "exact", value: 40 });

    expect(agentOut.pendingSessionUsage.costs.totalContributions).toBe(1);
    expect(agentOut.pendingSessionUsage.costs.state).toBe("unavailable");
    expect(agentOut.costAndPendingUsage.costs).toMatchObject({
      state: "partial",
      totalContributions: 2,
      values: [{ value: "0", coveredContributions: 1, reportedContributions: 1 }],
    });
    expect(agentOut.partialSessionUsage.inputTokens).toMatchObject({ state: "lower-bound", value: 2 });
    expect(agentOut.partialSessionUsage.totalTokens).toMatchObject({ state: "lower-bound", value: 3 });

    expect(adapterPartialOut.inputTotalTokens).toMatchObject({ state: "lower-bound", value: 13 });
    expect(adapterPartialOut.totalTokens).toMatchObject({ state: "lower-bound", value: 18 });
  });

  // @feature docs/feature/adapters/README.md#usage-and-cost-projection
  test("distinguishes observed zero from absence and rejects negative or overflowing token counts", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          { key: "emptyUsage", metric: "totalTokens", expected: { state: "unavailable" } },
          { key: "emptyObjUsage", metric: "inputTokens", expected: { state: "unavailable" } },
          { key: "zeroUsage", metric: "inputTokens", expected: { state: "exact", value: 0 } },
          { key: "negativeUsage", metric: "inputTokens", expected: { state: "unavailable", reason: "usage-invalid-token-value" } },
          // Regression counterexample: summed tokens > Number.MAX_SAFE_INTEGER must stay unavailable without failing attempt-cost publication.
          { key: "overflowUsage", metric: "inputTokens", expected: { state: "unavailable", reason: "usage-exceeds-safe-integer" } },
        ),
        (sample) => {
          expect(agentOut[sample.key][sample.metric]).toMatchObject(sample.expected);
        },
      ),
      { numRuns: 5 },
    );
    expect(adapterInvalidOut.rejections).toEqual([
      { threw: true, message: "Invalid Adapter usage snapshot" },
    ]);
    expect(adapterInvalidOut.usage.inputTotalTokens).toMatchObject({ state: "unavailable", reason: "usage-not-recorded" });
  });

  // @feature docs/feature/adapters/README.md#usage-and-cost-projection
  test("computes exact decimal sums, reported-zero priority, wildcard pricing, multi-currency totals, and frozen snapshots", () => {
    expect(agentOut.costUsage.costs).toEqual({
      state: "complete",
      totalContributions: 4,
      values: [
        {
          currency: "USD",
          value: "0.3000001",
          source: "reported",
          coveredContributions: 4,
          reportedContributions: 4,
          estimatedContributions: 0,
        },
      ],
    });
    expect(agentOut.wildUsage.costs).toMatchObject({
      state: "complete",
      values: [{ value: "0.0000018", coveredContributions: 1, estimatedContributions: 1 }],
    });
    expect(wildcardOut.wildUsage.costs.values[0]?.value).toBe("0.0012");
    expect(agentOut.missingBucketUsage.costs).toMatchObject({
      state: "partial",
      values: [{ value: "0.0000017", coveredContributions: 0 }],
    });
    expect(agentOut.partialCostUsage.costs).toMatchObject({
      state: "partial",
      totalContributions: 1,
      values: [{ value: "0", coveredContributions: 0, reportedContributions: 1 }],
    });

    expect(adapterMultiCurrencyOut.costs).toEqual({
      state: "complete",
      totalContributions: 3,
      values: [
        {
          currency: "EUR",
          value: "0.25",
          source: "reported",
          coveredContributions: 1,
          reportedContributions: 1,
          estimatedContributions: 0,
        },
        {
          currency: "USD",
          value: "0.000037",
          source: "mixed",
          coveredContributions: 2,
          reportedContributions: 1,
          estimatedContributions: 1,
        },
      ],
    });

    for (const flag of Object.values(agentOut.frozen)) {
      expect(flag).toBe(true);
    }
  });
});
