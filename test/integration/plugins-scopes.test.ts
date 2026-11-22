import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");

const FIXTURE = fileURLToPath(new URL("fixtures/plugins-scopes/", import.meta.url));
const PROPERTY_RUNS = Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 1);

interface RecordedEvent {
  readonly kind: string;
  readonly marker?: string;
  readonly declaredMarker?: string;
  readonly experimentId?: string;
  readonly evalId?: string;
  readonly attempt?: number;
  readonly sandboxId?: string;
  readonly ownerKind?: string;
  readonly ownerId?: string;
}

function pluginHelpersSource(): string {
  return `
import { definePlugin } from "niceeval/plugin";
import { changeFrequency, writeText, type SandboxCommandContext, type SandboxCommandTarget } from "niceeval/sandbox";
import { appendPluginEvent } from "./events.ts";

function sandboxFragment(marker: string) {
  const markerPath = \`/tmp/niceeval-plugin-\${marker}.txt\`;
  return {
    before: [
      writeText({
        id: \`test.plugin.\${marker}.marker\`,
        path: markerPath,
        text: marker,
        changeFrequency: changeFrequency.rare,
      }),
      async (sandbox: SandboxCommandTarget, ctx: SandboxCommandContext) => {
        const declaredMarker = await sandbox.readText(markerPath);
        appendPluginEvent({
          kind: "sandbox.plugin.before",
          marker,
          declaredMarker,
          sandboxId: sandbox.sandboxId,
          attemptId: ctx.attempt.id,
          attempt: ctx.attempt.index,
          ownerKind: ctx.owner.kind,
          ownerId: ctx.owner.id,
        });
      },
    ],
    after: async (sandbox: SandboxCommandTarget, ctx: Omit<SandboxCommandContext, "onCleanup">) => {
      appendPluginEvent({
        kind: "sandbox.plugin.after",
        marker,
        sandboxId: sandbox.sandboxId,
        attemptId: ctx.attempt.id,
        attempt: ctx.attempt.index,
        ownerKind: ctx.owner.kind,
        ownerId: ctx.owner.id,
      });
    },
  };
}

export const experimentPlugin = (marker: string, opts: { withAttempt?: boolean; withSandbox?: boolean } = {}) =>
  definePlugin({
    name: "test.experiment-plugin",
    key: marker,
    identity: { version: "1", marker, withAttempt: Boolean(opts.withAttempt), withSandbox: opts.withSandbox ?? true },
    experiment: {
      before: (ctx) => appendPluginEvent({ kind: "experiment.plugin.before", marker, experimentId: ctx.experimentId }),
      after: (ctx) => appendPluginEvent({ kind: "experiment.plugin.after", marker, experimentId: ctx.experimentId }),
    },
    ...(opts.withSandbox === false ? {} : { sandbox: sandboxFragment(marker) }),
    ...(opts.withAttempt
      ? {
          attempt: {
            before: (ctx) =>
              appendPluginEvent({
                kind: "attempt.plugin.before",
                marker,
                scope: "experiment",
                evalId: ctx.evalId,
                attempt: ctx.attempt,
              }),
            after: (ctx) =>
              appendPluginEvent({
                kind: "attempt.plugin.after",
                marker,
                scope: "experiment",
                evalId: ctx.evalId,
                attempt: ctx.attempt,
              }),
          },
        }
      : {}),
  });

export const evalPlugin = (marker: string, version = "1", withSandbox = true) =>
  definePlugin({
    name: "test.eval-plugin",
    key: marker,
    identity: { version, marker, withSandbox },
    attempt: {
      before: (ctx) =>
        appendPluginEvent({
          kind: "attempt.plugin.before",
          marker,
          scope: "eval",
          evalId: ctx.evalId,
          attempt: ctx.attempt,
        }),
      after: (ctx) =>
        appendPluginEvent({
          kind: "attempt.plugin.after",
          marker,
          scope: "eval",
          evalId: ctx.evalId,
          attempt: ctx.attempt,
        }),
    },
    ...(withSandbox ? { sandbox: sandboxFragment(marker) } : {}),
  });
`;
}

