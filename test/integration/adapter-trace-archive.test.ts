import { randomInt } from "node:crypto";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { experimentHost } from "niceeval/experiment/host";
import { withInspectionQuery } from "niceeval/inspection/host";
import { runHost } from "niceeval/run/host";
import {
  Effect,
  createFixtureProject,
  readJson,
  runSingleAttempt,
  writeJson,
  type FixtureProject,
} from "./fixtures/adapter-trace-usage-harness/harness.ts";

const FILES = {
  "adapters/archive.ts": `
import { defineAdapter } from "niceeval/adapter";
import { readFile, writeFile } from "node:fs/promises";

export const adapter = defineAdapter({
  name: "trace-archive",
  behaviorRevision: "1",
  create(ctx) {
    return {
      async play(caseId) {
        const actions = JSON.parse(await readFile(new URL("../" + caseId + "-actions.json", import.meta.url), "utf8"));
        const outcomes = [];
        for (const action of actions) {
          const pending = ctx.recordTrace({
            traceId: "match",
            schema: { id: "example.arena/v1" },
            collection: action.collection ?? { state: "complete", limitations: [] },
            scopes: [],
            events: [{ key: "start", type: "started", source: { id: "fixture" }, summary: "Match started" }],
            ...("archive" in action ? { archive: action.archive } : {}),
          });
          if (action.mutate) action.archive.locator.matchId = "changed-after-call";
          try {
            outcomes.push(await pending);
          } catch (error) {
            outcomes.push({ code: error.code });
          }
        }
        await writeFile(new URL("../" + caseId + "-outcomes.json", import.meta.url), JSON.stringify(outcomes));
        return true;
      },
    };
  },
});
`,
  "evals/archive.eval.ts": archiveEval("archive"),
  "experiments/archive.ts": archiveExperiment(["archive"]),
};

function archiveEval(caseId: string) {
  return `
import { equals } from "niceeval/expect";
import { adapter } from "../adapters/archive.ts";
export default adapter.defineEval({ async test(t) { t.check(await t.play(${JSON.stringify(caseId)}), equals(true)); } });
`;
}

function archiveExperiment(caseIds: readonly string[]) {
  return `
import { defineExperiment } from "niceeval";
import { adapter } from "../adapters/archive.ts";
export default defineExperiment({ adapter, evals: ${JSON.stringify(caseIds)} });
`;
}

const seed = randomInt(-(2 ** 31), 2 ** 31);
const cases = fc
  .sample(fc.tuple(fc.string(), fc.nat()), {
    seed,
    numRuns: Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 1),
    examples: [["", 0]] satisfies [string, number][],
  })
  .map(([matchId, byteLength], index) => ({
    evalId: `archive-${index}`,
    seed,
    archive: {
      system: "arena-replay",
      locator: { matchId, region: "local" },
      sha256: "a".repeat(64),
      byteLength,
    },
  }));

function archiveActions(archive: (typeof cases)[number]["archive"]) {
  const { matchId } = archive.locator;
  return [
    { archive, mutate: true },
    { archive: { ...archive, locator: { region: "local", matchId } } },
    { archive: { ...archive, locator: { ...archive.locator, matchId: `${matchId}-other` } } },
    { archive: { ...archive, system: "" } },
    { archive: { ...archive, system: "arena\u0085replay" } },
    { archive: { ...archive, sha256: "A".repeat(64) } },
    { archive: { ...archive, byteLength: -1 } },
    { archive: { ...archive, byteLength: Number.MAX_SAFE_INTEGER + 1 } },
    { archive: { ...archive, capability: "extra-field" } },
    {
      archive,
      collection: { state: "partial", limitations: [{ code: "niceeval.trace-stream-cut", message: "Forged" }] },
    },
    {},
  ];
}

async function execution(cwd: string, locator: string) {
  return withInspectionQuery(
    { cwd },
    async (query) => (await query.inspect({ kind: "attempt.trace", locator })).trace.execution,
  );
}

async function preview(cwd: string) {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "archive",
      config: { maxConcurrency: 1 },
      preview: true,
    }),
  );
  if (planned.status !== "ready" || planned.dry === undefined) {
    throw new Error(`Expected a dry plan: ${JSON.stringify(planned)}`);
  }
  return planned.dry.slots[0]!;
}

