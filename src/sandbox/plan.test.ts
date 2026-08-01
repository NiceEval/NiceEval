// cases: docs/engineering/testing/unit/sandbox.md

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createBuiltinSandboxFactories,
  defineSandboxTemplate,
  sandboxLayer,
  sandboxProviderPlan,
  SandboxProviderPlanningError,
  type SandboxLayer,
  type SandboxTargetPlatform,
} from "./layer.ts";
import { linkSandboxLayers, type LinkedSandboxLayerPair } from "./link.ts";
import {
  linkedRunPlanIdentity,
  planLinkedRuns,
  SandboxPhysicalPlanningError,
  type LinkedRunPlan,
} from "./plan.ts";

const linux: SandboxTargetPlatform = {
  _tag: "Linux",
  os: "linux",
  arch: "x64",
  libc: "gnu",
};

const factories = createBuiltinSandboxFactories({
  dockerBuildPlatform: Effect.succeed("linux/amd64"),
  hostPlatform: { _tag: "Darwin", os: "darwin", arch: "arm64" },
});

function linked(
  evalLayer: SandboxLayer | undefined,
  experimentLayer?: SandboxLayer,
  agentKind: "sandbox" | "direct" = "sandbox",
): LinkedSandboxLayerPair {
  const effectiveExperimentLayer = agentKind === "direct" ? experimentLayer : experimentLayer ?? sandboxLayer();
  const [pair] = Effect.runSync(linkSandboxLayers([{
    eval: { id: "eval/task", ...(evalLayer === undefined ? {} : { layer: evalLayer }) },
    experiment: {
      id: "experiment/codex",
      ...(effectiveExperimentLayer === undefined ? {} : { layer: effectiveExperimentLayer }),
    },
    agent: { kind: agentKind, name: "codex" },
  }]));
  if (pair === undefined) throw new Error("missing linked pair fixture");
  return pair;
}

function planned(pair: LinkedSandboxLayerPair): LinkedRunPlan {
  const [output] = Effect.runSync(planLinkedRuns([{
    pair,
    authorBaseDirs: { eval: "/repo/evals/task", experiment: "/repo/experiments" },
  }]));
  if (output === undefined) throw new Error("missing plan fixture");
  return output.plan;
}

