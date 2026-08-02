// cases: docs/engineering/testing/unit/experiments-runner.md

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { defineEval, defineSandboxAgent } from "../define.ts";
import { shell } from "../sandbox/commands.ts";
import {
  createBuiltinSandboxFactories,
  defineSandboxTemplate,
  sandboxLayer,
  sandboxProviderPlan,
  type SandboxLayer,
  type SandboxProviderModule,
} from "../sandbox/layer.ts";
import { SandboxLayerLinkError } from "../sandbox/link.ts";
import { discoverEval, type AgentRun, type DiscoveredEval } from "./types.ts";
import { completeEvidenceCoverage } from "../scoring/coverage.ts";
import { STATELESS } from "../state/plan.ts";
import {
  linkRunSandboxes,
  prepareRunSandboxes,
  preparedPairsByKey,
  runPairKey,
  sandboxRunInfoForPlan,
  schedulingForPreparedPairs,
  SandboxRunPairDuplicateError,
} from "./sandbox-selection.ts";

const factories = createBuiltinSandboxFactories({
  dockerBuildPlatform: Effect.succeed("linux/amd64"),
  hostPlatform: { _tag: "Darwin", os: "darwin", arch: "arm64" },
});

function inertProviderModule(id: string): SandboxProviderModule<Readonly<Record<string, never>>> {
  return Object.freeze({
    id,
    capabilities: Object.freeze({
      retention: Object.freeze({ _tag: "DestroyOnly" as const }),
      reuse: Object.freeze({ _tag: "Unsupported" as const, reason: "selection test provider does not reset sandboxes" }),
      sessionLimit: Object.freeze({ _tag: "Unlimited" as const }),
    }),
    materialize: () => Effect.dieMessage("selection tests never materialize provider plans"),
    collectBuildPreparation: () => Effect.succeed(Option.none()),
  });
}

const sandboxAgent = defineSandboxAgent({
  name: "sandbox-agent",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: "sandbox-agent", version: "1", revision: "1" },
    probe: shell("true"),
  },
  async send() {
    return { events: [], status: "completed" };
  },
});

function evalDef(id: string, sandbox?: SandboxLayer, baseDir = `/repo/evals/${id}`): DiscoveredEval {
  const sourcePath = `${baseDir}/eval.ts`;
  const definition = defineEval({ ...(sandbox === undefined ? {} : { sandbox }), test() {} });
  return discoverEval(definition, {
    id,
    baseDir,
    sourcePath,
    loaderDataPaths: Object.freeze([]),
    criteriaPaths: Object.freeze([]),
    privatePaths: Object.freeze([]),
    source: { path: `evals/${id}/eval.ts`, content: "export default defineEval({ test() {} });\n", sha256: "source" },
  });
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    agent: sandboxAgent,
    flags: {},
    attempts: 1,
    earlyExit: true,
    state: STATELESS,
    selectedEvalIds: [],
    experimentId: "experiments/run",
    experimentBaseDir: "/repo/experiments",
    experimentSourcePath: "/repo/experiments/run.ts",
    ...overrides,
  };
}

