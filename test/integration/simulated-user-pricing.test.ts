import { rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createJudgeProject,
  narrowInspectionSuccess,
  OpenRouterProvider,
  planAndRunExperiment,
  readPaginatedTrace,
  showJsonDocuments,
  startHttpServer,
} from "./fixtures/judge-harness/harness.ts";
import { respondStream } from "./fixtures/simulated-user-harness/harness.ts";
import { decodeSimulatedUserActivity } from "niceeval/inspection";

const cases = [
  { id: "builtin", model: "gpt-6.2-sol", configured: false, cost: 0.000092, source: "builtin-catalog" },
  { id: "configured", model: "openai/gpt-6.2-sol", configured: true, cost: 0.000195, source: "configured-profile" },
  { id: "reported", model: "azure/gpt-6.2-sol", configured: true, cost: 0, source: "reported" },
  { id: "unknown", model: "fixture/simulated-user-pricing-unknown", configured: false, cost: null, source: undefined },
] as const;
let cwd: string;
let server: Awaited<ReturnType<typeof startHttpServer>>;
const locators = new Map<string, string>();

beforeAll(async () => {
  server = await startHttpServer((_request, body, response) => {
    const payload = JSON.parse(body);
    respondStream(response, payload, {
      id: "simulated-user-pricing",
      toolArguments: { message: "Approved." },
      ...(payload.model === "azure/gpt-6.2-sol" ? { reportedCost: 0 } : {}),
    });
  });
  cwd = await createJudgeProject("niceeval-simulated-user-pricing-", {
    agent: `
      import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
      export default defineAgent({ name: "simulated-user-pricing", evidenceCoverage: completeEvidenceCoverage,
        async send() {
          return { status: "completed", events: [{ type: "message", role: "assistant", text: "Confirm?" }] };
        },
      });`,
    evals: Object.fromEntries(
      cases.map(({ id, model }) => [
        `${id}.eval.ts`,
        `
      import { defineEval, defineSimulatedUser } from "niceeval";
      export default defineEval({ judge: ${JSON.stringify(model)}, async test(t) {
        const turn = await t.send("Begin");
        await t.simulatedUser(defineSimulatedUser({ instructions: "Confirm." })).reply(turn);
      } });
    `,
      ]),
    ),
    experiments: {
      "pricing.ts": `import { defineExperiment } from "niceeval";
        import adapter from "../agent.ts";
        export default defineExperiment({ adapter, evals: "*" });`,
    },
  });
  const run = await planAndRunExperiment(cwd, "pricing", {
    config: {
      maxConcurrency: 2,
      judgeProvider: OpenRouterProvider({ model: "gpt-6.2-sol", apiKey: "fixture", baseUrl: server.baseUrl }),
      pricing: Object.fromEntries(
        cases
          .filter(({ configured }) => configured)
          .map(({ model }) => [model, { inputPerMTok: 5, outputPerMTok: 20 }]),
      ),
    },
  });
  for (const slot of run.run?.slots ?? []) {
    if (slot.publication.state === "published") locators.set(slot.evalId, slot.publication.attemptLocator);
  }
  expect([...locators.keys()].sort()).toEqual(cases.map(({ id }) => id).sort());
});

afterAll(async () => {
  await server?.close();
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

// @feature docs/feature/eval/README.md#simulated-user-pricing
test.each(cases)("simulated user seals $id cost in its own activity", async ({ id, cost, source }) => {
  const locator = locators.get(id)!;
  const [traceDoc] = await showJsonDocuments(cwd, [locator, "execution"]);
  const trace = narrowInspectionSuccess(traceDoc!, "attempt.trace");
  if (!trace.success) throw new Error(trace.reason);
  const event = trace.value.trace.execution.events.find((event) => event.source.id === "niceeval.simulated-user");
  const artifact = event?.evidence?.[0];
  if (artifact === undefined) throw new Error("Missing simulated-user audit artifact");
  const bytes = (await readPaginatedTrace(cwd, locator, artifact.evidenceId)).bytes;
  const activity = decodeSimulatedUserActivity(JSON.parse(bytes.toString("utf8")));
  expect(activity.generations).toHaveLength(1);
  expect(activity.generations[0]?.costUSD).toBe(cost);
  expect(activity.generations[0]?.priceSource?.kind).toBe(source);
  if (source === "builtin-catalog")
    expect(activity.generations[0]?.priceSource).toMatchObject({
      id: "models.dev",
      selector: "gpt-6.2-sol",
      asOf: expect.any(Number),
    });
  const [usageDoc] = await showJsonDocuments(cwd, [locator, "usage"]);
  const usage = narrowInspectionSuccess(usageDoc!, "attempt.usage");
  if (!usage.success) throw new Error(usage.reason);
  const summary = usage.value.usage.totalCosts.simulatedUser;
  expect(summary).toMatchObject({ calls: 1, amountUSD: cost });
  expect(summary?.builtinCatalogCalls).toBe(source === "builtin-catalog" ? 1 : undefined);
  if (source === "reported") expect(summary?.costBasis).toBe("reported");
});
