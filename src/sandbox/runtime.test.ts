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
  };
}

describe("provider-owned Sandbox runtime materialization", () => {
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
    const providerCreate = vi.fn(async () => fakeSandbox("custom-provider"));
    const providerPlan = planned(customProviderSandbox({
      name: "acme",
      targetPlatform: linux,
      create: providerCreate,
    }));
    const provider = await Effect.runPromise(materializeSandboxRunPlan(input(providerPlan, { _tag: "Live" })));
    expect(providerCreate).toHaveBeenCalledTimes(1);
    expect(provider.sandbox.sandboxId).toBe("custom-provider");
    await provider.group.stop();

    const groupStop = vi.fn(async () => {});
    const caseMaterialize = vi.fn(async () => ({
      sandbox: fakeSandbox("custom-case"),
      group: {
        primary: { sandboxId: "custom-case", provider: "acme-case" },
        resources: { namespace: "fixture" },
        stop: groupStop,
      },
      facts: { namespace: "fixture" },
    }));
    const casePlan = planned(customCaseSandbox({
      identity: { revision: "v1" },
      targetPlatform: linux,
      materialize: caseMaterialize,
    }));
    const customCase = await Effect.runPromise(materializeSandboxRunPlan(input(casePlan, { _tag: "Live" })));
    expect(caseMaterialize).toHaveBeenCalledWith(expect.objectContaining({ evalId: "task/example" }));
    expect(customCase.caseKind).toBe("custom");
    await customCase.group.stop();
    expect(groupStop).toHaveBeenCalledTimes(1);
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
    const materializeCompose = vi.fn(async (legacyPlan): Promise<MaterializedSandboxCase> => ({
      sandbox: fakeSandbox("compose-main"),
      group: {
        primary: { sandboxId: "compose-main", provider: "docker" },
        resources: { projectName: "fixture" },
        stop,
      },
      caseKind: "compose",
      caseKey: legacyPlan.caseKey,
      buildKeys: legacyPlan.buildKeys,
      identity: legacyPlan.identity,
      carryEligible: legacyPlan.carryEligible,
      facts: { projectName: "fixture" },
    }));

    const materialized = await Effect.runPromise(materializeSandboxRunPlan(input(plan, {
      _tag: "Test",
      materializeCompose,
    })));
    expect(materializeCompose).toHaveBeenCalledWith(
      expect.objectContaining({
        evalId: "task/example",
        caseKind: "compose",
        declaration: expect.objectContaining({
          form: "source",
          value: expect.objectContaining({
            file: join(root, "compose.yaml"),
            mainService: "client",
          }),
        }),
      }),
      expect.objectContaining({ ctx: expect.objectContaining({ evalId: "task/example" }) }),
    );
    expect(materialized.sandbox.sandboxId).toBe("compose-main");
    await materialized.group.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
