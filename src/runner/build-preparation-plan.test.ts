// cases: docs/engineering/testing/unit/sandbox.md

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { defineEval, defineSandboxAgent } from "../define.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { defineSandboxCommand } from "../sandbox/commands.ts";
import { createBuiltinSandboxFactories, type SandboxLayer } from "../sandbox/layer.ts";
import { STATELESS } from "../state/plan.ts";
import { collectBuildPreparation, toBuildPreparation } from "./build-preparation.ts";
import { prepareRunSandboxes, type PreparedRunPair } from "./sandbox-selection.ts";
import { discoverEval, type AgentRun } from "./types.ts";

async function prepared(layer: SandboxLayer, baseDir: string): Promise<PreparedRunPair> {
  const evalId = "task/dockerfile";
  const sourcePath = join(baseDir, "eval.ts");
  const evalDef = discoverEval(defineEval({ sandbox: layer, test() {} }), {
    id: evalId,
    baseDir,
    sourcePath,
    loaderDataPaths: Object.freeze([]),
    criteriaPaths: Object.freeze([]),
    privatePaths: Object.freeze([]),
    source: { path: "eval.ts", content: "", sha256: "0".repeat(64) },
  });
  const run: AgentRun = {
    agent: defineSandboxAgent({
      name: "codex",
      evidenceCoverage: completeEvidenceCoverage,
      ensure: {
        identity: { agent: "codex", version: "test", revision: "1" },
        probe: defineSandboxCommand(
          { id: "test.codex.probe", revision: "1", inputs: {} },
          async () => {},
        ),
      },
      installers: [],
      send: async () => ({ events: [], status: "completed" }),
    }),
    flags: {},
    attempts: 1,
    earlyExit: false,
    selectedEvalIds: [evalId],
    experimentId: "compare/codex",
    experimentBaseDir: baseDir,
    experimentSourcePath: sourcePath,
    state: STATELESS,
  };
  const [pair] = await Effect.runPromise(prepareRunSandboxes([evalDef], [run]));
  if (pair === undefined) throw new Error("missing prepared pair");
  return pair;
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
    await writeFile(join(directory, "eval.ts"), "export default null;\n", "utf8");
    const pair = await prepared(factories.dockerfileSandbox({ context: "." }), directory);
    if (pair.plan._tag !== "Sandbox") throw new Error("expected Sandbox plan");
    expect(pair.plan.providerPlan.build).toMatchObject({
      _tag: "Required",
      buildKeys: [expect.any(String)],
      caseKey: expect.any(String),
    });

    const collection = await Effect.runPromise(collectBuildPreparation({
      preparedPairs: [pair],
      carriedAttemptsByKey: new Map(),
    }));
    const collected = Option.getOrThrow(collection);
    expect(collected.works).toHaveLength(1);
    expect(collected.works[0]).toMatchObject({ provider: "docker" });
    expect(collected.pairBuildKeys[pair.key]).toEqual([collected.works[0]?.buildKey]);
    expect(pair.plan.providerPlan.build.buildKeys).toEqual([collected.works[0]?.buildKey]);
    expect("caseKeys" in collected).toBe(false);
    expect(Option.isSome(toBuildPreparation(collected))).toBe(true);
  });

  it("plans a case key for a no-build provider without creating build preparation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "niceeval-runtime-build-none-"));
    await writeFile(join(directory, "eval.ts"), "export default null;\n", "utf8");
    const factories = createBuiltinSandboxFactories({
      dockerBuildPlatform: Effect.succeed("linux/amd64"),
      hostPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
    });
    const pair = await prepared(
      factories.dockerImageSandbox({ image: `node@sha256:${"b".repeat(64)}` }),
      directory,
    );
    if (pair.plan._tag !== "Sandbox") throw new Error("expected Sandbox plan");
    expect(pair.plan.providerPlan.build).toMatchObject({
      _tag: "None",
      buildKeys: [],
      caseKey: expect.any(String),
    });

    const noBuild = await Effect.runPromise(collectBuildPreparation({
      preparedPairs: [pair],
      carriedAttemptsByKey: new Map(),
    }));
    expect(Option.isNone(noBuild)).toBe(true);

    const fullyCarried = await Effect.runPromise(collectBuildPreparation({
      preparedPairs: [pair],
      carriedAttemptsByKey: new Map([[pair.key, new Set([0])]]),
    }));
    expect(Option.isNone(fullyCarried)).toBe(true);
  });
});
