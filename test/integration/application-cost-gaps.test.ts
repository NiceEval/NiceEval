import { rm } from "node:fs/promises";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { selectInspectionOperation, withOperational } from "./fixtures/adapter-trace-usage-harness/harness.ts";
import {
  createJudgeProject,
  invokeCli,
  narrowInspectionSuccess,
  planAndRunExperiment,
  showJsonDocuments,
} from "./fixtures/judge-harness/harness.ts";

const cases = [
  { id: "request-only", actions: 'await t.send("request-only");', gap: "observed-usage-cost-incomplete" },
  {
    id: "token-and-cost",
    actions: 'await t.send("token-and-cost");',
    gap: "observed-usage-cost-incomplete",
    cost: "0.125",
  },
  { id: "no-observations", actions: 'await t.send("no-observations");', gap: "usage-not-recorded" },
  { id: "empty-ledger", actions: "", gap: null },
];
const locators = new Map<string, string>();
let cwd: string;

beforeAll(async () => {
  cwd = await createJudgeProject("niceeval-application-cost-gaps-", {
    agent: `
      import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
      export default defineAgent({ name: "cost-gap-agent", evidenceCoverage: completeEvidenceCoverage,
        async send({ text }) {
          const usage = text === "request-only" ? { requests: 1 }
            : text === "token-and-cost" ? { cacheReadTokens: 0, costUSD: 0.125 }
            : undefined;
          return { status: "completed", events: [], usage };
        },
      });`,
    extra: {
      "offline.ts": `import { defineAdapter } from "niceeval";
        export default defineAdapter({ name: "offline", behaviorRevision: "1", create(ctx) {
          ctx.sealUsage({ state: "complete" });
          return {};
        } });`,
    },
    evals: {
      ...Object.fromEntries(
        cases
          .filter(({ gap }) => gap !== null)
          .map(({ id, actions }) => [
            `${id}.eval.ts`,
            `
        import { defineEval } from "niceeval";
        import { equals } from "niceeval/expect";
        export default defineEval({ async test(t) { ${actions} t.check(true, equals(true)); } });
      `,
          ]),
      ),
      "empty-ledger.eval.ts": `import adapter from "../offline.ts";
        import { equals } from "niceeval/expect";
        export default adapter.defineEval({ test(t) { t.check(true, equals(true)); } });`,
    },
    experiments: {
      "agents.ts": `import { defineExperiment } from "niceeval";
        import adapter from "../agent.ts";
        export default defineExperiment({ adapter, evals: ["request-only", "token-and-cost", "no-observations"] });`,
      "offline.ts": `import { defineExperiment } from "niceeval";
        import adapter from "../offline.ts";
        export default defineExperiment({ adapter, evals: ["empty-ledger"] });`,
    },
  });
  for (const id of ["agents", "offline"]) {
    const run = await planAndRunExperiment(cwd, id);
    for (const slot of run.run?.slots ?? []) {
      if (slot.publication.state === "published") locators.set(slot.evalId, slot.publication.attemptLocator);
    }
  }
  expect([...locators.keys()].sort()).toEqual(cases.map(({ id }) => id).sort());
});

afterAll(async () => {
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
test("application cost gaps distinguish observed usage, no observation, and a proven empty ledger", async () => {
  await withOperational(cwd, (facts) => {
    fc.assert(
      fc.property(fc.constantFrom(...cases), ({ id, gap, cost }) => {
        const locator = locators.get(id)!;
        const { totalCosts, modelGroups } = selectInspectionOperation(facts, { kind: "attempt.usage", locator }).usage;
        expect(totalCosts.gaps.filter(({ source }) => source === "application").map(({ reason }) => reason)).toEqual(
          gap === null ? [] : [gap],
        );
        expect(totalCosts).toMatchObject({
          state: gap === null ? "complete" : cost === undefined ? "unavailable" : "partial",
          values: cost === undefined ? [] : [{ currency: "USD", value: cost, source: "reported" }],
        });
        expect(modelGroups.basis).toBe(gap === null ? "recorded-calls" : "reported-sends");
      }),
      { numRuns: cases.length, examples: cases.map((sample) => [sample]) },
    );
  });
});

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
test("experiment cost coverage keeps observed usage gaps and provider subtotals", async () => {
  const [agentsDoc] = await showJsonDocuments(cwd, ["exp:agents"]);
  const agents = narrowInspectionSuccess(agentsDoc!, "experiment.get");
  if (!agents.success) throw new Error(agents.reason);
  expect(agents.value.experiment.costSummary).toMatchObject({
    totalCosts: {
      state: "partial",
      values: [{ currency: "USD", value: "0.125", source: "reported" }],
      gaps: [
        { source: "application", reason: "observed-usage-cost-incomplete" },
        { source: "application", reason: "usage-not-recorded" },
      ],
    },
    coverage: { completeAttemptCount: 0, partialAttemptCount: 1, unavailableAttemptCount: 2 },
  });
  const [offlineDoc] = await showJsonDocuments(cwd, ["exp:offline"]);
  const offline = narrowInspectionSuccess(offlineDoc!, "experiment.get");
  if (!offline.success) throw new Error(offline.reason);
  expect(offline.value.experiment.costSummary).toMatchObject({
    totalCosts: { state: "complete", values: [], missingSources: [], gaps: [] },
    coverage: { completeAttemptCount: 1 },
  });
  const output = await invokeCli(cwd, ["show", locators.get("token-and-cost")!, "usage"]);
  expect(output.code).toBe(0);
  expect(output.stdout).toContain("Application usage observed");
  expect(output.stdout).toContain("0.125");
});
