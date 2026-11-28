import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Option, Result, Schema } from "effect";
import { decodeExpPlanDocument, decodeExpStartEvent, experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createFeedbackCoordinator } from "../../packages/niceeval/src/runner/feedback/coordinator.ts";
import { createNodeFeedbackIO } from "../../packages/niceeval/src/runner/feedback/io.ts";
import type { AttemptBeforeCache, BeforeCacheStep } from "../../packages/niceeval/src/sandbox/backend.ts";
import { makeDockerBeforeCacheCapability } from "../../packages/niceeval/src/sandbox/docker-before-cache.ts";
import { remoteSnapshotPreparer } from "../../packages/niceeval/src/sandbox/remote-snapshot/preparer.ts";
import { instaboxSnapshotDriver } from "../../packages/niceeval/src/sandbox/instabox/snapshot-driver.ts";
import { InstaboxBackend } from "../../packages/niceeval/src/sandbox/instabox/sandbox.ts";
import { makeRecordRoot, NodeRecordLive, recordHost, RunIdSchema } from "../../packages/niceeval/src/record/index.ts";
import { NiceEvalRecordAttachments } from "../../packages/niceeval/src/record/family/current.ts";
import {
  defineSandboxTemplate,
  planSandboxTemplate,
  sandboxLayerStateOf,
  sandboxProviderBindingOf,
  sandboxProviderPlan,
  type SandboxLayer,
  type BeforeCachePreparer,
} from "../../packages/niceeval/src/sandbox/layer.ts";
import { createLifecycleProject, runCli } from "./fixtures/lifecycle-sandbox/harness.ts";
import { selectInspectionOperation, withOperational } from "./fixtures/adapter-trace-usage-harness/harness.ts";

