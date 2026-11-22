import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import {
  createFixtureProject,
  Effect,
  readJson,
  selectInspectionOperation,
  withOperational,
  writeJson,
  type FixtureProject,
} from "./fixtures/adapter-trace-usage-harness/harness.ts";

const ADAPTER = `
import { defineAdapter } from "niceeval";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const projectFile = (name) => resolve(import.meta.dirname, "..", name);

export const usageAdapter = defineAdapter({
  name: "usage-accounting",
  behaviorRevision: "1",
  create(ctx) {
    return {
      async play(sampleId) {
        const plan = JSON.parse(await readFile(projectFile(sampleId + "-plan.json"), "utf8"));
        for (const call of plan.calls) {
          const snapshot = { provider: null, model: null, inputTokens: null, outputTokens: null };
          for (const [key, value] of Object.entries(call)) if (value !== null || key === "modelRole") snapshot[key] = value;
          ctx.recordUsage({ ...snapshot, provider: call.provider, model: call.model });
        }
        const rejections = [];
        for (const reason of plan.invalidReasons) {
          try {
            ctx.sealUsage({ state: "partial", reason });
            rejections.push({ threw: false });
          } catch (error) {
            rejections.push({ threw: true, message: error instanceof Error ? error.message : String(error) });
          }
        }
        if (plan.seal === "complete") ctx.sealUsage({ state: "complete" });
        else if (plan.seal !== "none") ctx.sealUsage({ state: "partial", reason: plan.seal.reason });
        await writeFile(projectFile(sampleId + "-rejections.json"), JSON.stringify(rejections));
        return true;
      },
      async libraryReport(t, sampleId) {
        await writeFile(projectFile(sampleId + "-library.json"), JSON.stringify({
          total: t.usage.cacheRead.total, roles: t.usage.cacheRead.roles, models: t.usage.cacheRead.models,
        }));
      },
    };
  },
});
`;

const PROPERTY_RUNS = Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 1);
const explorationRuns = Math.max(0, PROPERTY_RUNS - 2);

// --- Generators --------------------------------------------------------------------------------

type Status = "succeeded" | "failed" | "cancelled" | "unknown";
interface CallPlan {
  callId: string;
  modelRole: string | null;
  provider: string | null;
  model: string | null;
  status: Status;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  inputTotalTokens: number | null;
}

const HUGE = 4_000_000_000_000_000; // two calls stay safe, three overflow Number.MAX_SAFE_INTEGER when summed

const tokenTriple = fc.oneof(
  { weight: 8, arbitrary: fc.tuple(fc.nat(1000), fc.nat(1000), fc.nat(1000)) },
  { weight: 1, arbitrary: fc.tuple(fc.constant(HUGE), fc.nat(5), fc.nat(5)) },
  { weight: 1, arbitrary: fc.constant<[number, number, number]>([0, 0, 0]) },
);

/** One physical call whose known counters are mutually consistent; unknown counters are `null`, never zero. */
const callBody = fc
  .record({
    triple: tokenTriple,
    known: fc.record({ input: fc.boolean(), read: fc.boolean(), write: fc.boolean(), total: fc.boolean() }),
    modelRole: fc.constantFrom<string | null>("planner", "reviewer", null),
    identity: fc.constantFrom<[string | null, string | null]>(
      ["offline", "primary"],
      ["offline", "fallback"],
      [null, "fallback"],
      [null, null],
    ),
    status: fc.constantFrom<Status>("succeeded", "failed", "cancelled", "unknown"),
  })
  .map(({ triple: [input, read, write], known, modelRole, identity, status }): Omit<CallPlan, "callId"> => {
    const total = input + read + write;
    return {
      modelRole,
      provider: identity[0],
      model: identity[1],
      status,
      inputTokens: known.input ? input : null,
      cacheReadTokens: known.read ? read : null,
      cacheWriteTokens: known.write ? write : null,
      inputTotalTokens: known.total ? total : null,
    };
  });

const callList = fc
  .array(callBody, { minLength: 0, maxLength: 6 })
  .map((bodies) => bodies.map((body, index): CallPlan => ({ callId: `call-${index}`, ...body })));

const sealPlan = fc.oneof(
  fc.constant<"complete" | "none">("complete"),
  fc.constant<"complete" | "none">("none"),
  fc.constantFrom("source-incomplete", "ai-event-stream-incomplete", "a", "A.b_c:d-e").map((reason) => ({ reason })),
);

// --- Independent oracle for the documented rate formula ----------------------------------------

type Rate = { state: "exact"; value: number } | { state: "unavailable"; reason: string };

function callTotal(call: CallPlan): number | null {
  if (call.inputTotalTokens !== null) return call.inputTotalTokens;
  if (call.inputTokens !== null && call.cacheReadTokens !== null && call.cacheWriteTokens !== null) {
    return call.inputTokens + call.cacheReadTokens + call.cacheWriteTokens;
  }
  return null;
}

