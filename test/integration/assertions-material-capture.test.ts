import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createFixtureProject,
  runSingleAttempt,
  selectInspectionOperation,
  withOperational,
  type FixtureProject,
} from "./fixtures/adapter-trace-usage-harness/harness.ts";
import { readAssertionsList, readFullAssertionEntry } from "./fixtures/judge-harness/harness.ts";

const ADAPTER_AND_EVAL = {
  "adapters/capture.ts": `
    import { defineAdapter } from "niceeval";
    import { defineContextMatch, defineValueMatch } from "niceeval/expect";

    export const captureAdapter = defineAdapter({
      name: "material-capture",
      behaviorRevision: "1",
      create() {
        return {};
      },
      assertions({ check }) {
        return {
          checkFact(label, value, maxBytes, onEvaluate) {
            const match = defineContextMatch({
              name: "fact",
              read: () => ({ state: "available", value }),
              match: defineValueMatch({
                name: "known",
                evaluate: (captured) => {
                  onEvaluate?.(captured);
                  return true;
                },
              }),
              capture: { maxBytes },
            });
            return check(match).label(label);
          },
        };
      },
    });
  `,
  "evals/capture.eval.ts": `
    import { writeFile } from "node:fs/promises";
    import { resolve } from "node:path";
    import { satisfies } from "niceeval/expect";
    import { captureAdapter } from "../adapters/capture.ts";

    export default captureAdapter.defineEval({
      async test(t) {
        const boundaryValue = {
          'quote"': '\\u0000\\b\\t\\n\\f\\r\\\\"臺😀\\ud800',
          absent: undefined,
          array: [undefined, null, -0],
        };

        let capturedFrozen = false;
        let capturedMatched = false;
        t.checkFact("context-complete", boundaryValue, 49152, (captured) => {
          capturedFrozen = Object.isFrozen(captured);
          capturedMatched = captured.absent === undefined && captured['quote"'] === boundaryValue['quote"'];
        });
        t.onCleanup(async () => {
          await writeFile(
            resolve(import.meta.dirname, "..", "captured.json"),
            JSON.stringify({ capturedFrozen, capturedMatched, reads }),
          );
        });

        // Exact UTF-8 boundary is computed dynamically in test once we know the sealed content byte length;
        // here we also probe an intentionally tight byte budget below the serialized frame size.
        t.checkFact("context-over-limit", boundaryValue, 64);

        let reads = 0;
        const accessor = Object.defineProperty({}, "secret", {
          enumerable: true,
          get() {
            reads += 1;
            return 1;
          },
        });
        const jsonHook = {
          toJSON() {
            reads += 1;
            return 1;
          },
        };
        const sparse = new Array(2);
        const cycle = {};
        cycle.self = cycle;
        const customArray = [1];
        Object.defineProperty(customArray, "map", {
          value() {
            reads += 1;
            return [];
          },
        });

        const invalidValues = [
          ["accessor", accessor],
          ["toJSON", jsonHook],
          ["sparse", sparse],
          ["cycle", cycle],
          ["customArray", customArray],
          ["date", new Date()],
          ["map", new Map()],
          ["set", new Set()],
          ["nan", NaN],
          ["inf", Infinity],
          ["symbol", Symbol("x")],
          ["fn", () => 1],
        ];
        for (const [name, bad] of invalidValues) {
          t.checkFact("invalid-" + name, bad, 49152);
        }

        // Snapshot material capture (undefined vs function truncation)
        t.check(
          { hp: 80, attackTarget: undefined, bubble: undefined },
          satisfies("snapshot-undefined", (v) => v.hp === 80 && v.attackTarget === undefined),
        ).label("snapshot-undefined");

        t.check(
          { value: () => undefined },
          satisfies("snapshot-fn", () => true),
        ).label("snapshot-fn");

        await writeFile(resolve(import.meta.dirname, "..", "reads.json"), JSON.stringify({ reads }));
      },
    });
  `,
  "experiments/capture.ts": `
    import { defineExperiment } from "niceeval";
    import { captureAdapter } from "../adapters/capture.ts";
    export default defineExperiment({ adapter: captureAdapter, evals: ["capture"] });
  `,
};

