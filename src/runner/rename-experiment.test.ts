// cases: docs/engineering/testing/unit/experiments-runner.md
// Experiment 改名把 passed/failed 终态锚定到新身份，并留下旧 fingerprint、locator 与证据审计。

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { defineDirectAgent, defineEval, defineExperiment } from "../define.ts";
import { createWriter } from "../record/writer.ts";
import { openRecord } from "../record/open.ts";
import { discoverEval, discoverExperiment } from "./types.ts";
import { fingerprintWithManifest } from "./fingerprint.ts";
import { prepareRunSandboxes } from "./sandbox-selection.ts";
import { configIdentityForRun } from "./config-identity.ts";
import { hashConfigIdentity } from "./fingerprint.ts";
import { resolveRunTimeout } from "./timeout.ts";
import { experimentRunInfo } from "./attempt.ts";
import { planExperimentRename, renameExperiment } from "./rename-experiment.ts";
import type { AgentRun, Config, DiscoveredEval, DiscoveredExperiment, EvalResult } from "./types.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function config(): Config {
  return {};
}

function makeDefinitions(): { evals: readonly DiscoveredEval[]; experiments: readonly DiscoveredExperiment[] } {
  const evalDefinition = defineEval({
    description: "rename fixture",
    test: async () => undefined,
  });
  const evalDef = discoverEval(evalDefinition, {
    id: "kept",
    baseDir: "/project/evals",
    sourcePath: "/project/evals/kept.eval.ts",
    loaderDataPaths: [],
    criteriaPaths: [],
    privatePaths: [],
    source: { path: "evals/kept.eval.ts", content: "fixture", sha256: "0".repeat(64) },
  });
  const excludedDefinition = defineEval({ test: async () => undefined });
  const excluded = discoverEval(excludedDefinition, {
    id: "excluded",
    baseDir: "/project/evals",
    sourcePath: "/project/evals/excluded.eval.ts",
    loaderDataPaths: [],
    criteriaPaths: [],
    privatePaths: [],
    source: { path: "evals/excluded.eval.ts", content: "fixture", sha256: "1".repeat(64) },
  });
  const agent = defineDirectAgent({
    name: "rename-agent",
    evidenceCoverage: completeEvidenceCoverage,
    send: async () => ({ events: [], status: "completed" }),
  });
  const oldDefinition = defineExperiment({ agent, evals: "*" });
  const newDefinition = defineExperiment({ agent, evals: ["kept"] });
  return {
    evals: [evalDef, excluded],
    experiments: [
      discoverExperiment(oldDefinition, { id: "old", baseDir: "/project/experiments", sourcePath: "/project/experiments/old.ts" }),
      discoverExperiment(newDefinition, { id: "new", baseDir: "/project/experiments", sourcePath: "/project/experiments/new.ts" }),
    ],
  };
}

function targetRun(experiment: DiscoveredExperiment, selectedEvalIds: readonly string[]): AgentRun {
  return {
    agent: experiment.agent,
    flags: experiment.flags,
    attempts: experiment.attempts,
    earlyExit: experiment.earlyExit,
    sandboxReuse: experiment.sandboxReuse,
    experimentId: experiment.id,
    experimentBaseDir: experiment.baseDir,
    experimentSourcePath: experiment.sourcePath,
    selectedEvalIds,
    strict: false,
  };
}

async function targetFingerprint(evals: readonly DiscoveredEval[], experiment: DiscoveredExperiment, experimentId = experiment.id): Promise<{ fingerprint: string; configHash: string; experiment: EvalResult["experiment"] }> {
  const selected = [evals[0]!];
  const run = { ...targetRun(experiment, [selected[0]!.id]), experimentId };
  const pair = await Effect.runPromise(prepareRunSandboxes(selected, [run], undefined, {}));
  const first = pair[0]!;
  const identity = configIdentityForRun(run, first.plan);
  const result = await fingerprintWithManifest(first, undefined, { _tag: "Current", identity });
  const info = experimentRunInfo(run, first.plan, { [first.evalDef.id]: {} });
  return { fingerprint: result.fingerprint, configHash: hashConfigIdentity(identity), experiment: info };
}

async function writeSource(root: string, result: EvalResult): Promise<void> {
  const writer = createWriter(root, { producer: { name: "niceeval", version: "test" }, snapshotStartedAt: "2026-08-06T00:00:00.000Z" });
  const snapshot = await writer.run({
    experimentId: "old",
    agent: result.agent,
    startedAt: "2026-08-06T00:00:00.000Z",
    knownEvalIds: ["kept", "excluded"],
  });
  await writer.writeAttemptFor(result);
  await snapshot.finish({ completedAt: "2026-08-06T00:01:00.000Z" });
}

async function readTree(root: string): Promise<readonly [string, string][]> {
  const paths = (await readdir(root, { recursive: true, encoding: "utf8" })).sort();
  const files: [string, string][] = [];
  for (const path of paths) {
    try {
      files.push([path, await readFile(join(root, path), "utf8")]);
    } catch {
      // 目录本身由 paths 记录；这里只读取文件字节。
    }
  }
  return files;
}

function sourceResult(over: Partial<EvalResult> = {}): EvalResult {
  return {
    id: "kept",
    experimentId: "old",
    agent: "rename-agent",
    verdict: "passed",
    attempt: 0,
    durationMs: 10,
    executionMs: 10,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
    ...over,
  };
}

