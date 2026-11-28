import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import fc from "fast-check";
import { decodeExpTerminalEvent, experimentHost } from "niceeval/experiment/host";
import { narrowInspectionSuccess } from "niceeval/inspection";
import { runHost } from "niceeval/run/host";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { invokeCli, showJsonDocuments } from "../integration/fixtures/judge-harness/harness.ts";
import { createIncusProject, type IncusProject } from "../integration/fixtures/lifecycle-incus/project.ts";
import { createRecordProject } from "../integration/fixtures/record-harness/project.ts";

const ERROR_HEAD = "The provider rejected the request";
const REQUEST_ID = "req_fixture_capacity_123";

describe("saved execution error diagnostics", () => {
  const repetitions = [...new Set([35, ...fc.sample(fc.integer({ min: 35, max: 80 }), { seed: 149, numRuns: 4 })])];
  const cases = repetitions.map((length) => ({
    evalId: `error-${length}`,
    message: `${ERROR_HEAD} ${"🙂 capacity ".repeat(length)}request ${REQUEST_ID}`,
  }));
  const locators = new Map<string, string>();
  let cwd: string;

  beforeAll(async () => {
    cwd = await createRecordProject("niceeval-show-diagnostics-", { held: false });
    await Promise.all([
      writeFile(
        join(cwd, "experiments", "runs.ts"),
        `import { defineExperiment } from "niceeval";
         import adapter from "../adapter.ts";
         export default defineExperiment({ adapter, evals: ${JSON.stringify(cases.map(({ evalId }) => evalId))} });`,
      ),
      ...cases.map(({ evalId, message }) =>
        writeFile(
          join(cwd, "evals", `${evalId}.eval.ts`),
          `import adapter from "../adapter.ts";
           export default adapter.defineEval({ test() { throw new Error(${JSON.stringify(message)}); } });`,
        ),
      ),
    ]);
    const planned = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd,
        experimentSelector: "runs",
        config: { maxConcurrency: 1 },
        overrides: { rerun: "all" },
      }),
    );
    if (planned.status !== "ready") throw new Error(`Could not plan fixture: ${JSON.stringify(planned)}`);
    const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
    const { run } = await Effect.runPromise(runHost.get({ cwd, runId: receipt.createdRunIds[0]! }));
    for (const { evalId, publication } of run.slots) {
      if (publication.state !== "published") throw new Error(`Could not publish ${evalId}`);
      locators.set(evalId, publication.attemptLocator);
    }
  }, 30_000);

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  // @issue docs/issues/attempt-error-tail.md
  test("human show preserves both ends of the error and displays a diagnostic link", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...cases), async ({ evalId }) => {
        const locator = locators.get(evalId)!;
        const human = await invokeCli(cwd, ["show", locator]);
        expect(human.code, human.stderr).toBe(0);
        expect(human.stdout).toContain("Failure diagnostics");
        expect(human.stdout).toMatch(/Phase\s+eval\.run/u);
        expect(human.stdout).toMatch(/Sections[\s\S]*Diagnostics\s+available/u);
        expect(human.stdout).toContain(`niceeval show ${locator} execution`);
        expect(human.stdout).toContain(ERROR_HEAD);
        expect(human.stdout).toContain(REQUEST_ID);
        expect(human.stdout.replace(/\s+/gu, " ")).toMatch(/\[\d+ bytes omitted\]/u);
        expect(human.stdout).not.toContain("�");
        expect(human.stdout).toMatch(new RegExp(`niceeval show ${locator} diagnostic_\\w+`, "u"));
      }),
      { seed: 149, numRuns: 4, examples: [[cases[0]!]] },
    );
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("JSON show keeps both error ends within the UTF-8 summary budget", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...cases), async ({ evalId }) => {
        const locator = locators.get(evalId)!;
        const [document] = await showJsonDocuments(cwd, [locator]);
        const overview = narrowInspectionSuccess(document!, "attempt.get");
        if (!overview.success) throw new Error(overview.reason);
        const failure = overview.value.attempt.diagnostics?.items.find((item) => item.kind === "execution-error");
        expect(failure?.summary).toContain(REQUEST_ID);
        expect(failure?.summaryTruncated).toBe(true);
        expect(new TextEncoder().encode(failure?.summary).byteLength).toBeLessThanOrEqual(256);
      }),
      { seed: 149, numRuns: 4, examples: [[cases[0]!]] },
    );
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("the diagnostic command in human show retrieves the full original error", async () => {
    const { evalId, message } = cases[0]!;
    const locator = locators.get(evalId)!;
    const human = await invokeCli(cwd, ["show", locator]);
    expect(human.code, human.stderr).toBe(0);
    const [, evidence] = new RegExp(`niceeval show ${locator} (diagnostic_\\w+)`, "u").exec(human.stdout) ?? [];
    if (evidence === undefined) throw new Error("Show did not link to the saved diagnostic");
    const [detailDocument] = await showJsonDocuments(cwd, [locator, evidence]);
    const detail = narrowInspectionSuccess(detailDocument!, "attempt.trace.detail");
    if (!detail.success) throw new Error(detail.reason);
    expect(detail.value).toMatchObject({ detail: { kind: "diagnostic", summary: message } });
  });
});

describe("saved Before cache diagnostics", () => {
  let project: IncusProject;
  let env: Record<string, string>;
  let locator: string;

  beforeAll(async () => {
    project = await createIncusProject({
      artifactStorageReserveBytes: 1024,
      artifactEstimatedBytes: 2048,
      state: { instances: {}, volumes: {}, storageResources: { space: { total: 4096, used: 4000 } } },
    });
    env = Object.fromEntries(
      Object.entries(project.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    await project.writeExperiment({ actionId: "storage-prefix" });
    const run = await project.niceeval(["exp", "incus", "probe", "--rerun=all", "--json"]);
    expect(run.exitCode, run.stderr).toBe(1);
    const receipt = run.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((line) => line.type === "receipt");
    const terminal = decodeExpTerminalEvent(receipt);
    expect(terminal.summary.beforeCaches?.degraded).toBe(1);
    const [document] = await showJsonDocuments(project.cwd, [`run:${terminal.receipt.createdRunIds[0]!}`], env);
    const detail = narrowInspectionSuccess(document!, "run.get");
    if (!detail.success) throw new Error(detail.reason);
    const publication = detail.value.run.plannedAttempts[0]?.publication;
    if (publication?.state !== "published") throw new Error(`Could not publish fixture: ${JSON.stringify(publication)}`);
    locator = publication.attemptLocator;
  }, 30_000);

  afterAll(async () => {
    await project?.dispose();
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  // @issue docs/issues/show-cache-degraded-reason.md
  test("both show slices expose the named Before cache degradation and its saved evidence", async () => {
    const [document] = await showJsonDocuments(project.cwd, [locator, "execution"], env);
    const trace = narrowInspectionSuccess(document!, "attempt.trace");
    if (!trace.success) throw new Error(trace.reason);
    const diagnostic = trace.value.trace.diagnostics.items.find((item) => item.code === "cache-degraded");
    expect(diagnostic?.summary).toContain("snapshot-uncertain");
    expect(diagnostic?.summary).toContain("storage-prefix");
    for (const slice of [[], ["execution"]]) {
      const human = await invokeCli(project.cwd, ["show", locator, ...slice], env);
      expect(human.code, human.stderr).toBe(0);
      expect(human.stdout).toContain("snapshot-uncertain");
      expect(human.stdout).toContain("storage-prefix");
      expect(human.stdout).toContain(`niceeval show ${locator} ${diagnostic?.evidenceId}`);
    }
  });
});
