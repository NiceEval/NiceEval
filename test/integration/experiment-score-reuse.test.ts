import { createRequire } from "node:module";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createFixtureProject,
  runSingleAttempt,
  selectInspectionOperation,
  withOperational,
  type FixtureProject,
} from "./fixtures/adapter-trace-usage-harness/harness.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");

const awardedPoints = fc.sample(fc.nat(100), { seed: 20261121, numRuns: 1 })[0]!;
let project: FixtureProject;
let observed: { gaps: string[]; verdict: string | null; score: unknown };

beforeAll(async () => {
  project = await createFixtureProject("niceeval-score-reuse", {
    "adapter.ts": `
      import { defineAdapter } from "niceeval/adapter";
      export default defineAdapter({ name: "score-fixture", behaviorRevision: "1", create() { return {}; } });
    `,
    "evals/score.eval.ts": `
      // Cache-read usage is unavailable in this fixture.
      import adapter from "../adapter.ts";
      export default adapter.defineScoreEval({
        test(t) {
          t.score(${awardedPoints});
          t.score(t.usage.cacheRead.rate(), { weight: 50 });
        },
      });
    `,
    "experiments/score.ts": `
      import { defineExperiment } from "niceeval";
      import adapter from "../adapter.ts";
      export default defineExperiment({ adapter, evals: ["score"] });
    `,
  });
  const { cwd } = project;
  const locator = await runSingleAttempt(cwd, "score");
  const attempt = await withOperational(
    cwd,
    (facts) => selectInspectionOperation(facts, { kind: "attempt.get", locator }).attempt,
  );
  const plan = await Effect.runPromise(
    experimentHost.invocation.plan({ cwd, experimentSelector: "score", preview: true, config: {} }),
  );
  if (plan.status !== "ready" || !plan.dry) throw new Error(JSON.stringify(plan));
  observed = {
    verdict: attempt.verdict,
    score: attempt.score,
    gaps: plan.dry.slots.map((slot) => (slot.state === "gap" ? slot.reason : "reuse")),
  };
}, 15_000);

afterAll(async () => {
  await project?.dispose();
});

// @feature docs/feature/experiments/README.md#partial-reuse
test("an incomplete score cannot be carried when it includes unavailable scoring evidence", () => {
  expect(observed.verdict, JSON.stringify(observed)).toBe("errored");
  expect(observed.score).toMatchObject({ state: "unavailable", earned: awardedPoints });
  expect(observed.gaps, JSON.stringify(observed)).toEqual(["attempt-outcome-ineligible"]);
});