async function prepareProject() {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-plugins-scopes-"));
  await cp(FIXTURE, cwd, { recursive: true });
  const dependencies = join(cwd, "node_modules");
  await mkdir(dependencies);
  await Promise.all([
    symlink(dirname(require.resolve("effect/package.json")), join(dependencies, "effect"), "junction"),
    mkdir(join(cwd, "evals"), { recursive: true }),
    mkdir(join(cwd, "experiments"), { recursive: true }),
    rename(join(cwd, "events.ts.txt"), join(cwd, "events.ts")),
    rename(join(cwd, "sandbox.ts.txt"), join(cwd, "sandbox.ts")),
    rename(join(cwd, "agent.ts.txt"), join(cwd, "agent.ts")),
  ]);
  await writeFile(join(cwd, "plugins.ts"), pluginHelpersSource());
  return cwd;
}

async function readEvents(cwd: string): Promise<RecordedEvent[]> {
  try {
    const raw = await readFile(join(cwd, "plugin-events.ndjson"), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RecordedEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function clearEvents(cwd: string) {
  await writeFile(join(cwd, "plugin-events.ndjson"), "", "utf8");
}

async function planAndRun(
  cwd: string,
  experimentSelector: string,
  overrides: { rerun?: "all" | "failed" } = {},
) {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector,
      config: { maxConcurrency: 1 },
      overrides: { earlyExit: false, ...overrides },
    }),
  );
  if (planned.status !== "ready") {
    throw new Error(`Expected ready plan, got ${JSON.stringify(planned)}`);
  }
  const executed = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  return { planned, executed };
}

const experimentScopeSchedules = [
  { label: "regression", evalCount: 2, attempts: 1, pluginCount: 2, withAuthorHooks: true },
  ...fc
    .sample(
      fc.record({
        evalCount: fc.integer({ min: 1, max: 3 }),
        attempts: fc.integer({ min: 1, max: 2 }),
        pluginCount: fc.integer({ min: 1, max: 2 }),
        withAuthorHooks: fc.boolean(),
      }),
      { numRuns: PROPERTY_RUNS },
    )
    .map((sample, index) => ({ label: `exploration ${index + 1}`, ...sample })),
];

