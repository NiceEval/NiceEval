import { rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { invokeCli } from "./fixtures/judge-harness/harness.ts";
import { createRecordProject, openGate, waitForGate } from "./fixtures/record-harness/project.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");

const attempts = 4_097;
const evalId = `held-${"x".repeat(120)}`;
const abort = new AbortController();
let cwd: string | undefined;
let running: Promise<unknown> | undefined;
let runId: string;
let active: import("../../packages/niceeval/src/run/host/types.ts").RunDetail;

beforeAll(async () => {
  cwd = await createRecordProject("niceeval-large-run-plan-", { held: true });
  await rename(join(cwd, "evals", "held.eval.ts"), join(cwd, "evals", `${evalId}.eval.ts`));
  await writeFile(
    join(cwd, "experiments", "runs.ts"),
    `
        import { defineExperiment } from "niceeval";
        import adapter from "../adapter.ts";
        export default defineExperiment({ adapter, evals: [${JSON.stringify(evalId)}], attempts: ${attempts} });
      `,
  );
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "runs",
      config: { maxConcurrency: 1 },
      overrides: { rerun: "all", earlyExit: false },
    }),
  );
  if (planned.status !== "ready") throw new Error("Expected a ready Experiment plan");
  running = Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan, signal: abort.signal }));
  await Promise.race([
    waitForGate(cwd, "entered"),
    running.then(() => {
      throw new Error("Run ended before its first Attempt started");
    }),
  ]);
  const { runs } = await Effect.runPromise(runHost.list({ cwd }));
  if (runs.length !== 1) throw new Error("Expected exactly one active Run");
  runId = runs[0]!.runId;
  active = (await Effect.runPromise(runHost.get({ cwd, runId }))).run;
  await openGate(cwd, "release");
  const firstPublication = async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const { run } = await Effect.runPromise(runHost.get({ cwd: cwd!, runId }));
      if (run.coverage.published > 0) return;
      await setTimeout(20);
    }
    throw new Error("First Attempt did not publish");
  };
  await Promise.race([
    firstPublication(),
    running.then(() => {
      throw new Error("Run ended before its first Attempt was observed");
    }),
  ]);
  abort.abort();
  await expect(running).resolves.toMatchObject({ receipt: { completion: "interrupted" } });
  const exported = await invokeCli(cwd, ["run", "export", "--run", runId, "--out", "plan.sqlite", "--json"]);
  if (exported.code !== 0) throw new Error(exported.stderr);
}, 60_000);

afterAll(async () => {
  if (cwd === undefined) return;
  abort.abort();
  try {
    await openGate(cwd, "release");
    await running?.catch(() => undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 30_000);

// @feature docs/feature/run/README.md#publication-visibility
test("a Run retains all 4,097 planned slots through publication and sealing", async () => {
  const { run } = await Effect.runPromise(runHost.get({ cwd: cwd!, runId }));
  expect(active.coverage).toMatchObject({ expected: attempts, published: 0 });
  expect(run.state).toBe("interrupted");
  expect(run.coverage.expected).toBe(attempts);
  expect(run.slots.map((slot) => slot.slotId)).toEqual(active.slots.map((slot) => slot.slotId));
  expect(new Set(run.slots.map((slot) => slot.attemptOrdinal)).size).toBe(attempts);
  expect(run.slots.filter(({ publication }) => publication.state === "published").length).toBeGreaterThan(0);
  const exported = new DatabaseSync(join(cwd!, "plan.sqlite"), { readOnly: true });
  try {
    const runPayload = exported.prepare("SELECT core_payload AS payload FROM ne19_runs WHERE run_id=?").get(runId);
    const publicationPayload = exported
      .prepare("SELECT closure_payload AS payload FROM ne19_attempt_publications WHERE origin_run_id=?")
      .get(runId);
    for (const row of [runPayload, publicationPayload]) {
      expect(row?.payload).toBeInstanceOf(Uint8Array);
      const pointer = JSON.parse(new TextDecoder().decode(row?.payload as Uint8Array))["$niceeval.record.run-value"];
      expect(pointer.byteLength).toBeGreaterThan(1024 * 1024);
      expect(pointer.digest).toMatch(/^[0-9a-f]{64}$/u);
    }
  } finally {
    exported.close();
  }
});
