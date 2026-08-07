// cases: docs/engineering/testing/unit/sandbox.md

import { Effect, Option } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBuiltinSandboxFactories,
  customProviderSandbox,
  defineSandboxTemplate,
  sandboxProviderBindingOf,
  sandboxLayer,
  sandboxProviderPlan,
  SandboxProviderPlanningError,
  type SandboxLayer,
  type SandboxProviderBuildPlan,
  type SandboxProviderModule,
  type SandboxTargetPlatform,
} from "./layer.ts";
import { linkSandboxLayers, type LinkedSandboxLayerPair } from "./link.ts";
import { dockerfileBaseIdentity } from "./dockerfile-identity.ts";
import {
  formatSandboxPhysicalPlanningError,
  linkedRunFingerprintIdentity,
  linkedRunRecordIdentity,
  planLinkedRuns,
  SandboxPhysicalPlanningError,
  type LinkedRunPlan,
} from "./plan.ts";

if (false) {
  // @ts-expect-error Required 完成态必须至少含一个 BuildKey。
  const requiredWithoutBuild: SandboxProviderBuildPlan = { _tag: "Required", caseKey: "case", buildKeys: [] };
  // @ts-expect-error None 完成态不能携带 BuildKey。
  const noneWithBuild: SandboxProviderBuildPlan = { _tag: "None", caseKey: "case", buildKeys: ["build"] };
  void requiredWithoutBuild;
  void noneWithBuild;
}

const linux: SandboxTargetPlatform = {
  _tag: "Linux",
  os: "linux",
  arch: "x64",
  libc: "gnu",
};

const fixtureModule: SandboxProviderModule<{ readonly manifest: string }> = Object.freeze({
  id: "acme/pod",
  capabilities: Object.freeze({
    retention: Object.freeze({ _tag: "DestroyOnly" }),
    reuse: Object.freeze({ _tag: "Unsupported", reason: "fixture does not reset" }),
    sessionLimit: Object.freeze({ _tag: "Unlimited" }),
  }),
  materialize: () => Effect.dieMessage("fixture module must not materialize"),
  collectBuildPreparation: () => Effect.succeed(Option.none()),
});

const boundedModule: SandboxProviderModule<{ readonly manifest: string }> = Object.freeze({
  ...fixtureModule,
  id: "acme/bounded-pod",
  capabilities: Object.freeze({
    retention: Object.freeze({ _tag: "Suspendable" }),
    reuse: Object.freeze({ _tag: "Supported" }),
    sessionLimit: Object.freeze({ _tag: "Bounded", milliseconds: 60_000 }),
  }),
});

const factories = createBuiltinSandboxFactories({
  dockerBuildPlatform: Effect.succeed("linux/amd64"),
  hostPlatform: { _tag: "Darwin", os: "darwin", arch: "arm64" },
});
const tempRoots: string[] = [];
afterEach(async () => Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function builtInRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-plan-"));
  tempRoots.push(root);
  await writeFile(join(root, "Dockerfile"), `FROM node@sha256:${"a".repeat(64)}\n`);
  await writeFile(
    join(root, "compose.yaml"),
    `services:\n  client:\n    image: node@sha256:${"b".repeat(64)}\n`,
  );
  return root;
}

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
    requirements: [],
  }]));
  if (output === undefined) throw new Error("missing plan fixture");
  return output.plan;
}

