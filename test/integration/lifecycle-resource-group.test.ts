import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createLifecycleProject,
  scenarioArbitrary,
  type JournalEvent,
  type LifecycleProject,
  type Scenario,
} from "./fixtures/lifecycle-sandbox/harness.ts";

const SEED = 20_260_428;
const scenarios = fc.sample(scenarioArbitrary(), { numRuns: 4, seed: SEED });
// Seed examples: a failing Eval with several cleanups, and a second Attempt per Eval.
const examples: Scenario[] = [
  {
    scripts: [{ cleanups: 3, beforeFails: true, test: "fail" }, { cleanups: 2, beforeFails: false, test: "throw" }],
    attempts: 2,
    maxConcurrency: 2,
    failCreates: [],
  },
  { scripts: [{ cleanups: 0, beforeFails: false, test: "pass" }], attempts: 1, maxConcurrency: 1, failCreates: [] },
];

interface Observed {
  readonly scenario: Scenario;
  readonly project: LifecycleProject;
  readonly receiptCompletion: string;
  readonly leftover: string[];
}

function group(events: readonly JournalEvent[], sandboxId: unknown) {
  return events.filter((event) => event.sandboxId === sandboxId);
}

function positions(events: readonly JournalEvent[], pick: (event: JournalEvent) => boolean) {
  return events.flatMap((event, position) => (pick(event) ? [position] : []));
}

describe("resource groups after a completed Invocation", () => {
  const observed: Observed[] = [];

  beforeAll(async () => {
    const results = await Promise.all(
      [...examples, ...scenarios].map(async (scenario) => {
        const project = await createLifecycleProject(scenario);
        const { receipt } = await project.run();
        return { scenario, project, receiptCompletion: receipt.completion, leftover: await project.leftoverGroups() };
      }),
    );
    observed.push(...results);
  }, 60_000);

  afterAll(async () => {
    await Promise.all(observed.map(({ project }) => project.dispose()));
  });

  // @feature docs/feature/sandbox/README.md#resource-group-cleanup
  test("every materialized group is stopped exactly once and leaves no companion resource", () => {
    for (const { scenario, project, receiptCompletion, leftover } of observed) {
      const context = JSON.stringify({ scenario, events: project.events });
      expect(receiptCompletion, context).toBe("completed");
      const created = project.events.filter((event) => event.event === "create");
      expect(created.length, context).toBe(
        scenario.scripts.length * scenario.attempts - scenario.failCreates.filter((index) => index < scenario.scripts.length * scenario.attempts).length,
      );
      for (const { sandboxId } of created) {
        const stops = group(project.events, sandboxId).filter((event) => event.event === "stop");
        expect(stops, context).toHaveLength(1);
      }
      expect(leftover, context).toEqual([]);
    }
  });

  // @feature docs/feature/sandbox/README.md#resource-group-cleanup
  test("registered cleanups run in reverse registration order before their group is stopped", () => {
    for (const { scenario, project } of observed) {
      const context = JSON.stringify({ scenario, events: project.events });
      for (const sandboxId of new Set(project.events.flatMap((event) => (event.event === "create" ? [event.sandboxId] : [])))) {
        const own = group(project.events, sandboxId);
        const cleanups = own.filter((event) => event.event === "cleanup").map((event) => event.index as number);
        // Cleanups of one Attempt are a descending run: n-1, ..., 0.
        expect(cleanups, context).toEqual([...cleanups].sort((left, right) => right - left));
        expect(new Set(cleanups).size, context).toBe(cleanups.length);
        const stopAt = project.events.findIndex((event) => event.event === "stop" && event.sandboxId === sandboxId);
        for (const at of positions(project.events, (event) => event.event === "cleanup" && event.sandboxId === sandboxId)) {
          expect(at, context).toBeLessThan(stopAt);
        }
      }
    }
  });
});

describe("resource groups after an interrupted Invocation", () => {
  const interruptions = fc.sample(
    fc.record({ scenario: scenarioArbitrary({ held: true }), early: fc.boolean() }),
    { numRuns: 3, seed: SEED },
  );
  const cases: Array<{ scenario: Scenario; early: boolean }> = [
    {
      scenario: {
        scripts: [{ cleanups: 2, beforeFails: false, test: "hold" }],
        attempts: 1,
        maxConcurrency: 1,
        failCreates: [],
      },
      early: false,
    },
    ...interruptions,
  ];
  const observed: Array<{ project: LifecycleProject; completion: string; leftover: string[] }> = [];

  beforeAll(async () => {
    for (const { scenario, early } of cases) {
      const project = await createLifecycleProject(scenario);
      const running = project.run();
      // A late interruption waits until an Eval is holding resources; an early one races Invocation startup.
      if (!early) await Promise.race([project.entered(), running.then(() => undefined)]);
      project.abort.abort();
      project.release();
      const { receipt } = await running;
      observed.push({
        project,
        completion: receipt.completion,
        leftover: await project.leftoverGroups(),
      });
    }
  }, 60_000);

  afterAll(async () => {
    await Promise.all(observed.map(({ project }) => project.dispose()));
  });

  // @feature docs/feature/sandbox/README.md#resource-group-cleanup
  test("interrupting at any point still settles every created group exactly once", () => {
    for (const { project, completion, leftover } of observed) {
      const context = JSON.stringify({ events: project.events });
      expect(completion, context).toBe("interrupted");
      for (const event of project.events.filter((candidate) => candidate.event === "create")) {
        const stops = group(project.events, event.sandboxId).filter((candidate) => candidate.event === "stop");
        expect(stops, context).toHaveLength(1);
      }
      expect(leftover, context).toEqual([]);
    }
  });
});
