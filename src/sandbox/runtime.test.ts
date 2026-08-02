// cases: docs/engineering/testing/unit/sandbox.md

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MaterializedSandboxCase } from "./case-types.ts";
import {
  createBuiltinSandboxFactories,
  defineSandboxCase,
  customProviderSandbox,
  sandboxLayer,
  type SandboxLayer,
  type SandboxTargetPlatform,
} from "./layer.ts";
import { linkSandboxLayers } from "./link.ts";
import { planLinkedRuns, type LinkedRunPlan } from "./plan.ts";
import {
  collectSandboxRuntimeBuildPreparation,
  e2bLifetimeRequest,
  materializeSandboxRunPlan,
} from "./runtime.ts";
import type { Sandbox } from "./types.ts";

const linux: SandboxTargetPlatform = { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" };

function fakeSandbox(id: string): Sandbox {
  const ok = async () => ({ stdout: "", stderr: "", exitCode: 0 });
  return {
    workdir: "/workspace",
    sandboxId: id,
    otlpHost: null,
    runCommand: ok,
    runShell: ok,
    runCommandOrThrow: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    runShellOrThrow: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    readText: async () => "",
    writeText: async () => {},
    readBytes: async () => new Uint8Array(),
    writeBytes: async () => {},
    pathExists: async () => true,
    uploadFile: async () => {},
    uploadDirectory: async () => {},
    downloadFile: async () => {},
    downloadDirectory: async () => {},
    stop: async () => {},
  };
}

function planned(layer: SandboxLayer): Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }> {
  const [pair] = Effect.runSync(linkSandboxLayers([{
    eval: { id: "task/example", layer },
    experiment: { id: "compare/codex", layer: sandboxLayer() },
    agent: { kind: "sandbox", name: "codex" },
  }]));
  if (pair === undefined) throw new Error("missing linked pair");
  const [output] = Effect.runSync(planLinkedRuns([{
    pair,
    authorBaseDirs: { eval: "/repo/evals/task/example", experiment: "/repo/experiments" },
    requirements: [],
  }]));
  if (output?.plan._tag !== "Sandbox") throw new Error("missing sandbox plan");
  return output.plan;
}

function input(plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>, services: Parameters<typeof materializeSandboxRunPlan>[0]["services"]) {
  return {
    plan,
    evalId: "task/example",
    deadline: { _tag: "Unlimited" as const },
    feedback: { progress: () => {}, diagnostic: () => {} },
    signal: new AbortController().signal,
    hookContext: { experimentId: "compare/runtime", signal: new AbortController().signal, progress: () => {}, diagnostic: () => {}, fact: () => {} },
    buildLocators: new Map<string, string>(),
    provisionSlot: { _tag: "Detached" as const },
    services,
    release: { _tag: "Stop" as const },
  };
}

