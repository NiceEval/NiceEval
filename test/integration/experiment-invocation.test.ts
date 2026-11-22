import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { createRecordProject, openGate, waitForGate } from "./fixtures/record-harness/project.ts";
import { createFixtureProject, type FixtureProject } from "./fixtures/adapter-trace-usage-harness/harness.ts";

async function plan(cwd: string) {
  const result = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "runs",
      config: { maxConcurrency: 1 },
      overrides: { rerun: "all" },
    }),
  );
  if (result.status !== "ready") throw new Error(JSON.stringify(result));
  return result.plan;
}

let heldProject: string;
let active: import("../../packages/niceeval/src/experiment/host/index.ts").ExperimentHostInvocationStatusList;
let completed: Awaited<ReturnType<typeof execute>>;
let usageProject: FixtureProject;
const callSamples = fc.sample(fc.tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 })), {
  seed: 20261121,
  numRuns: 2,
});
let usages: Awaited<ReturnType<typeof execute>>[];
let shown: import("../../packages/niceeval/src/experiment/host/index.ts").ExperimentHostInvocationStatusShow;
let terminalLists: (typeof active)[];

function execute(invocationPlan: Awaited<ReturnType<typeof plan>>) {
  return Effect.runPromise(experimentHost.invocation.run({ plan: invocationPlan }));
}

const usageFiles = {
  "adapter.ts": `
    import { readFileSync } from "node:fs";
    import { defineAdapter } from "niceeval/adapter";
    export default defineAdapter({
      name: "invocation-usage", behaviorRevision: "1",
      create(ctx) {
        const { callCounts, partial } = JSON.parse(readFileSync(new URL("./usage.json", import.meta.url), "utf8"));
        const index = ctx.evalId === "first" ? 0 : 1;
        return {
          play() {
            for (let call = 0; call < callCounts[index]; call++) {
              ctx.recordUsage({
                callId: "call-" + call, model: "fixture", provider: "offline", status: "succeeded",
                inputTokens: 70, cacheReadTokens: 30, inputTotalTokens: 100, outputTokens: 20,
              });
            }
            ctx.sealUsage(partial && index === 1 ? { state: "partial", reason: "missing-call" } : { state: "complete" });
          },
        };
      },
    });
  `,
  "experiments/runs.ts": `
    import { defineExperiment } from "niceeval";
    import adapter from "../adapter.ts";
    export default defineExperiment({ adapter, evals: "*" });
  `,
  ...Object.fromEntries(
    ["first", "second"].map((id) => [
      `evals/${id}.eval.ts`,
      `
    import { equals } from "niceeval/expect";
    import adapter from "../adapter.ts";
    export default adapter.defineEval({ async test(t) { await t.play(); t.check(true, equals(true)); } });
  `,
    ]),
  ),
};

beforeAll(async () => {
  heldProject = await createRecordProject("niceeval-invocation-status-", { held: true });
  const running = execute(await plan(heldProject));
  void running.catch(() => {});
  try {
    await Promise.race([
      waitForGate(heldProject, "entered", 5_000),
      running.then(() => {
        throw new Error("Invocation closed before its held Eval started");
      }),
    ]);
    active = await Effect.runPromise(experimentHost.invocationStatus.list({ cwd: heldProject, all: true }));
  } finally {
    await openGate(heldProject, "release");
    completed = await running;
  }

  usageProject = await createFixtureProject("niceeval-invocation-usage", usageFiles);
  const { invocationId } = completed.receipt;
  shown = await Effect.runPromise(
    experimentHost.invocationStatus.show({ cwd: heldProject, invocationSelector: invocationId }),
  );
  terminalLists = await Promise.all(
    [false, true].map((all) => Effect.runPromise(experimentHost.invocationStatus.list({ cwd: heldProject, all }))),
  );
  usages = [];
  for (const partial of [false, true]) {
    const callCounts = callSamples[Number(partial)]!;
    await writeFile(join(usageProject.cwd, "usage.json"), JSON.stringify({ callCounts, partial }));
    usages.push(await execute(await plan(usageProject.cwd)));
  }
}, 25_000);

afterAll(async () => {
  await Promise.all([
    heldProject ? rm(heldProject, { recursive: true, force: true }) : undefined,
    usageProject?.dispose(),
  ]);
});

// @feature docs/feature/experiments/README.md#invocation-session
test("an active Invocation and its terminal receipt have the same publicly readable Session", () => {
  const { invocationId } = completed.receipt;
  expect(active.sessions.map(({ sessionId, status }) => ({ sessionId, status }))).toEqual([
    { sessionId: invocationId, status: "active" },
  ]);
  expect(shown.session).toMatchObject({ sessionId: invocationId, status: "completed" });
  expect(terminalLists.map(({ sessions }) => sessions)).toEqual([[], [shown.session]]);
});

for (const partial of [false, true]) {
  // @feature docs/feature/experiments/README.md#invocation-usage
  test(`Invocation reports ${partial ? "unknown" : "exact"} totals for ${partial ? "partial" : "complete"} Adapter usage`, () => {
    const [first, second] = callSamples[Number(partial)]!;
    const { summary } = usages[Number(partial)]!;
    expect(summary).toMatchObject({
      total: 2,
      passed: 2,
      inputTokens: partial ? undefined : (first + second) * 70,
      outputTokens: partial ? undefined : (first + second) * 20,
    });
  });
}
