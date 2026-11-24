import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  defineSandboxTemplate,
  planSandboxTemplate,
  sandboxLayerStateOf,
  sandboxProviderBindingOf,
  sandboxProviderPlan,
  sandboxTemplateCommandPlanLocator,
  type SandboxLayer,
  type BeforeCachePreparer,
} from "../../packages/niceeval/src/sandbox/layer.ts";
import { createLifecycleProject } from "./fixtures/lifecycle-sandbox/harness.ts";

function withCachedBranch(
  base: SandboxLayer<"template-bearing">,
  warmLeaf: string,
  onPublish: (id: string) => void,
  lookupGate: () => Promise<void>,
) {
  const template = sandboxLayerStateOf(base).template;
  const preparer: BeforeCachePreparer<void> = {
    continuesStaging: true,
    supportsAgentDerived: false,
    eligibility: () =>
      Effect.succeed({
        _tag: "Eligible",
        coverage: "all",
        persistence: "persistent",
        dependency: "parent-backed",
        baseIdentity: "fixture",
        keyScope: { cacheFormat: "fixture", semanticIdentity: {} },
        replacementScope: undefined,
      }),
    lookup: (_, __, steps) => {
      const step = steps[0]!;
      return Effect.promise(lookupGate).pipe(
        Effect.as(
          step.positions.at(-1) === warmLeaf
            ? { _tag: "Hit", artifact: { ...step.declaration, locator: warmLeaf } }
            : { _tag: "Miss" },
        ),
      );
    },
    materializeFrom: (_, context, _purpose, _source, runtime) =>
      context
        .materializeBase(runtime)
        .pipe(Effect.map((sandbox) => ({ _tag: "Materialized", sandbox, start: { _tag: "Restored" } }))),
    capture: (_, __, ___, step) =>
      Effect.sync(() => {
        onPublish(step.positions.at(-1)!);
        return { _tag: "Published", artifact: { ...step.declaration, locator: [...step.positions] } };
      }),
  };
  return defineSandboxTemplate({
    provider: template.provider,
    kind: template.kind,
    publishableIdentity: template.identity,
    privateFingerprintIdentity: template.identity,
    leakGate: template.leakGate,
    commandPlanLocator: sandboxTemplateCommandPlanLocator(template),
    plan: (input) =>
      planSandboxTemplate(template, input).pipe(
        Effect.map((original) => {
          const binding = Option.getOrThrow(sandboxProviderBindingOf(original));
          return sandboxProviderPlan({
            ...original,
            identityMarker: undefined,
            runtimePlan: undefined,
            interruptibleAcquisition: binding.interruptibleAcquisition,
            publishableIdentity: original.identity,
            privateFingerprintIdentity: original.identity,
            module: {
              id: binding.moduleId,
              capabilities: binding.capabilities,
              beforeCache: { _tag: "RunPrepared", coverage: "all", preparer },
              collectBuildPreparation: (_, __, evalId) => binding.collectBuildPreparation(evalId),
              materialize: (_, context) => binding.materialize(context),
            },
          });
        }),
      ),
  });
}

// @feature docs/feature/sandbox/README.md#shared-builds
describe.each(["leaf-a", "leaf-b"])("deep hit on %s", (warmLeaf) => {
  let project: Awaited<ReturnType<typeof createLifecycleProject>>;
  const firstLookup = Promise.withResolvers<void>();
  const resumeLookup = Promise.withResolvers<void>();
  const leafPublished = Promise.withResolvers<void>();
  let invocation: Promise<Effect.Success<ReturnType<typeof experimentHost.invocation.run>>>;
  const coldLeaf = warmLeaf === "leaf-a" ? "leaf-b" : "leaf-a";
  const controller = new AbortController();
  const published = new Set<string>();
  beforeAll(async () => {
    project = await createLifecycleProject({
      attempts: 1,
      maxConcurrency: 2,
      failCreates: [],
      scripts: ["a", "b"].map(() => ({ cleanups: 0, beforeFails: false, test: "pass" })),
    });
    const wrap = Symbol.for(project.cwd);
    Reflect.set(process, wrap, (layer: SandboxLayer<"template-bearing">) =>
      withCachedBranch(
        layer,
        warmLeaf,
        (id) => {
          published.add(id);
          if (id === coldLeaf) leafPublished.resolve();
        },
        () => {
          firstLookup.resolve();
          return resumeLookup.promise;
        },
      ),
    );
    await writeFile(
      join(project.cwd, "experiments/lifecycle.ts"),
      `
import { defineExperiment } from "niceeval";
import { shell } from "niceeval/sandbox";
import base from "../sandbox.ts";
import agent from "../agent.ts";
export default defineExperiment({adapter:agent, sandbox:Reflect.get(process, Symbol.for(${JSON.stringify(project.cwd)}))(base)
  .before(shell({id:"root",command:"true"})), evals:"*"});`,
    );
    for (const [i, branch] of ["a", "b"].entries()) {
      await writeFile(
        join(project.cwd, "evals", `e${i}.eval.ts`),
        `
import { defineEval } from "niceeval";
import { sandboxLayer, shell } from "niceeval/sandbox";
export default defineEval({sandbox:sandboxLayer().before(shell({id:"branch-${branch}",command:"true"}))
  .before(shell({id:"leaf-${branch}",command:"true"})), async test() {}});`,
      );
    }
    const prepared = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd: project.cwd,
        experimentSelector: "lifecycle",
        config: {},
        overrides: { rerun: "all", maxBeforeCacheConcurrency: 1, earlyExit: false },
      }),
    );
    if (prepared.status !== "ready") throw new Error(JSON.stringify(prepared));
    invocation = Effect.runPromise(experimentHost.invocation.run({ plan: prepared.plan, signal: controller.signal }));
    await Promise.race([
      firstLookup.promise,
      invocation.then(() => {
        throw new Error("Invocation ended before lookup");
      }),
    ]);
  });
  afterAll(async () => {
    if (project) {
      resumeLookup.resolve();
      if (!published.has(coldLeaf)) controller.abort();
      try {
        if (invocation) await invocation;
      } finally {
        Reflect.deleteProperty(process, Symbol.for(project.cwd));
        await project.dispose();
      }
    }
  });
  test("the other branch finishes at capacity one", async () => {
    resumeLookup.resolve();
    await expect(
      Promise.race([
        leafPublished.promise,
        invocation.then(() => {
          throw new Error("cold leaf was skipped");
        }),
      ]),
    ).resolves.toBeUndefined();
    expect([...published].sort()).toEqual([coldLeaf, "root"]);
  });
});
