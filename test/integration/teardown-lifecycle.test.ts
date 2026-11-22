import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");

const FIXTURE = fileURLToPath(new URL("fixtures/teardown-lifecycle/", import.meta.url));
const PROPERTY_RUNS = Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 1);

type Mode = "ok" | "slow" | "throw";
type Trigger = "sigint" | "timeout";

interface Scenario {
  readonly trigger: Trigger;
  readonly holdAt: string;
  readonly experimentPlugin: boolean;
  readonly evalPlugins: number;
  readonly teardown: Readonly<Record<string, Mode>>;
}

interface RecordedEvent {
  readonly kind: string;
  readonly unit?: string;
  readonly signalAborted?: boolean;
  readonly signalAbortedAtEnd?: boolean;
}

const unitsOf = (scenario: Pick<Scenario, "experimentPlugin" | "evalPlugins">): string[] => [
  ...(scenario.experimentPlugin ? ["x"] : []),
  ...Array.from({ length: scenario.evalPlugins }, (_, index) => `p${index}`),
  "agent",
];

/** Legal scenarios: the hold point is always a lifecycle point that exists in the generated project. */
const scenarioArbitrary: fc.Arbitrary<Scenario> = fc
  .record({
    trigger: fc.constantFrom<Trigger>("sigint", "timeout"),
    experimentPlugin: fc.boolean(),
    evalPlugins: fc.integer({ min: 0, max: 2 }),
    holdChoice: fc.nat(),
    modes: fc.array(fc.constantFrom<Mode>("ok", "slow", "throw"), { minLength: 4, maxLength: 4 }),
  })
  .map(({ trigger, experimentPlugin, evalPlugins, holdChoice, modes }) => {
    const units = unitsOf({ experimentPlugin, evalPlugins });
    const holds = trigger === "timeout" ? ["test"] : ["test", ...units.map((unit) => `${unit}.before`)];
    return {
      trigger,
      holdAt: holds[holdChoice % holds.length]!,
      experimentPlugin,
      evalPlugins,
      teardown: Object.fromEntries(units.map((unit, index) => [unit, modes[index]!])),
    };
  });

const regressions: readonly Scenario[] = [
  // Ordered cleanup chain whose callbacks are individually short but jointly outlast an exhausted budget.
  { trigger: "sigint", holdAt: "test", experimentPlugin: true, evalPlugins: 2, teardown: { x: "slow", p0: "slow", p1: "slow", agent: "slow" } },
  { trigger: "timeout", holdAt: "test", experimentPlugin: false, evalPlugins: 1, teardown: { p0: "slow", agent: "slow" } },
  { trigger: "sigint", holdAt: "test", experimentPlugin: true, evalPlugins: 1, teardown: { x: "throw", p0: "throw", agent: "throw" } },
  { trigger: "sigint", holdAt: "p0.before", experimentPlugin: true, evalPlugins: 2, teardown: { x: "ok", p0: "ok", p1: "ok", agent: "ok" } },
  { trigger: "sigint", holdAt: "x.before", experimentPlugin: true, evalPlugins: 1, teardown: { x: "slow", p0: "ok", agent: "ok" } },
  { trigger: "sigint", holdAt: "agent.before", experimentPlugin: false, evalPlugins: 2, teardown: { p0: "ok", p1: "slow", agent: "throw" } },
];

const samples: readonly Scenario[] = [
  ...regressions,
  ...fc.sample(scenarioArbitrary, { numRuns: PROPERTY_RUNS, seed: 20_261_120 }),
];

