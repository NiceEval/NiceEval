// cases: docs/engineering/testing/unit/sandbox.md

import { Effect, Option } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBuiltinSandboxFactories,
  defineSandboxTemplate,
  sandboxLayer,
  sandboxProviderPlan,
  sandboxProviderRuntimeOf,
  SandboxProviderPlanningError,
  type SandboxLayer,
  type SandboxTargetPlatform,
} from "./layer.ts";
import { linkSandboxLayers, type LinkedSandboxLayerPair } from "./link.ts";
import {
  linkedRunFingerprintIdentity,
  linkedRunCarryEligible,
  linkedRunRecordIdentity,
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
  }]));
  if (output === undefined) throw new Error("missing plan fixture");
  return output.plan;
}

describe("provider-neutral Sandbox planning", () => {
  it("physical plan downgrades floating Docker images from carry eligibility", () => {
    const pinned = planned(linked(factories.dockerImageSandbox({
      image: `node@sha256:${"f".repeat(64)}`,
    })));
    const floating = planned(linked(factories.dockerImageSandbox({ image: "node:24" })));
    expect(linkedRunCarryEligible(pinned)).toBe(true);
    expect(linkedRunCarryEligible(floating)).toBe(false);
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
    }))));
    const plans = outputs.map(({ plan }) => {
      if (plan._tag !== "Sandbox") throw new Error("expected sandbox plan");
      return plan.providerPlan;
    });

    expect(plans.map(({ runtimeAdapter }) => runtimeAdapter)).toEqual([
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
      runtimeAdapter: "niceeval/docker-compose",
      scheduling: { recommendedConcurrency: 10, lane: { key: "docker", limit: 10 } },
    });
    expect(Option.getOrThrow(sandboxProviderRuntimeOf(plans[0]!)).input).toMatchObject({
      file: { _tag: "Path", value: join(root, "compose.yaml") },
      workspaceService: "client",
      build: "on-demand",
      executionUser: { _tag: "ImageDefault" },
      env: {},
    });
    expect(plans[5]).toMatchObject({
      provider: "local",
      runtimeAdapter: "niceeval/local-directory",
      target: { platform: { _tag: "Darwin", os: "darwin", arch: "arm64" } },
      scheduling: { admission: { _tag: "Exclusive" } },
    });
    expect(Option.getOrThrow(sandboxProviderRuntimeOf(plans[5]!)).input).toEqual({
      directory: join(root, "workspace"),
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
      publishableIdentity: { manifestKind: "digest" },
      privateFingerprintIdentity: { manifest: "sha256:abc" },
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
    }]));
    expect(calls).toBe(0);

    const plan = planned(sandboxPair);
    expect(calls).toBe(1);
    expect(plan).toMatchObject({
      _tag: "Sandbox",
      providerPlan: {
        provider: "acme",
        runtimeAdapter: "acme/pod",
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
        runtimeAdapter: "niceeval/docker-image",
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
    expect(Option.getOrThrow(sandboxProviderRuntimeOf(first.providerPlan)).input).toMatchObject({
      env: { ACCESS_TOKEN: "secret-red", DATASET: "dataset-a" },
    });
    expect(linkedRunRecordIdentity(first)).toEqual(linkedRunFingerprintIdentity(first));
  });
});