// @feature docs/feature/plugins/README.md#plugin-scopes
describe.for(experimentScopeSchedules)(
  "Experiment Plugin wraps the Run once while Sandbox hooks run per fresh Attempt ($label)",
  (config) => {
    let cwd: string;
    let executed: Awaited<ReturnType<typeof planAndRun>>["executed"];
    let events: RecordedEvent[];
    let markers: string[];

    beforeAll(async () => {
      cwd = await prepareProject();
      const evalNames = Array.from({ length: config.evalCount }, (_, i) => `case-${i}`);
      await Promise.all(
        evalNames.map((name) =>
          writeFile(
            join(cwd, "evals", `${name}.eval.ts`),
            `import { defineEval } from "niceeval";
             export default defineEval({
               async test(t) {
                 const turn = await t.send(${JSON.stringify(name)});
                 await turn.succeeded().orStop();
               },
             });`,
          ),
        ),
      );
      markers = Array.from({ length: config.pluginCount }, (_, i) => `exp-${i}`);
      await writeFile(
        join(cwd, "experiments", "exp.ts"),
        `import { defineExperiment } from "niceeval";
         import agent from "../agent.ts";
         import sandbox from "../sandbox.ts";
         import { appendPluginEvent } from "../events.ts";
         import { experimentPlugin } from "../plugins.ts";
         export default defineExperiment({
           adapter: agent,
           sandbox,
           evals: ${JSON.stringify(evalNames)},
           attempts: ${config.attempts},
           maxConcurrency: 1,
           plugins: [${markers.map((m) => `experimentPlugin(${JSON.stringify(m)})`).join(", ")}],
           ${
             config.withAuthorHooks
               ? `before: (ctx) => appendPluginEvent({ kind: "experiment.author.before", experimentId: ctx.experimentId }),
                  after: (ctx) => appendPluginEvent({ kind: "experiment.author.after", experimentId: ctx.experimentId }),`
               : ""
           }
         });`,
      );
      executed = (await planAndRun(cwd, "exp", { rerun: "all" })).executed;
      events = await readEvents(cwd);
    }, 15_000);

    afterAll(async () => {
      if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
    });

    test("Run completes with all expected published slots and Experiment hooks wrap the Run once", async () => {
      const expectedTotalAttempts = config.evalCount * config.attempts;
      expect(executed.receipt.completion).toBe("completed");
      expect(executed.summary).toMatchObject({
        total: expectedTotalAttempts,
        passed: expectedTotalAttempts,
        failed: 0,
        errored: 0,
        skipped: 0,
      });
      const [runId] = executed.receipt.createdRunIds;
      expect(runId).toBeDefined();
      const { run } = await Effect.runPromise(runHost.get({ cwd, runId: runId! }));
      expect(run.slots).toHaveLength(expectedTotalAttempts);
      for (const slot of run.slots) {
        expect(slot.publication.state).toBe("published");
      }

      const expBefore = events.filter((e) => e.kind === "experiment.plugin.before");
      const expAfter = events.filter((e) => e.kind === "experiment.plugin.after");
      expect(expBefore.map((e) => e.marker)).toEqual(markers);
      expect(expAfter.map((e) => e.marker)).toEqual([...markers].reverse());

      if (config.withAuthorHooks) {
        expect(events[0]?.kind).toBe("experiment.author.before");
        expect(events.at(-1)?.kind).toBe("experiment.author.after");
        const firstPluginBefore = events.findIndex((e) => e.kind === "experiment.plugin.before");
        const lastPluginAfter = events.findLastIndex((e) => e.kind === "experiment.plugin.after");
        expect(firstPluginBefore).toBeGreaterThan(0);
        expect(lastPluginAfter).toBeLessThan(events.length - 1);
      }

      const firstAgentSend = events.findIndex((e) => e.kind === "agent.send");
      const lastAgentSend = events.findLastIndex((e) => e.kind === "agent.send");
      const lastExpBefore = events.findLastIndex((e) => e.kind === "experiment.plugin.before");
      const firstExpAfter = events.findIndex((e) => e.kind === "experiment.plugin.after");
      expect(lastExpBefore).toBeLessThan(firstAgentSend);
      expect(firstExpAfter).toBeGreaterThan(lastAgentSend);
    });

    test("Sandbox hooks run per fresh Attempt with distinct physical identities", () => {
      const expectedTotalAttempts = config.evalCount * config.attempts;
      const sbBefore = events.filter((e) => e.kind === "sandbox.plugin.before");
      const sbAfter = events.filter((e) => e.kind === "sandbox.plugin.after");
      const agentSends = events.filter((e) => e.kind === "agent.send");
      expect(agentSends).toHaveLength(expectedTotalAttempts);
      expect(sbBefore).toHaveLength(expectedTotalAttempts * config.pluginCount);
      expect(sbAfter).toHaveLength(expectedTotalAttempts * config.pluginCount);
      for (const entry of sbBefore) {
        expect(entry.declaredMarker).toBe(entry.marker);
        expect(entry.ownerKind).toBe("experiment");
        expect(entry.ownerId).toBe("exp");
      }
      for (const entry of sbAfter) {
        expect(entry.ownerKind).toBe("experiment");
        expect(entry.ownerId).toBe("exp");
      }

      const createdSandboxes = events.filter((e) => e.kind === "sandbox.create").map((e) => e.sandboxId);
      const stoppedSandboxes = events.filter((e) => e.kind === "sandbox.stop").map((e) => e.sandboxId);
      expect(new Set(createdSandboxes).size).toBe(expectedTotalAttempts);
      expect(new Set(stoppedSandboxes)).toEqual(new Set(createdSandboxes));
      expect(new Set(agentSends.map((e) => e.sandboxId))).toEqual(new Set(createdSandboxes));
    });
  },
);

const evalScopeSchedules = [
  { label: "regression", attempts: 2, evalPluginCount: 2, hasExpAttemptPlugin: true },
  ...fc
    .sample(
      fc.record({
        attempts: fc.integer({ min: 1, max: 2 }),
        evalPluginCount: fc.integer({ min: 1, max: 2 }),
        hasExpAttemptPlugin: fc.boolean(),
      }),
      { numRuns: PROPERTY_RUNS },
    )
    .map((sample, index) => ({ label: `exploration ${index + 1}`, ...sample })),
];

