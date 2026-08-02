// cases: docs/engineering/testing/unit/sandbox.md

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MaterializedSandboxCase } from "./case-types.ts";
import {
  createBuiltinSandboxFactories,
  customCaseSandbox,
  customProviderSandbox,
  sandboxLayer,
  type SandboxLayer,
  type SandboxTargetPlatform,
} from "./layer.ts";
import { linkSandboxLayers } from "./link.ts";
import { planLinkedRuns, type LinkedRunPlan } from "./plan.ts";
import { collectSandboxRuntimeBuildPreparation, materializeSandboxRunPlan } from "./runtime.ts";
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
    buildLocators: new Map<string, string>(),
    provisionSlot: { _tag: "Detached" as const },
    services,
    release: { _tag: "Stop" as const },
  };
}

describe("provider-owned Sandbox runtime materialization", () => {
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
    const casePlan = planned(customCaseSandbox({
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