let propertyProject: FixtureProject;
const propertyLocators = new Map<string, string>();
let identityProject: FixtureProject;
let baselineSlot: Awaited<ReturnType<typeof preview>>;
let baselineLocator: string;

beforeAll(async () => {
  propertyProject = await createFixtureProject("niceeval-trace-archive", {
    "adapters/archive.ts": FILES["adapters/archive.ts"],
    "experiments/archive.ts": archiveExperiment(cases.map(({ evalId }) => evalId)),
    ...Object.fromEntries(cases.map(({ evalId }) => [`evals/${evalId}.eval.ts`, archiveEval(evalId)])),
  });
  const { cwd } = propertyProject;
  await Promise.all(
    cases.map(({ evalId, archive }) => writeJson(cwd, `${evalId}-actions.json`, archiveActions(archive))),
  );
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({ cwd, experimentSelector: "archive", config: { maxConcurrency: 1 } }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan archive fixture: ${JSON.stringify(planned)}`);
  const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  const [runId] = receipt.createdRunIds;
  if (runId === undefined) throw new Error("The archive Invocation did not create a Run");
  const { run } = await Effect.runPromise(runHost.get({ cwd, runId }));
  for (const { evalId, publication } of run.slots) {
    if (publication.state !== "published") throw new Error(`Could not publish archive fixture ${evalId}`);
    propertyLocators.set(evalId, publication.attemptLocator);
  }

  identityProject = await createFixtureProject("niceeval-trace-archive-identity", FILES);
  await writeJson(identityProject.cwd, "archive-actions.json", [{}]);
  baselineSlot = await preview(identityProject.cwd);
  baselineLocator = await runSingleAttempt(identityProject.cwd, "archive");
}, 60_000);

afterAll(async () => {
  await propertyProject?.dispose();
  await identityProject?.dispose();
});

// @feature docs/feature/adapters/library/README.md#外部存档出处
test.each(cases)(
  "archive participates in replay identity and illegal resubmissions preserve the accepted trace [$evalId, seed $seed]",
  async ({ evalId, archive }) => {
    const { cwd } = propertyProject;
    const locator = propertyLocators.get(evalId);
    if (locator === undefined) throw new Error(`No published locator for ${evalId}`);
    const outcomes = await readJson<readonly unknown[]>(cwd, `${evalId}-outcomes.json`);
    expect(outcomes[0]).toEqual({
      state: "accepted",
      traceId: expect.any(String),
      events: [{ key: "start", eventId: expect.any(String), evidence: [] }],
    });
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes.slice(2)).toEqual([
      { code: "execution-trace-conflict" },
      ...Array.from({ length: 7 }, () => ({ code: "execution-trace-invalid" })),
      { code: "execution-trace-conflict" },
    ]);
    const trace = await execution(cwd, locator);
    expect(trace.limitations).toContainEqual({ code: "capture-failed", stage: "adapter" });
    expect(trace.traces).toEqual([
      {
        kind: "trace-header",
        traceId: expect.any(String),
        sourceTraceId: "match",
        schema: { id: "example.arena/v1" },
        archive,
        collection: { state: "complete", limitations: [] },
        scopes: [],
        index: "published",
        eventCount: 1,
      },
    ]);
  },
);

// @feature docs/feature/experiments/README.md#partial-reuse
test("adding archive provenance leaves an existing array trace eligible for Eval reuse", async () => {
  const { cwd } = identityProject;
  const { attempt, trace } = await withInspectionQuery({ cwd }, async (query) => ({
    attempt: (await query.inspect({ kind: "attempt.get", locator: baselineLocator })).attempt,
    trace: (await query.inspect({ kind: "attempt.trace", locator: baselineLocator })).trace.execution,
  }));
  expect(trace.traces[0]).toMatchObject({ sourceTraceId: "match", eventCount: 1 });
  expect(trace.traces[0]).not.toHaveProperty("archive");

  const archive = { system: "arena-replay", locator: { matchId: "same-execution" } };
  await writeJson(cwd, "archive-actions.json", [{ archive }]);
  const after = await preview(cwd);
  expect(after).toMatchObject({
    state: "reuse",
    target: { executionIdentityDigest: baselineSlot.target.executionIdentityDigest },
    source: { attemptId: attempt.core.attemptId },
  });
});