// @feature docs/feature/plugins/README.md#plugin-scopes
describe.for(evalScopeSchedules)(
  "Eval Plugins and Experiment attempt hooks execute per fresh Attempt in owner/array order ($label)",
  ({ attempts, evalPluginCount, hasExpAttemptPlugin }) => {
    let cwd: string;
    let events: RecordedEvent[];
    let evalMarkers: string[];

    beforeAll(async () => {
      cwd = await prepareProject();
      evalMarkers = Array.from({ length: evalPluginCount }, (_, i) => `eval-a-${i}`);
      await writeFile(
        join(cwd, "evals", "owned.eval.ts"),
        `import { defineEval } from "niceeval";
         import { evalPlugin } from "../plugins.ts";
         export default defineEval({
           plugins: [${evalMarkers.map((m) => `evalPlugin(${JSON.stringify(m)})`).join(", ")}],
           async test(t) {
             const turn = await t.send("owned");
             await turn.succeeded().orStop();
           },
         });`,
      );
      await writeFile(
        join(cwd, "evals", "plain.eval.ts"),
        `import { defineEval } from "niceeval";
         export default defineEval({
           async test(t) {
             const turn = await t.send("plain");
             await turn.succeeded().orStop();
           },
         });`,
      );
      await writeFile(
        join(cwd, "experiments", "scopes.ts"),
        `import { defineExperiment } from "niceeval";
         import agent from "../agent.ts";
         import sandbox from "../sandbox.ts";
         import { experimentPlugin } from "../plugins.ts";
         export default defineExperiment({
           adapter: agent,
           sandbox,
           evals: ["owned", "plain"],
           attempts: ${attempts},
           maxConcurrency: 1,
           plugins: ${hasExpAttemptPlugin ? `[experimentPlugin("exp-shared", { withAttempt: true })]` : "[]"},
         });`,
      );

      const { executed } = await planAndRun(cwd, "scopes", { rerun: "all" });
      expect(executed.receipt.completion).toBe("completed");
      events = await readEvents(cwd);
    }, 15_000);

    afterAll(async () => {
      if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
    });

    test("attempt hooks scope to their owning Eval and run in array/reverse order", () => {
      const attemptEvents = events.filter(
        (e) => e.kind === "attempt.plugin.before" || e.kind === "attempt.plugin.after",
      );
      const expectedOwnedMarkers = [...(hasExpAttemptPlugin ? ["exp-shared"] : []), ...evalMarkers];
      const expectedPlainMarkers = hasExpAttemptPlugin ? ["exp-shared"] : [];

      for (let attempt = 0; attempt < attempts; attempt++) {
        const ownedAttempt = attemptEvents.filter((e) => e.evalId === "owned" && e.attempt === attempt);
        expect(ownedAttempt.filter((e) => e.kind === "attempt.plugin.before").map((e) => e.marker)).toEqual(
          expectedOwnedMarkers,
        );
        expect(ownedAttempt.filter((e) => e.kind === "attempt.plugin.after").map((e) => e.marker)).toEqual(
          [...expectedOwnedMarkers].reverse(),
        );

        const plainAttempt = attemptEvents.filter((e) => e.evalId === "plain" && e.attempt === attempt);
        expect(plainAttempt.filter((e) => e.kind === "attempt.plugin.before").map((e) => e.marker)).toEqual(
          expectedPlainMarkers,
        );
        expect(plainAttempt.filter((e) => e.kind === "attempt.plugin.after").map((e) => e.marker)).toEqual(
          [...expectedPlainMarkers].reverse(),
        );
      }

      const sandboxes = events.filter((e) => e.kind === "sandbox.create").map((e) => e.sandboxId);
      expect(new Set(sandboxes).size).toBe(attempts * 2);
    });

    test("sandbox before/after bracket attempt hooks and carry eval owner identity", () => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const ownedSendIdx = events.findIndex(
          (e) => e.kind === "agent.send" && e.evalId === "owned" && e.attempt === attempt,
        );
        expect(ownedSendIdx).toBeGreaterThan(-1);
        const attemptSandboxId = events[ownedSendIdx]!.sandboxId;
        expect(attemptSandboxId).toBeDefined();

        const firstOwnedSbBefore = events.findIndex(
          (e) => e.kind === "sandbox.plugin.before" && e.sandboxId === attemptSandboxId && e.ownerKind === "eval",
        );
        const firstOwnedAttemptBefore = events.findIndex(
          (e) => e.kind === "attempt.plugin.before" && e.evalId === "owned" && e.attempt === attempt,
        );
        const lastOwnedAttemptAfter = events.findLastIndex(
          (e) => e.kind === "attempt.plugin.after" && e.evalId === "owned" && e.attempt === attempt,
        );
        const lastOwnedSbAfter = events.findLastIndex(
          (e) => e.kind === "sandbox.plugin.after" && e.sandboxId === attemptSandboxId && e.ownerKind === "eval",
        );
        expect(firstOwnedSbBefore).toBeGreaterThan(-1);
        expect(firstOwnedSbBefore).toBeLessThan(firstOwnedAttemptBefore);
        expect(firstOwnedAttemptBefore).toBeLessThan(ownedSendIdx);
        expect(ownedSendIdx).toBeLessThan(lastOwnedAttemptAfter);
        expect(lastOwnedAttemptAfter).toBeLessThan(lastOwnedSbAfter);
      }

      const evalOwnedSbBefore = events.filter((e) => e.kind === "sandbox.plugin.before" && e.ownerKind === "eval");
      const evalOwnedSbAfter = events.filter((e) => e.kind === "sandbox.plugin.after" && e.ownerKind === "eval");
      expect(evalOwnedSbBefore).toHaveLength(attempts * evalPluginCount);
      expect(evalOwnedSbAfter).toHaveLength(attempts * evalPluginCount);
      for (const entry of [...evalOwnedSbBefore, ...evalOwnedSbAfter]) expect(entry.ownerId).toBe("owned");
    });
  },
);