describe("provider-neutral Sandbox planning", () => {
  it("built-in factory 归一完整 immutable plan，默认值不编码成 undefined", () => {
    const pairs = [
      linked(factories.dockerComposeSandbox({ file: "compose.yaml", workspaceService: "client" })),
      linked(factories.dockerfileSandbox({ context: "." })),
      linked(factories.dockerImageSandbox({ image: "node:24@sha256:abc" })),
      linked(undefined, factories.e2bSandbox({ template: "codex-v3" })),
      linked(undefined, factories.vercelSandbox({ snapshotId: "snap_123", lifetimeMs: 60_000 })),
      linked(factories.localSandbox({ dir: "workspace" })),
    ];
    const outputs = Effect.runSync(planLinkedRuns(pairs.map((pair) => ({
      pair,
      authorBaseDirs: { eval: "/repo/evals/task", experiment: "/repo/experiments" },
    }))));
    const plans = outputs.map(({ plan }) => {
      if (plan._tag !== "Sandbox") throw new Error("expected sandbox plan");
      return plan.providerPlan;
    });

    expect(plans.map(({ runtime }) => runtime.adapter)).toEqual([
      "niceeval/docker-compose",
      "niceeval/dockerfile",
      "niceeval/docker-image",
      "niceeval/e2b-template",
      "niceeval/vercel-snapshot",
      "niceeval/local-directory",
    ]);
    expect(plans[0]).toMatchObject({
      provider: "docker",
      caseKind: "compose",
      runtime: {
        input: {
          file: { _tag: "Path", value: "/repo/evals/task/compose.yaml" },
          workspaceService: "client",
          build: "on-demand",
          executionUser: { _tag: "ImageDefault" },
          env: {},
        },
      },
      scheduling: { recommendedConcurrency: 10, lane: { key: "docker", limit: 10 } },
    });
    expect(plans[5]).toMatchObject({
      provider: "local",
      runtime: { input: { directory: "/repo/evals/task/workspace" } },
      target: { platform: { _tag: "Darwin", os: "darwin", arch: "arm64" } },
      scheduling: { admission: { _tag: "Exclusive" } },
    });
    expect(Object.isFrozen(outputs)).toBe(true);
    expect(plans.every(Object.isFrozen)).toBe(true);
    expect(JSON.stringify(plans.map(({ identity }) => identity))).not.toContain("undefined");
  });

  it("link 与 Direct planning 均不调用 provider planner", () => {
    let calls = 0;
    const template = defineSandboxTemplate({
      provider: "acme",
      kind: "pod",
      identity: { provider: "acme", kind: "pod", manifest: "sha256:abc" },
      leakGate: { _tag: "None" },
      plan: () => {
        calls += 1;
        return Effect.succeed(sandboxProviderPlan({
          provider: "acme",
          plannerRevision: "1",
          caseKind: "pod",
          target: { platform: linux, source: "provider-defined" },
          scheduling: {
            recommendedConcurrency: 4,
            lane: { key: "acme-account", limit: 4 },
            admission: { _tag: "Shared" },
          },
          runtime: { adapter: "acme/pod", input: { manifest: "sha256:abc" } },
          leakGate: { _tag: "None" },
          physicalIdentity: { manifest: "sha256:abc" },
        }));
      },
    });

    const sandboxPair = linked(template);
    expect(calls).toBe(0);
    const directPair = linked(undefined, undefined, "direct");
    Effect.runSync(planLinkedRuns([{
      pair: directPair,
      authorBaseDirs: { eval: "/repo/evals/task", experiment: "/repo/experiments" },
    }]));
    expect(calls).toBe(0);

    const plan = planned(sandboxPair);
    expect(calls).toBe(1);
    expect(plan).toMatchObject({
      _tag: "Sandbox",
      providerPlan: {
        provider: "acme",
        runtime: { adapter: "acme/pod" },
        scheduling: { lane: { key: "acme-account", limit: 4 } },
      },
    });
  });

  it("新增 provider 不改 core，planner typed failures 遍历整批后聚合且零 runtime create", () => {
    let plannedCount = 0;
    let createCount = 0;
    const failing = (name: string) => defineSandboxTemplate({
      provider: name,
      kind: "fixture",
      identity: { provider: name, kind: "fixture" },
      leakGate: { _tag: "None" },
      plan: () => {
        plannedCount += 1;
        return Effect.fail(new SandboxProviderPlanningError({
          code: `${name}.locator-missing`,
          provider: name,
          summary: `${name} locator is unavailable`,
          actions: Object.freeze([`configure ${name}`]),
        }));
      },
    });
    const first = linked(failing("acme-a"));
    const second = linked(undefined, failing("acme-b"));
    const failure = Effect.runSync(Effect.flip(planLinkedRuns([
      { pair: first, authorBaseDirs: { eval: "/repo/a", experiment: "/repo/exp" } },
      { pair: second, authorBaseDirs: { eval: "/repo/b", experiment: "/repo/exp" } },
    ])));

    expect(failure).toBeInstanceOf(SandboxPhysicalPlanningError);
    expect(failure.issues.map(({ providerCode }) => providerCode)).toEqual([
      "acme-a.locator-missing",
      "acme-b.locator-missing",
    ]);
    expect(plannedCount).toBe(2);
    expect(createCount).toBe(0);
  });

  it("plan identity 只含 pair/template/physical JSON，不含 callback", () => {
    const opaque = async (): Promise<void> => {};
    const pair = linked(
      factories.dockerImageSandbox({ image: "node:24" }),
      sandboxLayer().prepare(opaque),
    );
    const identity = linkedRunPlanIdentity(planned(pair));
    expect(identity).toMatchObject({
      mode: "sandbox",
      template: { provider: "docker", kind: "image", image: "node:24" },
      commands: [{ kind: "opaque", owner: { kind: "experiment" }, index: 0 }],
      providerPlan: {
        provider: "docker",
        runtime: { adapter: "niceeval/docker-image", input: { image: "node:24" } },
      },
    });
    expect(JSON.stringify(identity)).not.toContain("opaque =");
  });
});
