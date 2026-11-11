import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { decodeInspectionDocument, narrowInspectionSuccess } from "niceeval/inspection";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { inspectAttempt } from "./inspection.ts";

// @feature docs/feature/eval/README.md
test.concurrent("Note 按调用顺序独立保存，不进入 Assertion 与 Verdict", async () => {
  await evalE2E.case("attempt-notes", async ({ paths, commands: { niceeval } }) => {
    await writeFile(join(paths.projectRoot, "fixtures", "notes.ts"), `
      import { defineAdapter } from "niceeval";
      import assert from "node:assert/strict";
      export const adapter = defineAdapter({ name: "notes", create(ctx) {
        let note: ((label: string, value: number) => void) | undefined;
        ctx.onCleanup(() => assert.throws(() => note!("late", 1), { name: "AssertionAuthoringClosedError" }));
        return { rememberNote: (value: typeof note) => { note = value; } };
      }});
    `);
    await writeFile(join(paths.projectRoot, "experiments", "notes.ts"), `
      import { defineExperiment } from "niceeval";
      import { adapter } from "../fixtures/notes.ts";
      export default defineExperiment({ adapter });
    `);
    await writeFile(join(paths.projectRoot, "evals", "notes.eval.ts"), `
      import assert from "node:assert/strict";
      import { adapter } from "../fixtures/notes.ts";
      import { equals, ms, ratio, usd } from "niceeval/expect";
      export default adapter.defineEval({ test: async (t) => {
        const payload = { active: true };
        t.note("activity", payload);
        payload.active = false;
        t.note("missing", null);
        t.note("latency", ms(512));
        t.note("hit-rate", ratio(0.612));
        t.note("cost", usd(0.031));
        assert.throws(() => t.note("activity", 1), TypeError);
        assert.throws(() => t.note("large", "x".repeat(65537)), TypeError);
        assert.throws(() => t.note("invalid", NaN), TypeError);
        for (let i = 5; i < 64; i++) t.note("item-" + i, i);
        assert.throws(() => t.note("overflow", 65), TypeError);
        t.rememberNote(t.note);
        t.check(1, equals(1));
      }});
    `);
    const run = await niceeval.run(["exp", "notes", "notes", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), (entry) => entry.evalId === "notes", run.diagnostic());
    expect(event.verdict).toBe("passed");
    const { document } = await inspectAttempt(niceeval, paths.projectRoot, event.locator, "attempt.get");
    expect(document.attempt.assertions.entries).toHaveLength(1);
    expect(document.attempt.notes).toHaveLength(64);
    expect(document.attempt.notes.slice(0, 5)).toEqual([
      { label: "activity", sequence: 0, value: { active: true } },
      { label: "missing", sequence: 1, value: null },
      { label: "latency", sequence: 2, value: 512, unit: "ms" },
      { label: "hit-rate", sequence: 3, value: 0.612, unit: "ratio" },
      { label: "cost", sequence: 4, value: 0.031, unit: "usd" },
    ]);
    const show = await niceeval.run(["show", event.locator]);
    expect(show.exitCode, show.diagnostic()).toBe(0);
    expect(show.stdout).toContain("Notes");
    expect(show.stdout).toContain("activity");
    expect(show.stdout).toContain("unavailable");
    expect(show.stdout).toContain("512 ms");
    expect(show.stdout).toContain("61.2%");
    expect(show.stdout).toContain("$0.031");
    expect(show.stdout.indexOf("Notes")).toBeGreaterThan(show.stdout.indexOf("assertions"));
    const json = await niceeval.run(["show", event.locator, "--json"]);
    expect(json.exitCode, json.diagnostic()).toBe(0);
    const documents = json.ndjson<unknown>().map((value) => {
      const decoded = decodeInspectionDocument(value);
      if (!decoded.success) throw new Error(`${decoded.reason}\n\n${json.diagnostic()}`);
      return decoded.value;
    });
    expect(documents.map((entry) => "operation" in entry ? entry.operation : undefined)).toEqual(["attempt.get", "attempt.usage"]);
    const attempt = narrowInspectionSuccess(documents[0]!, "attempt.get");
    if (!attempt.success) throw new Error(`${attempt.reason}\n\n${json.diagnostic()}`);
    const usage = narrowInspectionSuccess(documents[1]!, "attempt.usage");
    if (!usage.success) throw new Error(`${usage.reason}\n\n${json.diagnostic()}`);
    expect(attempt.value.attempt.notes).toEqual(document.attempt.notes);
  });
});