describe("实验改名规划与写盘", () => {
  it("同 fingerprint 的 passed/failed 终态只写一个新 snapshot，并保留 excluded、artifactBase、renamedFrom 与新 locator", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-rename-"));
    roots.push(root);
    const definitions = makeDefinitions();
    const target = definitions.experiments[1]!;
    const current = await targetFingerprint(definitions.evals, target);
    const source = await targetFingerprint(definitions.evals, target, "old");
    await writeSource(root, sourceResult({ fingerprint: source.fingerprint }));
    const excludedWriter = createWriter(root, { producer: { name: "niceeval", version: "test" } });
    const excludedSnapshot = await excludedWriter.run({ experimentId: "old", agent: "rename-agent", startedAt: "2026-08-06T00:02:00.000Z" });
    await excludedWriter.writeAttemptFor(sourceResult({ id: "excluded", fingerprint: current.fingerprint, verdict: "failed" }));
    await excludedSnapshot.finish({ completedAt: "2026-08-06T00:03:00.000Z" });

    const plan = await planExperimentRename({
      cwd: root,
      oldId: "old",
      newId: "new",
      recordRoot: root,
      config: config(),
      evals: definitions.evals,
      experiments: definitions.experiments,
      now: () => "2026-08-06T01:00:00.000Z",
    });
    expect(plan.status).toBe("plan");
    expect(plan.blocked).toBeUndefined();
    expect(plan.migrations).toHaveLength(1);
    expect(plan.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ evalId: "excluded" })]));
    await expect(readdir(join(root, "new"))).rejects.toMatchObject({ code: "ENOENT" });

    const oldTreeBefore = await readTree(join(root, "old"));
    const committed = await renameExperiment({
      cwd: root,
      oldId: "old",
      newId: "new",
      recordRoot: root,
      config: config(),
      evals: definitions.evals,
      experiments: definitions.experiments,
      now: () => "2026-08-06T01:00:00.000Z",
    });
    expect(committed.migrated).toHaveLength(1);
    const renamedRun = (await openRecord(root)).experiments.find((experiment) => experiment.id === "new")!.latestRun;
    expect(renamedRun.attempts[0]!.result).toMatchObject({
      experimentId: "new",
      verdict: "passed",
      fingerprint: current.fingerprint,
      renamedFrom: {
        experimentId: "old",
        fingerprint: source.fingerprint,
        at: "2026-08-06T01:00:00.000Z",
      },
    });
    expect(renamedRun.attempts[0]!.result.locator).not.toBe(renamedRun.attempts[0]!.result.renamedFrom!.locator);
    expect(renamedRun.attempts[0]!.result.artifactBase).toContain("old/");
    expect(await readTree(join(root, "old"))).toEqual(oldTreeBefore);
    expect((await readdir(join(root, "new"))).length).toBe(1);
  });

  it("目标任一 eval 已有终态时整批拒绝且不写目标快照", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-rename-conflict-"));
    roots.push(root);
    const definitions = makeDefinitions();
    const target = definitions.experiments[1]!;
    const current = await targetFingerprint(definitions.evals, target);
    await writeSource(root, sourceResult({ fingerprint: current.fingerprint }));
    const writer = createWriter(root, { producer: { name: "niceeval", version: "test" } });
    const snapshot = await writer.run({ experimentId: "new", agent: "rename-agent", startedAt: "2026-08-06T00:00:00.000Z" });
    await writer.writeAttemptFor(sourceResult({ experimentId: "new", fingerprint: current.fingerprint }));
    await snapshot.finish();

    const plan = await planExperimentRename({ cwd: root, oldId: "old", newId: "new", recordRoot: root, config: config(), evals: definitions.evals, experiments: definitions.experiments });
    expect(plan).toMatchObject({
      status: "plan",
      blocked: { reason: "target-has-results", conflictingEvals: ["kept"] },
    });
    await expect(renameExperiment({ cwd: root, oldId: "old", newId: "new", recordRoot: root, config: config(), evals: definitions.evals, experiments: definitions.experiments })).rejects.toMatchObject({ reason: "target-has-results" });
  });

  it("fingerprint 不同时仍锚定到目标当前值，并在 renamedFrom 保留旧值", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-rename-fingerprint-"));
    roots.push(root);
    const definitions = makeDefinitions();
    await writeSource(root, sourceResult({ fingerprint: "stale-fingerprint" }));
    const target = definitions.experiments[1]!;
    const current = await targetFingerprint(definitions.evals, target);

    const options = {
      cwd: root,
      oldId: "old",
      newId: "new",
      recordRoot: root,
      config: config(),
      evals: definitions.evals,
      experiments: definitions.experiments,
    } as const;
    const plan = await planExperimentRename(options);
    expect(plan).toMatchObject({ status: "plan", migrations: [{ evalId: "kept", fingerprint: current.fingerprint }] });
    expect(plan.blocked).toBeUndefined();
    const done = await renameExperiment(options);
    expect(done.migrated[0]).toMatchObject({
      fingerprint: current.fingerprint,
      renamedFrom: { experimentId: "old", fingerprint: "stale-fingerprint" },
    });
  });
});
