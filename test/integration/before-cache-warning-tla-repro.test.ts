import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createFeedbackCoordinator } from "../../packages/niceeval/src/runner/feedback/coordinator.ts";
import { createNodeFeedbackIO } from "../../packages/niceeval/src/runner/feedback/io.ts";
import type { BeforeCacheStep } from "../../packages/niceeval/src/sandbox/backend.ts";
import {
  defineSandboxTemplate,
  planSandboxTemplate,
  sandboxLayerStateOf,
  sandboxProviderBindingOf,
  sandboxProviderPlan,
  type SandboxLayer,
  type BeforeCachePreparer,
} from "../../packages/niceeval/src/sandbox/layer.ts";
import { createLifecycleProject } from "./fixtures/lifecycle-sandbox/harness.ts";

type Mode = "docker" | "remote";
function providerFixture(
  layer: SandboxLayer<"template-bearing">,
  mode: Mode,
  variant: number,
  image: string,
  stop: () => void,
) {
  const template = sandboxLayerStateOf(layer).template;
  const replacementScope = { provider: mode, executionDomainId: "fixture", baseReference: "repo" };
  const preparer: BeforeCachePreparer<void> = {
    continuesStaging: false,
    supportsAgentDerived: false,
    eligibility: () =>
      Effect.succeed({
        _tag: "Eligible",
        persistence: "persistent",
        dependency: "parent-backed",
        coverage: "all",
        baseIdentity: "repo@sha256:" + String(variant).repeat(64),
        keyScope: { cacheFormat: "fixture", semanticIdentity: {} },
        replacementScope,
      }),
    lookup: () => Effect.sync(stop).pipe(Effect.andThen(Effect.interrupt)),
    materializeFrom: (_, context, _purpose, _source, runtime) =>
      context
        .materializeBase(runtime)
        .pipe(Effect.map((sandbox) => ({ _tag: "Materialized", sandbox, start: { _tag: "Restored" } }))),
    capture: () => Effect.die("fixture prefixes are warm"),
  };
  return defineSandboxTemplate({
    provider: mode,
    kind: "image",
    publishableIdentity: { resources: { cpus: variant } },
    privateFingerprintIdentity: { image, variant },
    leakGate: template.leakGate,
    commandPlanLocator: { _tag: "Exact", fields: [{ name: "image", value: image }] },
    plan: (input) =>
      planSandboxTemplate(template, input).pipe(
        Effect.map((original) => {
          const binding = Option.getOrThrow(sandboxProviderBindingOf(original));
          const common = {
            id: mode,
            capabilities: binding.capabilities,
            collectBuildPreparation: () => Effect.succeed(Option.none()),
          };
          return sandboxProviderPlan({
            ...original,
            provider: mode,
            runtimePlan: undefined,
            interruptibleAcquisition: false,
            identityMarker: undefined,
            publishableIdentity: { resources: { cpus: variant } },
            privateFingerprintIdentity: { image, variant },
            module:
              mode === "remote"
                ? {
                    ...common,
                    beforeCache: { _tag: "RunPrepared", coverage: "all", preparer },
                    materialize: (_, context) => binding.materialize(context),
                  }
                : {
                    ...common,
                    beforeCache: { _tag: "AttemptCaptured", coverage: "all" },
                    materialize: () => Effect.sync(stop).pipe(Effect.andThen(Effect.interrupt)),
                  },
          });
        }),
      ),
  });
}