function expectedRate(calls: readonly CallPlan[], collectionComplete: boolean): Rate {
  if (!collectionComplete) return { state: "unavailable", reason: "collection-incomplete" };
  if (calls.some((call) => call.status === "unknown")) return { state: "unavailable", reason: "call-status-unknown" };
  if (calls.length === 0) return { state: "unavailable", reason: "no-calls" };
  if (calls.some((call) => call.cacheReadTokens === null)) return { state: "unavailable", reason: "cache-read-missing" };
  if (calls.some((call) => callTotal(call) === null)) return { state: "unavailable", reason: "input-total-missing" };
  const total = calls.reduce((sum, call) => sum + callTotal(call)!, 0);
  const read = calls.reduce((sum, call) => sum + call.cacheReadTokens!, 0);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(read)) return { state: "unavailable", reason: "unsafe-token-total" };
  if (total === 0) return { state: "unavailable", reason: "zero-input-total" };
  return { state: "exact", value: read / total };
}

const PINNED_CALLS: CallPlan[] = [
  { callId: "call-0", modelRole: "planner", provider: "offline", model: "primary", status: "failed", inputTokens: 0, cacheReadTokens: 900, cacheWriteTokens: 100, inputTotalTokens: 1000 },
  { callId: "call-1", modelRole: "reviewer", provider: null, model: "fallback", status: "succeeded", inputTokens: 90, cacheReadTokens: 10, cacheWriteTokens: 0, inputTotalTokens: 100 },
];

const PINNED_INVALID_REASONS = ["AI event stream incomplete", "", "a".repeat(129)];

const invalidReason = fc.oneof(
  fc.constant(""),
  fc.constant(" "),
  fc.constant("AI event stream incomplete"),
  fc.constantFrom(".leading-dot", "_underscore", "-dash", ":colon"),
  fc.constantFrom("路径", "reason-界", "tab\there", "new\nline"),
  fc.nat(20).map((extra) => "a".repeat(129 + extra)),
);

const ratioSamples = [
  { id: "ratio-regression", calls: PINNED_CALLS, seal: "complete" as const, invalidReasons: [] },
  ...fc.sample(fc.tuple(callList, sealPlan), explorationRuns).map(([calls, seal], index) => ({
    id: `ratio-exploration-${index + 1}`,
    calls,
    seal,
    invalidReasons: [],
  })),
];

const invalidSealSamples = [
  { id: "seal-regression", calls: PINNED_CALLS, seal: "none" as const, invalidReasons: PINNED_INVALID_REASONS },
  ...fc.sample(fc.tuple(callList, fc.array(invalidReason, { minLength: 1, maxLength: 3 })), explorationRuns).map(
    ([calls, invalidReasons], index) => ({
      id: `seal-exploration-${index + 1}`,
      calls,
      seal: "none" as const,
      invalidReasons,
    }),
  ),
];

const groupKey = (parts: readonly (string | null)[]) => JSON.stringify(parts);

