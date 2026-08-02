// cases: docs/engineering/testing/unit/sandbox.md

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  noSandboxBackendCapabilities,
  supportedBackendCapability,
  type SandboxProviderBackend,
} from "../sandbox/backend.ts";
import type { MaterializedSandboxCase } from "../sandbox/case-types.ts";
import { createBuiltinSandboxFactories, sandboxLayer } from "../sandbox/layer.ts";
import { linkSandboxLayers } from "../sandbox/link.ts";
import { planLinkedRuns, type LinkedRunPlan } from "../sandbox/plan.ts";
import { ReusableSandboxPool } from "./sandbox-pool.ts";
import { normalizeSandboxPaths } from "../sandbox/paths.ts";

async function composePlan(): Promise<Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>> {
  const directory = await mkdtemp(join(tmpdir(), "niceeval-runtime-compose-"));
  await writeFile(
    join(directory, "compose.yaml"),
    `services:\n  client:\n    image: node:24@sha256:${"b".repeat(64)}\n`,
    "utf8",
  );
  const factories = createBuiltinSandboxFactories({
    dockerBuildPlatform: Effect.succeed("linux/amd64"),
    hostPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
  });
  const [pair] = Effect.runSync(linkSandboxLayers([{
    eval: {
      id: "task/example",
      layer: factories.dockerComposeSandbox({ file: "compose.yaml", workspaceService: "client", build: "prebuilt" }),
    },
    experiment: { id: "compare/codex", layer: sandboxLayer() },
    agent: { kind: "sandbox", name: "codex" },
  }]));
  if (pair === undefined) throw new Error("missing pair");
  const [planned] = await Effect.runPromise(planLinkedRuns([{
    pair,
    authorBaseDirs: { eval: directory, experiment: "/repo/experiments" },
    requirements: [],
  }]));
  if (planned?.plan._tag !== "Sandbox") throw new Error("missing plan");
  return planned.plan;
}

function runtimeFixture(opts: { readonly beforeMaterialize?: () => Promise<void> } = {}) {
  const commands: string[] = [];
  const deadlines: Array<number | undefined> = [];
  const groupStop = vi.fn(async () => {});
  let sequence = 0;
  const materializeCompose = vi.fn(async (legacy): Promise<MaterializedSandboxCase> => {
    await opts.beforeMaterialize?.();
    const sandboxId = `compose-${++sequence}`;
    const backend: SandboxProviderBackend = {
      workdir: "/workspace",
      sandboxId,
      otlpHost: "host.docker.internal",
      capabilities: {
        ...noSandboxBackendCapabilities,
        ensureLifetime: supportedBackendCapability(async () => ({ ready: true as const })),
        setCommandDeadline: supportedBackendCapability((deadlineAt?: number) => deadlines.push(deadlineAt)),
      },
      async runCommand() { return { stdout: "", stderr: "", exitCode: 0 }; },
      async runShell(script) { commands.push(script); return { stdout: "", stderr: "", exitCode: 0 }; },
      async readText() { return ""; },
      async writeText() {},
      async readBytes() { return new Uint8Array(); },
      async writeBytes() {},
      async pathExists() { return true; },
      async uploadFile() {},
      async uploadDirectory() {},
      async downloadFile() {},
      async downloadDirectory() {},
      async stop() {},
    };
    return {
      sandbox: normalizeSandboxPaths(backend, "docker"),
      group: {
        primary: { sandboxId, provider: "docker" },
        resources: { projectName: "fixture" },
        stop: groupStop,
      },
      caseKind: "compose",
      caseKey: legacy.caseKey,
      buildKeys: [],
      identity: legacy.identity,
      carryEligible: true,
      facts: { projectName: "fixture" },
    };
  });
  return { commands, deadlines, groupStop, materializeCompose };
}

describe("ReusableSandboxPool · pair-owned plan", () => {
  it("materializes once through the plan runtime and reuses the owned resource group", async () => {
    const { commands, deadlines, groupStop, materializeCompose } = runtimeFixture();
    const pool = new ReusableSandboxPool(
      await composePlan(),
      1,
      { progress: () => {}, diagnostic: () => {} },
      {
        experimentId: "compare/codex",
        signal: new AbortController().signal,
        progress: () => {},
        diagnostic: () => {},
        fact: () => {},
      },
      { _tag: "Stateless" },
      { _tag: "Test", materializeCompose },
    );

    const acquireAndReturn = () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const lease = yield* pool.acquire(60_000, new Map());
      yield* lease.commit({ _tag: "Reset" });
      return lease;
    })));
    const first = await acquireAndReturn();
    const second = await acquireAndReturn();
    await Effect.runPromise(pool.stop());

    expect(materializeCompose).toHaveBeenCalledTimes(1);
    expect(first.sandbox).toBe(second.sandbox);
    expect(second.reuseOrdinal).toBe(2);
    expect(deadlines).toHaveLength(2);
    expect(commands.some((command) => command.includes("git"))).toBe(true);
    expect(groupStop).toHaveBeenCalledTimes(1);
  });

  it("stop 等待活跃 lease 的 Scope 释放，之后只退休一次", async () => {
    const { groupStop, materializeCompose } = runtimeFixture();
    const pool = new ReusableSandboxPool(
      await composePlan(),
      1,
      { progress: () => {}, diagnostic: () => {} },
      { experimentId: "compare/codex", signal: new AbortController().signal, progress: () => {}, diagnostic: () => {}, fact: () => {} },
      { _tag: "Stateless" },
      { _tag: "Test", materializeCompose },
    );
    const attemptScope = Effect.runSync(Scope.make());
    await Effect.runPromise(Scope.extend(pool.acquire(60_000, new Map()), attemptScope));

    let stopSettled = false;
    const stopping = Effect.runPromise(pool.stop()).finally(() => { stopSettled = true; });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(stopSettled).toBe(false);
    expect(groupStop).not.toHaveBeenCalled();

    await Effect.runPromise(Scope.close(attemptScope, Exit.void));
    await stopping;
    expect(groupStop).toHaveBeenCalledTimes(1);
  });

  it("stop 覆盖物化竞态：创建完成后不借出，并恰好关闭一次", async () => {
    let allowMaterialize!: () => void;
    const materializationGate = new Promise<void>((resolve) => { allowMaterialize = resolve; });
    const { groupStop, materializeCompose } = runtimeFixture({ beforeMaterialize: () => materializationGate });
    const pool = new ReusableSandboxPool(
      await composePlan(),
      1,
      { progress: () => {}, diagnostic: () => {} },
      { experimentId: "compare/codex", signal: new AbortController().signal, progress: () => {}, diagnostic: () => {}, fact: () => {} },
      { _tag: "Stateless" },
      { _tag: "Test", materializeCompose },
    );
    const attemptScope = Effect.runSync(Scope.make());
    const acquiring = Effect.runPromise(Scope.extend(pool.acquire(60_000, new Map()), attemptScope));
    await vi.waitFor(() => expect(materializeCompose).toHaveBeenCalledTimes(1));

    let stopSettled = false;
    const stopping = Effect.runPromise(pool.stop()).finally(() => { stopSettled = true; });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(stopSettled).toBe(false);
    expect(groupStop).not.toHaveBeenCalled();

    allowMaterialize();
    await expect(acquiring).rejects.toThrow("sandbox reuse pool has been stopped");
    await stopping;
    await Effect.runPromise(Scope.close(attemptScope, Exit.void));
    expect(groupStop).toHaveBeenCalledTimes(1);
  });
});
