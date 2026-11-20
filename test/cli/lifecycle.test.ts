import { access } from "node:fs/promises";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createLifecycleProject,
  runCli,
  type LifecycleProject,
  type Scenario,
  type Script,
} from "../integration/fixtures/lifecycle-sandbox/harness.ts";

const SEED = 20_260_430;
const stepArbitrary = fc.constantFrom<Script["step"]>(undefined, "ok", "fails", "unknown-dependency");
const scenario = (steps: ReadonlyArray<Script["step"]>): Scenario => ({
  scripts: steps.map((step) => ({ cleanups: 0, beforeFails: false, test: "pass", ...(step === undefined ? {} : { step }) })),
  attempts: 1,
  maxConcurrency: 2,
  failCreates: [],
});
const stepSets: ReadonlyArray<ReadonlyArray<Script["step"]>> = [
  ["ok", "unknown-dependency"],
  ["ok", undefined],
  ["fails", "ok"],
  ...fc.sample(fc.array(stepArbitrary, { minLength: 1, maxLength: 3 }), { numRuns: 4, seed: SEED }),
];

interface Observed {
  readonly steps: ReadonlyArray<Script["step"]>;
  readonly project: LifecycleProject;
  readonly runs: Array<{ mode: string; code: number; stdout: string; stderr: string }>;
  readonly markers: boolean[];
}
const observed: Observed[] = [];

beforeAll(async () => {
  observed.push(
    ...(await Promise.all(
      stepSets.map(async (steps) => {
        const project = await createLifecycleProject(scenario(steps));
        const runs = [];
        for (const mode of ["human", "json"] as const) {
          const argv = ["exp", "lifecycle", "--rerun", "all", ...(mode === "json" ? ["--json"] : [])];
          runs.push({ mode, ...(await runCli(project.cwd, argv)) });
        }
        const markers = await Promise.all(
          steps.map((_, index) => access(join(project.cwd, `marker-e${index}`)).then(() => true, () => false)),
        );
        return { steps, project, runs, markers };
      }),
    )),
  );
}, 60_000);

afterAll(async () => {
  await Promise.all(observed.map(({ project }) => project.dispose()));
});

// @feature docs/feature/sandbox/README.md#safe-step-progress
test("an unlinkable declarative step fails planning before any Sandbox is created or any action starts", () => {
  for (const { steps, project, runs, markers } of observed) {
    const context = JSON.stringify({ steps, events: project.events, runs });
    if (steps.includes("unknown-dependency")) {
      for (const { code, stderr, stdout } of runs) {
        expect(code, context).toBe(1);
        expect(stderr, context).toContain("sandbox.before-planning-failed");
        expect(stderr, context).toContain("missing-dependency");
        expect(stdout, context).not.toContain("passed");
      }
      expect(project.events, context).toEqual([]);
      expect(markers, context).toEqual(steps.map(() => false));
    } else {
      for (const { code } of runs) {
        if (steps.includes("fails")) expect(code, context).not.toBe(0);
        else expect(code, context).toBe(0);
      }
      expect(markers, context).toEqual(steps.map((step) => step === "ok"));
    }
  }
});

// @feature docs/feature/sandbox/README.md#safe-step-progress
test("neither the human report nor machine output ever shows the declared command text", () => {
  for (const { steps, runs } of observed) {
    for (const { code, stdout, stderr, mode } of runs) {
      const context = JSON.stringify({ steps, mode, code, stdout, stderr });
      expect(`${stdout}${stderr}`, context).not.toContain("SECRET_STEP_TEXT");
    }
  }
});
