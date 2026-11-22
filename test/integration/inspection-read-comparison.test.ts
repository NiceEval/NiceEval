import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import {
  externalInspectionSource,
  openInspectionSource,
  operationalInspectionSource,
  selectInspectionOperation,
} from "../../packages/niceeval/src/inspection/index.ts";
import { openCurrentProjectSource } from "../../packages/niceeval/src/inspection/project-source.ts";
import { judgeUsageChatResponse, startJudgeUsageEmulator } from "./fixtures/inspection-core/judge-http.ts";
import { startModelEmulator } from "./fixtures/model-emulator.ts";

const SANDBOX_FIXTURE = fileURLToPath(new URL("fixtures/inspection-core/sandbox.ts.txt", import.meta.url));
const LEGACY_V4_RECORD = fileURLToPath(new URL("fixtures/inspection-core/assertions-v4.sqlite", import.meta.url));
const LARGE_DIFF_REPEATS = 700_000;
const EXTRA_DIFF_CHANGES = 129;
const EXTRA_DIFF_DIRECTORY = `changes-${"a".repeat(150)}/changes-${"b".repeat(150)}`;
const PAGED_DIFF_REPEATS = 7_000;

type RunId = import("../../packages/niceeval/src/inspection/public.ts").InspectionOperationFor<"run.get">["runId"];
type ExperimentId = import("../../packages/niceeval/src/inspection/public.ts").InspectionOperationFor<"experiment.get">["experimentId"];
type AssertionEntryId = import("../../packages/niceeval/src/inspection/public.ts").InspectionOperationFor<"attempt.assertion.detail">["entryId"];

