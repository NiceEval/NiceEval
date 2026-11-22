import { readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createRecordProject } from "./fixtures/record-harness/project.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");

async function plan(cwd: string, options: { preview?: boolean; rerun?: "all" } = {}) {
  const result = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "runs",
      config: { maxConcurrency: 1 },
      preview: options.preview,
      overrides: { rerun: options.rerun },
    }),
  );
  if (result.status !== "ready") throw new Error(JSON.stringify(result));
  return result;
}

async function preview(cwd: string) {
  const result = (await plan(cwd, { preview: true })).dry;
  if (!result) throw new Error("Expected a dry plan");
  return result;
}

async function execute(cwd: string) {
  const result = await Effect.runPromise(
    experimentHost.invocation.run({ plan: (await plan(cwd, { rerun: "all" })).plan }),
  );
  expect(result.receipt.completion).toBe("completed");
  const [runId] = result.receipt.createdRunIds;
  if (!runId) throw new Error("Expected a published Run");
  return (await Effect.runPromise(runHost.get({ cwd, runId }))).run;
}

const seed = 20261121;
const roleSamples = fc.sample(fc.nat(9999), { numRuns: 2, seed });
const scalarSamples = fc.sample(fc.tuple(fc.nat(9999), fc.constantFrom("low", "high")), { numRuns: 2, seed });
const deletionSamples = [false, true];
const refreshSamples = fc.sample(fc.uniqueArray(fc.nat(999), { minLength: 2, maxLength: 3 }), { numRuns: 2, seed });

// A changed digest means a changed execution identity for this fixed project.
// Follow docs/feature/experiments/architecture/cache.md#niceeval-身份域变更
// and account for affected Runs before updating these values.
const expectedModelDigests = {
  omitted: "1c50927a665be5ece2aa2b180a71f1ef5dfd683153b65cfeb0f1d1002f12f1e9",
  model: "f1744f50050361804c88388a889dd921099268f87a750646e9f01fdfec17cbc3",
  effort: "579f346009bba8c0635d782b54eb12227014ec32c2cd263746caf79f5dc098e0",
  both: "899f92e7cf39bd8bd028efae07ba1986284acb83a1e6843cc8259521005ebeab",
  multi: "b3fd7264614892076ec49fb92352588664340f5c198bf8b29d8a0c287ff198fa",
};

type DrySlot = Awaited<ReturnType<typeof preview>>["slots"][number];
type PublicRun = Awaited<ReturnType<typeof execute>>;

const roles: { run: PublicRun; reordered: DrySlot; changed: DrySlot }[] = [];
const scalarResults: { scalar: string; explicit: string; incomplete: string[] }[] = [];
const fixedModelDigests: Record<string, string> = {};
const deletionResults: { source: string | undefined; slot: DrySlot }[][] = [];
const refreshResults: { description: string | undefined; linked: string }[][] = [];
const projects: string[] = [];

async function project(prefix: string) {
  const cwd = await createRecordProject(prefix, { held: false });
  projects.push(cwd);
  return cwd;
}

async function observeFixedModelDigests() {
  const cwd = await project("niceeval-model-goldens-");
  const experiment = join(cwd, "experiments", "runs.ts");
  const source = await readFile(experiment, "utf8");
  const envKey = "NICEEVAL_TEST_MODEL_IDENTITY_CONFIG";
  await writeFile(
    experiment,
    `
    import process from "node:process";
    const settings = JSON.parse(process.env.${envKey});
    ${source.replace("{ adapter, evals:", "{ ...settings, adapter, evals:")}
  `,
  );
  const defaultModel = "fixture/model";
  const effort = "high";
  const configurations = {
    omitted: {},
    model: { model: defaultModel },
    effort: { reasoningEffort: effort },
    both: { model: defaultModel, reasoningEffort: effort },
    multi: {
      models: {
        planner: { model: "fixture/planner" },
        reviewer: { model: "fixture/reviewer", reasoningEffort: effort },
      },
    },
  } satisfies Record<keyof typeof expectedModelDigests, object>;

  // Vary only the evaluated configuration. Observing a temporary module URL would add its path to the fingerprint.
  const previous = process.env[envKey];
  try {
    for (const [name, config] of Object.entries(configurations)) {
      process.env[envKey] = JSON.stringify(config);
      const [slot] = (await preview(cwd)).slots;
      if (slot?.target.evalId !== "first") throw new Error(`Missing planned Eval for ${name}`);
      fixedModelDigests[name] = slot.target.executionIdentityDigest;
    }
  } finally {
    if (previous === undefined) delete process.env[envKey];
    else process.env[envKey] = previous;
  }
}

