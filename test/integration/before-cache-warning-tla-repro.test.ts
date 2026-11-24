import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  defineSandboxTemplate,
  planSandboxTemplate,
  sandboxLayerStateOf,
  sandboxProviderBindingOf,
  sandboxProviderPlan,
  type SandboxLayer,
  type BeforeCachePreparer,
} from "../../packages/niceeval/src/sandbox/layer.ts";
import { experimentHost } from "niceeval/experiment/host";
import { createFeedbackCoordinator } from "../../packages/niceeval/src/runner/feedback/coordinator.ts";
import { createNodeFeedbackIO } from "../../packages/niceeval/src/runner/feedback/io.ts";
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