describe("Assertion material and snapshot capture boundaries", () => {
  let project: FixtureProject;
  let locator: string;
  let exactByteProject: FixtureProject;
  let exactLocator: string;
  let exactEntries: Awaited<ReturnType<typeof readAssertionsList>>;

  beforeAll(async () => {
    project = await createFixtureProject("niceeval-material-capture", ADAPTER_AND_EVAL);
    locator = await runSingleAttempt(project.cwd, "capture");

    const entries = await readAssertionsList(project.cwd, locator);
    const completeEntryMeta = entries.find((e) => e.display.label === "context-complete")!;
    const { entry: fullComplete } = await readFullAssertionEntry(project.cwd, locator, completeEntryMeta.entryId);
    const source = fullComplete.materials.source as {
      content?: { base64?: string };
    };
    const rawJson = Buffer.from(source.content!.base64!, "base64").toString("utf8");
    const exactBytes = new TextEncoder().encode(rawJson).byteLength;

    exactByteProject = await createFixtureProject("niceeval-exact-bytes", {
      "adapters/capture.ts": ADAPTER_AND_EVAL["adapters/capture.ts"],
      "evals/exact.eval.ts": `
        import { captureAdapter } from "../adapters/capture.ts";
        export default captureAdapter.defineEval({
          test(t) {
            const boundaryValue = {
              'quote"': '\\u0000\\b\\t\\n\\f\\r\\\\"臺😀\\ud800',
              absent: undefined,
              array: [undefined, null, -0],
            };
            t.checkFact("exact-fit", boundaryValue, ${exactBytes});
            t.checkFact("one-byte-short", boundaryValue, ${exactBytes - 1});
          },
        });
      `,
      "experiments/exact.ts": `
        import { defineExperiment } from "niceeval";
        import { captureAdapter } from "../adapters/capture.ts";
        export default defineExperiment({ adapter: captureAdapter, evals: ["exact"] });
      `,
    });
    exactLocator = await runSingleAttempt(exactByteProject.cwd, "exact");
    exactEntries = await readAssertionsList(exactByteProject.cwd, exactLocator);
  }, 30_000);

  afterAll(async () => {
    await project?.dispose();
    await exactByteProject?.dispose();
  });

  // @feature docs/feature/assertions/README.md#matcher-outcomes
  test("context fact capture enforces exact UTF-8 byte limits and preserves undefined tags while freezing values", async () => {
    const entries = await readAssertionsList(project.cwd, locator);
    const completeEntryMeta = entries.find((e) => e.display.label === "context-complete")!;
    const { entry: fullComplete } = await readFullAssertionEntry(project.cwd, locator, completeEntryMeta.entryId);
    const source = fullComplete.materials.source as {
      content?: { state: string; base64?: string };
    };
    expect(fullComplete.materials.coverage).toEqual({ state: "complete" });
    const rawJson = Buffer.from(source.content!.base64!, "base64").toString("utf8");
    const parsedSource = JSON.parse(rawJson);
    expect(parsedSource.value.absent).toEqual({ $niceeval: "undefined" });

    fc.assert(
      fc.property(fc.constantFrom(0, 1), (index) => {
        const entry = exactEntries[index]!;
        if (!("entry" in entry)) throw new Error("Expected compact assertion entry");
        if (index === 0) {
          expect(entry.entry.decision.result).toBe("matched");
        } else {
          expect(entry.entry.decision).toMatchObject({ result: "unavailable", reason: "source-unavailable" });
        }
      }),
      { numRuns: 2 },
    );

    const overEntry = exactEntries[1]!;
    const { detail: overDetail } = await readFullAssertionEntry(exactByteProject.cwd, exactLocator, overEntry.entryId);
    expect(JSON.stringify(overDetail)).toContain("source-byte-limit");
  });

  // @feature docs/feature/assertions/README.md#matcher-outcomes
  test("invalid context fact shapes fail with material-not-capturable without invoking getters, toJSON, or custom array methods", async () => {
    const entries = await readAssertionsList(project.cwd, locator);
    const invalidNames = [
      "accessor",
      "toJSON",
      "sparse",
      "cycle",
      "customArray",
      "date",
      "map",
      "set",
      "nan",
      "inf",
      "symbol",
      "fn",
    ] as const;

    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...invalidNames), async (name) => {
        const meta = entries.find((e) => e.display.label === `invalid-${name}`)!;
        if (!("entry" in meta)) throw new Error("Expected assertion entry");
        expect(meta.entry.decision).toMatchObject({ result: "unavailable", reason: "source-unavailable" });
        const { detail } = await readFullAssertionEntry(project.cwd, locator, meta.entryId);
        expect(JSON.stringify(detail)).toContain("material-not-capturable");
      }),
      { numRuns: invalidNames.length },
    );

    const { readJson } = await import("./fixtures/adapter-trace-usage-harness/harness.ts");
    const capturedState = await readJson<{ capturedFrozen: boolean; capturedMatched: boolean; reads: number }>(
      project.cwd,
      "captured.json",
    );
    expect(capturedState.capturedFrozen).toBe(true);
    expect(capturedState.capturedMatched).toBe(true);
    expect(capturedState.reads).toBe(0);
  });

  // @feature docs/feature/assertions/README.md#matcher-outcomes
  test("assertion snapshot capture tags undefined fields as complete and marks unsupported values partial", async () => {
    const entries = await readAssertionsList(project.cwd, locator);
    const undefMeta = entries.find((e) => e.display.label === "snapshot-undefined")!;
    const fnMeta = entries.find((e) => e.display.label === "snapshot-fn")!;

    await withOperational(project.cwd, (facts) => {
      const undefDetail = selectInspectionOperation(facts, {
        kind: "attempt.assertion.detail",
        locator,
        entryId: undefMeta.entryId,
        projection: "full",
      }).assertion;
      if (!("entry" in undefDetail) || !("materials" in undefDetail.entry)) {
        throw new Error("Expected full assertion entry");
      }
      const undefMaterials = undefDetail.entry.materials;
      expect(undefMaterials.coverage).toEqual({ state: "complete" });
      expect(undefMaterials.limitations).toEqual([]);
      if (
        undefMaterials.source.kind !== "content" ||
        undefMaterials.source.content.state !== "available" ||
        !("base64" in undefMaterials.source.content)
      ) {
        throw new Error("Expected available inline source content");
      }
      expect(JSON.parse(Buffer.from(undefMaterials.source.content.base64, "base64").toString("utf8"))).toEqual({
        hp: 80,
        attackTarget: { $niceeval: "undefined" },
        bubble: { $niceeval: "undefined" },
      });

      const fnDetail = selectInspectionOperation(facts, {
        kind: "attempt.assertion.detail",
        locator,
        entryId: fnMeta.entryId,
        projection: "full",
      }).assertion;
      if (!("entry" in fnDetail) || !("materials" in fnDetail.entry)) {
        throw new Error("Expected full assertion entry");
      }
      const fnMaterials = fnDetail.entry.materials;
      expect(fnMaterials.coverage).toEqual({ state: "partial", reason: "truncated" });
      expect(fnMaterials.limitations).toEqual([{ kind: "truncated", omittedBytes: 15 }]);
    });
  });
});