describe("provider-neutral Sandbox planning", () => {
  it("未 pin FROM 仍把原始 ref 稳定投影进 BuildKey，并只保留 inert identity marker", () => {
    const identity = dockerfileBaseIdentity("FROM node:24\n");
    expect(identity.fromDigest).toBe('["unresolved:node:24"]');
    expect(identity).toMatchObject({
      providerIdentityMarker: {
        _tag: "Ineligible",
        code: "sandbox.base-image-unresolved",
      },
    });
    expect(identity).not.toHaveProperty("carryEligible");
  });

  it("rejects a dynamically forged Required build plan with no BuildKey", () => {
    const forgedPlan = () => sandboxProviderPlan({
      provider: "acme",
      plannerRevision: "1",
      caseKind: "custom",
      target: { platform: linux, source: "provider-defined" },
      scheduling: {
        recommendedConcurrency: 1,
        lane: { key: "acme", limit: 1 },
        admission: { _tag: "Shared" },
      },
      module: fixtureModule,
      build: { _tag: "Required", caseKey: "forged", buildKeys: [] } as never,
      runtimePlan: Object.freeze({ manifest: "sha256:abc" }),
      publishableIdentity: {},
      privateFingerprintIdentity: {},
    });
    expect(forgedPlan).toThrow(TypeError);
    expect(forgedPlan).toThrow(/build\.buildKeys must contain at least one BuildKey/);
  });

  it("physical plan keeps pinned/floating/custom provider declarations carryable", () => {
    const pinned = planned(linked(factories.dockerImageSandbox({
      image: `node@sha256:${"f".repeat(64)}`,
    })));
    const floating = planned(linked(factories.dockerImageSandbox({ image: "node:24" })));
    const custom = planned(linked(customProviderSandbox({
      name: "opaque-provider",
      targetPlatform: linux,
      create: () => Effect.dieMessage("fixture provider must not materialize"),
    })));
    for (const plan of [pinned, floating, custom]) {
      expect(plan._tag).toBe("Sandbox");
      if (plan._tag !== "Sandbox") throw new Error("expected sandbox plan");
      expect(plan.providerPlan).not.toHaveProperty("carry");
    }
    if (pinned._tag !== "Sandbox" || floating._tag !== "Sandbox" || custom._tag !== "Sandbox") {
      throw new Error("expected sandbox plans");
    }
    expect(pinned.providerPlan.identity).toMatchObject({ version: 3, carry: { _tag: "Eligible" } });
    expect(floating.providerPlan.identity).toMatchObject({
      version: 3,
      carry: { _tag: "Ineligible", code: "sandbox.image-unresolved" },
    });
    expect(custom.providerPlan.identity).toMatchObject({
      version: 3,
      carry: { _tag: "Ineligible", code: "sandbox.custom-provider-opaque" },
    });
  });

  it("built-in factory 归一完整 immutable plan，默认值不编码成 undefined", async () => {
    const root = await builtInRoot();
    const pairs = [
      linked(factories.dockerComposeSandbox({ file: "compose.yaml", workspaceService: "client" })),
      linked(factories.dockerfileSandbox({ context: "." })),
      linked(factories.dockerImageSandbox({ image: "node:24@sha256:abc" })),
      linked(undefined, factories.e2bSandbox({ template: "codex-v3" })),
      linked(undefined, factories.vercelSandbox({ snapshotId: "snap_123", lifetimeMs: 60_000 })),
      linked(factories.localSandbox({ dir: "workspace" })),
    ];
    const outputs = await Effect.runPromise(planLinkedRuns(pairs.map((pair) => ({
      pair,
      authorBaseDirs: { eval: root, experiment: root },
      requirements: [],
    }))));
    const plans = outputs.map(({ plan }) => {
      if (plan._tag !== "Sandbox") throw new Error("expected sandbox plan");
      return plan.providerPlan;
    });

    expect(plans.map((plan) => Option.getOrThrow(sandboxProviderBindingOf(plan)).moduleId)).toEqual([
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
      build: { _tag: "None", buildKeys: [], caseKey: expect.any(String) },
      scheduling: { recommendedConcurrency: 10, lane: { key: "docker", limit: 10 } },
    });
    expect(plans[0]?.identity).toMatchObject({
      build: plans[0]?.build,
    });
    expect(plans[1]).toMatchObject({
      build: { _tag: "Required", buildKeys: [expect.any(String)], caseKey: expect.any(String) },
    });
    expect(Option.getOrThrow(sandboxProviderBindingOf(plans[0]!))).toMatchObject({
      moduleId: "niceeval/docker-compose",
      capabilities: { retention: { _tag: "DestroyOnly" }, reuse: { _tag: "Supported" } },
    });
    expect(plans[5]).toMatchObject({
      provider: "local",
      target: { platform: { _tag: "Darwin", os: "darwin", arch: "arm64" } },
      scheduling: { admission: { _tag: "Exclusive" } },
    });
    expect(Option.getOrThrow(sandboxProviderBindingOf(plans[5]!))).toMatchObject({
      moduleId: "niceeval/local-directory",
      capabilities: { reuse: { _tag: "Unsupported" } },
    });
    expect(Object.isFrozen(outputs)).toBe(true);
    expect(plans.every(Object.isFrozen)).toBe(true);
    expect(JSON.stringify(plans.map(({ identity }) => identity))).not.toContain("undefined");
  });

  it("Docker tmpfs/只读 rootfs 选择 DestroyOnly provider，并推进资源覆盖 revision", async () => {
    const root = await builtInRoot();
    const outputs = await Effect.runPromise(planLinkedRuns([
      {
        pair: linked(factories.dockerfileSandbox({
          context: ".",
          resources: {
            readOnlyRootfs: true,
            tmpfs: { "/workspace": { sizeBytes: 1024 } },
          },
        })),
        authorBaseDirs: { eval: root, experiment: root },
        requirements: [],
      },
      {
        pair: linked(factories.dockerImageSandbox({
          image: `node@sha256:${"f".repeat(64)}`,
          resources: { tmpfs: { "/tmp": { sizeBytes: 1024 } } },
        })),
        authorBaseDirs: { eval: root, experiment: root },
        requirements: [],
      },
    ]));
    const plans = outputs.map(({ plan }) => {
      if (plan._tag !== "Sandbox") throw new Error("expected sandbox plan");
      return plan.providerPlan;
    });

    expect(plans.map((plan) => plan.plannerRevision)).toEqual(["dockerfile-3", "docker-image-2"]);
    expect(plans.map((plan) => Option.getOrThrow(sandboxProviderBindingOf(plan)).moduleId)).toEqual([
      "niceeval/dockerfile-ephemeral",
      "niceeval/docker-image-ephemeral",
    ]);
    expect(plans.map((plan) => plan.capabilities.retention._tag)).toEqual(["DestroyOnly", "DestroyOnly"]);
  });

  it("link 与 Direct planning 均不调用 provider planner", () => {
    let calls = 0;
    const template = defineSandboxTemplate({
      provider: "acme",
      kind: "pod",
      publishableIdentity: { manifestKind: "digest" },
      privateFingerprintIdentity: { manifest: "sha256:abc" },
      leakGate: { _tag: "None" },
      plan: () => {
        calls += 1;
        return Effect.succeed(sandboxProviderPlan({
          provider: "acme",
          plannerRevision: "1",
          caseKind: "custom",
          target: { platform: linux, source: "provider-defined" },
          scheduling: {
            recommendedConcurrency: 4,
            lane: { key: "acme-account", limit: 4 },
            admission: { _tag: "Shared" },
          },
          module: fixtureModule,
          build: { _tag: "None", caseKey: "test-case", buildKeys: [] },
          runtimePlan: Object.freeze({ manifest: "sha256:abc" }),
          publishableIdentity: { manifestKind: "digest" },
          privateFingerprintIdentity: { manifest: "sha256:abc" },
        }));
      },
    });

    const sandboxPair = linked(template);
    expect(calls).toBe(0);
    const directPair = linked(undefined, undefined, "direct");
    Effect.runSync(planLinkedRuns([{
      pair: directPair,
      authorBaseDirs: { eval: "/repo/evals/task", experiment: "/repo/experiments" },
      requirements: [],
    }]));
    expect(calls).toBe(0);

    const plan = planned(sandboxPair);
    expect(calls).toBe(1);
    expect(plan).toMatchObject({
      _tag: "Sandbox",
      providerPlan: {
        provider: "acme",
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
      publishableIdentity: {},
      privateFingerprintIdentity: { provider: name, kind: "fixture" },
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
      { pair: first, authorBaseDirs: { eval: "/repo/a", experiment: "/repo/exp" }, requirements: [] },
      { pair: second, authorBaseDirs: { eval: "/repo/b", experiment: "/repo/exp" }, requirements: [] },
    ])));

    expect(failure).toBeInstanceOf(SandboxPhysicalPlanningError);
    expect(failure.issues.map(({ providerCode }) => providerCode)).toEqual([
      "acme-a.locator-missing",
      "acme-b.locator-missing",
    ]);
    expect(plannedCount).toBe(2);
    expect(createCount).toBe(0);
    expect(formatSandboxPhysicalPlanningError(failure)).toContain("acme-a.locator-missing");
    expect(formatSandboxPhysicalPlanningError(failure)).toContain("experiment/codex × eval/task (codex)");
    expect(formatSandboxPhysicalPlanningError(failure)).toContain("No provider build or Sandbox creation was started");
  });

  it("任一已声明 capability 不可用时与 ready pair 一起走整个 Run 的零资源聚合失败", () => {
    let plannedCount = 0;
    const template = defineSandboxTemplate({
      provider: "acme",
      kind: "pod",
      publishableIdentity: {},
      privateFingerprintIdentity: {},
      leakGate: { _tag: "None" },
      plan: () => {
        plannedCount += 1;
        return Effect.succeed(sandboxProviderPlan({
          provider: "acme",
          plannerRevision: "1",
          caseKind: "custom",
          target: { platform: linux, source: "provider-defined" },
          scheduling: {
            recommendedConcurrency: 1,
            lane: { key: "acme", limit: 1 },
            admission: { _tag: "Shared" },
          },
          module: fixtureModule,
          build: { _tag: "None", caseKey: "case", buildKeys: [] },
          runtimePlan: Object.freeze({ manifest: "sha256:abc" }),
          publishableIdentity: {},
          privateFingerprintIdentity: {},
        }));
      },
    });
    const first = linked(template);
    const second = linked(undefined, template);
    const failure = Effect.runSync(Effect.flip(planLinkedRuns([
      {
        pair: first,
        authorBaseDirs: { eval: "/repo/a", experiment: "/repo/exp" },
        requirements: [{ _tag: "Reuse" }, { _tag: "Retention" }],
      },
      {
        pair: second,
        authorBaseDirs: { eval: "/repo/b", experiment: "/repo/exp" },
        requirements: [],
      },
    ])));

    expect(plannedCount).toBe(2);
    expect(failure.issues.map(({ code, providerCode }) => ({ code, providerCode }))).toEqual([
      { code: "sandbox.capability-unavailable", providerCode: "sandbox.reuse-unavailable" },
      { code: "sandbox.capability-unavailable", providerCode: "sandbox.retention-unavailable" },
    ]);
    expect(failure.message).toContain("No provider build or Sandbox creation was started");
  });

  it("已解析 Attempt timeout 超过 provider session limit 时在资源创建前拒绝", () => {
    const template = defineSandboxTemplate({
      provider: "acme",
      kind: "bounded-pod",
      publishableIdentity: {},
      privateFingerprintIdentity: {},
      leakGate: { _tag: "None" },
      plan: () => Effect.succeed(sandboxProviderPlan({
        provider: "acme",
        plannerRevision: "1",
        caseKind: "custom",
        target: { platform: linux, source: "provider-defined" },
        scheduling: {
          recommendedConcurrency: 1,
          lane: { key: "acme", limit: 1 },
          admission: { _tag: "Shared" },
        },
        module: boundedModule,
        build: { _tag: "None", caseKey: "case", buildKeys: [] },
        runtimePlan: Object.freeze({ manifest: "sha256:abc" }),
        publishableIdentity: {},
        privateFingerprintIdentity: {},
      })),
    });
    const failure = Effect.runSync(Effect.flip(planLinkedRuns([{
      pair: linked(template),
      authorBaseDirs: { eval: "/repo/a", experiment: "/repo/exp" },
      requirements: [{ _tag: "SessionDuration", milliseconds: 120_000 }],
    }])));

    expect(failure.issues).toMatchObject([{
      code: "sandbox.capability-unavailable",
      providerCode: "sandbox.session-limit-exceeded",
    }]);
  });

  it("record 与 fingerprint projection 只含可发布 JSON，不含 callback/runtime locator", () => {
    const opaque = async (): Promise<void> => {};
    const pair = linked(
      factories.dockerImageSandbox({ image: "node:24" }),
      sandboxLayer().prepare(opaque),
    );
    const plan = planned(pair);
    const identity = linkedRunRecordIdentity(plan);
    expect(identity).toMatchObject({
      mode: "sandbox",
      template: { provider: "docker", kind: "image", publishable: { source: "configured-image" } },
      commands: [{ kind: "opaque", owner: { kind: "experiment" }, index: 0 }],
      providerPlan: {
        provider: "docker",
        publishable: { source: "configured-image" },
      },
    });
    expect(linkedRunFingerprintIdentity(plan)).toEqual(identity);
    expect(JSON.stringify(identity)).not.toContain("node:24");
    expect(JSON.stringify(identity)).not.toContain("opaque =");
  });

  it("credential env value 不进 identity，revision/语义 env/私有路径进入 opaque digest", async () => {
    const makeRoot = async (): Promise<string> => {
      const root = await mkdtemp(join(tmpdir(), "niceeval-secure-plan-"));
      tempRoots.push(root);
      await mkdir(join(root, "private"));
      await writeFile(
        join(root, "private", "compose.yaml"),
        `services:\n  client:\n    image: node@sha256:${"c".repeat(64)}\n`,
      );
      return root;
    };
    const firstRoot = await makeRoot();
    const secondRoot = await makeRoot();
    const makePlan = async (
      secret: string,
      revision: string,
      semantic: string,
      authorBaseDir: string,
    ): Promise<LinkedRunPlan> => {
      const pair = linked(factories.dockerComposeSandbox({
        file: "private/compose.yaml",
        workspaceService: "client",
        env: { DATASET: semantic },
        credentialEnv: { ACCESS_TOKEN: { value: secret, revision } },
      }));
      const [output] = await Effect.runPromise(planLinkedRuns([{
        pair,
        authorBaseDirs: { eval: authorBaseDir, experiment: "/repo/experiments" },
        requirements: [],
      }]));
      if (output === undefined) throw new Error("missing secure plan fixture");
      return output.plan;
    };

    const first = await makePlan("secret-red", "tenant-a", "dataset-a", firstRoot);
    const changedSecret = await makePlan("secret-blue", "tenant-a", "dataset-a", firstRoot);
    const changedRevision = await makePlan("secret-red", "tenant-b", "dataset-a", firstRoot);
    const changedSemantic = await makePlan("secret-red", "tenant-a", "dataset-b", firstRoot);
    const changedPath = await makePlan("secret-red", "tenant-a", "dataset-a", secondRoot);
    if (first._tag !== "Sandbox") throw new Error("expected sandbox plan");

    const recordJson = JSON.stringify(linkedRunRecordIdentity(first));
    const wholePlanJson = JSON.stringify(first.providerPlan);
    for (const forbidden of ["secret-red", firstRoot, "private/compose.yaml"]) {
      expect(recordJson).not.toContain(forbidden);
      expect(wholePlanJson).not.toContain(forbidden);
    }
    expect(linkedRunFingerprintIdentity(changedSecret)).toEqual(linkedRunFingerprintIdentity(first));
    expect(linkedRunFingerprintIdentity(changedRevision)).not.toEqual(linkedRunFingerprintIdentity(first));
    expect(linkedRunFingerprintIdentity(changedSemantic)).not.toEqual(linkedRunFingerprintIdentity(first));
    expect(linkedRunFingerprintIdentity(changedPath)).not.toEqual(linkedRunFingerprintIdentity(first));
    expect(Option.getOrThrow(sandboxProviderBindingOf(first.providerPlan)).moduleId).toBe("niceeval/docker-compose");
    expect(linkedRunRecordIdentity(first)).toEqual(linkedRunFingerprintIdentity(first));
  });
});
