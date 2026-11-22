import { appendFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { createRecordProject } from "./fixtures/record-harness/project.ts";

async function plan(cwd: string, preview: boolean) {
  const result = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "runs",
      config: {},
      ...(preview ? { preview } : { overrides: { rerun: "all" } }),
    }),
  );
  if (result.status !== "ready") throw new Error(`Expected ready plan: ${JSON.stringify(result)}`);
  return result;
}

async function observeSlot(cwd: string) {
  const { dry } = await plan(cwd, true);
  if (dry?.slots.length !== 1) throw new Error(`Expected a single slot: ${JSON.stringify(dry)}`);
  return dry.slots[0]!;
}

const layouts = ["hoisted", "nested", "linked"] as const;
type Layout = (typeof layouts)[number];
type Probe = [layout: Layout, depth: number, changed: number];
type Observation = Awaited<ReturnType<typeof observeSlot>>;
type Declaration = "dependencies" | "peerDependencies" | "optionalDependencies" | "optional-peer";

const directories: string[] = [];
const observations: {
  probe: Probe;
  runId: string;
  initial: Observation;
  updated: Observation;
  missing: Observation;
}[] = [];
const optionalObservations: {
  declaration: Declaration;
  runId: string;
  absent: Observation;
  present: Observation;
}[] = [];

function declareDependency(name: string, declaration: Declaration) {
  if (declaration === "optional-peer") {
    return { peerDependencies: { [name]: "2.0.1" }, peerDependenciesMeta: { [name]: { optional: true } } };
  }
  return { [declaration]: { [name]: "2.0.1" } };
}

async function installClosure(cwd: string, layout: Layout, depth: number, declaration: Declaration = "dependencies") {
  // Reduce the registry js-yaml/argparse counterexample to local installed packages.
  // The root's main entry works without argparse, which is used by its deferred entry.
  const nodeModules = join(cwd, "node_modules");
  let root = join(nodeModules, "js-yaml");
  if (layout === "linked") {
    root = await mkdtemp(join(dirname(cwd), "niceeval-linked-dependency-"));
    directories.push(root);
  }
  const names = ["js-yaml", ...Array.from({ length: depth }, (_, index) => (index === 0 ? "argparse" : `leaf-${index}`))];
  const roots = [root];
  for (const name of names.slice(1)) {
    roots.push(join(layout === "hoisted" ? nodeModules : join(roots.at(-1)!, "node_modules"), name));
  }
  for (const [index, directory] of roots.entries()) {
    const next = names[index + 1];
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: names[index],
        version: index === 0 ? "4.1.0" : "2.0.1",
        type: "module",
        exports: "./index.js",
        ...(next === undefined ? {} : declareDependency(next, index === 0 ? declaration : "dependencies")),
      }),
    );
    await writeFile(
      join(directory, "index.js"),
      `export const load = Number;\n${next === undefined ? "" : `export const deferred = () => import("${next}");\n`}`,
    );
  }
  if (layout === "linked") await symlink(root, join(nodeModules, "js-yaml"), "dir");
  await writeFile(
    join(cwd, "adapter.ts"),
    `
    import { load } from "js-yaml";
    import { defineAdapter } from "niceeval/adapter";
    import { equals } from "niceeval/expect";
    export default defineAdapter({
      name: "installed-package-fixture", behaviorRevision: "1", create: () => ({}),
      assertions: ({ check }) => ({ ready: () => check(load("1"), equals(1)) }),
    });
    `,
  );
  return roots.slice(1);
}

async function publish(cwd: string): Promise<string> {
  const execution = await plan(cwd, false);
  const { receipt, summary } = await Effect.runPromise(experimentHost.invocation.run({ plan: execution.plan }));
  expect(receipt.completion).toBe("completed");
  expect(receipt.createdRunIds).toHaveLength(1);
  expect(summary.passed).toBe(1);
  return receipt.createdRunIds[0]!;
}