beforeAll(async () => {
  await observeFixedModelDigests();
  const cwd = await project("niceeval-model-identity-");
  const experiment = join(cwd, "experiments", "runs.ts");
  const source = await readFile(experiment, "utf8");
  await writeFile(
    experiment,
    `
    import { readFileSync } from "node:fs";
    const settings = JSON.parse(readFileSync(new URL("../models.json", import.meta.url), "utf8"));
    ${source.replace("{ adapter, evals:", "{ ...settings, adapter, evals:")}
  `,
  );
  const writeModels = (value: object) => writeFile(join(cwd, "models.json"), JSON.stringify(value));
  const planner = { model: "fixture/planner" };
  const reviewer = { model: "fixture/reviewer", reasoningEffort: "high" };
  await writeModels({ models: { planner, reviewer } });
  const run = await execute(cwd);
  await writeModels({ models: { reviewer, planner } });
  const [reordered] = (await preview(cwd)).slots;
  for (const suffix of roleSamples) {
    await writeModels({ models: { reviewer, planner: { model: `${planner.model}-${suffix}` } } });
    const [changed] = (await preview(cwd)).slots;
    roles.push({ run, reordered: reordered!, changed: changed! });
  }

  const digest = async (config: object) => {
    await writeModels(config);
    return (await preview(cwd)).slots[0]!.target.executionIdentityDigest;
  };
  const omitted = await digest({});
  for (const [suffix, reasoningEffort] of scalarSamples) {
    const model = `fixture/model-${suffix}`;
    scalarResults.push({
      scalar: await digest({ model, reasoningEffort }),
      explicit: await digest({ models: { default: { model, reasoningEffort } } }),
      incomplete: [omitted, await digest({ model }), await digest({ reasoningEffort })],
    });
  }

  for (const deleteOldestFirst of deletionSamples) {
    const root = await project("niceeval-reuse-barrier-");
    const history = [await execute(root), await execute(root), await execute(root)];
    const remaining = [...history];
    const observe = async () => ({ source: remaining.at(-1)?.runId, slot: (await preview(root)).slots[0]! });
    const observations = [await observe()];
    for (const index of deleteOldestFirst ? [2, 0, 1] : [2, 1, 0]) {
      const { runId } = history[index]!;
      await Effect.runPromise(runHost.delete({ cwd: root, runId }));
      remaining.splice(
        remaining.findIndex((item) => item.runId === runId),
        1,
      );
      observations.push(await observe());
    }
    deletionResults.push(observations);
  }

  const refresh = await project("niceeval-fresh-discovery-");
  const dependency = join(refresh, "node_modules", "stable.cjs");
  await writeFile(dependency, "module.exports = { answer: 42 };\n");
  for (const revisions of refreshSamples) {
    const observations = [];
    for (const revision of revisions) {
      await writeFile(
        join(refresh, "evals", "first.eval.ts"),
        `
        import adapter from "../adapter.ts";
        const dependency = require("../node_modules/stable.cjs");
        export default adapter.defineEval({
          description: ${JSON.stringify(`revision-${revision}`)} + ":" + dependency.answer,
          test(t) { t.ready(); },
        });
      `,
      );
      const catalog = await Effect.runPromise(experimentHost.catalog({ cwd: refresh }));
      const linked = await Effect.runPromise(
        experimentHost.check({ cwd: refresh, experimentSelector: "runs", config: {} }),
      );
      observations.push({
        description: catalog.evals.find(({ id }) => id === "first")?.description,
        linked: linked.status,
      });
    }
    refreshResults.push(observations);
  }
}, 60_000);

afterAll(async () => {
  await Promise.all(projects.map((cwd) => rm(cwd, { recursive: true, force: true })));
});

// @feature docs/feature/experiments/README.md#partial-reuse
test("fixed model configurations retain their public execution identity digests", () => {
  expect(fixedModelDigests).toEqual(expectedModelDigests);
});

// @feature docs/feature/experiments/README.md#partial-reuse
test("model-role declaration order preserves identity while changing a named model prevents reuse", () => {
  for (const { run, reordered, changed } of roles) {
    expect(reordered).toMatchObject({
      state: "reuse",
      source: { sourceRunId: run.runId },
      target: { executionIdentityDigest: run.slots[0]!.executionIdentityDigest },
    });
    expect(changed).toMatchObject({ state: "gap", reason: "identity-mismatch" });
    const explanation = changed.comparisons.find(
      ({ recordedClaim }) => recordedClaim === "execution-identity",
    )?.explanation;
    expect(explanation).toMatchObject({ kind: "changed", deltas: [{ selector: "config:models.planner.model" }] });
  }
});

// @feature docs/feature/experiments/README.md#partial-reuse
test("scalar model selection and an equivalent explicit default role give the same identity", () => {
  for (const { scalar, explicit, incomplete } of scalarResults) {
    expect(explicit).toBe(scalar);
    expect(new Set([scalar, ...incomplete]).size).toBe(4);
  }
});

// @feature docs/feature/experiments/README.md#partial-reuse
test("deleting Runs reveals the newest remaining source for each slot", () => {
  for (const observations of deletionResults) {
    for (const { source, slot } of observations) {
      if (source) expect(slot).toMatchObject({ state: "reuse", source: { sourceRunId: source } });
      else expect(slot).toMatchObject({ state: "gap", reason: "no-source-run" });
    }
  }
});

// @feature docs/feature/experiments/README.md#configuration-precedence
test("planning refreshes edited Eval sources and links the shared Adapter in each discovery", () => {
  for (const [index, revisions] of refreshSamples.entries()) {
    expect(refreshResults[index]).toEqual(
      revisions.map((revision) => ({
        description: `revision-${revision}:42`,
        linked: "linked",
      })),
    );
  }
});