async function runProjectExperiment(
  cwd: string,
  experimentSelector: string,
  options: {
    readonly rerun?: "all" | "failed";
    readonly evalSelectors?: readonly string[];
    readonly pricing?: Record<string, { readonly inputPerMTok: number; readonly outputPerMTok: number }>;
  } = {},
) {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector,
      ...(options.evalSelectors === undefined ? {} : { evalSelectors: [...options.evalSelectors] }),
      config: {
        maxConcurrency: 1,
        ...(options.pricing === undefined ? {} : { pricing: options.pricing }),
      },
      overrides: { rerun: options.rerun ?? "all" },
    }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan ${experimentSelector}: ${JSON.stringify(planned)}`);
  return Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
}

function withOperational<A>(
  cwd: string,
  run: (facts: import("../../packages/niceeval/src/inspection/index.ts").InspectionFactSource) => A,
): Promise<A> {
  return Effect.runPromise(
    Effect.scoped(openInspectionSource(operationalInspectionSource(cwd)).pipe(Effect.map(run))),
  );
}

function withExternal<A>(
  cwd: string,
  recordPath: string,
  run: (facts: import("../../packages/niceeval/src/inspection/index.ts").InspectionFactSource) => A,
): Promise<A> {
  return Effect.runPromise(
    Effect.scoped(openInspectionSource(externalInspectionSource(cwd, recordPath)).pipe(Effect.map(run))),
  );
}

function withCurrentProject<A>(
  cwd: string,
  run: (facts: import("../../packages/niceeval/src/inspection/index.ts").InspectionFactSource) => A,
  experimentIds?: readonly string[],
): Promise<A> {
  return Effect.runPromise(
    Effect.scoped(
      openCurrentProjectSource({
        cwd,
        config: { maxConcurrency: 1 },
        ...(experimentIds === undefined ? {} : { experimentIds }),
      }).pipe(Effect.map(run)),
    ),
  );
}

function expectOperationCode(fn: () => unknown, expectedCode: string) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code: expectedCode });
}

async function publishedSlotLocators(cwd: string, runId: string) {
  const detail = await Effect.runPromise(runHost.get({ cwd, runId }));
  return new Map(
    detail.run.slots.flatMap((slot) =>
      slot.publication.state === "published" ? ([[slot.evalId, slot.publication.attemptLocator]] as const) : [],
    ),
  );
}

describe("exact read and comparison: runs, overview, matrix, diff, and notes", () => {
  let cwd: string;
  let passRunId: RunId;
  let scoreRunId: RunId;
  let matrixBaseRunId: RunId;
  let matrixNextRunId: RunId;
  let stoppedLocator: string;
  let diffLocator: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-inspection-read-"));
    await Promise.all(["evals", "experiments", "adapters", "node_modules"].map((dir) => mkdir(join(cwd, dir))));
    await Promise.all([
      symlink(dirname(fileURLToPath(import.meta.resolve("effect/package.json"))), join(cwd, "node_modules", "effect"), "junction"),
      writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(join(cwd, "sandbox.ts"), await readFile(SANDBOX_FIXTURE, "utf8")),
      writeFile(
        join(cwd, "adapters", "core.ts"),
        `
        import { defineAdapter } from "niceeval";
        import { completeEvidenceCoverage, defineAgent, defineSandboxAgent } from "niceeval/adapter";
        import { shell } from "niceeval/sandbox";
        export const plainAdapter = defineAdapter({ name: "plain", behaviorRevision: "1", create: () => ({}) });
        export const passAgent = defineAgent({
          name: "pass-agent",
          evidenceCoverage: completeEvidenceCoverage,
          send: async () => ({ status: "completed", events: [] }),
        });
        export const diffAgent = defineSandboxAgent({
          name: "diff-body",
          evidenceCoverage: completeEvidenceCoverage,
          install: { identity: { agent: "diff-body", version: "1", revision: "1" }, probe: shell("true") },
          async send(_input, ctx) {
            await ctx.sandbox.writeText("small.txt", "after\\n");
            await ctx.sandbox.writeText("large.txt", "新".repeat(${LARGE_DIFF_REPEATS}) + "\\n");
            await ctx.sandbox.writeText("paged.txt", "新".repeat(${PAGED_DIFF_REPEATS}) + "\\n");
            await ctx.sandbox.writeText("binary.txt", "now text\\n");
            await ctx.sandbox.runShellOrThrow([
              'set -eu',
              'mkdir -p "${EXTRA_DIFF_DIRECTORY}"',
              'cd "${EXTRA_DIFF_DIRECTORY}"',
              'i=0',
              'while [ "$i" -lt ${EXTRA_DIFF_CHANGES} ]; do printf "new\\\\n" > "extra-$i.txt"; i=$((i + 1)); done',
            ].join("\\n"));
            return { status: "completed", events: [] };
          },
        });
      `,
      ),
      writeFile(
        join(cwd, "evals", "pass-ok.eval.ts"),
        `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineEval({ test(t) { t.check(1, equals(1)).label("ok"); } });`,
      ),
      writeFile(
        join(cwd, "evals", "pass-fail.eval.ts"),
        `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineEval({ test(t) { t.check(1, equals(2)).label("fail"); } });`,
      ),
      writeFile(
        join(cwd, "evals", "stopped.eval.ts"),
        `import { defineScoreEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineScoreEval({ async test(t) {
           t.score(1).label("earned");
           await t.check(false, equals(true)).label("stop only").orStop();
           t.check(false, equals(true)).gate().label("must not run");
         } });`,
      ),
      writeFile(
        join(cwd, "evals", "notes-fast.eval.ts"),
        `import { plainAdapter } from "../adapters/core.ts"; import { ms } from "niceeval/expect";
         export default plainAdapter.defineEval({ test(t) {
           t.note("latency", ms(100)); t.note("load", 2); t.note("metadata", { ready: true });
         } });`,
      ),
      writeFile(
        join(cwd, "evals", "notes-slow.eval.ts"),
        `import { plainAdapter } from "../adapters/core.ts"; import { ms } from "niceeval/expect";
         export default plainAdapter.defineEval({ test(t) {
           t.note("latency", ms(300)); t.note("load", 4);
         } });`,
      ),
      writeFile(
        join(cwd, "evals", "notes-other-unit.eval.ts"),
        `import { plainAdapter } from "../adapters/core.ts"; import { seconds } from "niceeval/expect";
         export default plainAdapter.defineEval({ test(t) {
           t.note("latency", seconds(2));
         } });`,
      ),
      writeFile(
        join(cwd, "evals", "notes-no-unit.eval.ts"),
        `import { plainAdapter } from "../adapters/core.ts";
         export default plainAdapter.defineEval({ test(t) {
           t.note("latency", 50);
         } });`,
      ),
      writeFile(
        join(cwd, "evals", "notes-missing.eval.ts"),
        `import { plainAdapter } from "../adapters/core.ts";
         export default plainAdapter.defineEval({ test(t) {
           t.note("latency", null); t.note("metadata", "ignored");
         } });`,
      ),
      writeFile(
        join(cwd, "evals", "matrix.eval.ts"),
        `import { defineScoreEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineScoreEval({ test(t) {
           const next = t.flags.variant === "next";
           t.check(next, equals(true)).score(2).label("Changed criterion");
           t.check(true, equals(true)).score(1).label("Duplicate criterion");
           t.check(false, equals(true)).score(1).label("Duplicate criterion");
           t.check(true, equals(true)).label("Label identity");
           if (!next) t.check(true, equals(true)).label("Only baseline");
           t.check(true, equals(true)).group("Unlabeled group");
           t.check(true, equals(true)).group("Separate group").label("Label identity");
         } });`,
      ),
      writeFile(
        join(cwd, "evals", "diff-body.eval.ts"),
        `import { defineScoreEval } from "niceeval";
         export default defineScoreEval({ async test(t) {
           await t.sandbox.writeText("small.txt", "before\\n");
           await t.sandbox.writeText("large.txt", "旧".repeat(${LARGE_DIFF_REPEATS}) + "\\n");
           await t.sandbox.writeText("paged.txt", "旧".repeat(${PAGED_DIFF_REPEATS}) + "\\n");
           await t.sandbox.writeBytes("binary.txt", new Uint8Array([0, 1, 2, 3]));
           await t.send("change files");
           t.score(1);
         } });`,
      ),
      writeFile(
        join(cwd, "experiments", "pass-exp.ts"),
        `import { defineExperiment } from "niceeval"; import { passAgent } from "../adapters/core.ts";
         export default defineExperiment({ adapter: passAgent, evals: ["pass-ok", "pass-fail"], labels: { memory: "semantic", shared: "same", firstOnly: "present" }, flags: { privateExecutionFlag: "secret" } });`,
      ),
      writeFile(
        join(cwd, "experiments", "pass-exp-b.ts"),
        `import { defineExperiment } from "niceeval"; import { passAgent } from "../adapters/core.ts";
         export default defineExperiment({ adapter: passAgent, evals: ["pass-ok"], labels: { zero: 0, zeroStr: "0", shared: "same" } });`,
      ),
      writeFile(
        join(cwd, "experiments", "stopped-exp.ts"),
        `import { defineExperiment } from "niceeval"; import { passAgent } from "../adapters/core.ts";
         export default defineExperiment({ adapter: passAgent, evals: ["stopped"] });`,
      ),
      writeFile(
        join(cwd, "experiments", "notes-exp.ts"),
        `import { defineExperiment } from "niceeval"; import { plainAdapter } from "../adapters/core.ts";
         export default defineExperiment({ adapter: plainAdapter, evals: ["notes-fast", "notes-slow", "notes-other-unit", "notes-no-unit", "notes-missing"] });`,
      ),
      writeFile(
        join(cwd, "experiments", "matrix-base.ts"),
        `import { defineExperiment } from "niceeval"; import { passAgent } from "../adapters/core.ts";
         export default defineExperiment({ adapter: passAgent, evals: ["matrix"], attempts: 2 });`,
      ),
      writeFile(
        join(cwd, "experiments", "matrix-next.ts"),
        `import { defineExperiment } from "niceeval"; import { passAgent } from "../adapters/core.ts";
         export default defineExperiment({ adapter: passAgent, evals: ["matrix"], flags: { variant: "next" } });`,
      ),
      writeFile(
        join(cwd, "experiments", "diff-exp.ts"),
        `import { defineExperiment } from "niceeval"; import sandbox from "../sandbox.ts"; import { diffAgent } from "../adapters/core.ts";
         export default defineExperiment({ adapter: diffAgent, sandbox, evals: ["diff-body"] });`,
      ),
    ]);

    passRunId = (await runProjectExperiment(cwd, "pass-exp")).receipt.createdRunIds[0]! as RunId;
    await runProjectExperiment(cwd, "pass-exp-b");
    scoreRunId = (await runProjectExperiment(cwd, "stopped-exp")).receipt.createdRunIds[0]! as RunId;
    stoppedLocator = (await publishedSlotLocators(cwd, scoreRunId)).get("stopped")!;
    await runProjectExperiment(cwd, "notes-exp");
    matrixBaseRunId = (await runProjectExperiment(cwd, "matrix-base")).receipt.createdRunIds[0]! as RunId;
    matrixNextRunId = (await runProjectExperiment(cwd, "matrix-next")).receipt.createdRunIds[0]! as RunId;
    const diffRunId = (await runProjectExperiment(cwd, "diff-exp")).receipt.createdRunIds[0]!;
    diffLocator = (await publishedSlotLocators(cwd, diffRunId)).get("diff-body")!;
  }, 120_000);

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("run, overview, and experiment notes keep exact denominators, labels, and stoppedAt state", async () => {
    await withOperational(cwd, (facts) => {
      const overview = selectInspectionOperation(facts, { kind: "overview.get" }).overview;
      const passExp = overview.experiments.find((item) => item.experimentId === "pass-exp")!;
      expect(passExp.labels).toMatchObject({
        memory: { state: "available", value: "semantic" },
        shared: { state: "available", value: "same" },
      });
      const passExpB = overview.experiments.find((item) => item.experimentId === "pass-exp-b")!;
      expect(passExpB.labels).toEqual({
        shared: { state: "available", value: "same" },
        zero: { state: "available", value: 0 },
        zeroStr: { state: "available", value: "0" },
      });
      const stoppedAttempt = selectInspectionOperation(facts, {
        kind: "attempt.get",
        locator: stoppedLocator,
      }).attempt;
      const stopEntry = stoppedAttempt.assertions.entries.find((entry) => entry.display.label === "stop only")!;
      expect(stoppedAttempt).toMatchObject({
        verdict: "passed",
        stoppedAt: { state: "available", value: { entryId: stopEntry.entryId, label: "stop only" } },
      });
      expect(stoppedAttempt.assertions.entries.map((item) => item.display.label)).not.toContain("must not run");

      const notesExp = selectInspectionOperation(facts, {
        kind: "experiment.get",
        experimentId: "notes-exp" as ExperimentId,
      }).experiment;
      expect(notesExp.notes).toHaveLength(4);
      expect(notesExp.notes).toEqual(
        expect.arrayContaining([
          { label: "latency", unit: "ms", count: 2, min: 100, median: 200, p90: 280, max: 300 },
          { label: "latency", unit: "seconds", count: 1, min: 2, median: 2, p90: 2, max: 2 },
          { label: "latency", count: 1, min: 50, median: 50, p90: 50, max: 50 },
          { label: "load", count: 2, min: 2, median: 3, p90: 3.8, max: 4 },
        ]),
      );
    });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("runs.compare honors mode denominators, exactMemberSet, and missing Run issues across fast-check choices", async () => {
    await withOperational(cwd, (facts) => {
      fc.assert(
        fc.property(
          fc.constantFrom("paired", "side-by-side", "exact"),
          fc.constantFrom(
            [passRunId, passRunId, true] as const,
            [passRunId, scoreRunId, false] as const,
            [matrixBaseRunId, matrixNextRunId, false] as const,
            [passRunId, "run_missing0000000000000000" as RunId, false] as const,
          ),
          (mode, [leftRunId, rightRunId, expectedExact]) => {
            const doc = selectInspectionOperation(facts, {
              kind: "runs.compare",
              mode,
              leftRunIds: [leftRunId],
              rightRunIds: [rightRunId],
            });
            expect(doc.comparison.mode).toBe(mode);
            expect(doc.comparison.exactMemberSet).toBe(expectedExact);
            if (mode === "side-by-side") {
              expect(doc.comparison.pairs).toEqual([]);
            } else if (expectedExact) {
              expect(doc.comparison.pairs.length).toBe(doc.comparison.left.members.length);
            }
            if (mode === "exact" && !expectedExact) {
              expect(doc.issues).toEqual(
                expect.arrayContaining([expect.objectContaining({ code: "comparison-member-set-mismatch" })]),
              );
            }
            if (rightRunId === "run_missing0000000000000000") {
              expect(doc.issues).toEqual(
                expect.arrayContaining([expect.objectContaining({ code: "selection-run-missing", side: "right" })]),
              );
            }
          },
        ),
        { numRuns: 12, seed: 2040 },
      );
    });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("experiments.assertions preserves duplicate criteria, absent cells, prefix filtering, and partial bounds", async () => {
    await withOperational(cwd, (facts) => {
      const filtered = selectInspectionOperation(facts, {
        kind: "experiments.assertions",
        experimentIds: ["matrix-next", "matrix-base", "matrix-base"] as ExperimentId[],
        evalIdPrefix: "matrix",
      }).matrix;
      expect(filtered).toMatchObject({
        state: "complete",
        experimentIds: ["matrix-base", "matrix-next"],
        omitted: { evals: 0, rows: 0, columns: 0 },
      });
      const matrixEval = filtered.evals.find((item) => item.evalId === "matrix")!;
      expect(matrixEval.columns.map(({ experimentId, attemptOrdinal }) => [experimentId, attemptOrdinal])).toEqual([
        ["matrix-base", 0],
        ["matrix-base", 1],
        ["matrix-next", 0],
      ]);
      expect(matrixEval.unlabeled).toEqual([1, 1, 1]);
      expect(matrixEval.rows.filter((row) => row.label === "Label identity")).toHaveLength(2);
      expect(matrixEval.rows.find((row) => row.label === "Changed criterion")?.distinct).toBe(true);
      expect(matrixEval.rows.find((row) => row.label === "Duplicate criterion")?.cells).toEqual(
        [0, 1, 2].map(() => ({
          state: "available",
          entries: [
            expect.objectContaining({ contribution: { state: "earned", points: 1, earned: 1 } }),
            expect.objectContaining({ contribution: { state: "earned", points: 1, earned: 0 } }),
          ],
        })),
      );
      expect(matrixEval.rows.find((row) => row.label === "Only baseline")?.cells[2]).toEqual({ state: "absent" });

      expectOperationCode(
        () =>
          selectInspectionOperation(facts, {
            kind: "experiments.assertions",
            experimentIds: ["does-not-exist" as ExperimentId],
          }),
        "inspection-selection-missing",
      );
    });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("attempt.diff retains large revisions and paginates changes and UTF-8 text losslessly", async () => {
    await withOperational(cwd, (facts) => {
      const list = { kind: "attempt.diff", locator: diffLocator } as const;
      const listPage = (continuation?: string) => {
        const request = continuation === undefined ? list : { ...list, continuation };
        const result = selectInspectionOperation(facts, request).diff;
        if (result.state !== "complete") throw new Error("Expected complete diff page");
        return result;
      };
      let listed = listPage();
      const expected = [
        "binary.txt",
        "large.txt",
        "paged.txt",
        "small.txt",
        ...Array.from({ length: EXTRA_DIFF_CHANGES }, (_, index) => `${EXTRA_DIFF_DIRECTORY}/extra-${index}.txt`),
      ].sort();
      const changes = [...listed.windows.flatMap((window) => window.changes)];
      expect(listed.continuation).toEqual(expect.any(String));
      while (listed.continuation !== undefined) {
        expect(listed.omittedChangeCount).toBe(expected.length - changes.length);
        listed = listPage(listed.continuation);
        changes.push(...listed.windows.flatMap((window) => window.changes));
      }
      expect(listed.omittedChangeCount).toBe(0);
      expect(changes.map((change) => change.path)).toEqual(expected);

      const lookup = (path: string, continuation?: string) => {
        const { changeId } = changes.find((item) => item.path === path)!;
        const response = selectInspectionOperation(facts, {
          ...list,
          changeId,
          ...(continuation === undefined ? {} : { continuation }),
        }).diff;
        if (!("detail" in response) || response.detail === undefined) throw new Error("Expected file change detail");
        return { detail: response.detail, continuation: response.continuation };
      };
      expect(lookup("small.txt").detail).toMatchObject({
        before: { state: "available", text: "before\n", truncated: false },
        after: { state: "available", text: "after\n", truncated: false },
        hunks: {
          state: "available",
          text: "--- a/small.txt\n+++ b/small.txt\n@@ -1,1 +1,1 @@\n-before\n+after\n",
        },
      });
      expect(lookup("binary.txt").detail).toMatchObject({
        before: { state: "binary" },
        after: { state: "binary" },
        hunks: { state: "unavailable", text: "" },
      });

      // This detail read verifies the whole stored text against the declared digest before returning its page.
      const large = changes.find((change) => change.path === "large.txt")!;
      const verified = lookup("large.txt").detail;
      for (const [side, character] of [["before", "旧"], ["after", "新"]] as const) {
        const text = character.repeat(LARGE_DIFF_REPEATS) + "\n";
        expect(large[side]).toMatchObject({
          state: "present",
          revision: {
            kind: "text",
            content: "available",
            byteLength: Buffer.byteLength(text),
            sha256: createHash("sha256").update(text).digest("hex"),
          },
        });
        const page = verified[side];
        if (page.state !== "available") throw new Error(`Expected large ${side} text`);
        expect(page.text).toBe(character.repeat(page.endOffset / 3));
        expect(page.omittedBytes).toBe(Buffer.byteLength(text) - page.endOffset);
      }

      let current = lookup("paged.txt");
      expect(current.continuation).toEqual(expect.any(String));
      expectOperationCode(
        () => selectInspectionOperation(facts, { ...list, continuation: current.continuation }),
        "restart-required",
      );
      const bodies = { before: "", after: "", hunks: "" };
      const endOffsets = { before: 0, after: 0, hunks: 0 };
      while (true) {
        for (const key of ["before", "after", "hunks"] as const) {
          const part = current.detail[key];
          if (part.state !== "available") throw new Error(`Expected available ${key}, got ${part.state}`);
          expect(part.offset).toBe(endOffsets[key]);
          expect(part.omittedBytes).toBe(part.byteLength - part.endOffset);
          expect(part.endOffset - part.offset).toBe(Buffer.byteLength(part.text));
          endOffsets[key] = part.endOffset;
          bodies[key] += part.text;
        }
        if (current.continuation === undefined) break;
        current = lookup("paged.txt", current.continuation);
      }
      const before = "旧".repeat(PAGED_DIFF_REPEATS) + "\n";
      const after = "新".repeat(PAGED_DIFF_REPEATS) + "\n";
      expect(bodies).toEqual({
        before,
        after,
        hunks: `--- a/paged.txt\n+++ b/paged.txt\n@@ -1,1 +1,1 @@\n-${before}+${after}`,
      });
    });
  });
});

describe("exact read and comparison: matrix byte bounds and large assertion lists", () => {
  let cwd: string;
  let largeListLocator: string;
  let largeListEntryIds: AssertionEntryId[];

  beforeAll(async () => {
    cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-inspection-heavy-"));
    await Promise.all(["evals", "experiments"].map((dir) => mkdir(join(cwd, dir))));
    await Promise.all([
      writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(
        join(cwd, "agent.ts"),
        `import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
         export const passAgent = defineAgent({ name: "heavy-agent", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) });`,
      ),
      writeFile(
        join(cwd, "evals", "matrix-bulk.eval.ts"),
        `import { defineScoreEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineScoreEval({ test(t) { t.check(true, equals(true)).label("bulk-criterion"); } });`,
      ),
      writeFile(
        join(cwd, "evals", "large-list.eval.ts"),
        `import { defineScoreEval } from "niceeval"; import { defineMaterialMatch, includes } from "niceeval/expect";
         export default defineScoreEval({ test(t) {
           const material = defineMaterialMatch({
             name: "large-list-material",
             capture: { maxBytes: 1024 * 1024, maxItems: 16, maxNodes: 128, maxDepth: 16 },
             read: () => ({ state: "complete", items: [{ id: "large", value: "large-material-marker" + "x".repeat(512 * 1024) }] }),
             match: includes("large-material-marker"),
           });
           for (let index = 0; index < 80; index += 1) t.check(material).score(1).label("Entry " + index);
         } });`,
      ),
      writeFile(
        join(cwd, "experiments", "matrix-bulk-base.ts"),
        `import { defineExperiment } from "niceeval"; import { passAgent } from "../agent.ts";
         export default defineExperiment({ adapter: passAgent, evals: ["matrix-bulk"], attempts: 51 });`,
      ),
      writeFile(
        join(cwd, "experiments", "matrix-bulk-next.ts"),
        `import { defineExperiment } from "niceeval"; import { passAgent } from "../agent.ts";
         export default defineExperiment({ adapter: passAgent, evals: ["matrix-bulk"], attempts: 50, flags: { variant: "next" } });`,
      ),
      writeFile(
        join(cwd, "experiments", "large-list.ts"),
        `import { defineExperiment } from "niceeval"; import { passAgent } from "../agent.ts";
         export default defineExperiment({ adapter: passAgent, evals: ["large-list"] });`,
      ),
    ]);
    await runProjectExperiment(cwd, "matrix-bulk-base");
    await runProjectExperiment(cwd, "matrix-bulk-next");
    const listRunId = (await runProjectExperiment(cwd, "large-list")).receipt.createdRunIds[0]!;
    largeListLocator = (await publishedSlotLocators(cwd, listRunId)).get("large-list")!;
    await withOperational(cwd, (facts) => {
      largeListEntryIds = selectInspectionOperation(facts, {
        kind: "attempt.get",
        locator: largeListLocator,
      }).attempt.assertions.entries.map((entry) => entry.entryId as AssertionEntryId);
    });
  }, 120_000);

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("experiments.assertions enforces partial byte and column bounds cleanly", async () => {
    await withOperational(cwd, (facts) => {
      const fullMatrix = selectInspectionOperation(facts, {
        kind: "experiments.assertions",
        experimentIds: ["matrix-bulk-base", "matrix-bulk-next"] as ExperimentId[],
      }).matrix;
      expect(fullMatrix.state).toBe("partial");
      expect(fullMatrix.omitted.columns).toBeGreaterThan(0);
      expect(fullMatrix.evals.flatMap((item) => item.columns).length).toBeLessThanOrEqual(100);
      expect(Buffer.byteLength(JSON.stringify(fullMatrix.evals))).toBeLessThanOrEqual(450_000);
    });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("compact assertion lists omit large materials and isolate per-entry read deadlines", async () => {
    await withOperational(cwd, (facts) => {
      let now = 1_000_000;
      const spy = vi.spyOn(Date, "now").mockImplementation(() => {
        now += 100;
        return now;
      });
      try {
        const listed = selectInspectionOperation(facts, {
          kind: "attempt.assertions",
          locator: largeListLocator,
          projection: "compact",
        });
        expect(listed.assertions.map((item) => ("entryId" in item ? item.entryId : ""))).toEqual(largeListEntryIds);
        for (const item of listed.assertions) {
          expect(item).not.toHaveProperty("failure");
          expect(JSON.stringify(item)).not.toContain("large-material-markerxxx");
        }
      } finally {
        spy.mockRestore();
      }

      const firstEntryId = largeListEntryIds[0]!;
      const full = selectInspectionOperation(facts, {
        kind: "attempt.assertion.detail",
        locator: largeListLocator,
        entryId: firstEntryId,
        projection: "full",
      }).assertion;
      if (!("fields" in full)) throw new Error("Expected a paged full assertion detail");
      expect(full.fields.find(({ path }) => path === "/entry/materials/source/content/base64")).toMatchObject({
        offset: 0,
        nextOffset: expect.any(Number),
        encoding: "content-base64",
      });

      let expiredNow = 1_000_000;
      const expireSpy = vi.spyOn(Date, "now").mockImplementation(() => {
        expiredNow += 35_000;
        return expiredNow;
      });
      try {
        expectOperationCode(
          () =>
            selectInspectionOperation(facts, {
              kind: "attempt.assertion.detail",
              locator: largeListLocator,
              entryId: firstEntryId,
              projection: "full",
            }),
          "inspection-read-deadline-exceeded",
        );
      } finally {
        expireSpy.mockRestore();
      }
    });
  });
});

describe("exact read and comparison: usage, judge usage, repricing, and experiment cost", () => {
  let cwd: string;
  let modelRolesCostLocator: string;
  let modelRolesTruncatedLocator: string;
  let modelRolesUsageLocator: string;
  let sealEmptyLocator: string;
  let sealPartialLocator: string;
  let sealCaughtLocator: string;
  let unsealedLocator: string;
  let judgeEmptyLocator: string;
  let judgeInvalidQaLocator: string;
  let judgePricingLocator: string;
  let judgeReportedLocator: string;
  let judgeRetryLocator: string;
  let judgeTokensLocator: string;
  let judgeImageLocator: string;
  let judgeImageEntryId: AssertionEntryId;
  let judgeImageId: string;
  let expCostInitialTotal: string;
  let expCostReplacementTotal: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-inspection-usage-"));
    await Promise.all(["evals", "experiments", "adapters"].map((dir) => mkdir(join(cwd, dir))));
    const fixture = await startJudgeUsageEmulator([
      {
        status: 200,
        body: judgeUsageChatResponse(
          { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.02 },
          { invalidQA: true, provider: "router-serving" },
        ),
      },
      {
        status: 200,
        body: judgeUsageChatResponse({
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 20 },
        }),
      },
      {
        status: 503,
        body: {
          error: { message: "Private provider failure detail" },
          model: "judge-usage-served",
          provider: "router-serving",
          usage: {
            prompt_tokens: 120,
            completion_tokens: 30,
            total_tokens: 150,
            prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
            cost: "0.002",
          },
        },
      },
      {
        status: 200,
        body: judgeUsageChatResponse(
          {
            prompt_tokens: 120,
            completion_tokens: 30,
            total_tokens: 150,
            prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
            cost: 0,
          },
          { provider: "router-serving" },
        ),
      },
      {
        status: 503,
        body: {
          error: { message: "Private provider failure detail" },
          model: "judge-usage-served",
          provider: "router-serving",
          usage: {
            prompt_tokens: 120,
            completion_tokens: 30,
            total_tokens: 150,
            prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
            cost: 0.01,
          },
        },
      },
      {
        status: 200,
        body: judgeUsageChatResponse(
          {
            prompt_tokens: 120,
            completion_tokens: 30,
            total_tokens: 150,
            prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
            cost: "0",
          },
          { provider: "router-serving" },
        ),
      },
      {
        status: 200,
        body: judgeUsageChatResponse({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, { screenshot: true }),
      },
    ]);
    const verdictCausesFixture = await startModelEmulator([
      {
        id: "offline-judge",
        match: { model: "offline" },
        error: { status: 502, message: "Offline Judge unavailable", headers: { "Retry-After": "0" } },
      },
    ]);
    const { baseUrl } = fixture;
    const { baseUrl: verdictCausesUrl } = verdictCausesFixture;
    try {
      await Promise.all([
        writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
        writeFile(
          join(cwd, "niceeval.config.ts"),
          `import { defineConfig } from "niceeval";
           export default defineConfig({
             timeoutMs: 60_000, maxConcurrency: 1,
             pricing: { "inspection-fixture-v1": { inputPerMTok: 1, outputPerMTok: 2 } },
           });`,
        ),
        writeFile(
          join(cwd, "adapters", "usage.ts"),
          `
          import { defineAdapter, type AdapterUsageInput } from "niceeval";
          import { defineMaterialMatch, defineValueMatch } from "niceeval/expect";
          export const rolesAdapter = defineAdapter({
            name: "model-roles",
            behaviorRevision: "1",
            create(ctx) {
              return {
                selectedModel(slot: string) {
                  const selection = ctx.models[slot];
                  if (selection?.model == null) throw new Error(\`Missing model for \${slot}\`);
                  return selection.model;
                },
                record(usage: AdapterUsageInput) { ctx.recordUsage(usage); },
                finishUsage() { ctx.sealUsage({ state: "complete" }); },
              };
            },
          });
          export const sealAdapter = defineAdapter({
            name: "usage-seal",
            behaviorRevision: "1",
            create(ctx) {
              return {
                recordKnownCost() {
                  ctx.recordUsage({
                    callId: "accepted", provider: "offline-application", model: "application-model", status: "succeeded",
                    inputTokens: 4, inputTotalTokens: 4, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
                    cost: { amount: "0.125", currency: "USD", source: { kind: "reported", id: "offline.response" } },
                  });
                },
                finishComplete() { ctx.sealUsage({ state: "complete" }); },
                finishPartial() { ctx.sealUsage({ state: "partial", reason: "journal-not-sealed" }); },
                catchWriteAfterSeal() {
                  try {
                    ctx.recordUsage({
                      callId: "after-seal", provider: "offline-application", model: "application-model", status: "succeeded",
                      inputTokens: 8, inputTotalTokens: 8, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0,
                      cost: { amount: "0.875", currency: "USD", source: { kind: "reported", id: "offline.response" } },
                    });
                    return false;
                  } catch { return true; }
                },
              };
            },
          });
          export const unsealedAdapter = defineAdapter({ name: "usage-unsealed", behaviorRevision: "1", create: () => ({}) });
          export const expCostAdapter = defineAdapter({
            name: "experiment-cost",
            behaviorRevision: "1",
            create(ctx) {
              return {
                recordCost(amount: string | undefined, status: "succeeded" | "failed" = "succeeded") {
                  ctx.recordUsage({
                    callId: "application-request", provider: "offline-application", model: "fixture/experiment-cost",
                    status, inputTokens: 1, inputTotalTokens: 1, outputTokens: 0,
                    ...(amount === undefined ? {} : { cost: { amount, currency: "USD", source: { kind: "reported", id: "offline.receipt" } } }),
                  });
                  ctx.sealUsage({ state: "complete" });
                },
              };
            },
          });
          export const judgeAppAdapter = defineAdapter({
            name: "judge-usage-app",
            behaviorRevision: "1",
            create(ctx) {
              ctx.diagnostic({ code: "inspection-advisory", level: "warning", message: "Optional telemetry unavailable" });
              return {
                history() { return [{ id: "answer-1", value: "Paris is the capital of France." }]; },
                recordAppUsage() {
                  ctx.recordUsage({
                    callId: "application-1", provider: "offline-application", model: "application-model", status: "succeeded",
                    inputTokens: 4, inputTotalTokens: 4, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
                    cost: { amount: "0.25", currency: "USD", source: { kind: "reported", id: "offline-application.response" } },
                  });
                  ctx.sealUsage({ state: "complete" });
                },
              };
            },
          });
          const answer = defineValueMatch<string>({ name: "answer-present", evaluate: (text) => text.length > 0 });
          type HistoryCtx = { history(): readonly { id: string; value: string }[] };
          export const historyMatch = defineMaterialMatch<HistoryCtx, string>({
            name: "answer-history", read: (ctx) => ({ state: "complete", items: ctx.history() }), match: answer,
          });
          export const emptyHistoryMatch = defineMaterialMatch<HistoryCtx, string>({
            name: "empty-history", read: () => ({ state: "complete", items: [] }), match: answer,
          });
        `,
        ),
        writeFile(
          join(cwd, "evals", "model-roles-cost.eval.ts"),
          `import { rolesAdapter } from "../adapters/usage.ts";
           export default rolesAdapter.defineEval({ test(t) {
             for (let index = 0; index < 375; index += 1) {
               const modelRole = index < 356 ? "planner" : "reviewer";
               t.record({
                 callId: \`cost-\${index}\`, modelRole, provider: "fixture-provider", model: t.selectedModel(modelRole),
                 status: "succeeded", inputTokens: 1, inputTotalTokens: 1, outputTokens: 1,
                 ...(index < 356 ? { cost: { amount: index === 0 ? "0.071083152" : "0", currency: "USD", source: { kind: "reported", id: "offline.response" } } } : {}),
               });
             }
             t.finishUsage();
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "model-roles-truncated.eval.ts"),
          `import { rolesAdapter } from "../adapters/usage.ts";
           export default rolesAdapter.defineEval({ test(t) {
             for (let index = 0; index < 129; index += 1) {
               t.record({
                 callId: \`a-\${index}\`, modelRole: "a", provider: "fixture-provider", model: \`fixture/model-\${index}\`,
                 status: "succeeded", inputTokens: 1, inputTotalTokens: 1, outputTokens: 1,
                 ...(index === 0 ? { cost: { amount: "0.25", currency: "USD", source: { kind: "reported", id: "offline.response" } } } : { cost: { amount: "0", currency: "USD", source: { kind: "reported", id: "offline.response" } } }),
               });
             }
             t.record({
               callId: "z-0", modelRole: "z", provider: "fixture-provider", model: "fixture/z",
               status: "succeeded", inputTokens: 7, inputTotalTokens: 7, outputTokens: 3,
               cost: { amount: "0.25", currency: "USD", source: { kind: "reported", id: "offline.response" } },
             });
             t.finishUsage();
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "model-roles-usage.eval.ts"),
          `import { rolesAdapter } from "../adapters/usage.ts";
           export default rolesAdapter.defineEval({ test(t) {
             t.record({ callId: "planner-1", modelRole: "planner", provider: "fixture-provider", model: "fixture/shared", status: "failed", inputTokens: 5, inputTotalTokens: 5, outputTokens: 5, cost: { amount: "0", currency: "USD", source: { kind: "reported", id: "offline.response" } } });
             t.record({ callId: "planner-2", modelRole: "planner", retryOf: "planner-1", provider: null, model: "fixture/fallback", status: "succeeded", inputTokens: 10, inputTotalTokens: 10, outputTokens: 5, cost: { amount: "0.125", currency: "USD", source: { kind: "reported", id: "offline.response" } } });
             t.record({ callId: "reviewer-1", modelRole: "reviewer", provider: "fixture-provider", model: "fixture/shared", status: "succeeded", inputTokens: 10, inputTotalTokens: 10, outputTokens: 5, cost: { amount: "0.25", currency: "USD", source: { kind: "reported", id: "offline.response" } } });
             t.record({ callId: "unattributed-1", modelRole: null, provider: null, model: "fixture/unpriced", status: "succeeded", inputTokens: null, inputTotalTokens: null, outputTokens: null });
             t.finishUsage();
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "seal-empty.eval.ts"),
          `import { equals } from "niceeval/expect"; import { sealAdapter } from "../adapters/usage.ts";
           export default sealAdapter.defineEval({ test(t) { t.finishComplete(); t.check(1, equals(1)); } });`,
        ),
        writeFile(
          join(cwd, "evals", "seal-partial.eval.ts"),
          `import { equals } from "niceeval/expect"; import { sealAdapter } from "../adapters/usage.ts";
           export default sealAdapter.defineEval({ test(t) { t.recordKnownCost(); t.finishPartial(); t.check(1, equals(1)); } });`,
        ),
        writeFile(
          join(cwd, "evals", "seal-caught.eval.ts"),
          `import { equals } from "niceeval/expect"; import { sealAdapter } from "../adapters/usage.ts";
           export default sealAdapter.defineEval({ test(t) { t.recordKnownCost(); t.finishPartial(); t.check(t.catchWriteAfterSeal(), equals(true)); } });`,
        ),
        writeFile(
          join(cwd, "evals", "unsealed.eval.ts"),
          `import { equals } from "niceeval/expect"; import { unsealedAdapter } from "../adapters/usage.ts";
           export default unsealedAdapter.defineEval({ test(t) { t.check(1, equals(1)); } });`,
        ),
        writeFile(
          join(cwd, "evals", "exp-cost-paid.eval.ts"),
          `import { equals } from "niceeval/expect"; import { expCostAdapter } from "../adapters/usage.ts";
           export default expCostAdapter.defineEval({ test(t) {
             t.recordCost(process.env.NICEEVAL_TEST_COST_PHASE === "replacement" ? "0.300000003" : "0.100000001", "succeeded");
             t.check(1, equals(1));
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "exp-cost-failed.eval.ts"),
          `import { equals } from "niceeval/expect"; import { expCostAdapter } from "../adapters/usage.ts";
           export default expCostAdapter.defineEval({ test(t) {
             t.recordCost("0.200000002", "failed");
             t.check(1, equals(2));
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "exp-cost-zero.eval.ts"),
          `import { equals } from "niceeval/expect"; import { expCostAdapter } from "../adapters/usage.ts";
           export default expCostAdapter.defineEval({ test(t) { t.recordCost("0"); t.check(1, equals(1)); } });`,
        ),
        writeFile(
          join(cwd, "evals", "exp-cost-missing.eval.ts"),
          `import { equals } from "niceeval/expect"; import { expCostAdapter } from "../adapters/usage.ts";
           export default expCostAdapter.defineEval({ test(t) { t.recordCost(undefined); t.check(1, equals(1)); } });`,
        ),
        writeFile(
          join(cwd, "evals", "judge-qa.eval.ts"),
          `import { judgeAppAdapter, historyMatch } from "../adapters/usage.ts";
           export default judgeAppAdapter.defineEval({ test(t) {
             t.recordAppUsage();
             t.closeQA(historyMatch, "Does the answer name the capital of France?").gate(1).label("Answer QA");
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "judge-empty.eval.ts"),
          `import { judgeAppAdapter, emptyHistoryMatch } from "../adapters/usage.ts";
           export default judgeAppAdapter.defineEval({ test(t) {
             t.recordAppUsage();
             t.closeQA(emptyHistoryMatch, "Does the answer name the capital of France?").label("Empty QA");
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "judge-image.eval.ts"),
          `import { defineJudge } from "niceeval/expect"; import { judgeImage } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/usage.ts";
           const quality = defineJudge({ rubric: "Assess screenshot." });
           export default judgeAppAdapter.defineScoreEval({ test(t) {
             t.judge({ screenshot: judgeImage({
               body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"),
               mediaType: "image/png",
             }) }, quality).score(1).label("Screenshot");
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "verdict-causes.eval.ts"),
          `import { judgeAppAdapter, historyMatch } from "../adapters/usage.ts";
           export default judgeAppAdapter.defineScoreEval({ test(t) {
             t.closeQA(historyMatch, "First?").score(1).label("First required review");
             t.closeQA(historyMatch, "Second?").score(1).label("Second required review");
           } });`,
        ),
        writeFile(
          join(cwd, "experiments", "model-roles-cost.ts"),
          `import { defineExperiment } from "niceeval"; import { rolesAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: rolesAdapter, models: { unused: { model: "fixture/unused" }, reviewer: { model: "fixture/unpriced" }, planner: { model: "fixture/shared" } }, evals: ["model-roles-cost"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "model-roles-truncated.ts"),
          `import { defineExperiment } from "niceeval"; import { rolesAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: rolesAdapter, models: { a: { model: "fixture/requested-a" }, unused: { model: "fixture/unused" }, z: { model: "fixture/z" } }, evals: ["model-roles-truncated"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "model-roles-usage.ts"),
          `import { defineExperiment } from "niceeval"; import { rolesAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: rolesAdapter, models: { planner: { model: "fixture/shared", reasoningEffort: "high" }, reviewer: { model: "fixture/shared" }, unused: { model: "fixture/unused" } }, evals: ["model-roles-usage"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "seal-empty.ts"),
          `import { defineExperiment } from "niceeval"; import { sealAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: sealAdapter, evals: ["seal-empty"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "seal-partial.ts"),
          `import { defineExperiment } from "niceeval"; import { sealAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: sealAdapter, evals: ["seal-partial"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "seal-caught.ts"),
          `import { defineExperiment } from "niceeval"; import { sealAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: sealAdapter, evals: ["seal-caught"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "unsealed.ts"),
          `import { defineExperiment } from "niceeval"; import { unsealedAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: unsealedAdapter, evals: ["unsealed"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "exp-cost.ts"),
          `import { defineExperiment } from "niceeval"; import { expCostAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: expCostAdapter, evals: ["exp-cost-paid", "exp-cost-failed"], attempts: 35 });`,
        ),
        writeFile(
          join(cwd, "experiments", "exp-cost-incomplete.ts"),
          `import { defineExperiment } from "niceeval"; import { expCostAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: expCostAdapter, evals: ["exp-cost-zero", "exp-cost-missing"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "judge-empty.ts"),
          `import { defineExperiment } from "niceeval"; import { OpenRouterProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["judge-empty"], judge: OpenRouterProvider({ model: "judge-usage-request", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }) });`,
        ),
        writeFile(
          join(cwd, "experiments", "judge-invalid-qa.ts"),
          `import { defineExperiment } from "niceeval"; import { OpenRouterProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["judge-qa"], judge: OpenRouterProvider({ model: "judge-usage-request", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }) });`,
        ),
        writeFile(
          join(cwd, "experiments", "judge-pricing.ts"),
          `import { defineExperiment } from "niceeval"; import { VercelProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["judge-qa"], judge: VercelProvider({ model: "inspection-fixture-v1", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }) });`,
        ),
        writeFile(
          join(cwd, "experiments", "judge-reported.ts"),
          `import { defineExperiment } from "niceeval"; import { OpenRouterProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["judge-qa"], judge: OpenRouterProvider({ model: "inspection-fixture-v1", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }) });`,
        ),
        writeFile(
          join(cwd, "experiments", "judge-retry.ts"),
          `import { defineExperiment } from "niceeval"; import { OpenRouterProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["judge-qa"], judge: OpenRouterProvider({ model: "inspection-fixture-v1", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }) });`,
        ),
        writeFile(
          join(cwd, "experiments", "judge-tokens.ts"),
          `import { defineExperiment } from "niceeval"; import { VercelProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["judge-qa"], judge: VercelProvider({ model: "judge-usage-request", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }) });`,
        ),
        writeFile(
          join(cwd, "experiments", "judge-image.ts"),
          `import { defineExperiment } from "niceeval"; import { OpenRouterProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["judge-image"], judge: OpenRouterProvider({ model: "inspection-fixture-v1", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }) });`,
        ),
        writeFile(
          join(cwd, "experiments", "verdict-causes.ts"),
          `import { defineExperiment } from "niceeval"; import { OpenRouterProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/usage.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["verdict-causes"], judge: OpenRouterProvider({ model: "offline", apiKey: "offline", baseUrl: ${JSON.stringify(verdictCausesUrl)}, timeoutMs: 1_000 }) });`,
        ),
      ]);

      async function firstLocator(experimentId: string) {
        const res = await runProjectExperiment(cwd, experimentId, {
          pricing: { "inspection-fixture-v1": { inputPerMTok: 1, outputPerMTok: 2 } },
        });
        return (await publishedSlotLocators(cwd, res.receipt.createdRunIds[0]!)).values().next().value!;
      }

      modelRolesCostLocator = await firstLocator("model-roles-cost");
      modelRolesTruncatedLocator = await firstLocator("model-roles-truncated");
      modelRolesUsageLocator = await firstLocator("model-roles-usage");
      sealEmptyLocator = await firstLocator("seal-empty");
      sealPartialLocator = await firstLocator("seal-partial");
      sealCaughtLocator = await firstLocator("seal-caught");
      unsealedLocator = await firstLocator("unsealed");

      await runProjectExperiment(cwd, "exp-cost-incomplete");
      process.env.NICEEVAL_TEST_COST_PHASE = "initial";
      await runProjectExperiment(cwd, "exp-cost");
      await withOperational(cwd, (facts) => {
        expCostInitialTotal = selectInspectionOperation(facts, {
          kind: "experiment.get",
          experimentId: "exp-cost" as ExperimentId,
        }).experiment.costSummary.totalCosts.values[0]!.value;
      });
      process.env.NICEEVAL_TEST_COST_PHASE = "replacement";
      await runProjectExperiment(cwd, "exp-cost", { evalSelectors: ["exp-cost-paid"] });
      delete process.env.NICEEVAL_TEST_COST_PHASE;
      await withOperational(cwd, (facts) => {
        expCostReplacementTotal = selectInspectionOperation(facts, {
          kind: "experiment.get",
          experimentId: "exp-cost" as ExperimentId,
        }).experiment.costSummary.totalCosts.values[0]!.value;
      });

      judgeInvalidQaLocator = await firstLocator("judge-invalid-qa");
      judgePricingLocator = await firstLocator("judge-pricing");
      judgeReportedLocator = await firstLocator("judge-reported");
      judgeRetryLocator = await firstLocator("judge-retry");
      judgeTokensLocator = await firstLocator("judge-tokens");
      judgeEmptyLocator = await firstLocator("judge-empty");
      judgeImageLocator = await firstLocator("judge-image");

      await withOperational(cwd, (facts) => {
        const attempt = selectInspectionOperation(facts, {
          kind: "attempt.get",
          locator: judgeImageLocator,
        }).attempt;
        judgeImageEntryId = attempt.assertions.entries.find((entry) => entry.display.label === "Screenshot")!
          .entryId as AssertionEntryId;
        const detail = selectInspectionOperation(facts, {
          kind: "attempt.assertion.detail",
          locator: judgeImageLocator,
          entryId: judgeImageEntryId,
          projection: "full",
        }).assertion;
        if (
          !("entry" in detail) ||
          !("scoreMatchAudit" in detail.entry) ||
          detail.entry.scoreMatchAudit?.state !== "available" ||
          detail.entry.scoreMatchAudit.audit.kind !== "images"
        ) {
          throw new Error("Expected image scoreMatchAudit");
        }
        judgeImageId = detail.entry.scoreMatchAudit.audit.images[0]!.imageId;
      });

      // Run verdict-causes to exercise failed Judge calls + advisory diagnostics.
      const causesRun = await runProjectExperiment(cwd, "verdict-causes");
      const causesLocator = (await publishedSlotLocators(cwd, causesRun.receipt.createdRunIds[0]!)).get(
        "verdict-causes",
      )!;
      await withOperational(cwd, (facts) => {
        const attempt = selectInspectionOperation(facts, { kind: "attempt.get", locator: causesLocator }).attempt;
        expect(attempt.verdict).toBe("errored");
        expect(attempt.verdictCauses?.groups).toEqual([
          { result: "unavailable", reason: "source-unavailable", failureDetail: "judge-call-failed", count: 2 },
        ]);
        expect(attempt.diagnostics.items).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: "inspection-advisory", kind: "advisory" })]),
        );
      });
    } finally {
      delete process.env.NICEEVAL_TEST_COST_PHASE;
      await Promise.all([fixture.close(), verdictCausesFixture.close()]);
      await expect(fetch(baseUrl)).rejects.toThrow();
      await expect(fetch(verdictCausesUrl)).rejects.toThrow();
    }
  }, 120_000);

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("model usage groups, truncated previews, and sealing states keep exact totals and cost gaps", async () => {
    await withOperational(cwd, (facts) => {
      const costUsage = selectInspectionOperation(facts, {
        kind: "attempt.usage",
        locator: modelRolesCostLocator,
      }).usage;
      expect(costUsage.totals.costs).toEqual({
        state: "partial",
        source: "reported",
        values: [
          {
            currency: "USD",
            value: "0.071083152",
            source: "reported",
            coveredCalls: 356,
            reportedCalls: 356,
            estimatedCalls: 0,
          },
        ],
        totalCalls: 375,
      });
      expect(costUsage.callsTruncated).toBe(true);
      expect(costUsage.omittedCallCount).toBe(247);

      const truncatedUsage = selectInspectionOperation(facts, {
        kind: "attempt.usage",
        locator: modelRolesTruncatedLocator,
      }).usage;
      expect(truncatedUsage.configuredModels).toEqual({
        state: "available",
        bindings: [
          { modelRole: "a", model: "fixture/requested-a", reasoningEffort: null, recordedCalls: 129 },
          { modelRole: "unused", model: "fixture/unused", reasoningEffort: null, recordedCalls: 0 },
          { modelRole: "z", model: "fixture/z", reasoningEffort: null, recordedCalls: 1 },
        ],
      });
      expect(truncatedUsage.modelGroups).toMatchObject({
        totalGroupCount: 130,
        groupsTruncated: true,
        omittedGroupCount: 66,
      });
      expect(truncatedUsage.totals.costs?.values[0]?.value).toBe("0.5");

      const rolesUsage = selectInspectionOperation(facts, {
        kind: "attempt.usage",
        locator: modelRolesUsageLocator,
      }).usage;
      expect(rolesUsage.modelGroups.groups[0]?.modelRole).toBeNull();
      expect(rolesUsage.totalCosts).toEqual({
        state: "partial",
        values: [{ currency: "USD", value: "0.375", source: "reported" }],
        missingSources: ["application"],
        gaps: [{ source: "application", reason: "provider-cost-not-reported", models: [] }],
      });

      expect(
        selectInspectionOperation(facts, { kind: "attempt.usage", locator: sealEmptyLocator }).usage.totalCosts,
      ).toEqual({ state: "complete", values: [], missingSources: [], gaps: [] });

      for (const locator of [sealPartialLocator, sealCaughtLocator]) {
        const usage = selectInspectionOperation(facts, { kind: "attempt.usage", locator }).usage;
        expect(usage.state).toBe("partial");
        expect(usage.totalCosts).toEqual({
          state: "partial",
          values: [{ currency: "USD", value: "0.125", source: "reported" }],
          missingSources: ["application"],
          gaps: [{ source: "application", reason: "usage-not-recorded", models: [] }],
        });
      }

      expect(
        selectInspectionOperation(facts, { kind: "attempt.usage", locator: unsealedLocator }).usage.totalCosts,
      ).toEqual({
        state: "unavailable",
        values: [],
        missingSources: ["application"],
        gaps: [{ source: "application", reason: "usage-not-recorded", models: [] }],
      });
    });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("judge usage, pricing receipts, experiment costSummary, and image readback preserve exact facts", async () => {
    await withOperational(cwd, (facts) => {
      const empty = selectInspectionOperation(facts, { kind: "attempt.usage", locator: judgeEmptyLocator }).usage;
      expect(empty.judgeUsage).toMatchObject({
        state: "complete",
        calls: [],
        totals: { requests: { value: 0 }, costs: { state: "complete", values: [], totalCalls: 0 } },
      });
      expect(empty.totalCosts).toEqual({
        state: "complete",
        values: [{ currency: "USD", value: "0.25", source: "reported" }],
        missingSources: [],
        gaps: [],
      });

      const invalidQa = selectInspectionOperation(facts, {
        kind: "attempt.usage",
        locator: judgeInvalidQaLocator,
      }).usage;
      expect(invalidQa.totalCosts).toEqual({
        state: "complete",
        values: [{ currency: "USD", value: "0.27", source: "reported" }],
        missingSources: [],
        gaps: [],
      });

      const pricing = selectInspectionOperation(facts, {
        kind: "attempt.usage",
        locator: judgePricingLocator,
      }).usage;
      expect(pricing.totalCosts).toEqual({
        state: "partial",
        values: [{ currency: "USD", value: "0.25006", source: "mixed" }],
        missingSources: ["judge"],
        gaps: [
          { source: "judge", reason: "no-pricing-profile", models: ["inspection-fixture-v1"] },
          { source: "judge", reason: "token-buckets-incomplete", models: [] },
        ],
      });

      const reported = selectInspectionOperation(facts, {
        kind: "attempt.usage",
        locator: judgeReportedLocator,
      }).usage;
      expect(reported.totalCosts).toEqual({
        state: "complete",
        values: [{ currency: "USD", value: "0.252", source: "reported" }],
        missingSources: [],
        gaps: [],
      });

      const retry = selectInspectionOperation(facts, { kind: "attempt.usage", locator: judgeRetryLocator }).usage;
      expect(retry.totalCosts).toEqual({
        state: "complete",
        values: [{ currency: "USD", value: "0.26", source: "reported" }],
        missingSources: [],
        gaps: [],
      });

      const tokens = selectInspectionOperation(facts, { kind: "attempt.usage", locator: judgeTokensLocator }).usage;
      expect(tokens.totalCosts).toEqual({
        state: "partial",
        values: [{ currency: "USD", value: "0.25", source: "reported" }],
        missingSources: ["judge"],
        gaps: [{ source: "judge", reason: "no-pricing-profile", models: ["judge-usage-request"] }],
      });

      // Experiment costSummary exact decimal totals across >64 Attempts and partial rerun replacement.
      expect(expCostInitialTotal).toBe("10.500000105");
      expect(expCostReplacementTotal).toBe("17.500000175");
      const incompleteExp = selectInspectionOperation(facts, {
        kind: "experiment.get",
        experimentId: "exp-cost-incomplete" as ExperimentId,
      }).experiment;
      expect(incompleteExp.costSummary).toEqual({
        scope: "latest-recorded-attempts",
        totalCosts: {
          state: "partial",
          values: [{ currency: "USD", value: "0", source: "reported" }],
          missingSources: ["application"],
          gaps: [{ source: "application", reason: "no-pricing-profile", models: ["fixture/experiment-cost"] }],
        },
        coverage: {
          plannedAttemptCount: 2,
          recordedAttemptCount: 2,
          originAttemptCount: 2,
          completeAttemptCount: 1,
          partialAttemptCount: 0,
          unavailableAttemptCount: 1,
          missingAttemptCount: 0,
        },
      });

      // Assertion image readback returns valid PNG bytes.
      const image = selectInspectionOperation(facts, {
        kind: "attempt.assertion.image",
        locator: judgeImageLocator,
        entryId: judgeImageEntryId,
        imageId: judgeImageId,
      }).image;
      expect(image.state).toBe("available");
      if (image.state === "available") {
        expect(Buffer.from(image.base64, "base64").subarray(0, 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
      }
    });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("attempt.reprice computes hypothetical estimates without mutating historical usage", async () => {
    await withOperational(cwd, (facts) => {
      const beforeUsage = selectInspectionOperation(facts, {
        kind: "attempt.usage",
        locator: judgePricingLocator,
      });
      const beforeAttempt = selectInspectionOperation(facts, {
        kind: "attempt.get",
        locator: judgePricingLocator,
      });

      fc.assert(
        fc.property(fc.constantFrom(1, 2, 3), (multiplier) => {
          const pricing = Object.fromEntries(
            ["application-model", "inspection-fixture-v1"].map((model) => [
              model,
              {
                inputPerMTok: 2 * multiplier,
                outputPerMTok: 8 * multiplier,
                cacheReadPerMTok: multiplier,
                cacheWritePerMTok: 2 * multiplier,
                source: { id: `comparison-${multiplier}` },
              },
            ]),
          );
          const repricing = selectInspectionOperation(facts, {
            kind: "attempt.reprice",
            locator: judgePricingLocator,
            pricing,
          }).repricing;
          expect(repricing.application).toMatchObject({
            state: "complete",
            callCount: 1,
            amount: String((16 * multiplier) / 1_000_000),
          });
          expect(repricing.judge).toMatchObject({
            state: "partial",
            callCount: 1,
            amount: String((260 * multiplier) / 1_000_000),
          });
        }),
        { numRuns: 3, seed: 2042 },
      );

      const unmatched = selectInspectionOperation(facts, {
        kind: "attempt.reprice",
        locator: judgePricingLocator,
        pricing: { "unmatched-model": { inputPerMTok: 1, outputPerMTok: 1, source: { id: "unmatched" } } },
      }).repricing;
      expect(unmatched.total).toEqual({ state: "unavailable", currency: "USD", amount: null });

      expect(selectInspectionOperation(facts, { kind: "attempt.usage", locator: judgePricingLocator })).toEqual(
        beforeUsage,
      );
      expect(selectInspectionOperation(facts, { kind: "attempt.get", locator: judgePricingLocator })).toEqual(
        beforeAttempt,
      );
    });
  });
});

describe("exact read and comparison: current project gaps, pending barriers, source errors, and targeted cost", () => {
  let cwd: string;
  let untouchedDir: string;
  let corruptRecord: string;
  let emptyRecord: string;
  let siblingLocator = "";
  let releasePending: (() => void) | undefined;
  let pendingRun: Promise<unknown> | undefined;

  beforeAll(async () => {
    const baseTmp = await realpath(tmpdir());
    cwd = await mkdtemp(join(baseTmp, "niceeval-inspection-project-"));
    untouchedDir = await mkdtemp(join(baseTmp, "niceeval-inspection-untouched-"));
    for (const root of [cwd, untouchedDir]) {
      await Promise.all(["evals", "experiments", "evals/score"].map((dir) => mkdir(join(root, dir), { recursive: true })));
      await Promise.all([
        writeFile(join(root, "package.json"), JSON.stringify({ type: "module" })),
        writeFile(
          join(root, "adapter.ts"),
          `
          import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
          import { appendFileSync, existsSync } from "node:fs";
          import { resolve } from "node:path";
          const projectFile = (name: string) => resolve(import.meta.dirname, name);
          const gates = (globalThis as Record<PropertyKey, Map<string, { entered: () => void; release: Promise<void> }>>)[
            Symbol.for("niceeval.test.inspection-gates")
          ];
          export const currentAgent = defineAgent({
            name: "current-inspection-fixture",
            evidenceCoverage: completeEvidenceCoverage,
            send: async (_input, ctx) => {
              appendFileSync(projectFile("agent-calls.txt"), "send\\n");
              const gate = gates?.get(projectFile(""));
              if (gate !== undefined && existsSync(projectFile("hold-agent"))) {
                gate.entered();
                await gate.release;
              }
              if (ctx.signal.aborted) throw new Error("aborted");
              return { status: "completed", events: [{ type: "message", role: "assistant", text: "accepted" }] };
            },
          });
        `,
        ),
        writeFile(
          join(root, "evals", "first.eval.ts"),
          `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
           export default defineEval({ async test(t) { const r = await t.send("current"); t.check(r.reply, equals("accepted")); } });`,
        ),
        writeFile(
          join(root, "evals", "changed.eval.ts"),
          `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
           export default defineEval({ async test(t) { const r = await t.send("current"); t.check(r.reply, equals("accepted")); } });`,
        ),
        writeFile(
          join(root, "evals", "score", "zero.eval.ts"),
          `import { defineScoreEval } from "niceeval";
           export default defineScoreEval({ test(t) { t.score(0); } });`,
        ),
        writeFile(
          join(root, "evals", "score", "partial.eval.ts"),
          `import { defineScoreEval } from "niceeval"; import { defineValueMatch } from "niceeval/expect";
           const unavailable = defineValueMatch<null>({ name: "missing-ev", evaluate: () => ({ state: "unavailable", reason: "completion-boundary-missing" }) });
           export default defineScoreEval({ test(t) { t.score(2); t.check(null, unavailable).score(50); } });`,
        ),
        writeFile(
          join(root, "experiments", "current-pass.ts"),
          `import { defineExperiment } from "niceeval"; import { currentAgent } from "../adapter.ts";
           export default defineExperiment({ adapter: currentAgent, evals: ["first", "changed"], attempts: 2 });`,
        ),
        writeFile(
          join(root, "experiments", "current-score.ts"),
          `import { defineExperiment } from "niceeval"; import { currentAgent } from "../adapter.ts";
           export default defineExperiment({ adapter: currentAgent, evals: ["score/"] });`,
        ),
      ]);
    }
    corruptRecord = join(cwd, "corrupt.sqlite");
    emptyRecord = join(cwd, "empty.sqlite");
    await Promise.all([
      writeFile(corruptRecord, "This is not a SQLite Record."),
      writeFile(emptyRecord, ""),
    ]);

    const original = await runProjectExperiment(cwd, "current-pass");
    const { run: originalRun } = await Effect.runPromise(
      runHost.get({ cwd, runId: original.receipt.createdRunIds[0]! }),
    );
    const sibling = originalRun.slots.find((slot) => slot.evalId === "first" && slot.attemptOrdinal === 1)?.publication;
    if (sibling?.state !== "published") throw new Error("Expected the original sibling Attempt");
    siblingLocator = sibling.attemptLocator;
    await runProjectExperiment(cwd, "current-score");
    await copyFile(join(cwd, ".niceeval", "record.sqlite"), join(cwd, "portable.sqlite"));

    const gateSym = Symbol.for("niceeval.test.inspection-gates");
    const gates = new Map<string, { entered: () => void; release: Promise<void> }>();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    releasePending = () => release.resolve();
    Reflect.set(globalThis, gateSym, gates);
    gates.set(cwd, { entered: entered.resolve, release: release.promise });
    await writeFile(join(cwd, "hold-agent"), "hold");

    const heldPlan = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd,
        experimentSelector: "current-pass",
        evalSelectors: ["first"],
        config: { maxConcurrency: 1 },
        overrides: { rerun: "all", attempts: 1 },
      }),
    );
    if (heldPlan.status !== "ready") throw new Error("Expected ready heldPlan");
    pendingRun = Effect.runPromise(experimentHost.invocation.run({ plan: heldPlan.plan }));
    await entered.promise;
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const runs = (await Effect.runPromise(runHost.list({ cwd }))).runs;
      if (runs.some((run) => run.state === "active")) break;
      await sleep(10);
    }
  }, 60_000);

  afterAll(async () => {
    releasePending?.();
    await pendingRun?.catch(() => undefined);
    Reflect.deleteProperty(globalThis, Symbol.for("niceeval.test.inspection-gates"));
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
    if (untouchedDir !== undefined) await rm(untouchedDir, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("project.get tracks initial no-result gaps without running agents", async () => {
    await withCurrentProject(untouchedDir, (facts) => {
      const project = selectInspectionOperation(facts, { kind: "project.get" }).project;
      expect(project.coverage).toEqual({ expected: 6, covered: 0, gaps: 6 });
      expect(project.plannedAttempts.every((slot) => slot.state === "gap" && slot.reason === "no-result")).toBe(true);
    });
    await expect(readFile(join(untouchedDir, "agent-calls.txt"), "utf8")).rejects.toThrow();
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("project.get tracks score eligibility, external rejection, and active pending barriers", async () => {
    await withCurrentProject(cwd, (facts) => {
      const scoreProject = selectInspectionOperation(facts, {
        kind: "project.get",
        experimentIds: ["current-score" as ExperimentId],
      }).project;
      expect(scoreProject.coverage).toEqual({ expected: 2, covered: 1, gaps: 1 });
      expect(scoreProject.totals).toMatchObject({ evaluationKind: "points", score: { state: "partial", value: 0 } });
      expect(scoreProject.plannedAttempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ evalId: "score/zero", state: "reuse" }),
          expect.objectContaining({ evalId: "score/partial", state: "gap", reason: "outcome-ineligible" }),
        ]),
      );

      const passProj = selectInspectionOperation(facts, {
        kind: "project.get",
        experimentIds: ["current-pass" as ExperimentId],
      }).project;
      const first0 = passProj.plannedAttempts.find((slot) => slot.evalId === "first" && slot.attemptOrdinal === 0)!;
      const first1 = passProj.plannedAttempts.find((slot) => slot.evalId === "first" && slot.attemptOrdinal === 1)!;
      expect(first0).toMatchObject({ state: "gap", reason: "pending" });
      expect(first1).toMatchObject({ state: "reuse", locator: siblingLocator });
    });

    await withExternal(cwd, join(cwd, "portable.sqlite"), (facts) => {
      expectOperationCode(() => selectInspectionOperation(facts, { kind: "project.get" }), "current-target-unavailable");
    });
  });

  describe("settled project", () => {
    beforeAll(async () => {
      releasePending?.();
      await pendingRun;
      await rm(join(cwd, "hold-agent"), { force: true });
      Reflect.deleteProperty(globalThis, Symbol.for("niceeval.test.inspection-gates"));
      // The settled Record fixture now contains an adopted reference for Inspection to resolve.
      await Effect.runPromise(
        experimentHost.accept({ cwd, locators: [siblingLocator], config: { maxConcurrency: 1 } }),
      );
    }, 15_000);

    // @feature docs/feature/inspection/README.md#exact-read-and-comparison
    test("project.get points to the adopted Attempt after accept", async () => {
      await withCurrentProject(cwd, (facts) => {
        const passProj = selectInspectionOperation(facts, {
          kind: "project.get",
          experimentIds: ["current-pass" as ExperimentId],
        }).project;
        const first1 = passProj.plannedAttempts.find((slot) => slot.evalId === "first" && slot.attemptOrdinal === 1)!;
        expect(first1).toMatchObject({
          state: "reuse",
          locator: siblingLocator,
          action: "accepted",
          relation: "reference",
        });
      }, ["current-pass"]);
    });

    // @feature docs/feature/inspection/README.md#exact-read-and-comparison
    test("project.get reports an identity-mismatch gap after changing the Eval", async () => {
      const changedPath = join(cwd, "evals", "changed.eval.ts");
      await writeFile(changedPath, (await readFile(changedPath, "utf8")).replace("current", "modified-current"));
      await withCurrentProject(cwd, (facts) => {
        const passProj = selectInspectionOperation(facts, {
          kind: "project.get",
          experimentIds: ["current-pass" as ExperimentId],
        }).project;
        const changedSlot = passProj.plannedAttempts.find((slot) => slot.evalId === "changed")!;
        expect(changedSlot).toMatchObject({ state: "gap", reason: "identity-mismatch" });
      });
    });

    // @feature docs/feature/inspection/README.md#exact-read-and-comparison
    test("project.get keeps history when the current Experiments are removed", async () => {
      await rm(join(cwd, "experiments"), { recursive: true, force: true });
      await mkdir(join(cwd, "experiments"));
      await withCurrentProject(cwd, (facts) => {
        const emptyProj = selectInspectionOperation(facts, { kind: "project.get" }).project;
        expect(emptyProj.coverage).toEqual({ expected: 0, covered: 0, gaps: 0 });
        expect(emptyProj.history.length).toBeGreaterThan(0);
      });
    });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test.for(["corrupt", "empty"] as const)("a %s Record fails closed", async (kind) => {
    await expect(withExternal(cwd, kind === "corrupt" ? corruptRecord : emptyRecord, () => {})).rejects.toMatchObject({
      code: "inspection-source-invalid",
    });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("a legacy v4 Record reports an unsupported schema", async () => {
    await expect(withExternal(cwd, LEGACY_V4_RECORD, () => {})).rejects.toMatchObject({
      code: "inspection-source-invalid",
      cause: { code: "record-schema-unsupported" },
    });
  });
});

describe("exact read and comparison: targeted read cost", () => {
  let costDir: string;
  let targetRunId: RunId;
  let targetLocator: string;
  let beforeReadMs = 0;

  beforeAll(async () => {
    costDir = await mkdtemp(join(await realpath(tmpdir()), "niceeval-inspection-cost-"));
    await Promise.all(["evals", "experiments"].map((dir) => mkdir(join(costDir, dir))));
    await Promise.all([
      writeFile(join(costDir, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(
        join(costDir, "experiments", "target.ts"),
        `import { defineAdapter, defineExperiment } from "niceeval";
         export const adapter = defineAdapter({ name: "read-target", create: () => ({ read: () => "target-result" }) });
         export default defineExperiment({ adapter, evals: ["target"] });`,
      ),
      writeFile(
        join(costDir, "evals", "target.eval.ts"),
        `import { equals } from "niceeval/expect"; import { adapter } from "../experiments/target.ts";
         export default adapter.defineEval({ async test(t) { t.check(await t.read(), equals("target-result")); } });`,
      ),
    ]);
    const targetRun = await runProjectExperiment(costDir, "target");
    targetRunId = targetRun.receipt.createdRunIds[0]! as RunId;
    targetLocator = (await publishedSlotLocators(costDir, targetRunId)).get("target")!;

    const t0 = performance.now();
    await withOperational(costDir, (facts) => {
      expect(selectInspectionOperation(facts, { kind: "attempt.get", locator: targetLocator }).attempt.locator).toBe(targetLocator);
      expect(selectInspectionOperation(facts, { kind: "run.get", runId: targetRunId }).run.value.runId).toBe(targetRunId);
      expect(
        selectInspectionOperation(facts, { kind: "experiment.get", experimentId: "target" as ExperimentId }).experiment.experiment
          .experimentId,
      ).toBe("target");
    });
    beforeReadMs = performance.now() - t0;

    await writeFile(
      join(costDir, "experiments", "unrelated.ts"),
      `import { defineAdapter, defineExperiment } from "niceeval";
       export const adapter = defineAdapter({ name: "unrelated-trace", behaviorRevision: "1", create(ctx) {
         return { async archive() {
           await ctx.recordTrace({
             traceId: "unrelated", schema: { id: "example.read-cost" }, collection: { state: "complete", limitations: [] }, scopes: [],
             events: Array.from({ length: 30_000 }, (_, index) => ({
               key: String(index), type: "observed", source: { id: "fixture", sequence: index },
               summary: "Unrelated event", payload: { value: "x".repeat(64) }, links: [], evidence: [], scopeMemberships: [],
             })),
           });
           return true;
         } };
       } });
       export default defineExperiment({ adapter, evals: ["unrelated"] });`,
    );
    await writeFile(
      join(costDir, "evals", "unrelated.eval.ts"),
      `import { equals } from "niceeval/expect"; import { adapter } from "../experiments/unrelated.ts";
       export default adapter.defineEval({ async test(t) { t.check(await t.archive(), equals(true)); } });`,
    );
    await runProjectExperiment(costDir, "unrelated");
  }, 60_000);

  afterAll(async () => {
    if (costDir !== undefined) await rm(costDir, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("targeted read latency stays bounded when unrelated Runs and large trace payloads are added", async () => {
    const t1 = performance.now();
    await withOperational(costDir, (facts) => {
      expect(selectInspectionOperation(facts, { kind: "attempt.get", locator: targetLocator }).attempt.locator).toBe(targetLocator);
      expect(selectInspectionOperation(facts, { kind: "run.get", runId: targetRunId }).run.value.runId).toBe(targetRunId);
      expect(
        selectInspectionOperation(facts, { kind: "experiment.get", experimentId: "target" as ExperimentId }).experiment.experiment
          .experimentId,
      ).toBe("target");
    });
    const afterReadMs = performance.now() - t1;
    expect(afterReadMs).toBeLessThan(beforeReadMs * 4 + 150);
  });
});
