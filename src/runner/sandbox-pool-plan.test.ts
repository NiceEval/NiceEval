// cases: docs/engineering/testing/unit/sandbox.md

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
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
  }]));
  if (planned?.plan._tag !== "Sandbox") throw new Error("missing plan");
  return planned.plan;
}

describe("ReusableSandboxPool · pair-owned plan", () => {
  it("materializes once through the plan runtime and reuses the owned resource group", async () => {
    const commands: string[] = [];
    const deadlines: Array<number | undefined> = [];
    const groupStop = vi.fn(async () => {});
    const backend: SandboxProviderBackend = {
      workdir: "/workspace",
      sandboxId: "compose-main",
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
    const materializeCompose = vi.fn(async (legacy): Promise<MaterializedSandboxCase> => ({
      sandbox: normalizeSandboxPaths(backend, "docker"),
      group: {
        primary: { sandboxId: backend.sandboxId, provider: "docker" },
        resources: { projectName: "fixture" },
        stop: groupStop,
      },
      caseKind: "compose",
      caseKey: legacy.caseKey,
      buildKeys: [],
      identity: legacy.identity,
      carryEligible: true,
      facts: { projectName: "fixture" },
    }));
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
      const lease = yield* pool.acquire(60_000);
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
});
