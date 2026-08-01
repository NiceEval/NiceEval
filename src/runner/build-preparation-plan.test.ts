// cases: docs/engineering/testing/unit/sandbox.md

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createBuiltinSandboxFactories, sandboxLayer, type SandboxLayer } from "../sandbox/layer.ts";
import { linkSandboxLayers } from "../sandbox/link.ts";
import { planLinkedRuns, type LinkedRunPlan } from "../sandbox/plan.ts";
import { collectBuildPreparation } from "./build-preparation.ts";
import type { PreparedRunPair } from "./sandbox-selection.ts";

async function planned(layer: SandboxLayer, baseDir: string): Promise<Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>> {
  const [pair] = Effect.runSync(linkSandboxLayers([{
    eval: { id: "task/dockerfile", layer },
    experiment: { id: "compare/codex", layer: sandboxLayer() },
    agent: { kind: "sandbox", name: "codex" },
  }]));
  if (pair === undefined) throw new Error("missing pair");
  const [result] = await Effect.runPromise(planLinkedRuns([{
    pair,
    authorBaseDirs: { eval: baseDir, experiment: "/repo/experiments" },
  }]));
  if (result?.plan._tag !== "Sandbox") throw new Error("missing plan");
  return result.plan;
}

describe("Run build preparation · PreparedRunPair", () => {
  it("collects Dockerfile BuildKey without re-reading author selectors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "niceeval-runtime-build-"));
    await writeFile(
      join(directory, "Dockerfile"),
      `FROM node:24@sha256:${"a".repeat(64)}\nWORKDIR /workspace\n`,
      "utf8",
    );
    const factories = createBuiltinSandboxFactories({
      dockerBuildPlatform: Effect.succeed("linux/amd64"),
      hostPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
    });
    const plan = await planned(factories.dockerfileSandbox({ context: "." }), directory);
    const prepared = {
      key: "compare/codex|task/dockerfile",
      plan,
      run: { attempts: 1 },
      evalDef: { id: "task/dockerfile" },
      identity: {},
    } as PreparedRunPair;

    const collected = await collectBuildPreparation({
      preparedPairs: [prepared],
      carriedAttemptsByKey: new Map(),
    });
    expect(collected?.works).toHaveLength(1);
    expect(collected?.works[0]).toMatchObject({ provider: "docker" });
    expect(collected?.evalBuildKeys[prepared.key]).toEqual([collected?.works[0]?.buildKey]);
    expect(collected?.caseKeys.has(prepared.key)).toBe(true);
  });
});