const carrySchedules = [
  { label: "regression", rerunIndex: 0 },
  ...fc
    .sample(fc.integer({ min: 0, max: 1 }), { numRuns: PROPERTY_RUNS })
    .map((rerunIndex, index) => ({ label: `exploration ${index + 1}`, rerunIndex })),
];

describe.for(carrySchedules)("Plugin carry and partial rerun scoping ($label)", ({ rerunIndex }) => {
  let cwd: string;
  let partialPlan: Awaited<ReturnType<typeof planOnly>>;

  async function planOnly(targetCwd: string, preview = false) {
    const planned = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd: targetCwd,
        experimentSelector: "carry",
        config: { maxConcurrency: 1 },
        overrides: { earlyExit: false },
        preview,
      }),
    );
    if (planned.status !== "ready") {
      throw new Error(`Expected ready plan, got ${JSON.stringify(planned)}`);
    }
    return planned;
  }

  beforeAll(async () => {
    cwd = await prepareProject();
    for (const index of [0, 1]) {
      await writeFile(
        join(cwd, "evals", `case-${index}.eval.ts`),
        `import { defineEval } from "niceeval";
         import { evalPlugin } from "../plugins.ts";
         export default defineEval({
           plugins: [evalPlugin("eval-${index}", "1", false)],
           async test(t) {
             const turn = await t.send("case-${index}");
             await turn.succeeded().orStop();
           },
         });`,
      );
    }
    await writeFile(
      join(cwd, "experiments", "carry.ts"),
      `import { defineExperiment } from "niceeval";
       import { directAgent } from "../agent.ts";
       import { experimentPlugin } from "../plugins.ts";
       export default defineExperiment({
         adapter: directAgent,
         evals: ["case-0", "case-1"],
         attempts: 1,
         maxConcurrency: 1,
         plugins: [experimentPlugin("exp-top", { withAttempt: true, withSandbox: false })],
       });`,
    );
    const initial = await planAndRun(cwd, "carry", { rerun: "all" });
    expect(initial.executed.receipt.completion).toBe("completed");
    expect((await readEvents(cwd)).filter((e) => e.kind === "agent.send")).toHaveLength(2);
  }, 15_000);

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/plugins/README.md#plugin-scopes
  test("full carry executes zero Plugin hooks and zero Sandboxes", async () => {
    await clearEvents(cwd);
    const carried = await planAndRun(cwd, "carry");
    expect(carried.executed.receipt.completion).toBe("completed");
    expect(await readEvents(cwd)).toEqual([]);
  });

  // @feature docs/feature/plugins/README.md#plugin-scopes
  test("partial identity change plans only the changed Eval as a fresh slot", async () => {
    await writeFile(
      join(cwd, "evals", `case-${rerunIndex}.eval.ts`),
      `import { defineEval } from "niceeval";
       import { evalPlugin } from "../plugins.ts";
       export default defineEval({
         plugins: [evalPlugin("eval-${rerunIndex}", "2", false)],
         async test(t) {
           const turn = await t.send("case-${rerunIndex}");
           await turn.succeeded().orStop();
         },
       });`,
    );
    partialPlan = await planOnly(cwd, true);
    const freshSlots = partialPlan.dry?.slots.filter((slot) => slot.state === "gap") ?? [];
    expect(freshSlots.map((slot) => slot.target.evalId)).toEqual([`case-${rerunIndex}`]);
  });

  // @feature docs/feature/plugins/README.md#plugin-scopes
  test("executing the partial rerun scopes Experiment and Attempt hooks to fresh Attempts only", async () => {
    await clearEvents(cwd);
    const partial = await Effect.runPromise(experimentHost.invocation.run({ plan: partialPlan.plan }));
    expect(partial.receipt.completion).toBe("completed");
    const partialEvents = await readEvents(cwd);

    expect(partialEvents.filter((e) => e.kind === "experiment.plugin.before").map((e) => e.marker)).toEqual([
      "exp-top",
    ]);
    expect(partialEvents.filter((e) => e.kind === "experiment.plugin.after").map((e) => e.marker)).toEqual([
      "exp-top",
    ]);
    const freshSends = partialEvents.filter((e) => e.kind === "agent.send");
    expect(freshSends.map((e) => e.evalId)).toEqual([`case-${rerunIndex}`]);
    const attemptStarts = partialEvents.filter((e) => e.kind === "attempt.plugin.before");
    expect(attemptStarts.map((e) => [e.evalId, e.marker])).toEqual([
      [`case-${rerunIndex}`, "exp-top"],
      [`case-${rerunIndex}`, `eval-${rerunIndex}`],
    ]);
  });
});