describe("adapter usage accounting", () => {
  let project: FixtureProject;
  const locators = new Map<string, string>();

  beforeAll(async () => {
    // Each sample has its own Attempt and ledger. One Invocation shares the loader, Record writer and finalization.
    const samples = [...ratioSamples, ...invalidSealSamples];
    const files = Object.fromEntries(
      samples.map(({ id }) => [
        `evals/${id}.eval.ts`,
        `import { equals } from "niceeval/expect"; import { usageAdapter } from "../adapters/usage.ts";
         export default usageAdapter.defineEval({ async test(t) {
           const ok = await t.play(${JSON.stringify(id)});
           await t.libraryReport(t, ${JSON.stringify(id)});
           t.check(ok, equals(true));
         } });`,
      ]),
    );
    project = await createFixtureProject("niceeval-adapter-usage", {
      ...files,
      "adapters/usage.ts": ADAPTER,
      "experiments/usage.ts": `import { defineExperiment } from "niceeval"; import { usageAdapter } from "../adapters/usage.ts";
        export default defineExperiment({
          adapter: usageAdapter,
          models: { planner: { model: "offline/shared" }, reviewer: { model: "offline/shared" }, unused: { model: "offline/unused" } },
          evals: ${JSON.stringify(samples.map(({ id }) => id))},
        });`,
    });
    await Promise.all(samples.map(({ id, ...plan }) => writeJson(project.cwd, `${id}-plan.json`, plan)));
    const planned = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd: project.cwd,
        experimentSelector: "usage",
        config: { maxConcurrency: 1 },
        overrides: { rerun: "all", earlyExit: false },
      }),
    );
    if (planned.status !== "ready") throw new Error(`Could not plan usage: ${JSON.stringify(planned)}`);
    const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
    const { run } = await Effect.runPromise(runHost.get({ cwd: project.cwd, runId: receipt.createdRunIds[0]! }));
    for (const { evalId, publication } of run.slots) {
      if (publication.state === "published") locators.set(evalId, publication.attemptLocator);
    }
    expect([...locators.keys()].sort()).toEqual(samples.map(({ id }) => id).sort());
  }, 60_000);

  afterAll(async () => {
    await project?.dispose();
  });

  // @feature docs/feature/adapters/README.md#usage-accounting
  test.for(ratioSamples)(
    "cache read rate is the token-weighted ratio over covered calls and unavailable with a reason for any gap, never zero-filled ($id)",
    async ({ id, calls, seal }) => {
      const locator = locators.get(id)!;
      const complete = seal === "complete";
      const context = JSON.stringify({ calls, seal });
      const { attempt, usage } = await withOperational(project.cwd, (facts) => ({
        attempt: selectInspectionOperation(facts, { kind: "attempt.get", locator }).attempt,
        usage: selectInspectionOperation(facts, { kind: "attempt.usage", locator }).usage,
      }));
      const report = usage.cacheRead;
      // Canonical seals (complete, partial with a valid reason, or none) never error the Attempt.
      expect(attempt.verdict, context).toBe("passed");

      // Rate and reason come from the contract formula, for the total, each role, and each exact model group.
      expect(report.total.rate, context).toEqual(expectedRate(calls, complete));
      expect(report.total.recordedCalls, context).toBe(calls.length);
      expect(report.total.collectionComplete, context).toBe(complete);
      expect(report.total.unknownStatusCalls, context).toBe(calls.filter((call) => call.status === "unknown").length);
      expect(report.total.missingCacheReadCalls, context).toBe(calls.filter((call) => call.cacheReadTokens === null).length);
      expect(report.total.missingInputTotalCalls, context).toBe(calls.filter((call) => callTotal(call) === null).length);
      expect(report.total.coveredCalls, context).toBe(
        calls.filter((call) => call.cacheReadTokens !== null && callTotal(call) !== null).length,
      );
      if (report.total.rate.state === "unavailable") expect(report.total.reasons[0], context).toBe(report.total.rate.reason);
      else expect(report.total.reasons, context).toEqual([]);

      const roleNames = new Set<string | null>(["planner", "reviewer", "unused", ...calls.map((call) => call.modelRole)]);
      expect(new Set(report.roles.map((role) => role.modelRole)), context).toEqual(roleNames);
      for (const role of report.roles) {
        const own = calls.filter((call) => call.modelRole === role.modelRole);
        expect(role.rate, `${context} role ${role.modelRole}`).toEqual(expectedRate(own, complete));
        expect(role.recordedCalls, context).toBe(own.length);
      }

      const modelKeys = new Set(calls.map((call) => groupKey([call.modelRole, call.provider, call.model])));
      expect(new Set(report.models.map((m) => groupKey([m.modelRole, m.provider, m.model]))), context).toEqual(modelKeys);
      for (const group of report.models) {
        const own = calls.filter(
          (call) => groupKey([call.modelRole, call.provider, call.model]) === groupKey([group.modelRole, group.provider, group.model]),
        );
        expect(group.rate, `${context} group ${JSON.stringify(group)}`).toEqual(expectedRate(own, complete));
      }

      // Library `t.usage.cacheRead` and Inspection project the same ledger identically.
      const library = await readJson<{ total: unknown; roles: unknown; models: unknown }>(project.cwd, `${id}-library.json`);
      expect(library.total, context).toEqual(report.total);
      expect(library.roles, context).toEqual(report.roles);
      expect(library.models, context).toEqual(report.models);
    },
  );

  // @feature docs/feature/adapters/README.md#usage-accounting
  test.for(invalidSealSamples)(
    "non-canonical seal reasons throw at the call site with the format, keep earlier calls, and still error the Attempt ($id)",
    async ({ id, calls, invalidReasons }) => {
      const locator = locators.get(id)!;
      const context = JSON.stringify({ calls, invalidReasons });
      const rejections = await readJson<readonly { threw: boolean; message?: string }[]>(project.cwd, `${id}-rejections.json`);

      expect(rejections.map((r) => r.threw), context).toEqual(invalidReasons.map(() => true));
      for (const rejection of rejections) expect(rejection.message, context).toMatch(/1-128 ASCII characters/);

      const { attempt, usage } = await withOperational(project.cwd, (facts) => ({
        attempt: selectInspectionOperation(facts, { kind: "attempt.get", locator }).attempt,
        usage: selectInspectionOperation(facts, { kind: "attempt.usage", locator }).usage,
      }));
      // The rejection is a capture failure even though the author caught it.
      expect(attempt.verdict, context).toBe("errored");
      // Calls recorded before the rejected seal remain readable and the ledger is not claimed complete.
      expect((usage.calls ?? []).map((call) => call.callId), context).toEqual(calls.map((call) => call.callId));
      expect(usage.state, context).not.toBe("complete");
      expect(usage.cacheRead.total.collectionComplete, context).toBe(false);
    },
  );
});
