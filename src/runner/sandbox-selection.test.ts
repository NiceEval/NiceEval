// cases: docs/engineering/testing/unit/experiments-runner.md

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { defineEval, defineSandboxAgent } from "../define.ts";
import { shell } from "../sandbox/commands.ts";
import {
  createBuiltinSandboxFactories,
  defineSandboxTemplate,
  sandboxLayer,
  sandboxProviderPlan,
  type SandboxLayer,
} from "../sandbox/layer.ts";
import { SandboxLayerLinkError } from "../sandbox/link.ts";
import { discoverEval, type AgentRun, type DiscoveredEval } from "./types.ts";
import { completeEvidenceCoverage } from "../scoring/coverage.ts";
import { STATELESS } from "../state/plan.ts";
import {
  linkRunSandboxes,
  prepareRunSandboxes,
  preparedPairsByKey,
  sandboxRunInfoForPlan,
  schedulingForPreparedPairs,
} from "./sandbox-selection.ts";

const factories = createBuiltinSandboxFactories({
  dockerBuildPlatform: Effect.succeed("linux/amd64"),
  hostPlatform: { _tag: "Darwin", os: "darwin", arch: "arm64" },
});

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

function evalDef(id: string, sandbox?: SandboxLayer): DiscoveredEval {
  const sourcePath = `/repo/evals/${id}/eval.ts`;
  const definition = defineEval({ ...(sandbox === undefined ? {} : { sandbox }), test() {} });
  return discoverEval(definition, {
    id,
    baseDir: `/repo/evals/${id}`,
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
    const image = evalDef("image", factories.dockerImageSandbox({ image: "node:24" }));
    const compose = evalDef("compose", factories.dockerComposeSandbox({
      file: "compose.yaml",
      workspaceService: "client",
    }));
    const selected = run({ sandbox: sandboxLayer(), selectedEvalIds: ["image", "compose"] });

    const prepared = await Effect.runPromise(prepareRunSandboxes([image, compose], [selected]));
    expect(prepared.map(({ plan }) => plan._tag === "Sandbox" && plan.providerPlan.runtimeAdapter)).toEqual([
      "niceeval/docker-image",
      "niceeval/docker-compose",
    ]);
    expect(prepared[1]).toMatchObject({
      key: "experiments/run|compose",
      plan: {
        _tag: "Sandbox",
        providerPlan: {
          runtimeAdapter: "niceeval/docker-compose",
        },
      },
    });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared[0])).toBe(true);
    expect("linkedSandboxes" in selected).toBe(false);
    expect("resolvedSandboxes" in selected).toBe(false);
    expect("configHash" in selected).toBe(false);
    expect(preparedPairsByKey(prepared).get("experiments/run|image")).toBe(prepared[0]);
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
        providerPlan: { provider: "e2b", runtimeAdapter: "niceeval/e2b-template" },
      },
    });
    if (prepared?.plan._tag !== "Sandbox") throw new Error("expected Sandbox plan");
    expect(sandboxRunInfoForPlan(prepared.plan)).toMatchObject({
      provider: "e2b",
      params: { plan: { provider: "e2b", runtimeAdapter: "niceeval/e2b-template" } },
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
        caseKind: "pod",
        target: {
          platform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
          source: "provider-defined",
        },
        scheduling: {
          recommendedConcurrency: 8,
          lane: { key: "acme", limit: 8 },
          admission: { _tag: "Shared" },
        },
        runtime: { adapter: "acme/pod", input: {} },
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
        caseKind: "local",
        target: {
          platform: { _tag: "Darwin", os: "darwin", arch: "arm64" },
          source: "provider-defined",
        },
        scheduling: {
          recommendedConcurrency: 1,
          lane: { key: "user-worktree", limit: 1 },
          admission: { _tag: "Exclusive" },
        },
        runtime: { adapter: "worktree/local", input: {} },
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