// @feature docs/feature/plugins/README.md#plugin-scopes
test("Group Plugin covers the shared EvalGroup lane once in CommandPlan while Sandbox and Attempt hooks scope to slots", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        evalCount: fc.integer({ min: 2, max: 3 }),
        attempts: fc.integer({ min: 1, max: 2 }),
        groupPluginCount: fc.integer({ min: 1, max: 2 }),
        evalPluginCount: fc.integer({ min: 0, max: 2 }),
        expGroupPlugin: fc.boolean(),
      }),
      async ({ evalCount, attempts, groupPluginCount, evalPluginCount, expGroupPlugin }) => {
        const cwd = await prepareProject();
        try {
          await mkdir(join(cwd, "evals", "grouped"), { recursive: true });
          const evalMarkers = Array.from({ length: evalPluginCount }, (_, i) => `member-eval-${i}`);
          const groupMarkers = Array.from({ length: groupPluginCount }, (_, i) => `group-own-${i}`);
          const evalNames = Array.from({ length: evalCount }, (_, i) => `m-${i}`);

          await writeFile(
            join(cwd, "group-plugins.ts"),
            `import { definePlugin } from "niceeval/plugin";
             import { shell } from "niceeval/sandbox";
             export const groupScopePlugin = (marker: string) => definePlugin({
               name: "test.group-scope-plugin",
               key: marker,
               identity: { marker },
               requires: { evalGroup: true },
               group: { before() {}, after() {} },
               sandbox: { before: shell("true"), after: shell("true") },
             });
             export const expWithGroupPlugin = definePlugin({
               name: "test.exp-group-plugin",
               key: "exp-group",
               identity: { version: "1" },
               experiment: { before() {}, after() {} },
               group: { before() {}, after() {} },
             });`,
          );

          for (const name of evalNames) {
            await writeFile(
              join(cwd, "evals", "grouped", `${name}.eval.ts`),
              `import { defineEval } from "niceeval";
               import { evalPlugin } from "../../plugins.ts";
               export default defineEval({
                 plugins: [${evalMarkers.map((m) => `evalPlugin(${JSON.stringify(m)}, "1", false)`).join(", ")}],
                 async test(t) {
                   const turn = await t.send(${JSON.stringify(name)});
                   await turn.succeeded().orStop();
                 },
               });`,
            );
          }

          await writeFile(
            join(cwd, "evals", "grouped", "eval-group.ts"),
            `import { defineEvalGroup } from "niceeval";
             ${evalNames.map((n, i) => `import eval${i} from "./${n}.eval.ts";`).join("\n")}
             import { groupScopePlugin } from "../../group-plugins.ts";
             export default defineEvalGroup({
               evals: [${evalNames.map((_, i) => `eval${i}`).join(", ")}],
               onUnavailable: "stop-group",
               plugins: [${groupMarkers.map((m) => `groupScopePlugin(${JSON.stringify(m)})`).join(", ")}],
             });`,
          );

          await writeFile(
            join(cwd, "experiments", "grouped.ts"),
            `import { defineExperiment } from "niceeval";
             import { e2bSandbox } from "niceeval/sandbox";
             import agent from "../agent.ts";
             import { expWithGroupPlugin } from "../group-plugins.ts";
             export default defineExperiment({
               adapter: agent,
               sandbox: e2bSandbox({ template: "plugins-group-plan-fixture" }),
               evals: ["grouped"],
               attempts: ${attempts},
               plugins: ${expGroupPlugin ? "[expWithGroupPlugin]" : "[]"},
             });`,
          );

          const planned = await Effect.runPromise(
            experimentHost.debug({
              cwd,
              config: {},
              experimentSelector: "grouped",
            }),
          );
          if (planned.status !== "planned") {
            throw new Error(`Expected planned debug result, got ${JSON.stringify(planned)}`);
          }

          const [experiment] = planned.commandPlan.experiments;
          expect(experiment).toBeDefined();
          expect(experiment!.lanes).toHaveLength(1);
          const lane = experiment!.lanes[0]!;
          expect(lane.kind).toBe("eval-group");
          if (lane.kind !== "eval-group") throw new Error("Expected eval-group lane");

          // Group hooks appear once before and once (in reverse) after the single shared EvalGroup lane.
          const expectedGroupBeforeLabels = [
            ...(expGroupPlugin ? ["test.exp-group-plugin:exp-group"] : []),
            ...groupMarkers.map((m) => `test.group-scope-plugin:${m}`),
          ];
          expect(lane.beforeSlots.map((step) => step.label)).toEqual(expectedGroupBeforeLabels);
          expect(lane.afterSlots.map((step) => step.label)).toEqual([...expectedGroupBeforeLabels].reverse());

          // Shared physical lifecycle template is present on the EvalGroup lane, and each Attempt
          // slot runs the group's sandbox before/after steps plus the Eval Plugin attempt hooks.
          expect(lane.physicalLifecycleTemplate).toBeDefined();
          expect(lane.slots).toHaveLength(evalCount * attempts);
          for (const slot of lane.slots) {
            expect(slot.action).toBe("dispatch");
            const sbPrepareLabels = slot.steps
              .filter((step) => step.phase === "sandbox.before" && step.label?.startsWith("test.group-scope-plugin:"))
              .map((step) => step.label);
            const sbAfterLabels = slot.steps
              .filter((step) => step.phase === "sandbox.after" && step.label?.startsWith("test.group-scope-plugin:"))
              .map((step) => step.label);
            expect(sbPrepareLabels).toEqual(groupMarkers.map((m) => `test.group-scope-plugin:${m}`));
            expect(sbAfterLabels).toEqual([...groupMarkers].reverse().map((m) => `test.group-scope-plugin:${m}`));

            const setupLabels = slot.steps
              .filter((step) => step.phase === "plugin.lifecycle.setup")
              .map((step) => step.label);
            const teardownLabels = slot.steps
              .filter((step) => step.phase === "plugin.lifecycle.teardown")
              .map((step) => step.label);
            expect(setupLabels).toEqual(evalMarkers.map((m) => `test.eval-plugin:${m}`));
            expect(teardownLabels).toEqual([...evalMarkers].reverse().map((m) => `test.eval-plugin:${m}`));
          }
        } finally {
          await rm(cwd, { recursive: true, force: true });
        }
      },
    ),
    { numRuns: Math.max(PROPERTY_RUNS, 2) },
  );
});