// @feature docs/feature/sandbox/README.md#shared-builds
describe.each([
  { mode: "docker" as const, sameImage: true, conflicts: 1 },
  { mode: "docker" as const, sameImage: false, conflicts: 0 },
  { mode: "remote" as const, sameImage: true, conflicts: 1 },
])("replacement warnings for $mode, same image reference $sameImage", ({ mode, sameImage, conflicts }) => {
  let project: Awaited<ReturnType<typeof createLifecycleProject>>;
  let plan: Extract<Effect.Success<ReturnType<typeof experimentHost.invocation.plan>>, { status: "ready" }>["plan"];
  const reachedProvider = Promise.withResolvers<void>();
  let invocation: Promise<unknown> | undefined;
  beforeAll(async () => {
    project = await createLifecycleProject({
      attempts: 1,
      maxConcurrency: 2,
      failCreates: [],
      scripts: [{ cleanups: 0, beforeFails: false, test: "pass" }],
    });
    const key = Symbol.for(project.cwd);
    Reflect.set(process, key, (layer: SandboxLayer<"template-bearing">, mode: Mode, variant: number, image: string) =>
      providerFixture(layer, mode, variant, image, () => {
        reachedProvider.resolve();
        project.abort.abort();
      }),
    );
    for (const [i, name] of ["lifecycle", "second"].entries()) {
      const image = sameImage ? "repo:tag" : "repo:tag" + i;
      const command = mode === "remote" ? "true" : "echo " + i;
      await writeFile(
        join(project.cwd, "experiments", name + ".ts"),
        `
import { defineExperiment } from "niceeval";
import { shell } from "niceeval/sandbox";
import agent from "../agent.ts";
import sandbox from "../sandbox.ts";
const provider = Reflect.get(process,Symbol.for(${JSON.stringify(project.cwd)}))(sandbox,${JSON.stringify(mode)},${i + 1},${JSON.stringify(image)});
export default defineExperiment({adapter:agent,sandbox:provider.before(shell({id:"prepare",command:${JSON.stringify(command)}})),evals:"*"});`,
      );
    }
    await writeFile(
      join(project.cwd, "evals/e0.eval.ts"),
      `
import { defineEval } from "niceeval";
import { sandboxLayer,shell } from "niceeval/sandbox";
export default defineEval({sandbox:sandboxLayer().before(shell({id:"tail",command:"true"})), async test(){}});`,
    );
    const prepared = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd: project.cwd,
        experimentIds: ["lifecycle", "second"],
        config: {},
        overrides: { rerun: "all", earlyExit: false },
      }),
    );
    if (prepared.status !== "ready") throw new Error(JSON.stringify(prepared));
    plan = prepared.plan;
  });
  afterAll(async () => {
    if (project) {
      project.abort.abort();
      try {
        await invocation;
      } finally {
        Reflect.deleteProperty(process, Symbol.for(project.cwd));
        await project.dispose();
      }
    }
  });
  test("reports conflicting positions before provider I/O", async () => {
    const warnings: string[] = [];
    const coordinator = createFeedbackCoordinator({
      profile: "json",
      io: createNodeFeedbackIO(),
      renderer: { appendDurable() {} },
      tickIntervalMs: undefined,
      activateSink: false,
      onEvent: (event) => {
        if (event.type === "diagnostic" && event.code === "before-cache-replacement-conflict")
          warnings.push(event.message);
      },
    });
    invocation = Effect.runPromise(
      experimentHost.invocation.run({ plan, signal: project.abort.signal, feedback: { coordinator } }),
    );
    await Promise.race([
      reachedProvider.promise,
      invocation.then(() => {
        throw new Error("Invocation ended before provider I/O");
      }),
    ]);
    expect(warnings).toHaveLength(conflicts);
    if (conflicts) expect(warnings[0]).toContain('Before action "tail"');
  });
});

type RuntimeBase = "derived" | "mutable" | "unchanged";

function runtimeProviderFixture(
  layer: SandboxLayer<"template-bearing">,
  mode: RuntimeBase,
  onLookup: (key: string) => void,
) {
  const template = sandboxLayerStateOf(layer).template;
  let materialized = 0;
  const firstLookup = Promise.withResolvers<void>();
  return defineSandboxTemplate({
    provider: "docker",
    kind: "image",
    publishableIdentity: template.identity,
    privateFingerprintIdentity: template.identity,
    leakGate: template.leakGate,
    commandPlanLocator:
      mode === "derived"
        ? { _tag: "Opaque", reason: { code: "fixture-derived", summary: "Locator resolved after build" } }
        : { _tag: "Exact", fields: [{ name: "image", value: "repo:tag" }] },
    plan: (input) =>
      planSandboxTemplate(template, input).pipe(
        Effect.map((original) => {
          const binding = Option.getOrThrow(sandboxProviderBindingOf(original));
          return sandboxProviderPlan({
            ...original,
            provider: "docker",
            runtimePlan: undefined,
            interruptibleAcquisition: binding.interruptibleAcquisition,
            identityMarker: undefined,
            publishableIdentity: original.identity,
            privateFingerprintIdentity: original.identity,
            module: {
              id: "docker",
              capabilities: binding.capabilities,
              beforeCache: { _tag: "AttemptCaptured", coverage: "all" },
              collectBuildPreparation: () => Effect.succeed(Option.none()),
              materialize: (_, context) =>
                binding.materialize(context).pipe(
                  Effect.map((sandbox) => {
                    const ordinal = materialized++;
                    const baseIdentity = ordinal === 0 || mode === "unchanged" ? "base-a" : "base-b";
                    const replacementScope = {
                      provider: "docker",
                      executionDomainId: "local",
                      baseReference: mode === "derived" ? "fixture-built-image" : "repo:tag",
                    };
                    const capability = {
                      eligibility: () =>
                        (ordinal === 0 ? Effect.void : Effect.promise(() => firstLookup.promise)).pipe(
                          Effect.as({
                            _tag: "Eligible" as const,
                            persistence: "persistent" as const,
                            dependency: "parent-backed" as const,
                            coverage: "all" as const,
                            baseIdentity,
                            keyScope: { cacheFormat: "fixture", semanticIdentity: {} },
                            replacementScope,
                          }),
                        ),
                      lookupAndRestore: (step: BeforeCacheStep) =>
                        Effect.sync(() => {
                          const key = step.declaration.beforeCacheKey;
                          onLookup(key);
                          firstLookup.resolve();
                          return {
                            _tag: "Restored" as const,
                            beforeCacheKey: key,
                            entryId: key,
                            generation: 1,
                            artifactId: key,
                            imageId: undefined,
                            sandboxId: sandbox.sandbox.sandboxId,
                          };
                        }),
                      capture: () => Effect.die("fixture prefixes are warm"),
                      fallBackToBase: () => Effect.die("fixture has no failed restore"),
                    };
                    return { ...sandbox, beforeCache: { _tag: "AttemptCaptured" as const, capability } };
                  }),
                ),
            },
          });
        }),
      ),
  });
}

