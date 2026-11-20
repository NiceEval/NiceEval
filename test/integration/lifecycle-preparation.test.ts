import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createLifecycleProject,
  scenarioArbitrary,
  showAttempt,
  type LifecycleProject,
  type Scenario,
} from "./fixtures/lifecycle-sandbox/harness.ts";

const SEED = 20_260_429;
const beforeScenarios: Scenario[] = [
  {
    scripts: [
      { cleanups: 2, beforeFails: true, test: "pass" },
      { cleanups: 1, beforeFails: false, test: "pass" },
      { cleanups: 0, beforeFails: false, test: "fail" },
    ],
    attempts: 2,
    maxConcurrency: 3,
    failCreates: [],
  },
  ...fc.sample(scenarioArbitrary({ faults: "before" }), { numRuns: 3, seed: SEED }),
];
const createScenarios: Scenario[] = [
  { scripts: [{ cleanups: 1, beforeFails: false, test: "pass" }], attempts: 2, maxConcurrency: 2, failCreates: [0] },
  ...fc.sample(scenarioArbitrary({ faults: "create" }), { numRuns: 3, seed: SEED }),
];

type Outline = Awaited<ReturnType<typeof showAttempt>>;
interface Observed {
  readonly scenario: Scenario;
  readonly project: LifecycleProject;
  readonly attempts: Array<{ evalId: string; outline: Outline }>;
}

async function observe(scenarios: readonly Scenario[]): Promise<Observed[]> {
  return Promise.all(
    scenarios.map(async (scenario) => {
      const project = await createLifecycleProject(scenario);
      const { attempts } = await project.run();
      return {
        scenario,
        project,
        attempts: await Promise.all(
          attempts.map(async ({ evalId, locator }) => ({ evalId, outline: await showAttempt(project.cwd, locator) })),
        ),
      };
    }),
  );
}

let beforeFailures: Observed[] = [];
let createFailures: Observed[] = [];

beforeAll(async () => {
  [beforeFailures, createFailures] = await Promise.all([observe(beforeScenarios), observe(createScenarios)]);
}, 60_000);

afterAll(async () => {
  await Promise.all([...beforeFailures, ...createFailures].map(({ project }) => project.dispose()));
});

const diagnostics = (outline: Outline) => outline.diagnostics.items.map(({ phase, summary }) => ({ phase, summary }));

// @feature docs/feature/sandbox/README.md#preparation-failure
test("a failing author before errors only its own Attempts, never starts the Agent, and still settles its group", () => {
  for (const { scenario, project, attempts } of beforeFailures) {
    const context = JSON.stringify({ scenario, events: project.events, attempts: attempts.map((a) => [a.evalId, a.outline.core.outcome]) });
    expect(attempts, context).toHaveLength(scenario.scripts.length * scenario.attempts);
    for (const { evalId, outline } of attempts) {
      const script = scenario.scripts[Number(evalId.slice(1))]!;
      if (script.beforeFails) {
        expect(outline.core.outcome, context).toBe("errored");
        expect(diagnostics(outline), context).toEqual([
          {
            phase: "sandbox.prepare",
            summary: expect.stringContaining(`sandbox.before.eval action "eval:${evalId}:before:0" failed: before failed for ${evalId}`),
          },
        ]);
      } else {
        expect(outline.core.outcome, context).toBe(script.test === "throw" ? "errored" : "completed");
        if (script.test !== "throw") expect(diagnostics(outline), context).toEqual([]);
      }
    }
    const started = project.events.filter((event) => event.event === "test").map((event) => event.evalId);
    for (const [index, script] of scenario.scripts.entries()) {
      const count = started.filter((evalId) => evalId === `e${index}`).length;
      expect(count, context).toBe(script.beforeFails ? 0 : scenario.attempts);
    }
    expect(project.events.filter((event) => event.event === "send" && scenario.scripts[Number(String(event.text).slice(1))]?.beforeFails), context).toEqual([]);
    const creates = project.events.filter((event) => event.event === "create");
    const stops = project.events.filter((event) => event.event === "stop");
    expect(stops.map((event) => event.sandboxId).sort(), context).toEqual(creates.map((event) => event.sandboxId).sort());
  }
});

// @feature docs/feature/sandbox/README.md#preparation-failure
test("a provider that refuses materialization errors exactly the refused Attempts and leaves nothing to settle", () => {
  for (const { scenario, project, attempts } of createFailures) {
    const context = JSON.stringify({ scenario, events: project.events });
    const total = scenario.scripts.length * scenario.attempts;
    const refused = scenario.failCreates.filter((index) => index < total).length;
    const errored = attempts.filter(({ outline }) => outline.core.outcome === "errored");
    expect(attempts, context).toHaveLength(total);
    expect(errored, context).toHaveLength(refused);
    for (const { outline } of errored) {
      expect(diagnostics(outline), context).toEqual([
        { phase: expect.any(String), summary: expect.stringContaining("provider refused materialization") },
      ]);
    }
    expect(project.events.filter((event) => event.event === "create-failed"), context).toHaveLength(refused);
    expect(project.events.filter((event) => event.event === "create"), context).toHaveLength(total - refused);
    expect(project.events.filter((event) => event.event === "stop"), context).toHaveLength(total - refused);
  }
});
