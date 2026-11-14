import { only } from "@niceeval/testkit";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @regression memory/operational-record-read-amplification.md
test.concurrent("精确读取不随无关 Run 的大量执行证据增长", async () => {
  await inspectionE2E.case("targeted-read-cost", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    await mkdir(join(projectRoot, "experiments"), { recursive: true });
    await writeFile(join(projectRoot, "experiments/read-target.ts"), `
import { defineAdapter, defineExperiment } from "niceeval";
export const adapter = defineAdapter({ name: "read-target", create: () => ({ read: () => "target-result" }) });
export default defineExperiment({ adapter, evals: ["read-target"] });
`);
    await writeFile(join(projectRoot, "evals/read-target.eval.ts"), `
import { equals } from "niceeval/expect";
import { adapter } from "../experiments/read-target.ts";
export default adapter.defineEval({ async test(t) { t.check(await t.read(), equals("target-result")); } });
`);
    const produced = await niceeval.run(["exp", "read-target", "--json"]);
    expect(produced.exitCode, produced.diagnostic()).toBe(0);
    const runId = only(produced.expReceipt().createdRunIds, () => true, produced.diagnostic());
    const locator = only(produced.expEvalEvents(), (event) => event.evalId === "read-target", produced.diagnostic()).locator;

    const queried = await niceeval.run(["show", `run:${runId}`, "--json"]);
    expect(queried.exitCode, queried.diagnostic()).toBe(0);
    const document = queried.inspectionSuccess("run.get");
    expect(document.publicationCutoff).toEqual({ storeGeneration: expect.any(String), revision: expect.any(Number) });
    expect(document.source).toEqual({ kind: "project-record", publicationCutoffIdentity: expect.any(String) });
    const commands = [["show", locator], ["show", `run:${runId}`], ["show", `exp:${"read-target"}`]];
    const before: number[] = [];
    for (const argv of commands) {
      const result = await niceeval.run(argv);
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.stdout, result.diagnostic()).toContain(locator);
      before.push(result.durationMs);
    }

    // Grow Run metadata separately from the large-payload slice below. Every
    // Run is produced through exp; the test never fabricates database rows.
    await mkdir(join(projectRoot, "experiments/read-count"), { recursive: true });
    for (let index = 0; index < 64; index += 1) {
      await writeFile(join(projectRoot, `experiments/read-count/run-${index}.ts`), `
import { defineExperiment } from "niceeval";
import { adapter } from "../read-target.ts";
export default defineExperiment({ adapter, evals: ["read-target"] });
`);
    }
    const addedRuns = await niceeval.run(["exp", "read-count", "--json"], { timeoutMs: 180_000 });
    expect(addedRuns.exitCode, addedRuns.diagnostic()).toBe(0);
    expect(addedRuns.expReceipt().createdRunIds, addedRuns.diagnostic()).toHaveLength(64);
    for (const [index, argv] of commands.entries()) {
      const result = await niceeval.run(argv);
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.stdout, result.diagnostic()).toContain(locator);
      expect(result.durationMs, `Run inventory growth; ${argv.join(" ")}: before=${before[index]}ms; ${result.diagnostic()}`)
        .toBeLessThan(before[index]! * 2 + 750);
    }

    // Only public Adapter capture creates the unrelated collection. No reader,
    // table names, SQL instrumentation, or implementation counters are involved.
    await writeFile(join(projectRoot, "experiments/read-unrelated.ts"), `
import { defineAdapter, defineExperiment } from "niceeval";
export const adapter = defineAdapter({ name: "read-cost-trace", behaviorRevision: "1", create(ctx) {
  return { async archive() {
    await ctx.recordTrace({ traceId: "unrelated", schema: { id: "example.read-cost" }, collection: { state: "complete", limitations: [] }, scopes: [],
      events: Array.from({ length: 60_000 }, (_, index) => ({ key: String(index), type: "observed", source: { id: "fixture", sequence: index }, summary: "Unrelated event", payload: { value: "x".repeat(128) }, links: [], evidence: [], scopeMemberships: [] })) });
    return true;
  } };
} });
export default defineExperiment({ adapter, evals: ["read-unrelated"], attempts: 2 });
`);
    await writeFile(join(projectRoot, "evals/read-unrelated.eval.ts"), `
import { equals } from "niceeval/expect";
import { adapter } from "../experiments/read-unrelated.ts";
export default adapter.defineEval({ async test(t) { t.check(await t.archive(), equals(true)); } });
`);
    const unrelated = await niceeval.run(["exp", "read-unrelated", "--json"], { timeoutMs: 180_000 });
    expect(unrelated.exitCode, unrelated.diagnostic()).toBe(0);
    expect(unrelated.expEvalEvents(), unrelated.diagnostic()).toEqual([
      expect.objectContaining({ evalId: "read-unrelated", attempts: 2, passed: 2 }),
    ]);
    for (const [index, argv] of commands.entries()) {
      const result = await niceeval.run(argv);
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.stdout, result.diagnostic()).toContain(locator);
      // A relative envelope absorbs cold CLI startup and default suite load.
      // Scanning/hashing 120,000 unrelated events exceeds it; indexed reads do not.
      expect(result.durationMs, `${argv.join(" ")}: before=${before[index]}ms; ${result.diagnostic()}`)
        .toBeLessThan(before[index]! * 2 + 750);
    }
  });
}, 240_000);