type Mode = "docker" | "remote";
function providerFixture(
  layer: SandboxLayer<"template-bearing">,
  mode: Mode,
  variant: number,
  image: string,
  stop: () => void,
  providedPreparer?: BeforeCachePreparer<void>,
) {
  const template = sandboxLayerStateOf(layer).template;
  const replacementScope = { provider: mode, executionDomainId: "fixture", baseReference: "repo" };
  const preparer: BeforeCachePreparer<void> = providedPreparer ?? {
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

// @feature docs/feature/sandbox/README.md#preparation-failure
describe.each(["consumer", "staging", "retry"] as const)("restoring a selected snapshot during %s", (scenario) => {
  const selectedId = "8a8e6848-440f-47af-b4bb-7020917ee1b0";
  const diagnostics: string[] = [];
  const secret = "fixture-key-never-published";
  const providerCalls: string[] = [];
  let published: Awaited<ReturnType<typeof readPublishedDiagnostics>>;
  let runDiagnostics: readonly { readonly code: string; readonly summary: string }[];
  let stagingCauses: readonly { readonly code: string; readonly summary: string }[];
  let project: Awaited<ReturnType<typeof createLifecycleProject>>;
  function readPublishedDiagnostics(cwd: string, locator: string) {
    return withOperational(cwd, (facts) =>
      selectInspectionOperation(facts, { kind: "attempt.get", locator }).attempt.diagnostics.items,
    );
  }

  beforeAll(async () => {
    project = await createLifecycleProject({
      attempts: 1,
      maxConcurrency: 1,
      failCreates: [],
      scripts: [{ cleanups: 0, beforeFails: false, test: "pass" }],
    });
    const preparer: BeforeCachePreparer<void> = {
      continuesStaging: false,
      supportsAgentDerived: false,
      eligibility: () =>
        Effect.succeed({
          _tag: "Eligible",
          coverage: "all",
          persistence: "persistent",
          dependency: "parent-backed",
          baseIdentity: "fixture-base",
          keyScope: { cacheFormat: "fixture", semanticIdentity: {} },
          replacementScope: undefined,
        }),
      lookup: (_, __, [step]) =>
        Effect.succeed(
          step?.positions.at(-1) === "root"
            ? { _tag: "Hit", artifact: { ...step.declaration, locator: { artifactId: selectedId, executionDomainId: "fixture" } } }
            : scenario === "staging"
              ? { _tag: "Miss" }
              : { _tag: "Degraded", reason: "snapshot-uncertain", detail: "fixture publish failed" },
        ),
      materializeFrom: (_, context, purpose, source, runtime) => {
        expect(source).toMatchObject({ _tag: "Artifact", artifact: { locator: { artifactId: selectedId } } });
        return Effect.gen(function* () {
          if (scenario === "staging" && purpose === "consumer")
            return { _tag: "Materialized", sandbox: yield* context.materializeBase(runtime), start: { _tag: "Restored" } };
          const restored = yield* Effect.result(instaboxSnapshotDriver.createFromSnapshot({
            source: { _tag: "Template", id: "minimal" },
            pathPrepend: [],
            resources: { vcpus: 4, memMiB: 8192 },
            explicitSize: false,
            lifetimeMs: undefined,
          }, "sn_fixture", runtime));
          if (Result.isSuccess(restored)) {
            expect(scenario).toBe("retry");
            return { _tag: "Materialized", sandbox: restored.success, start: { _tag: "Restored" } };
          }
          expect(scenario).not.toBe("retry");
          const sandbox = yield* context.materializeBase(runtime);
          return {
            _tag: "Materialized",
            sandbox,
            start: {
              _tag: "FellBackToBase",
              reason: "snapshot-restore-failed",
              ...(restored.failure.causes === undefined ? {} : { causes: restored.failure.causes }),
            },
          };
        });
      },
      capture: () => Effect.die("fixture prefixes are settled by lookup"),
    };
    Reflect.set(process, Symbol.for(project.cwd), (layer: SandboxLayer<"template-bearing">) =>
      providerFixture(layer, "remote", 1, "fixture", () => {}, preparer),
    );
    await writeFile(join(project.cwd, "experiments/lifecycle.ts"), `
import { defineExperiment } from "niceeval";
import { shell } from "niceeval/sandbox";
import agent from "../agent.ts";
import base from "../sandbox.ts";
const sandbox = Reflect.get(process, Symbol.for(${JSON.stringify(project.cwd)}))(base);
export default defineExperiment({ adapter: agent, sandbox: sandbox
  .before(shell({ id: "root", command: 'printf "%s" replay-root' }))
  .before(shell({ id: "tail", command: 'printf "%s" replay-tail' })), evals: "*" });`);
    await writeFile(join(project.cwd, "evals/e0.eval.ts"), `
import { defineEval } from "niceeval";
export default defineEval({ async test() {} });`);
    const prepared = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd: project.cwd,
        experimentIds: ["lifecycle"],
        config: {},
        overrides: { rerun: "all", earlyExit: false },
      }),
    );
    if (prepared.status !== "ready") throw new Error(JSON.stringify(prepared));
    const coordinator = createFeedbackCoordinator({
      profile: "json",
      io: createNodeFeedbackIO(),
      renderer: { appendDurable() {} },
      tickIntervalMs: undefined,
      activateSink: false,
      onEvent: (event) => {
        if (event.type === "diagnostic" && event.code === "cache-degraded") diagnostics.push(event.message);
      },
    });
    vi.stubEnv("INSTABOX_API_KEY", secret);
    let allocations = 0;
    const idempotencyKeys: string[] = [];
    const probe = vi.spyOn(InstaboxBackend.prototype, "runCommand").mockImplementation(async (command, args) => ({
      exitCode: 0,
      stdout: command === "bash" && args?.[1]?.includes("uname -s") ? "Linux\nx86_64\nldd (GNU libc)\n" : "",
      stderr: "",
    }));
    vi.stubGlobal("fetch", (async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.instabox.sh");
      providerCalls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/v1/snapshots/sn_fixture") return Response.json({ id: "sn_fixture", status: "ready" });
      if (scenario === "retry") {
        if (url.pathname === "/v1/machines" && init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toMatchObject({ snapshotId: "sn_fixture", failFast: true });
          const key = new Headers(init.headers).get("Idempotency-Key");
          expect(key).toBeTruthy();
          idempotencyKeys.push(key!);
          if (allocations++ === 0)
            return Response.json({ error: { code: "no_capacity", retryable: true } }, { status: 503 });
          return Response.json({ id: "create", machineId: "fixture-machine", state: "succeeded", error: null }, { status: 202 });
        }
        if (url.pathname === "/v1/machines/fixture-machine/ssh-tokens")
          return Response.json({ id: "grant", machineId: "fixture-machine", token: "mock", host: "unused.fixture", port: 22, hostKeyFingerprint: "SHA256:AAAA" });
        if (url.pathname === "/v1/machines/fixture-machine") {
          if (init?.method === "DELETE") return Response.json({ id: "delete", machineId: "fixture-machine", state: "succeeded", error: null });
          return Response.json({ id: "fixture-machine", state: "running", operationId: null, runtime: { ready: true } });
        }
      }
      if (url.pathname !== "/v1/machines" || init?.method !== "POST") throw new Error("Unexpected provider request");
      return Response.json({ error: {
        code: "permission_denied",
        requestId: "req-denied",
        retryable: false,
        message: `Permission deni\u0007ed.\nAuthorization: Bearer ${secret}`,
        stack: secret,
      } }, { status: 403 });
    }) satisfies typeof fetch);
    try {
      const result = await Effect.runPromise(experimentHost.invocation.run({ plan: prepared.plan, feedback: { coordinator } }));
      expect(result.summary.passed).toBe(1);
      const runId = Schema.decodeUnknownSync(RunIdSchema)(result.receipt.createdRunIds[0]);
      const { run } = await Effect.runPromise(runHost.get({ cwd: project.cwd, runId }));
      const slot = run.slots[0];
      if (slot?.publication.state !== "published") throw new Error("Expected a published Attempt");
      published = await readPublishedDiagnostics(project.cwd, slot.publication.attemptLocator);
      runDiagnostics = await withOperational(project.cwd, (facts) =>
        selectInspectionOperation(facts, { kind: "run.get", runId }).run.diagnostics,
      );
      if (scenario === "staging") {
        const root = makeRecordRoot(join(project.cwd, ".niceeval"));
        if (Result.isFailure(root)) throw new Error("The staging fixture has no Record root");
        stagingCauses = await Effect.runPromise(
          Effect.gen(function* () {
            const reader = yield* recordHost.openRead({ root: root.success });
            const selection = yield* reader.selectRuns({ runIds: [runId] });
            const record = yield* reader.readRun(selection.runRefs[0]!);
            if (record.state !== "available") throw new Error("The staging fixture has no published Run");
            const diagnostics = yield* reader.read(record.value.owner, NiceEvalRecordAttachments.runnerDiagnostics.run);
            if (diagnostics.state !== "available") throw new Error("The staging fixture has no published Run diagnostics");
            return diagnostics.value.segments.flatMap((entry) => entry.code === "cache-degraded" ? entry.causes : []);
          }).pipe(Effect.scoped, Effect.provide(NodeRecordLive)),
        );
      }
      if (scenario === "retry") expect(new Set(idempotencyKeys).size).toBe(2);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      probe.mockRestore();
    }
  }, 15_000);

  afterAll(async () => {
    if (project) {
      Reflect.deleteProperty(process, Symbol.for(project.cwd));
      await project.dispose();
    }
  });

  test("publishes diagnostic causes for failed restores and uses the snapshot after a safe retry", () => {
    const recoveries = diagnostics.filter((message) => message.includes("snapshot-restore-failed"));
    const requestedAllocations = providerCalls.filter((request) => request === "POST /v1/machines");
    if (scenario === "retry") {
      expect(requestedAllocations).toHaveLength(2);
      expect(recoveries).toHaveLength(0);
      expect(published.every((item) => item.causes.length === 0)).toBe(true);
      expect(project.events.filter((event) => event.event === "create")).toHaveLength(0);
      return;
    }
    expect(requestedAllocations).toHaveLength(1);
    const safeCause = {
      code: "permission-denied",
      summary: "Instabox allocation failed: HTTP 403, permission_denied, requestId=req-denied, retryable=false, Permission denied.",
      summaryTruncated: false,
    };
    expect(JSON.stringify(published)).not.toContain(secret);
    if (scenario === "staging") {
      expect(recoveries).toEqual([expect.stringContaining("Staging fell back to Base")]);
      expect(runDiagnostics.filter((item) => item.code === "cache-degraded")).toEqual([
        expect.objectContaining({ summary: expect.stringContaining("Staging fell back to Base") }),
      ]);
      expect(published.filter((item) => item.summary.includes("Staging fell back to Base"))).toEqual([
        expect.objectContaining({ causes: [safeCause] }),
      ]);
      expect(stagingCauses).toEqual([{ code: safeCause.code, summary: safeCause.summary }]);
      return;
    }
    expect(recoveries).toHaveLength(2);
    expect(providerCalls).toEqual(["GET /v1/snapshots/sn_fixture", "POST /v1/machines"]);
    for (const action of ["root", "tail"]) {
      expect(recoveries).toContainEqual(expect.stringContaining(
        `restore stage create-instance; selected artifact ${selectedId}; Before experiment:lifecycle / ${action}`,
      ));
    }
    const publication = diagnostics.filter((message) => message.includes("snapshot-uncertain"));
    expect(publication).toEqual([expect.stringContaining("fixture publish failed")]);
    expect(publication[0]).not.toContain(selectedId);
    const restored = published.filter((item) => item.summary.includes("snapshot-restore-failed"));
    expect(restored).toHaveLength(2);
    for (const item of restored) {
      expect(item.summary).toContain("One restore failure affects 2 actions");
      expect(item.causes).toEqual([safeCause]);
    }
    expect(published.find((item) => item.summary.includes("snapshot-uncertain"))?.causes).toEqual([]);
    const replays = project.events.filter((event) =>
      event.event === "command-start" && JSON.stringify(event.args).includes("replay-"),
    );
    expect(replays).toHaveLength(2);
    expect(replays[0]?.args).toEqual(expect.arrayContaining([expect.stringContaining("replay-root")]));
    expect(replays[1]?.args).toEqual(expect.arrayContaining([expect.stringContaining("replay-tail")]));
    expect(replays[0]?.sandboxId).toBe(replays[1]?.sandboxId);
  });
});

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
  cache: AttemptBeforeCache | ((key: string) => void),
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
              beforeCache: { _tag: "AttemptCaptured", coverage: "all", ...(typeof cache === "function" ? {} : { requiresUserDatabase: true }) },
              collectBuildPreparation: () => Effect.succeed(Option.none()),
              materialize: (_, context) =>
                binding.materialize(context).pipe(
                  Effect.map((sandbox) => {
                    if (typeof cache !== "function") {
                      return { ...sandbox, beforeCache: { _tag: "AttemptCaptured" as const, capability: cache } };
                    }
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
                          cache(key);
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

describe.each(["docker", "remote"] as const)("%s eligibility with an unsupported ledger", (mode) => {
  let project: Awaited<ReturnType<typeof createLifecycleProject>>;
  let databasePath: string;
  let originalDatabase: Buffer;
  const rejected = new Map<string, Awaited<ReturnType<typeof runCli>>>();
  let refusedEvents: number;
  let refusedRecord: boolean;
  let refusedBytes: Buffer;
  let bypass: Awaited<ReturnType<typeof runCli>>;
  let previewCarry: Awaited<ReturnType<typeof runCli>>;
  let executeCarry: Awaited<ReturnType<typeof runCli>>;
  let carryEvents: number;
  let carryBytes: Buffer;

  beforeAll(async () => {
    project = await createLifecycleProject({
      attempts: 1,
      maxConcurrency: 1,
      failCreates: [],
      scripts: [{ cleanups: 0, beforeFails: false, test: "pass", step: "ok" }],
    });
    vi.stubEnv("NICEEVAL_HOME", project.cwd);
    vi.stubEnv("XDG_STATE_HOME", project.cwd);
    databasePath = join(project.cwd, "niceeval.sqlite");
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("CREATE TABLE old_format (value TEXT)");
    } finally {
      database.close();
    }
    originalDatabase = await readFile(databasePath);

    const unexpected = () => {
      throw new Error("An unavailable ledger cannot supply a cache artifact");
    };
    const capability = makeDockerBeforeCacheCapability({
      baseReference: "repo:tag",
      eligibility: () => ({
        _tag: "Eligible",
        persistence: "persistent",
        dependency: "parent-backed",
        coverage: "all",
        baseIdentity: "sha256:" + "a".repeat(64),
        keyScope: { cacheFormat: "fixture", semanticIdentity: {} },
      }),
      captureExactImage: unexpected,
      rebaseToExactImage: unexpected,
      destroyCurrentForCacheRecovery: unexpected,
      adoptBeforeCacheHold: unexpected,
      fallBackToBase: unexpected,
    });
    const remote = remoteSnapshotPreparer({
      preserves: { disks: ["/"], memory: true },
      sourceUsableAfterSnapshot: true,
      snapshotSettleMs: 32,
      resolveBase: () => Effect.die("Preflight must precede Provider resolution"),
      createFromSnapshot: () => Effect.die("The fixture has no remote snapshots"),
      createSnapshot: () => Effect.die("The fixture has no remote snapshots"),
      findSnapshot: () => Effect.die("The fixture has no remote snapshots"),
      deleteSnapshot: () => Effect.die("The fixture has no remote snapshots"),
    });
    Reflect.set(process, Symbol.for(project.cwd), (layer: SandboxLayer<"template-bearing">) =>
      mode === "docker"
        ? runtimeProviderFixture(layer, "unchanged", capability)
        : providerFixture(layer, mode, 1, "repo:tag", unexpected, remote),
    );
    await writeFile(
      join(project.cwd, "experiments/lifecycle.ts"),
      `
import { defineExperiment } from "niceeval";
import agent from "../agent.ts";
import base from "../sandbox.ts";
const sandbox = Reflect.get(process, Symbol.for(${JSON.stringify(project.cwd)}))(base);
export default defineExperiment({ adapter: agent, sandbox, evals: "*" });`,
    );
    const argv = ["exp", "lifecycle"];
    for (const mode of ["dry", "run"]) {
      for (const format of ["json", "human"]) {
        rejected.set(
          `${mode}:${format}`,
          await runCli(project.cwd, [
            ...argv,
            "--rerun",
            "all",
            ...(mode === "dry" ? ["--dry"] : []),
            ...(format === "json" ? ["--json"] : []),
          ]),
        );
      }
    }
    refusedEvents = project.events.length;
    refusedRecord = existsSync(join(project.cwd, ".niceeval", "record.sqlite"));
    refusedBytes = await readFile(databasePath);

    bypass = await runCli(project.cwd, [...argv, "--rerun", "all", "--sandbox-before-cache", "bypass", "--json"]);
    const eventsBeforeCarry = project.events.length;
    previewCarry = await runCli(project.cwd, [...argv, "--dry", "--json"]);
    executeCarry = await runCli(project.cwd, [...argv, "--json"]);
    carryEvents = project.events.length - eventsBeforeCarry;
    carryBytes = await readFile(databasePath);
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (project) {
      Reflect.deleteProperty(process, Symbol.for(project.cwd));
      await project.dispose();
    }
  });

  // @feature docs/feature/sandbox/data-model.md#user-database-preflight
  test("rejects an unsupported ledger before provider operations with one actionable diagnosis", () => {
    fc.assert(
      fc.property(fc.constantFrom("dry", "run"), fc.constantFrom("json", "human"), (mode, format) => {
        const result = rejected.get(`${mode}:${format}`)!;
        expect(result.code, JSON.stringify(result)).toBe(1);
        if (format === "json") {
          expect(result.stderr).toBe("");
          expect(JSON.parse(result.stdout)).toEqual({
            event: "warning",
            level: "error",
            code: "user-database-unsupported",
            message: expect.stringContaining(databasePath),
          });
        } else {
          expect(result.stdout).toBe("");
          expect(result.stderr.match(/user-database-unsupported/gu)).toHaveLength(1);
        }
        const output = result.stdout + result.stderr;
        expect(output).toContain(databasePath);
        expect(output).toContain("Stop its consumers, reconcile retained provider artifacts and holds");
        expect(refusedEvents).toBe(0);
        expect(refusedRecord).toBe(false);
        expect(refusedBytes).toEqual(originalDatabase);
      }),
      { seed: 261127, numRuns: 4, examples: [["dry", "json"], ["run", "json"], ["dry", "human"], ["run", "human"]] },
    );
  });

  // @feature docs/feature/sandbox/data-model.md#user-database-preflight
  test("leaves bypass and fully carried plans usable with the same unsupported ledger", () => {
    expect(bypass.code, JSON.stringify(bypass)).toBe(0);
    expect(previewCarry.code, JSON.stringify(previewCarry)).toBe(0);
    expect(decodeExpPlanDocument(JSON.parse(previewCarry.stdout)).reused).toBe(1);
    expect(executeCarry.code, JSON.stringify(executeCarry)).toBe(0);
    expect(decodeExpStartEvent(JSON.parse(executeCarry.stdout.split("\n")[0]!)).reused).toBe(1);
    expect(carryEvents).toBe(0);
    expect(carryBytes).toEqual(originalDatabase);
  });
});