async function prepareProject(scenario: Scenario): Promise<string> {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-teardown-"));
  await cp(FIXTURE, cwd, { recursive: true });
  await Promise.all([
    mkdir(join(cwd, "evals"), { recursive: true }),
    mkdir(join(cwd, "experiments"), { recursive: true }),
    ...["events", "plugins", "agent"].map((name) => rename(join(cwd, `${name}.ts.txt`), join(cwd, `${name}.ts`))),
  ]);
  await writeFile(join(cwd, "scenario.json"), JSON.stringify(scenario));
  const plugins = Array.from({ length: scenario.evalPlugins }, (_, index) => `attemptUnit(${index})`);
  await writeFile(
    join(cwd, "evals", "held.eval.ts"),
    `import { defineEval } from "niceeval";
     import { attemptUnit } from "../plugins.ts";
     import { hold } from "../events.ts";
     export default defineEval({
       plugins: [${plugins.join(", ")}],
       async test(t) {
         const turn = await t.send("hold");
         await turn.succeeded().orStop();
         await hold("test", t.signal);
         throw new Error("the held Eval resumed after interruption");
       },
     });`,
  );
  await writeFile(
    join(cwd, "experiments", "held.ts"),
    `import { defineExperiment } from "niceeval";
     import agent from "../agent.ts";
     import { experimentUnit } from "../plugins.ts";
     export default defineExperiment({
       adapter: agent,
       evals: ["held"],
       attempts: 1,
       maxConcurrency: 1,
       ${scenario.trigger === "timeout" ? "timeoutMs: 120," : ""}
       plugins: [${scenario.experimentPlugin ? "experimentUnit" : ""}],
     });`,
  );
  return cwd;
}