describe("pair-owned Sandbox planning", () => {
  it("一次性产出 immutable LinkedRunPlan，不向 AgentRun 写 pair cache", async () => {
    const directory = await mkdtemp(join(tmpdir(), "niceeval-selection-plan-"));
    const imageDir = join(directory, "image");
    const composeDir = join(directory, "compose");
    await Promise.all([mkdir(imageDir), mkdir(composeDir)]);
    await writeFile(
      join(composeDir, "compose.yaml"),
      `services:\n  client:\n    image: node:24@sha256:${"c".repeat(64)}\n`,
      "utf8",
    );
    const image = evalDef("image", factories.dockerImageSandbox({ image: "node:24" }), imageDir);
    const compose = evalDef("compose", factories.dockerComposeSandbox({
      file: "compose.yaml",
      workspaceService: "client",
    }), composeDir);
    const selected = run({ sandbox: sandboxLayer(), selectedEvalIds: ["image", "compose"] });

    const prepared = await Effect.runPromise(prepareRunSandboxes([image, compose], [selected]));
    expect(prepared.map(({ plan }) => plan._tag === "Sandbox" && plan.providerPlan.provider)).toEqual([
      "docker",
      "docker",
    ]);
    expect(prepared[1]).toMatchObject({
      key: runPairKey("experiments/run", "compose"),
      plan: {
        _tag: "Sandbox",
        providerPlan: {
          provider: "docker",
        },
      },
    });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared[0])).toBe(true);
    expect("linkedSandboxes" in selected).toBe(false);
    expect("resolvedSandboxes" in selected).toBe(false);
    expect("configHash" in selected).toBe(false);
    const index = preparedPairsByKey(prepared);
    expect(index.get(runPairKey("experiments/run", "image"))).toBe(prepared[0]);
    expect("set" in index).toBe(false);
  });

  it("Experiment template 只影响自己的 pair，并按 experiment baseDir 解析", async () => {
    const plain = evalDef("plain", sandboxLayer());
    const selected = run({
      sandbox: factories.e2bSandbox({ template: "codex-v3" }),
      selectedEvalIds: ["plain"],
    });
    const [prepared] = await Effect.runPromise(prepareRunSandboxes([plain], [selected]));

    expect(prepared).toMatchObject({
      plan: {
        _tag: "Sandbox",
        pair: { templateOwner: { kind: "experiment", id: "experiments/run" } },
        providerPlan: { provider: "e2b" },
      },
    });
    if (prepared?.plan._tag !== "Sandbox") throw new Error("expected Sandbox plan");
    expect(sandboxRunInfoForPlan(prepared.plan)).toMatchObject({
      provider: "e2b",
      params: { plan: { provider: "e2b" } },
      fingerprint: expect.any(String),
    });
  });

  it("link 错误遍历整个矩阵后通过 Effect typed channel 返回", () => {
    const missing = evalDef("missing");
    const conflict = evalDef("conflict", factories.dockerImageSandbox({ image: "node:24" }));
    const selected = run({
      sandbox: factories.e2bSandbox({ template: "base" }),
      selectedEvalIds: ["missing", "conflict"],
    });
    const failure = Effect.runSync(Effect.flip(linkRunSandboxes([missing, conflict], [selected])));
    if (!(failure instanceof SandboxLayerLinkError)) throw new Error("expected SandboxLayerLinkError");
    expect(failure.issues.map((issue) => issue.code)).toEqual(["sandbox.template-conflict"]);
  });

  it("pair key 不靠分隔符猜边界，重复 pair 在 link 期走 typed failure", () => {
    expect(runPairKey("a|b", "c")).not.toBe(runPairKey("a", "b|c"));

    const duplicate = run({ selectedEvalIds: ["same"] });
    const failure = Effect.runSync(Effect.flip(linkRunSandboxes(
      [evalDef("same", factories.dockerImageSandbox({ image: "node:24" }))],
      [duplicate, duplicate],
    )));
    expect(failure).toBeInstanceOf(SandboxRunPairDuplicateError);
    if (!(failure instanceof SandboxRunPairDuplicateError)) throw new Error("expected duplicate pair error");
    expect(failure).toMatchObject({
      code: "sandbox.duplicate-run-pair",
      duplicates: [{
        key: runPairKey("experiments/run", "same"),
        experimentId: "experiments/run",
        evalId: "same",
        occurrences: 2,
      }],
    });
  });

  it("推荐并发与 exclusive 只读 planner metadata", async () => {
    const cloudEval = evalDef("cloud", sandboxLayer());
    const shared = defineSandboxTemplate({
      provider: "acme",
      kind: "pod",
      publishableIdentity: { provider: "acme", kind: "pod" },
      privateFingerprintIdentity: { provider: "acme", kind: "pod" },
      leakGate: { _tag: "None" },
      plan: () => Effect.succeed(sandboxProviderPlan({
        provider: "acme",
        plannerRevision: "1",
        caseKind: "custom",
        target: {
          platform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
          source: "provider-defined",
        },
        scheduling: {
          recommendedConcurrency: 8,
          lane: { key: "acme", limit: 8 },
          admission: { _tag: "Shared" },
        },
        module: inertProviderModule("acme/pod"),
        runtimePlan: {},
        publishableIdentity: {},
        privateFingerprintIdentity: {},
      })),
    });
    const exclusive = defineSandboxTemplate({
      provider: "worktree",
      kind: "local",
      publishableIdentity: { provider: "worktree", kind: "local" },
      privateFingerprintIdentity: { provider: "worktree", kind: "local" },
      leakGate: { _tag: "None" },
      plan: () => Effect.succeed(sandboxProviderPlan({
        provider: "worktree",
        plannerRevision: "1",
        caseKind: "custom",
        target: {
          platform: { _tag: "Darwin", os: "darwin", arch: "arm64" },
          source: "provider-defined",
        },
        scheduling: {
          recommendedConcurrency: 1,
          lane: { key: "user-worktree", limit: 1 },
          admission: { _tag: "Exclusive" },
        },
        module: inertProviderModule("worktree/local"),
        runtimePlan: {},
        publishableIdentity: {},
        privateFingerprintIdentity: {},
      })),
    });
    const pairs = await Effect.runPromise(prepareRunSandboxes([cloudEval], [
      run({ sandbox: shared, selectedEvalIds: ["cloud"] }),
      run({
        experimentId: "experiments/local",
        experimentSourcePath: "/repo/experiments/local.ts",
        sandbox: exclusive,
        selectedEvalIds: ["cloud"],
      }),
    ]));
    expect(schedulingForPreparedPairs(pairs)).toEqual({
      recommendedConcurrency: 1,
      exclusive: true,
      lanes: [
        { key: "acme", limit: 8, admission: "Shared" },
        { key: "user-worktree", limit: 1, admission: "Exclusive" },
      ],
    });
  });
});