describe("provider-owned Sandbox runtime materialization", () => {
  // cases: docs/engineering/testing/unit/sandbox.md「Sandbox 复用」
  // bug: memory/e2b-deadline-lifetime-default.md
  it("E2B 将 bounded attempt 的 deadline 加收尾预留写成创建请求，而不是 SDK 默认 TTL", () => {
    expect(e2bLifetimeRequest(
      { _tag: "ProviderDefault" },
      { _tag: "Bounded", timeoutMs: 6 * 60_000, deadlineAt: Date.now() + 6 * 60_000 },
    )).toEqual({
      _tag: "Requested",
      milliseconds: 6 * 60_000 + 30_000,
      source: "attempt-deadline",
    });
  });

  // cases: docs/engineering/testing/unit/sandbox.md「Sandbox 复用」
  // bug: memory/e2b-deadline-lifetime-default.md
  it("E2B 在创建前拒绝短于 attempt 加收尾预留的显式 lifetimeMs", () => {
    expect(() => e2bLifetimeRequest(
      { _tag: "Configured", milliseconds: 6 * 60_000 },
      { _tag: "Bounded", timeoutMs: 6 * 60_000, deadlineAt: Date.now() + 6 * 60_000 },
    )).toThrow(/shorter than this attempt's required 390000ms/);
  });

  it("物理实例只在创建/释放边界执行 lifecycle，setup 正序且 teardown 逆序", async () => {
    const events: string[] = [];
    const plan = planned(
      customProviderSandbox({
        name: "lifecycle",
        targetPlatform: linux,
        create: () => Effect.succeed(fakeSandbox("lifecycle")),
      })
        .setup(() => { events.push("setup:a"); })
        .setup(() => { events.push("setup:b"); })
        .teardown(() => { events.push("teardown:a"); })
        .teardown(() => { events.push("teardown:b"); }),
    );
    await Effect.runPromise(Effect.scoped(materializeSandboxRunPlan(input(plan, { _tag: "Live" }))));
    expect(events).toEqual(["setup:a", "setup:b", "teardown:b", "teardown:a"]);
  });

  it("setup 失败仍执行完整 teardown 并停止 provider 实例", async () => {
    const events: string[] = [];
    const stop = vi.fn(async () => { events.push("stop"); });
    const diagnostics: string[] = [];
    const plan = planned(
      customProviderSandbox({
        name: "lifecycle-setup-failure",
        targetPlatform: linux,
        create: () => Effect.succeed({ ...fakeSandbox("lifecycle-setup-failure"), stop }),
      })
        .setup(() => { events.push("setup"); throw new Error("setup failed"); })
        .teardown(() => { events.push("teardown:a"); })
        .teardown(() => { events.push("teardown:b"); }),
    );
    const result = await Effect.runPromise(Effect.either(Effect.scoped(materializeSandboxRunPlan({
      ...input(plan, { _tag: "Live" }),
      hookContext: {
        ...input(plan, { _tag: "Live" }).hookContext,
        diagnostic: (entry) => diagnostics.push(entry.code),
      },
    }))));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.code).toBe("sandbox.materialization-failed");
    expect(events).toEqual(["setup", "teardown:b", "teardown:a", "stop"]);
    expect(diagnostics).toEqual([]);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("custom provider 创建成功后 facade 归一化失败仍停止尚未纳入 Scope 的实例", async () => {
    const stop = vi.fn(async () => {});
    const sandbox = { ...fakeSandbox("facade-failure"), stop };
    Object.defineProperty(sandbox, "appendLog", {
      get() {
        throw new Error("broken provider facade");
      },
    });
    const plan = planned(customProviderSandbox({
      name: "facade-failure",
      targetPlatform: linux,
      create: () => Effect.succeed(sandbox),
    }));

    const result = await Effect.runPromise(Effect.either(Effect.scoped(
      materializeSandboxRunPlan(input(plan, { _tag: "Live" })),
    )));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.code).toBe("sandbox.materialization-failed");
      expect(result.left.message).toBe("broken provider facade");
    }
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("teardown hook 的失败只记诊断，继续后续 hook 并停止 provider", async () => {
    const events: string[] = [];
    const stop = vi.fn(async () => { events.push("stop"); });
    const diagnostics: string[] = [];
    const plan = planned(
      customProviderSandbox({
        name: "lifecycle-teardown-failure",
        targetPlatform: linux,
        create: () => Effect.succeed({ ...fakeSandbox("lifecycle-teardown-failure"), stop }),
      })
        .teardown(() => { events.push("teardown:a"); })
        .teardown(() => { events.push("teardown:b"); throw new Error("teardown failed"); }),
    );
    await Effect.runPromise(Effect.scoped(materializeSandboxRunPlan({
      ...input(plan, { _tag: "Live" }),
      hookContext: {
        ...input(plan, { _tag: "Live" }).hookContext,
        diagnostic: (entry) => diagnostics.push(entry.code),
      },
    })));

    expect(events).toEqual(["teardown:b", "teardown:a", "stop"]);
    expect(diagnostics).toEqual(["sandbox-teardown-failed"]);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("在声明点拒绝非函数 lifecycle hook", () => {
    expect(() => sandboxLayer().setup(null as never)).toThrow("sandbox setup hook must be a function");
    expect(() => sandboxLayer().teardown(null as never)).toThrow("sandbox teardown hook must be a function");
  });

  it("rejects a serialized plan without its private ProviderModule binding", async () => {
    const providerCreate = vi.fn(() => Effect.succeed(fakeSandbox("must-not-create")));
    const original = planned(customProviderSandbox({
      name: "acme",
      targetPlatform: linux,
      create: providerCreate,
    }));
    const detached: typeof original = Object.freeze({
      ...original,
      providerPlan: structuredClone(original.providerPlan),
    });

    const result = await Effect.runPromise(Effect.either(Effect.scoped(
      materializeSandboxRunPlan(input(detached, { _tag: "Live" })),
    )));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.code).toBe("sandbox.provider-binding-missing");
    expect(providerCreate).not.toHaveBeenCalled();
  });

  it("rejects runtime locator keys that were not fixed by physical planning", async () => {
    const providerCreate = vi.fn(() => Effect.succeed(fakeSandbox("must-not-create")));
    const plan = planned(customProviderSandbox({
      name: "acme",
      targetPlatform: linux,
      create: providerCreate,
    }));
    expect(plan.providerPlan.build).toMatchObject({
      _tag: "None",
      buildKeys: [],
      caseKey: expect.any(String),
    });

    const result = await Effect.runPromise(Effect.either(Effect.scoped(
      materializeSandboxRunPlan({
        ...input(plan, { _tag: "Live" }),
        buildLocators: new Map([["late-build-key", "late-locator"]]),
      }),
    )));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.code).toBe("sandbox.build-input-drift");
    expect(providerCreate).not.toHaveBeenCalled();
  });

  it("keeps JsonValue locators to the provider boundary and rejects a non-string Dockerfile locator", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-runtime-locator-"));
    await writeFile(join(root, "Dockerfile"), `FROM node@sha256:${"e".repeat(64)}\n`);
    try {
      const factories = createBuiltinSandboxFactories({
        dockerBuildPlatform: Effect.succeed("linux/amd64"),
        hostPlatform: linux,
      });
      const [pair] = Effect.runSync(linkSandboxLayers([{
        eval: { id: "task/example", layer: factories.dockerfileSandbox({ context: "." }) },
        experiment: { id: "compare/codex", layer: sandboxLayer() },
        agent: { kind: "sandbox", name: "codex" },
      }]));
      if (pair === undefined) throw new Error("missing linked pair");
      const [output] = await Effect.runPromise(planLinkedRuns([{
        pair,
        authorBaseDirs: { eval: root, experiment: root },
        requirements: [],
      }]));
      if (output?.plan._tag !== "Sandbox") throw new Error("missing sandbox plan");
      const buildKey = output.plan.providerPlan.build.buildKeys[0];
      if (buildKey === undefined) throw new Error("missing BuildKey");

      const result = await Effect.runPromise(Effect.either(Effect.scoped(materializeSandboxRunPlan({
        ...input(output.plan, { _tag: "Live" }),
        buildLocators: new Map([[buildKey, { templateId: "provider-native-object" }]]),
      }))));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.code).toBe("sandbox.materialization-failed");
        expect(String(result.left.cause)).toContain("must be a string");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects Dockerfile inputs that change after physical planning", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-runtime-build-"));
    await writeFile(join(root, "Dockerfile"), `FROM node@sha256:${"e".repeat(64)}\nCOPY payload /payload\n`);
    await writeFile(join(root, "payload"), "planned\n");
    try {
      const factories = createBuiltinSandboxFactories({
        dockerBuildPlatform: Effect.succeed("linux/amd64"),
        hostPlatform: linux,
      });
      const [pair] = Effect.runSync(linkSandboxLayers([{
        eval: { id: "task/example", layer: factories.dockerfileSandbox({ context: "." }) },
        experiment: { id: "compare/codex", layer: sandboxLayer() },
        agent: { kind: "sandbox", name: "codex" },
      }]));
      if (pair === undefined) throw new Error("missing linked pair");
      const [output] = await Effect.runPromise(planLinkedRuns([{
        pair,
        authorBaseDirs: { eval: root, experiment: root },
        requirements: [],
      }]));
      if (output?.plan._tag !== "Sandbox") throw new Error("missing sandbox plan");

      await writeFile(join(root, "payload"), "changed\n");
      const result = await Effect.runPromise(Effect.either(
        collectSandboxRuntimeBuildPreparation(output.plan, "task/example"),
      ));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(String(result.left.cause)).toContain("changed after physical planning");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("verifies no-build Compose inputs without recomputing the planned CaseKey", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-runtime-compose-plan-"));
    const composePath = join(root, "compose.yaml");
    await writeFile(composePath, `services:\n  client:\n    image: node@sha256:${"d".repeat(64)}\n`);
    try {
      const factories = createBuiltinSandboxFactories({
        dockerBuildPlatform: Effect.succeed("linux/amd64"),
        hostPlatform: linux,
      });
      const [pair] = Effect.runSync(linkSandboxLayers([{
        eval: {
          id: "task/example",
          layer: factories.dockerComposeSandbox({
            file: "compose.yaml",
            workspaceService: "client",
            build: "prebuilt",
          }),
        },
        experiment: { id: "compare/codex", layer: sandboxLayer() },
        agent: { kind: "sandbox", name: "codex" },
      }]));
      if (pair === undefined) throw new Error("missing linked pair");
      const [output] = await Effect.runPromise(planLinkedRuns([{
        pair,
        authorBaseDirs: { eval: root, experiment: root },
        requirements: [],
      }]));
      if (output?.plan._tag !== "Sandbox") throw new Error("missing sandbox plan");
      const plannedCaseKey = output.plan.providerPlan.build.caseKey;
      expect(output.plan.providerPlan.build._tag).toBe("None");

      await writeFile(composePath, `services:\n  client:\n    image: node@sha256:${"c".repeat(64)}\n`);
      const result = await Effect.runPromise(Effect.either(
        collectSandboxRuntimeBuildPreparation(output.plan, "task/example"),
      ));

      expect(output.plan.providerPlan.build.caseKey).toBe(plannedCaseKey);
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") expect(result.left.code).toBe("sandbox.build-input-drift");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("custom provider/case callbacks stay bound to the selected template", async () => {
    const providerCreate = vi.fn(() => Effect.succeed(fakeSandbox("custom-provider")));
    const providerPlan = planned(customProviderSandbox({
      name: "acme",
      targetPlatform: linux,
      create: providerCreate,
    }));
    const provider = await Effect.runPromise(Effect.scoped(
      materializeSandboxRunPlan(input(providerPlan, { _tag: "Live" })),
    ));
    expect(providerCreate).toHaveBeenCalledTimes(1);
    expect(provider.sandbox.sandboxId).toBe("custom-provider");

    const groupStop = vi.fn(async () => {});
    const caseMaterialize = vi.fn(() => Effect.succeed({
      sandbox: fakeSandbox("custom-case"),
      group: {
        primary: { sandboxId: "custom-case", provider: "acme-case" },
        resources: { namespace: "fixture" },
        stop: groupStop,
      },
      services: { _tag: "None" as const },
      facts: { namespace: "fixture" },
    }));
    const casePlan = planned(defineSandboxCase({
      identity: { revision: "v1" },
      targetPlatform: linux,
      services: { _tag: "Unsupported" },
      materialize: caseMaterialize,
    }));
    const customCase = await Effect.runPromise(Effect.scoped(
      materializeSandboxRunPlan(input(casePlan, { _tag: "Live" })),
    ));
    expect(caseMaterialize).toHaveBeenCalledWith(expect.objectContaining({ evalId: "task/example" }));
    expect(customCase.caseKind).toBe("custom");
    expect(groupStop).toHaveBeenCalledTimes(1);
  });

  it("custom case rejects half-states and unknown capabilities before accepting completion", async () => {
    expect(() => defineSandboxCase({
      identity: { revision: () => "opaque" } as never,
      targetPlatform: linux,
      services: { _tag: "Unsupported" },
      materialize: (() => Effect.dieMessage("must not run")) as never,
    })).toThrow(/pure JSON data/);
    expect(() => defineSandboxCase({
      identity: { revision: "v1" },
      targetPlatform: linux,
      services: { _tag: "Maybe" } as never,
      materialize: (() => Effect.dieMessage("must not run")) as never,
    })).toThrow(/Supported.*Unsupported/);

    const groupStop = vi.fn(async () => {});
    const plan = planned(defineSandboxCase({
      identity: { revision: "v1" },
      targetPlatform: linux,
      services: { _tag: "Unsupported" },
      materialize: (() => Effect.succeed({
        sandbox: fakeSandbox("invalid-custom-case"),
        group: {
          primary: { sandboxId: "invalid-custom-case" },
          resources: { namespace: "fixture" },
          stop: groupStop,
        },
        services: { _tag: "None" },
        facts: {},
        retention: { entry: "not-supported" },
      })) as never,
    }));
    const result = await Effect.runPromise(Effect.either(
      Effect.scoped(materializeSandboxRunPlan(input(plan, { _tag: "Live" }))),
    ));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.message).toMatch(/unsupported field.*retention/);
    expect(groupStop).toHaveBeenCalledTimes(1);
  });

  it("Scope runs exactly one selected release disposition", async () => {
    const sandboxStop = vi.fn(async () => {});
    const managedRelease = vi.fn(() => Effect.void);
    const providerPlan = planned(customProviderSandbox({
      name: "acme",
      targetPlatform: linux,
      create: () => Effect.succeed({ ...fakeSandbox("managed"), stop: sandboxStop }),
    }));

    await Effect.runPromise(Effect.scoped(materializeSandboxRunPlan({
      ...input(providerPlan, { _tag: "Live" }),
      release: { _tag: "Managed", run: managedRelease },
    })));

    expect(managedRelease).toHaveBeenCalledTimes(1);
    expect(sandboxStop).not.toHaveBeenCalled();
  });

  it("Compose adapter decodes the completed runtime input before invoking its provider materializer", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-runtime-compose-"));
    await writeFile(
      join(root, "compose.yaml"),
      `services:\n  client:\n    image: node@sha256:${"d".repeat(64)}\n`,
    );
    try {
    const factories = createBuiltinSandboxFactories({
      dockerBuildPlatform: Effect.succeed("linux/amd64"),
      hostPlatform: linux,
    });
    const [pair] = Effect.runSync(linkSandboxLayers([{
      eval: {
        id: "task/example",
        layer: factories.dockerComposeSandbox({
      file: "compose.yaml",
      workspaceService: "client",
      build: "prebuilt",
        }),
      },
      experiment: { id: "compare/codex", layer: sandboxLayer() },
      agent: { kind: "sandbox", name: "codex" },
    }]));
    if (pair === undefined) throw new Error("missing linked pair");
    const [output] = await Effect.runPromise(planLinkedRuns([{
      pair,
      authorBaseDirs: { eval: root, experiment: root },
      requirements: [],
    }]));
    if (output?.plan._tag !== "Sandbox") throw new Error("missing sandbox plan");
    const plan = output.plan;
    const stop = vi.fn(async () => {});
    const materializeCompose = vi.fn(async (providerPlan): Promise<MaterializedSandboxCase> => ({
      sandbox: fakeSandbox("compose-main"),
      group: {
        primary: { sandboxId: "compose-main", provider: "docker" },
        resources: { projectName: "fixture" },
        stop,
      },
      caseKind: "compose",
      caseKey: providerPlan.caseKey,
      buildKeys: providerPlan.collection.buildKeys,
      identity: providerPlan.identity,
      carryEligible: providerPlan.carryEligible,
      facts: { projectName: "fixture" },
    }));

    const materialized = await Effect.runPromise(Effect.scoped(materializeSandboxRunPlan(input(plan, {
      _tag: "Test",
      materializeCompose,
    }))));
    expect(materializeCompose).toHaveBeenCalledWith(
      expect.objectContaining({
        evalId: "task/example",
        mainService: "client",
        collection: expect.objectContaining({ composePath: join(root, "compose.yaml") }),
      }),
      expect.objectContaining({ ctx: expect.objectContaining({ evalId: "task/example" }) }),
    );
    expect(materialized.sandbox.sandboxId).toBe("compose-main");
    expect(stop).toHaveBeenCalledTimes(1);

    const driftStop = vi.fn(async () => {});
    const drifted = await Effect.runPromise(Effect.either(Effect.scoped(materializeSandboxRunPlan(input(plan, {
      _tag: "Test",
      materializeCompose: async (providerPlan) => ({
        sandbox: fakeSandbox("compose-drift"),
        group: {
          primary: { sandboxId: "compose-drift", provider: "docker" },
          resources: { projectName: "fixture-drift" },
          stop: driftStop,
        },
        caseKind: "compose",
        caseKey: "runtime-recomputed-case",
        buildKeys: providerPlan.collection.buildKeys,
        identity: providerPlan.identity,
        carryEligible: providerPlan.carryEligible,
        facts: { projectName: "fixture-drift" },
      }),
    })))));
    expect(drifted._tag).toBe("Left");
    if (drifted._tag === "Left") expect(drifted.left.code).toBe("sandbox.build-input-drift");
    expect(driftStop).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