beforeAll(async () => {
  const closure: fc.Arbitrary<Probe> = fc
    .tuple(fc.constantFrom(...layouts), fc.integer({ min: 1, max: 3 }))
    .chain(([layout, depth]) => fc.tuple(fc.constant(layout), fc.constant(depth), fc.nat(depth - 1)));
  const probes = fc.sample<Probe>(closure, {
    seed: 20261121,
    numRuns: 5,
    examples: [
      ["hoisted", 1, 0],
      ["nested", 3, 2],
      ["linked", 2, 1],
    ],
  });
  for (const probe of probes) {
    const [layout, depth, changed] = probe;
    const cwd = await createRecordProject("niceeval-dependency-content-", { held: false });
    directories.push(cwd);
    const packages = await installClosure(cwd, layout, depth, layout === "linked" ? "peerDependencies" : "dependencies");
    const runId = await publish(cwd);

    const initial = await observeSlot(cwd);
    const changedPackage = packages[changed]!;
    await appendFile(join(changedPackage, "index.js"), "export const changed = 2;\n");
    const updated = await observeSlot(cwd);
    await rm(changedPackage, { recursive: true });
    const missing = await observeSlot(cwd);
    observations.push({ probe, runId, initial, updated, missing });
  }
  for (const declaration of ["optional-peer", "optionalDependencies"] as const) {
    const cwd = await createRecordProject("niceeval-optional-dependency-", { held: false });
    directories.push(cwd);
    const [dependency] = await installClosure(cwd, "hoisted", 1, declaration);
    const inactive = join(cwd, "inactive-dependency");
    await rename(dependency!, inactive);
    const runId = await publish(cwd);
    const absent = await observeSlot(cwd);
    await rename(inactive, dependency!);
    const present = await observeSlot(cwd);
    optionalObservations.push({ declaration, runId, absent, present });
  }
}, 60_000);

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

// @feature docs/feature/experiments/README.md#partial-reuse
test("an unchanged installed dependency closure reuses the published Attempt", () => {
  for (const { probe, runId, initial } of observations) {
    expect(initial, JSON.stringify(probe)).toMatchObject({ state: "reuse", source: { sourceRunId: runId } });
  }
});

// @feature docs/feature/experiments/README.md#partial-reuse
test("editing transitive installed bytes changes the execution identity", () => {
  for (const { probe, initial, updated } of observations) {
    expect(updated, JSON.stringify(probe)).toMatchObject({ state: "gap", reason: "identity-mismatch" });
    expect(updated.target.executionIdentityDigest, JSON.stringify(probe)).not.toBe(
      initial.target.executionIdentityDigest,
    );
  }
});

// @feature docs/feature/experiments/README.md#partial-reuse
test("a missing transitive package makes the slot ineligible for reuse", () => {
  for (const { probe, missing } of observations) {
    expect(missing, JSON.stringify(probe)).toMatchObject({ state: "gap", reason: "dynamic-module-unresolved" });
    if (missing.state !== "gap") throw new Error("Expected a gap");
    expect(missing.issues, JSON.stringify(probe)).toContainEqual(
      expect.objectContaining({ code: "dynamic-module-unresolved", file: "adapter.ts" }),
    );
  }
});

// @feature docs/feature/experiments/README.md#partial-reuse
test("an absent optional dependency or peer keeps the published result reusable", () => {
  for (const { declaration, runId, absent } of optionalObservations) {
    expect(absent, declaration).toMatchObject({ state: "reuse", source: { sourceRunId: runId } });
  }
});

// @feature docs/feature/experiments/README.md#partial-reuse
test("installing a previously absent optional dependency or peer changes the execution identity", () => {
  for (const { declaration, absent, present } of optionalObservations) {
    expect(present, declaration).toMatchObject({ state: "gap", reason: "identity-mismatch" });
    expect(present.target.executionIdentityDigest, declaration).not.toBe(absent.target.executionIdentityDigest);
  }
});