// @feature docs/feature/sandbox/README.md#shared-builds
describe.each([
  { mode: "derived", distinct: 2, conflicts: 1 },
  { mode: "mutable", distinct: 2, conflicts: 1 },
  { mode: "unchanged", distinct: 1, conflicts: 0 },
] satisfies { mode: RuntimeBase; distinct: number; conflicts: number }[])(
  "replacement warnings after resolving $mode Base",
  ({ mode, distinct, conflicts }) => {
    let project: Awaited<ReturnType<typeof createLifecycleProject>>;
    let plan: Extract<Effect.Success<ReturnType<typeof experimentHost.invocation.plan>>, { status: "ready" }>["plan"];
    let invocation: Promise<unknown> | undefined;
    const reachedLookups = Promise.withResolvers<void>();
    const lookedUp: string[] = [];
    const warnings: Array<{ message: string; keysSeen: number }> = [];
    beforeAll(async () => {
      project = await createLifecycleProject({
        attempts: 1,
        maxConcurrency: 2,
        failCreates: [],
        scripts: [0, 1].map(() => ({ cleanups: 0, beforeFails: false, test: "pass" })),
      });
      Reflect.set(process, Symbol.for(project.cwd), (layer: SandboxLayer<"template-bearing">) =>
        runtimeProviderFixture(layer, mode, (candidate) => {
          lookedUp.push(candidate);
          if (lookedUp.length === 2) reachedLookups.resolve();
        }),
      );
      await writeFile(
        join(project.cwd, "experiments/lifecycle.ts"),
        `
import { defineExperiment } from "niceeval";
import { shell } from "niceeval/sandbox";
import base from "../sandbox.ts";
import agent from "../agent.ts";
const provider = Reflect.get(process, Symbol.for(${JSON.stringify(project.cwd)}))(base);
export default defineExperiment({adapter:agent, sandbox:provider.before(shell({id:"prepare",command:"exit 42"})), evals:"*"});`,
      );
      await Promise.all(
        project.evalIds.map((evalId) =>
          writeFile(
            join(project.cwd, "evals", `${evalId}.eval.ts`),
            `
import { defineEval } from "niceeval";
export default defineEval({async test(){}});`,
          ),
        ),
      );
      const prepared = await Effect.runPromise(
        experimentHost.invocation.plan({
          cwd: project.cwd,
          experimentIds: ["lifecycle"],
          config: { maxConcurrency: 2 },
          overrides: { rerun: "all", earlyExit: false },
        }),
      );
      if (prepared.status !== "ready") throw new Error(JSON.stringify(prepared));
      plan = prepared.plan;
    });
    afterAll(async () => {
      if (project) {
        project.abort.abort();
        try {
          await invocation;
        } finally {
          Reflect.deleteProperty(process, Symbol.for(project.cwd));
          await project.dispose();
        }
      }
    });
    test("observes exact keys and warns once when exact keys conflict", async () => {
      const coordinator = createFeedbackCoordinator({
        profile: "json",
        io: createNodeFeedbackIO(),
        renderer: { appendDurable() {} },
        tickIntervalMs: undefined,
        activateSink: false,
        onEvent: (event) => {
          if (event.type === "diagnostic" && event.code === "before-cache-replacement-conflict")
            warnings.push({ message: event.message, keysSeen: lookedUp.length });
        },
      });
      invocation = Effect.runPromise(
        experimentHost.invocation.run({
          plan,
          signal: project.abort.signal,
          feedback: { coordinator },
        }),
      );
      await Promise.race([
        reachedLookups.promise,
        invocation.then(() => {
          throw new Error("Invocation ended before both Before cache lookups");
        }),
      ]);
      expect(lookedUp).toHaveLength(2);
      expect(new Set(lookedUp).size).toBe(distinct);
      expect(warnings).toHaveLength(conflicts);
      if (conflicts) {
        expect(warnings[0]).toEqual({
          message: expect.stringContaining('Before action "prepare"'),
          keysSeen: 1,
        });
      }
    });
  },
);