async function readEvents(cwd: string): Promise<RecordedEvent[]> {
  try {
    const raw = await readFile(join(cwd, "teardown-events.ndjson"), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RecordedEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function arrangeScenario(scenario: Scenario) {
  const cwd = await prepareProject(scenario);
  try {
    const planned = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd,
        experimentSelector: "held",
        config: { maxConcurrency: 1 },
        overrides: { earlyExit: false, rerun: "all" },
      }),
    );
    if (planned.status !== "ready") throw new Error(`Expected a ready plan, got ${JSON.stringify(planned)}`);
    return { cwd, plan: planned.plan };
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

async function observeScenario(scenario: Scenario, { cwd, plan }: Awaited<ReturnType<typeof arrangeScenario>>) {
  const abort = new AbortController();
  const running = Effect.runPromise(experimentHost.invocation.run({ plan, signal: abort.signal }));
  if (scenario.trigger === "sigint") {
    // Interrupt only once the scenario's hold point is live, so the activated prefix is the one the scenario names.
    const deadline = Date.now() + 8_000;
    const state = { finished: false };
    void running.then(
      () => (state.finished = true),
      () => (state.finished = true),
    );
    while (!(await readEvents(cwd)).some((event) => event.kind === "held")) {
      if (state.finished) throw new Error("The Run finished before reaching its hold point");
      if (Date.now() > deadline) throw new Error("The hold point was never reached");
      await delay(5);
    }
    abort.abort();
  }
  const executed = await running;
  return { executed, events: await readEvents(cwd) };
}

async function runScenario(scenario: Scenario) {
  const arranged = await arrangeScenario(scenario);
  try {
    return await observeScenario(scenario, arranged);
  } finally {
    await rm(arranged.cwd, { recursive: true, force: true });
  }
}

const describeScenario = (scenario: Scenario): string =>
  `${scenario.trigger} at ${scenario.holdAt}; x=${scenario.experimentPlugin}; plugins=${scenario.evalPlugins}; ${JSON.stringify(scenario.teardown)}`;

type Observed = Awaited<ReturnType<typeof runScenario>>;

const contextOf = (scenario: Scenario, { events }: Observed): string =>
  `scenario ${JSON.stringify(scenario)}\nevents ${JSON.stringify(events)}`;

/** Activation is the order in which before callbacks started; teardown mirrors it, once, one callback at a time. */
function expectMirroredTeardown(scenario: Scenario, observed: Observed): void {
  const { events } = observed;
  const context = contextOf(scenario, observed);
  const activated = events.filter((event) => event.kind === "before").map((event) => event.unit);
  const started = events.filter((event) => event.kind === "after.started").map((event) => event.unit);
  const finished = events.filter((event) => event.kind === "after.finished").map((event) => event.unit);
  expect(started, context).toEqual([...activated].reverse());
  expect(finished, context).toEqual([...activated].reverse());
  const kinds = events.filter((event) => event.kind.startsWith("after.")).map((event) => event.kind);
  expect(kinds, context).toEqual(activated.flatMap(() => ["after.started", "after.finished"]));
}

/** Every teardown receives a signal that is live when it starts and stays live while it waits. */
function expectLiveSignals(scenario: Scenario, observed: Observed, units: (unit: string) => boolean): void {
  const context = contextOf(scenario, observed);
  for (const event of observed.events) {
    if (event.unit === undefined || !units(event.unit)) continue;
    if (event.kind === "after.started") expect(event.signalAborted, `${event.unit} started aborted\n${context}`).toBe(false);
    if (event.kind === "after.finished") {
      expect(event.signalAbortedAtEnd, `${event.unit} aborted mid-teardown\n${context}`).toBe(false);
    }
  }
}

/** The interrupted or errored outcome survives whatever the teardown callbacks did. */
function expectOriginalOutcome(scenario: Scenario, observed: Observed): void {
  const context = contextOf(scenario, observed);
  const { executed } = observed;
  if (scenario.trigger === "sigint") {
    expect(executed.receipt.completion, context).toBe("interrupted");
  } else {
    expect(executed.receipt.completion, context).toBe("completed");
    expect(executed.summary, context).toMatchObject({ total: 1, errored: 1, passed: 0 });
  }
}

// @feature docs/feature/run/README.md#interrupted-teardown
describe("interrupted and timed-out Attempts tear down every activated unit once", () => {
  // Load the Host, the Eval loader and the Direct Agent once so each scenario is measured on its own cost.
  beforeAll(async () => {
    await runScenario({ trigger: "sigint", holdAt: "test", experimentPlugin: false, evalPlugins: 0, teardown: {} });
  }, 20_000);

  describe.for(samples.map((scenario) => ({ label: describeScenario(scenario), scenario })))(
    "$label",
    ({ scenario }) => {
      let arranged: Awaited<ReturnType<typeof arrangeScenario>> | undefined;

      beforeAll(async () => {
        arranged = await arrangeScenario(scenario);
      }, 20_000);
      afterAll(async () => {
        if (arranged !== undefined) await rm(arranged.cwd, { recursive: true, force: true });
      });

      // @feature docs/feature/run/README.md#interrupted-teardown
      test("preserves the terminal outcome and tears down with live signals in reverse activation order", async () => {
        const observed = await observeScenario(scenario, arranged!);
        expectMirroredTeardown(scenario, observed);
        expectLiveSignals(scenario, observed, () => true);
        expectOriginalOutcome(scenario, observed);
      });
    },
  );
});

describe("saved regressions", () => {
  // Reduced from: sigint at test, one Experiment Plugin, every teardown ok. The Experiment-level after
  // callback used to be handed the Run's already aborted signal instead of a fresh one.
  // @feature docs/feature/run/README.md#interrupted-teardown
  test("an Experiment Plugin teardown after SIGINT receives a live signal", async () => {
    const scenario: Scenario = { trigger: "sigint", holdAt: "test", experimentPlugin: true, evalPlugins: 0, teardown: {} };
    const observed = await runScenario(scenario);
    expectLiveSignals(scenario, observed, (unit) => unit === "x");
  });

  // Reduced from: sigint while the first Eval Plugin before callback is held. The Direct Agent never
  // activated, yet its after callback used to run.
  // @feature docs/feature/run/README.md#interrupted-teardown
  test("a Direct Agent whose before never started does not tear down", async () => {
    const scenario: Scenario = { trigger: "sigint", holdAt: "p0.before", experimentPlugin: false, evalPlugins: 2, teardown: {} };
    const observed = await runScenario(scenario);
    expectMirroredTeardown(scenario, observed);
  });
});
