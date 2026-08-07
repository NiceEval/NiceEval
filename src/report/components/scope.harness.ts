// Reports 家族共享的 Sample / Record 机械构造器(harness,规则见
// docs/engineering/testing/unit/README.md「Fixture 与 Harness」):只做「Run[] → Sample / Record」的无场景
// 语义包装,场景输入(snap()/res() 等 fixture)留在各测试文件里。makeSample / Sample 形状变更
// 只改这一处,不再在每个 report 测试文件里各改一份副本。
// 不进 dist/report 产物(tsconfig.report-build.json 按 *.harness.ts 排除)。

import type {
  AttemptHandle,
  AttemptRef,
  EvalResult,
  Record,
  Sample,
  SampleCoverage,
  SampleIssue,
  Run,
} from "../../record/index.ts";
import { makeSample } from "../../sample/index.ts";

type AttemptLoaderOverrides = Partial<
  Pick<AttemptHandle, "locator" | "commands" | "events" | "trace" | "o11y" | "agentSetup" | "diff" | "sources">
>;

/**
 * Report 测试共用的纯机械 AttemptHandle 外壳。场景身份与 result 仍由调用方明确传入；
 * 新增证据 loader 时只需在这里补一次，不让所有 Report fixture 跟着改。
 */
export function attemptHandleOf(
  run: Run,
  result: EvalResult,
  ref: AttemptRef,
  overrides: AttemptLoaderOverrides = {},
): AttemptHandle {
  return {
    evalId: result.id,
    experimentId: result.experimentId ?? run.experimentId,
    result,
    ref,
    run,
    carried: Boolean(result.artifactBase),
    evidenceState: "local",
    commands: async () => null,
    events: async () => null,
    trace: async () => null,
    o11y: async () => null,
    agentSetup: async () => null,
    diff: async () => null,
    sources: async () => null,
    ...overrides,
  };
}

/** 现刻水位形态的 Sample:attempts 物化自各快照,issues / coverage 按需注入。 */
export function scopeOf(runs: Run[], issues: SampleIssue[] = [], coverage: SampleCoverage[] = []): Sample {
  return makeSample("current", runs, runs.flatMap((s) => s.attempts), issues, coverage);
}

/** 按 experimentId 分组、startedAt 降序的最小 Record:latest()/current() 都取各实验最新快照。 */
export function resultsOf(runs: Run[]): Record {
  const byId = new Map<string, Run[]>();
  for (const s of runs) byId.set(s.experimentId, [...(byId.get(s.experimentId) ?? []), s]);
  const experiments = [...byId.entries()].map(([id, snaps]) => {
    const sorted = [...snaps].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return {
      id,
      runs: sorted,
      latest: sorted[0]!,
      knownEvalIds: [...new Set(sorted.flatMap((s) => s.evals.map((e) => e.id)))].sort(),
    };
  });
  return {
    experiments,
    unreadable: [],
    latest: () => makeSample("latest-run", experiments.map((e) => e.latest), experiments.flatMap((e) => e.latest.attempts), []),
    current: () => makeSample("current", experiments.map((e) => e.latest), experiments.flatMap((e) => e.latest.attempts), []),
  } as unknown as Record;
}

/** 空 Sample + 指回它的 Record:attempt-input page 场景里只需要一个合法的空上下文。 */
export function emptyScopeAndResults(): { scope: Sample; results: Record } {
  const scope = scopeOf([]);
  const results = { experiments: [], unreadable: [], latest: () => scope, current: () => scope } as unknown as Record;
  return { scope, results };
}
