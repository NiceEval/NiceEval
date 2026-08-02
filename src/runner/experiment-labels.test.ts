// cases: docs/engineering/testing/unit/experiments-runner.md
// 登记行:ExperimentDef.labels 值域 string | number(解析时校验),原样投影进快照
// ExperimentRunInfo.labels;不透传 ctx / t,不参与可比性配置。

import { Effect } from "effect";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { defineDirectAgent, defineEval, defineExperiment } from "../define.ts";
import { experimentRunInfo } from "./attempt.ts";
import { comparabilityConfigOf, deepEqualJson } from "../sample/index.ts";
import type { Run } from "../record/types.ts";
import type { AgentRun } from "./types.ts";
import { discoverEval } from "./types.ts";
import { prepareRunSandboxes } from "./sandbox-selection.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";

const fakeAgent = defineDirectAgent({
  name: "fake",
  evidenceCoverage: completeEvidenceCoverage,
  async send() {
    return { events: [], status: "completed" };
  },
});

const evalDef = discoverEval(defineEval({ test() {} }), {
  id: "e",
  baseDir: "/project/evals/e",
  sourcePath: fileURLToPath(import.meta.url),
  loaderDataPaths: [],
  criteriaPaths: [],
  privatePaths: [],
  source: { path: "src/runner/experiment-labels.test.ts", content: "", sha256: "0".repeat(64) },
});

function runWith(labels?: globalThis.Record<string, string | number>): AgentRun {
  return {
    agent: fakeAgent,
    flags: {},
    attempts: 1,
    earlyExit: true,
    selectedEvalIds: ["e"],
    experimentId: "exp",
    experimentBaseDir: "/project/experiments",
    experimentSourcePath: "/project/experiments/exp.ts",
    ...(labels !== undefined ? { labels } : {}),
  };
}

async function runInfo(run: AgentRun) {
  const [pair] = await Effect.runPromise(prepareRunSandboxes([evalDef], [run]));
  if (pair === undefined) throw new Error("expected one prepared run pair");
  return experimentRunInfo(run, pair.plan, { [evalDef.id]: pair.identity });
}

describe("ExperimentDef.labels", () => {
  it("值域 string | number:合法值通过,布尔 / 对象在解析时报错", () => {
    expect(() =>
      defineExperiment({ agent: fakeAgent, labels: { line: "codex", contextK: 32 } }),
    ).not.toThrow();
    expect(() =>
      defineExperiment({ agent: fakeAgent, labels: { on: true as unknown as string } }),
    ).toThrow(/labels\.on/);
    expect(() =>
      defineExperiment({ agent: fakeAgent, labels: { nested: { a: 1 } as unknown as string } }),
    ).toThrow(/labels\.nested/);
    expect(() =>
      defineExperiment({ agent: fakeAgent, labels: { nan: Number.NaN } }),
    ).toThrow(/labels\.nan/);
  });

  it("原样投影进 ExperimentRunInfo.labels;未声明时字段缺省", async () => {
    const labels = { line: "codex", memory: "mempal" };
    expect((await runInfo(runWith(labels)))?.labels).toEqual(labels);
    expect((await runInfo(runWith()))?.labels).toBeUndefined();
    // 空对象不落盘(与 flags 同一态度:不写空壳字段)
    expect((await runInfo(runWith({})))?.labels).toBeUndefined();
  });

  it("不参与可比性配置:仅 labels 不同的两快照仍互相可比", () => {
    const snapshotWith = (labels?: globalThis.Record<string, string | number>): Run =>
      ({
        experimentId: "mem/codex",
        agent: "codex",
        model: "gpt-5.4",
        experiment: {
          attempts: 1,
          earlyExit: true,
          selectedEvalIds: [],
          flags: { web: true },
          ...(labels !== undefined ? { labels } : {}),
        },
      }) as unknown as Run;
    const a = comparabilityConfigOf(snapshotWith({ line: "codex" }));
    const b = comparabilityConfigOf(snapshotWith({ line: "renamed", memory: "mempal" }));
    const c = comparabilityConfigOf(snapshotWith());
    expect(deepEqualJson(a, b)).toBe(true);
    expect(deepEqualJson(a, c)).toBe(true);
  });
});
