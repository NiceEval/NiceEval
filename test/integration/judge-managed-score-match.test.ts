import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  OpenAIProvider,
  chatToolResponse,
  createJudgeProject,
  narrowInspectionSuccess,
  planAndRunExperiment,
  readAssertionDetail,
  readAssertionsList,
  readFullAssertionEntry,
  showJsonDocuments,
  startHttpServer,
  startJudgeEmulator,
  startModelEmulator,
} from "./fixtures/judge-harness/harness.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { defineJudge, defineScoreMatch } =
  require("niceeval/expect") as typeof import("../../packages/niceeval/src/expect/index.ts");

describe("Managed ScoreMatch definitions and lifecycle boundaries", () => {
  let emulator: Awaited<ReturnType<typeof startModelEmulator>>;
  let retryDateEmulator: Awaited<ReturnType<typeof startJudgeEmulator<{ retryDateCalls: number }>>>;
  let cancelServer: Awaited<ReturnType<typeof startHttpServer>>;
  let cwd = "";
  let canonicalLocator = "";
  let invalidResponseLocator = "";
  let timeoutLocator = "";
  let retryAfterDateLocator = "";
  let preCancelledLocator = "";
  let budgetCatchLocator = "";
  let pendingCallLocator = "";
  let interruptedStepLocator = "";

  beforeAll(async () => {
    emulator = await startModelEmulator([
      {
        id: "canonical",
        match: { model: "canonical-model", tool: "record_score_match" },
        reply: [{ type: "tool_call", name: "record_score_match", arguments: { measurement: 0.75, rationale: "sound" } }],
      },
      {
        id: "extra-field",
        match: { model: "extra-field-model", tool: "record_score_match" },
        reply: [
          {
            type: "tool_call",
            name: "record_score_match",
            arguments: { measurement: 1, rationale: "correct", hiddenReasoning: "private" },
          },
        ],
      },
      {
        id: "budget",
        match: { model: "budget-model", tool: "record_score_match" },
        reply: [{ type: "tool_call", name: "record_score_match", arguments: { measurement: 0.75, rationale: "first call" } }],
      },
    ]);

    retryDateEmulator = await startJudgeEmulator(
      "judge-retry-date",
      () => ({ retryDateCalls: 0 }),
      ({ app, state }) => {
        app.post("/v1/chat/completions", async (c) => {
          const payload = await c.req.json<{ model: string; tool_choice?: { function?: { name?: string } } }>();
          const toolName = payload.tool_choice?.function?.name ?? "record_score_match";
          state.retryDateCalls += 1;
          if (state.retryDateCalls === 1) {
            return Response.json(
              { error: { message: "busy", type: "server_error" } },
              { status: 503, headers: { "Retry-After": new Date(Date.now() + 80).toUTCString() } },
            );
          }
          return new Response(chatToolResponse(toolName, { measurement: 0.75, rationale: "recovered" }, payload.model), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        });
      },
    );

    cancelServer = await startHttpServer(() => {
      // Raw hanging connections for timeout & in-flight cancellation checks
    });

    cwd = await createJudgeProject("niceeval-managed-score-match-", {
      config: `
        import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({
          judgeProvider: OpenAIProvider({ model: "canonical-model", baseUrl: ${JSON.stringify(emulator.baseUrl)}, apiKey: "k" }),
        });
      `,
      agent: `
        import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
        export default defineAgent({
          name: "managed-agent",
          evidenceCoverage: completeEvidenceCoverage,
          send: async () => ({ status: "completed", events: [] }),
        });
      `,
      evals: {
        "canonical.eval.ts": `
          import { Effect } from "effect";
          import { defineScoreEval } from "niceeval";
          import { defineScoreMatch } from "niceeval/expect";
          export default defineScoreEval({
            judge: "canonical-model",
            async test(t) {
              const config = { weights: { correctness: 1 }, labels: ["yes", "no"] };
              const match = defineScoreMatch({
                name: "quality",
                version: "1",
                config,
                llm: {},
                score: (material, ctx) =>
                  ctx.llm.score({
                    rubric: "Check",
                    anchors: [{ measurement: 0, description: "no" }, { measurement: 1, description: "yes" }],
                    material,
                  }).pipe(Effect.map((r) => ({ state: "measured", ...r }))),
              });
              config.weights.correctness = 0;
              config.labels.push("maybe");
              t.check({ answer: "ok" }, match).score(4).label("canonical");
            },
          });
        `,
        "extra-field.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineJudge } from "niceeval/expect";
          export default defineScoreEval({
            judge: "extra-field-model",
            test(t) {
              t.judge({ q: "q" }, defineJudge({ rubric: "Check" })).score(1).label("extra-field");
            },
          });
        `,
        "timeout.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineJudge } from "niceeval/expect";
          import { OpenAIProvider } from "niceeval/judge";
          export default defineScoreEval({
            judge: OpenAIProvider({ model: "timeout-model", baseUrl: ${JSON.stringify(cancelServer.baseUrl)}, apiKey: "k", timeoutMs: 80 }),
            test(t) {
              t.judge({ q: "q" }, defineJudge({ rubric: "Check" })).score(1).label("timeout");
            },
          });
        `,
        "retry-date.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineJudge } from "niceeval/expect";
          import { OpenAIProvider } from "niceeval/judge";
          export default defineScoreEval({
            judge: OpenAIProvider({ model: "retry-date-model", baseUrl: ${JSON.stringify(retryDateEmulator.baseUrl)}, apiKey: "k" }),
            test(t) {
              t.judge({ q: "q" }, defineJudge({ rubric: "Check" })).score(4).label("retry-date");
            },
          });
        `,
        "budget-catch.eval.ts": `
          import { Effect } from "effect";
          import { defineScoreEval } from "niceeval";
          import { defineScoreMatch } from "niceeval/expect";
          export default defineScoreEval({
            judge: "budget-model",
            test(t) {
              const match = defineScoreMatch({
                name: "bounded",
                version: "1",
                config: {},
                llm: { maxCalls: 1 },
                score: (_value, context) =>
                  Effect.gen(function* () {
                    const step = {
                      rubric: "quality",
                      anchors: [{ measurement: 0, description: "no" }, { measurement: 1, description: "yes" }],
                      material: null,
                    };
                    yield* context.llm.score(step);
                    return yield* context.llm.score(step).pipe(
                      Effect.as(1),
                      Effect.catch(() => Effect.succeed(1)),
                    );
                  }),
              });
              t.check(null, match).score(1).label("budget-catch");
            },
          });
        `,
        "pending-call.eval.ts": `
          import { writeFile } from "node:fs/promises";
          import { resolve } from "node:path";
          import { Effect, Exit } from "effect";
          import { defineScoreEval } from "niceeval";
          import { defineScoreMatch } from "niceeval/expect";
          import { OpenAIProvider } from "niceeval/judge";
          export default defineScoreEval({
            judge: OpenAIProvider({ model: "pending-model", baseUrl: ${JSON.stringify(cancelServer.baseUrl)}, apiKey: "k" }),
            async test(t) {
              let escaped;
              const match = defineScoreMatch({
                name: "pending",
                version: "1",
                config: {},
                llm: {},
                score: (_value, context) =>
                  Effect.gen(function* () {
                    escaped = context;
                    yield* Effect.forkChild(
                      context.llm.classify({ rubric: "quality", choices: ["yes", "no"], material: null }),
                    );
                    yield* Effect.sleep("40 millis");
                    return 1;
                  }),
              });
              t.check(null, match).label("pending-call");
              t.onCleanup(async () => {
                const lateExit = await Effect.runPromiseExit(
                  escaped.llm.classify({ rubric: "late", choices: ["yes", "no"], material: null }),
                );
                await writeFile(
                  resolve(import.meta.dirname, "..", "escaped-exit.json"),
                  JSON.stringify({ failed: Exit.isFailure(lateExit) }),
                );
              });
            },
          });
        `,
        "interrupted-step.eval.ts": `
          import { Effect, Fiber } from "effect";
          import { defineScoreEval } from "niceeval";
          import { defineScoreMatch } from "niceeval/expect";
          import { OpenAIProvider } from "niceeval/judge";
          export default defineScoreEval({
            judge: OpenAIProvider({ model: "interrupt-model", baseUrl: ${JSON.stringify(cancelServer.baseUrl)}, apiKey: "k" }),
            test(t) {
              const match = defineScoreMatch({
                name: "interrupted-step",
                version: "1",
                config: {},
                llm: {},
                score: (_value, context) =>
                  Effect.gen(function* () {
                    const step = yield* Effect.forkChild(
                      context.llm.classify({ rubric: "quality", choices: ["yes", "no"], material: null }),
                    );
                    yield* Effect.sleep("30 millis");
                    yield* Fiber.interrupt(step);
                    return 1;
                  }),
              });
              t.check(null, match).score(1).label("interrupted-step");
            },
          });
        `,
      },
      experiments: {
        "canonical.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({ adapter: agent, evals: ["canonical"], attempts: 1 });`,
        "extra-field.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({ adapter: agent, evals: ["extra-field"], attempts: 1 });`,
        "timeout.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({ adapter: agent, evals: ["timeout"], attempts: 1 });`,
        "retry-date.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({ adapter: agent, evals: ["retry-date"], attempts: 1 });`,
        "budget-catch.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({ adapter: agent, evals: ["budget-catch"], attempts: 1 });`,
        "pending-call.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({ adapter: agent, evals: ["pending-call"], attempts: 1 });`,
        "interrupted-step.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({ adapter: agent, evals: ["interrupted-step"], attempts: 1 });`,
      },
    });

    const baseConfig = {
      judgeProvider: OpenAIProvider({ model: "canonical-model", baseUrl: emulator.baseUrl, apiKey: "k" }),
    };
    const runOne = async (selector: string) => {
      const res = await planAndRunExperiment(cwd, selector, { config: baseConfig, rerun: "all" });
      const slot = res.run?.slots[0];
      if (slot?.publication.state !== "published") throw new Error(`Missing slot for ${selector}`);
      return slot.publication.attemptLocator;
    };

    [
      canonicalLocator,
      invalidResponseLocator,
      timeoutLocator,
      retryAfterDateLocator,
      budgetCatchLocator,
      pendingCallLocator,
      interruptedStepLocator,
    ] = await Promise.all([
      runOne("canonical"),
      runOne("extra-field"),
      runOne("timeout"),
      runOne("retry-date"),
      runOne("budget-catch"),
      runOne("pending-call"),
      runOne("interrupted-step"),
    ]);

    const preCancelled = new AbortController();
    preCancelled.abort();
    const cancelledRes = await planAndRunExperiment(cwd, "canonical", {
      config: baseConfig,
      rerun: "all",
      signal: preCancelled.signal,
    });
    const cancelledSlot = cancelledRes.run?.slots[0];
    if (cancelledSlot?.publication.state === "published") {
      preCancelledLocator = cancelledSlot.publication.attemptLocator;
    }
  }, 30_000);

  afterAll(async () => {
    await Promise.all([emulator?.close(), retryDateEmulator?.close(), cancelServer?.close()]);
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/judge/README.md#material-admission
  test("defineScoreMatch and defineJudge reject invalid options, accessors, and custom anchor properties", () => {
    fc.assert(
      fc.property(fc.integer({ min: -64, max: 0 }), fc.integer({ min: -64, max: 0 }), (badCalls, badBytes) => {
        expect(() =>
          defineScoreMatch({ name: "x", version: "1", config: {}, llm: { maxCalls: badCalls }, score: () => Effect.succeed(1) }),
        ).toThrow("positive safe integer");
        expect(() => defineScoreMatch({ name: "x", score: () => 1, extra: true } as never)).toThrow("unknown option");
        const cfgAccessor = Object.defineProperty({}, "value", { enumerable: true, get: () => 1 });
        expect(() =>
          defineScoreMatch({ name: "x", version: "1", config: cfgAccessor, llm: {}, score: () => Effect.succeed(1) }),
        ).toThrow("data property");

        expect(() => defineJudge({ rubric: "r", extra: true } as never)).toThrow("unknown option");
        expect(() => defineJudge(Object.defineProperty({ rubric: "r" }, "anchors", { get: () => [] }) as never)).toThrow(
          "data property",
        );

        let customMapCalled = false;
        const customAnchors = [
          { measurement: 0, description: "no" },
          { measurement: 1, description: "yes" },
        ];
        Object.defineProperty(customAnchors, "map", {
          value: () => {
            customMapCalled = true;
            return [];
          },
        });
        expect(() => defineJudge({ rubric: "r", anchors: customAnchors })).toThrow("custom properties");
        expect(customMapCalled).toBe(false);

        const accessorAnchors = [
          { measurement: 0, description: "no" },
          { measurement: 1, description: "yes" },
        ];
        Object.defineProperty(accessorAnchors, "0", { get: () => ({ measurement: 0, description: "no" }) });
        expect(() => defineJudge({ rubric: "r", anchors: accessorAnchors })).toThrow("data property");
        expect(() => defineJudge({ rubric: "r", maxMaterialBytes: badBytes })).toThrow("positive safe integer");
      }),
      { numRuns: 20 },
    );
  });

  // @feature docs/feature/judge/README.md#score-audit
  test("defineScoreMatch seals canonical sorted config and default call limits isolated from later mutations", async () => {
    const entries = await readAssertionsList(cwd, canonicalLocator);
    const { entry } = await readFullAssertionEntry(cwd, canonicalLocator, entries[0]!.entryId);
    if (entry.scoreMatchAudit?.state !== "available") throw new Error("Expected scoreMatchAudit");
    expect(entry.scoreMatchAudit.audit.definition.limits).toMatchObject({ maxCalls: 4 });
    expect(JSON.parse(entry.scoreMatchAudit.audit.definition.config)).toMatchObject({
      definition: { labels: ["yes", "no"], weights: { correctness: 1 } },
    });
  });

  // @feature docs/feature/judge/README.md#failures-and-cancellation
  test("extra protocol fields, request timeout, and pre-cancellation produce diagnosable states", async () => {
    const extraEntries = await readAssertionsList(cwd, invalidResponseLocator);
    expect(extraEntries[0]?.entry.decision).toMatchObject({ result: "errored" });
    const extraDetail = await readAssertionDetail(cwd, invalidResponseLocator, extraEntries[0]!.entryId);
    expect(JSON.stringify(extraDetail)).toContain("score-match-invalid-response");

    const timeoutEntries = await readAssertionsList(cwd, timeoutLocator);
    expect(timeoutEntries[0]?.entry.decision).toMatchObject({ result: "unavailable", reason: "source-unavailable" });
    const timeoutDetail = await readAssertionDetail(cwd, timeoutLocator, timeoutEntries[0]!.entryId);
    expect(JSON.stringify(timeoutDetail)).toContain("judge-call-failed");

    expect(preCancelledLocator).toBe("");
  });

  // @feature docs/feature/judge/README.md#precheck-and-retry
  test("HTTP-date Retry-After header gates retry and settles when recovered", async () => {
    const entries = await readAssertionsList(cwd, retryAfterDateLocator);
    expect(entries[0]?.entry.decision.result).toBe("matched");
    expect(entries[0]?.entry.contribution).toEqual({ state: "earned", points: 4, earned: 3 });
  });

  // @feature docs/feature/judge/README.md#failures-and-cancellation
  test("managed ScoreMatch call-budget exhaustion, pending forked calls, and interrupted steps stay sealed and cannot be bypassed", async () => {
    const budgetEntries = await readAssertionsList(cwd, budgetCatchLocator);
    const allCalls = await emulator.calls();
    expect(allCalls.filter((c) => JSON.stringify(c).includes("first call"))).toHaveLength(1);
    expect(budgetEntries[0]?.entry.decision.result).toBe("unavailable");
    const { entry: budgetFull } = await readFullAssertionEntry(cwd, budgetCatchLocator, budgetEntries[0]!.entryId);
    if (budgetFull.scoreMatchAudit?.state !== "available") throw new Error("Expected budget audit");
    expect(budgetFull.scoreMatchAudit.audit.calls).toHaveLength(2);
    expect(budgetFull.scoreMatchAudit.audit.calls[1]).toMatchObject({
      state: "rejected",
      transport: "not-sent",
      failure: { code: "score-match-call-budget" },
    });

    const pendingEntries = await readAssertionsList(cwd, pendingCallLocator);
    expect(pendingEntries.map((e) => [e.display.label, e.entry.decision.result])).toEqual([
      ["pending-call", "errored"],
    ]);
    const [usageDoc] = await showJsonDocuments(cwd, [pendingCallLocator, "usage"]);
    const usage = narrowInspectionSuccess(usageDoc!, "attempt.usage");
    if (!usage.success || usage.value.usage.judgeUsage.state !== "complete") throw new Error("Expected judgeUsage");
    expect(usage.value.usage.judgeUsage.calls).toHaveLength(1);
    expect(usage.value.usage.judgeUsage.calls[0]?.status).toBe("cancelled");
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const escapedState = JSON.parse(await readFile(join(cwd, "escaped-exit.json"), "utf8")) as { failed: boolean };
    expect(escapedState.failed).toBe(true);
    const pendingDetail = await readAssertionDetail(cwd, pendingCallLocator, pendingEntries[0]!.entryId);
    expect(JSON.stringify(pendingDetail)).toContain("score-match-pending-call");

    const interruptedEntries = await readAssertionsList(cwd, interruptedStepLocator);
    expect(interruptedEntries[0]?.entry.decision.result).toBe("unavailable");
    const interruptedDetail = await readAssertionDetail(cwd, interruptedStepLocator, interruptedEntries[0]!.entryId);
    expect(JSON.stringify(interruptedDetail)).toContain("score-match-incomplete-step");
  });
});
