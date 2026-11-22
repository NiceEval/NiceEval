import { afterAll, beforeAll, expect, test } from "vitest";
import { createFixtureProject, runSingleAttempt, type FixtureProject } from "./fixtures/adapter-trace-usage-harness/harness.ts";
import { readAssertionsList, readFullAssertionEntry } from "./fixtures/judge-harness/harness.ts";

const count = 17;
const labelBytes = 250_000;
const lastFact = "material after the former budget";
let fixture: FixtureProject | undefined;
let locator: string;
let assertions: Awaited<ReturnType<typeof readAssertionsList>>;

beforeAll(async () => {
  fixture = await createFixtureProject("niceeval-attempt-material", {
    "adapters/facts.ts": `
      import { defineAdapter } from "niceeval";
      import { defineContextMatch, satisfies } from "niceeval/expect";
      export const adapter = defineAdapter({
        name: "material-facts",
        behaviorRevision: "1",
        create: () => ({}),
        assertions({ check }) {
          return {
            checkFact(label, value) {
              return check(defineContextMatch({
                name: "fact",
                read: () => ({ state: "available", value }),
                match: satisfies("original fact", (captured) => captured === value),
                capture: { maxBytes: 4 * 1024 * 1024 },
              })).label(label);
            },
          };
        },
      });
    `,
    "evals/facts.eval.ts": `
      import { adapter } from "../adapters/facts.ts";
      export default adapter.defineEval({
        test(t) {
          const large = "\\u0000".repeat(Math.floor((4 * 1024 * 1024 - 256) / 6));
          const label = "L".repeat(${labelBytes});
          for (let i = 0; i < ${count - 1}; i++) t.checkFact(label + i, large);
          t.checkFact(label + ${count - 1}, ${JSON.stringify(lastFact)});
        },
      });
    `,
    "experiments/facts.ts": `
      import { defineExperiment } from "niceeval";
      import { adapter } from "../adapters/facts.ts";
      export default defineExperiment({ adapter, evals: ["facts"] });
    `,
  });
  locator = await runSingleAttempt(fixture.cwd, "facts");
  assertions = await readAssertionsList(fixture.cwd, locator);
}, 30_000);

afterAll(async () => {
  await fixture?.dispose();
});

// @feature docs/feature/assertions/README.md#scope-and-completeness
test("an Attempt preserves every Assertion and label across the former retention and document limits", async () => {
  const cwd = fixture!.cwd;
  expect(assertions).toHaveLength(count);
  const label = "L".repeat(labelBytes);
  const missingLabels = assertions.flatMap(({ display }, index) => display.label === label + index ? [] : [index]);
  expect(missingLabels).toEqual([]);
  const unavailable = assertions.filter(({ entry }) => entry.decision.result !== "matched");
  expect(unavailable.map(({ display, entry }) => [display.label, entry.decision])).toEqual([]);

  const { entry } = await readFullAssertionEntry(cwd, locator, assertions[count - 1]!.entryId);
  expect(entry.display.label).toBe(label + (count - 1));
  const source = entry.materials.source;
  if (source.kind !== "content" || source.content.state !== "available" || !("base64" in source.content)) {
    throw new Error(`Expected published source content, got ${JSON.stringify(source)}`);
  }
  expect(JSON.parse(Buffer.from(source.content.base64, "base64").toString("utf8"))).toMatchObject({ value: lastFact });
});
