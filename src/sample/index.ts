// 快照 Sample 与 attempt 去重(定稿见 docs/feature/record/library.md「选择快照」「官方现刻水位」「身份键与去重」)。
//
// 选择器长在集合上(results.latest() / results.current()),不是 DSL,只是最常用的两种口径。
// 选择器必须诚实:残缺、落后、未收尾都被算出来,以结构化 issues 随 Sample 走 ——
// 渲染与否在消费方(message 是渲染好的英文句子,以下一步收尾),但缺口不静默。

import type {
  AttemptHandle,
  DedupeWarning,
  Eval,
  Experiment,
  Record,
  ProjectCurrentTarget,
  Sample,
  SampleCoverage,
  SampleIssue,
  SampleMissing,
  UnreadableRun,
  Run,
} from "../record/types.ts";
import type { ExperimentRunInfo, JsonValue } from "../types.ts";
import { evalPrefixPredicate, matchExperimentSelector } from "../shared/aggregate.ts";

export { loadProjectCurrent as loadProjectCurrentTarget } from "../runner/project-current.ts";

/**
 * Record.latest() 的实现:每个实验取最新一次快照(= exp.runs[0]),生成覆盖事实与
 * 挑选警告。收整个 `Record` 而不是裸 `Experiment[]`,是为了同时取 `unreadable` / `root` 生成
 * `unreadable-run` 警告(非实验作用域,不受 `opts.experiments` 过滤 —— 那些落盘
 * 本来就没能解析出 experimentId,没有前缀可过滤)。
 */
export function latestRunSample(
  record: Pick<Record, "experiments" | "unreadable" | "root">,
  opts?: { experiments?: string | string[] },
): Sample {
  const selected = filterExperiments(record.experiments, opts?.experiments);
  const issues: SampleIssue[] = [];
  const coverage: SampleCoverage[] = [];
  const runs: Run[] = [];
  const attempts: AttemptHandle[] = [];

  for (const exp of selected) {
    const raw = exp.latestRun;
    const picked = raw.attempts;
    if (picked.length > 0) runs.push(raw); // 只保留实际贡献 Attempt 的真实 Run,不重建
    attempts.push(...picked);

    // 覆盖事实:分母 = 该实验已知 eval 并集(本地历史 ∪ 各快照携带的 knownEvalIds),
    // 分子 = 当前口径下有物理 Attempt 的题。位置参数允许只重跑一道题,缺口不能安静吞下。
    const knownEvalIds = exp.knownEvalIds;
    coverage.push({
      experimentId: exp.id,
      run: raw,
      knownEvalIds: [...knownEvalIds],
      missing: missingFor(knownEvalIds, picked, exp.runs.flatMap((run) => run.attempts)),
    });

    if (!raw.completedAt) {
      issues.push({
        code: "unfinished-run",
        experimentId: exp.id,
        startedAt: raw.startedAt,
        dir: raw.dir,
      });
    }
  }
  issues.push(...unreadableSnapshotWarnings(record.unreadable, record.root));
  issues.push(...danglingEvidenceIssues(attempts));
  const selectedAttempts = dedupeAttempts(attempts).attempts;
  const historyAttempts = dedupeAttempts(
    selected.flatMap((exp) => exp.runs.flatMap((run) => run.attempts)),
  ).attempts;
  return makeSample("latest-run", runs, selectedAttempts, issues, coverage, historyAttempts);
}

/** Sample selector 的范围输入:experiment id 前缀与 eval id 前缀,都可缺省。 */
export interface SampleOptions {
  /** experiment id 前缀(--exp),分段匹配语义同 filterExperiments。 */
  experiments?: string | string[];
  /** eval id 前缀(位置参数),收窄 Sample 覆盖的 eval;覆盖事实分母同步收窄到范围内。 */
  evals?: string | string[];
}

// ───────────────────────── 可比性配置 ─────────────────────────

/**
 * current() 跨快照拼接的可比性前提所比较的字段集(docs/feature/record/library.md
 * 「官方现刻水位」):会改变单题被测行为或判定的字段。runs / earlyExit / maxConcurrency /
 * 运行期选题与 description 不参与比较，也不落进 Record 的结果配置。
 */
export interface ComparabilityConfig {
  agent: string;
  model?: string;
  reasoningEffort?: string;
  flags?: globalThis.Record<string, JsonValue>;
  budget?: number;
  timeoutMs?: number;
  sandboxLayer: ExperimentRunInfo["sandboxLayer"];
  agentInstalls: ExperimentRunInfo["agentInstalls"];
}

/** 一个快照的可比性配置投影;conditionsByFlag 与 experimentListData 复用同一字段集。 */
export function comparabilityConfigOf(run: Run): ComparabilityConfig {
  const info = run.experiment;
  return {
    agent: run.agent,
    ...(run.model !== undefined ? { model: run.model } : {}),
    ...(info?.reasoningEffort !== undefined ? { reasoningEffort: info.reasoningEffort } : {}),
    ...(info?.flags !== undefined ? { flags: info.flags } : {}),
    ...(info?.budget !== undefined ? { budget: info.budget } : {}),
    ...(info?.timeoutMs !== undefined ? { timeoutMs: info.timeoutMs } : {}),
    sandboxLayer: info?.sandboxLayer ?? { kind: "unrecorded" },
    agentInstalls: info?.agentInstalls ?? [],
  };
}

/** 可序列化值的深相等(对象键序无关;undefined 字段与缺席字段等价)。 */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqualJson(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const keysA = Object.keys(a).filter((k) => (a as globalThis.Record<string, unknown>)[k] !== undefined);
    const keysB = Object.keys(b).filter((k) => (b as globalThis.Record<string, unknown>)[k] !== undefined);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) =>
      deepEqualJson((a as globalThis.Record<string, unknown>)[k], (b as globalThis.Record<string, unknown>)[k]),
    );
  }
  return false;
}

/**
 * 两个宿主(show / view)共用的现刻水位选择器:每个 experiment × eval 取「包含该 eval 的
 * 最新快照」里的全部 attempt,跨 run 拼出当前判定水位。results.latest() 只挑「每实验最新
 * 快照」,带 eval 前缀的局部重跑会产出残缺快照;现刻水位承诺「不会因为一次局部重跑变残缺」,
 * 所以在实验的历史快照上逐 eval 向更早的 run 补齐——但补齐只发生在 `Sample.attempts` 这份
 * 物化选择上,真正贡献过至少一道题的来源 Run 原样进 `Sample.runs`,不重建、不
 * 合并成报告专用对象(见 docs/feature/record/library.md「官方现刻水位」)。
 *
 * **可比性前提**:每个 experiment 以最新快照的可比性配置(agent / model / reasoningEffort /
 * flags / budget / timeoutMs / sandbox)为基准,只有配置与基准深相等的历史快照才参与补齐;
 * 改过配置后只补跑部分 eval 时,旧配置快照覆盖的其余题不冒充新配置的水位,进
 * `coverage.missing` 如实呈现。这保证 current() 产出的每个 experiment 只对应一套配置。
 *
 * 同一 eval 的全部 attempts 必须整批取自包含它的最新快照,不把历史快照的 attempts 平铺后
 * 按 eval 聚合——否则会把不同运行的重试混成一次虚构运行。
 */
export function latestRecordSample(record: Record, scope: SampleOptions = {}): Sample {
  const match =
    scope.evals !== undefined && (!Array.isArray(scope.evals) || scope.evals.length > 0)
      ? evalPrefixPredicate(Array.isArray(scope.evals) ? scope.evals : [scope.evals])
      : () => true;
  const experiments = filterExperiments(record.experiments, scope.experiments);
  const runs: Run[] = [];
  const attempts: AttemptHandle[] = [];
  const issues: SampleIssue[] = [];
  const coverage: SampleCoverage[] = [];

  for (const exp of experiments) {
    if (exp.latestRun.completedAt === undefined) {
      issues.push({
        code: "unfinished-run",
        experimentId: exp.id,
        startedAt: exp.latestRun.startedAt,
        dir: exp.latestRun.dir,
      });
    }

    // 可比性基准 = 该实验最新快照的可比性配置;不一致的旧快照整份跳过,不贡献 attempt。
    const baseline = exp.latestRun.configHash;
    // 逐题取最新:快照按最新在前,首个出现即最新判定
    const taken = new Map<string, { ev: Eval; run: Run }>();
    for (const run of exp.runs) {
      if (run !== exp.latestRun && (baseline === undefined || run.configHash !== baseline)) continue;
      for (const ev of run.evals) {
        if (ev.attempts.length === 0 || !match(ev.id) || taken.has(ev.id)) continue;
        taken.set(ev.id, { ev, run });
      }
    }
    if (taken.size === 0) {
      // 即使没有任何可比配置的历史贡献,该实验已知(范围内)的题仍然是覆盖缺口。
      // 锚点仍是 latest Run——它确定该 Experiment 的可比性配置,供分组读 agent/model。
      const knownEvalIds = exp.knownEvalIds.filter(match);
      if (knownEvalIds.length > 0) {
        coverage.push({
          experimentId: exp.id,
          run: exp.latestRun,
          knownEvalIds,
          missing: missingFor(knownEvalIds, [], exp.runs.flatMap((run) => run.attempts)),
        });
      }
      continue;
    }

    // attempts 按 eval id 字典序物化(与旧 evals 顺序同一口径),不随贡献来源的快照分布而变。
    const picks = [...taken.values()].sort((a, b) => a.ev.id.localeCompare(b.ev.id));

    const pickedAttempts = picks.flatMap((pick) => pick.ev.attempts);
    attempts.push(...pickedAttempts);

    // 真实贡献 Run:只收物化进 `pickedAttempts` 的来源,`Sample.runs` 里每个成员都真正 backs 至少一条
    // `Sample.attempts`。按 exp.runs
    // 既有的最新在前顺序去重,原对象身份保留。
    const usedSnapshots = new Set(pickedAttempts.map((a) => a.run));
    const contributing = exp.runs.filter((s) => usedSnapshots.has(s));
    runs.push(...contributing);

    // 覆盖事实:分母收窄到范围内(--exp / 位置参数),不让范围外的缺口刷屏;跨快照补齐后
    // 仍缺的题——「历史上见过却从未在可比配置的可读落盘里出现」(含改配置后未补跑的题)、
    // 或当前配置没有结果的题——统一进 missing,不静默。
    const knownEvalIds = exp.knownEvalIds.filter(match);
    coverage.push({
      experimentId: exp.id,
      // 可比性基准即最新 Run:分组读 agent/model/flags 时与「这套配置」对齐。
      run: exp.latestRun,
      knownEvalIds,
      missing: missingFor(knownEvalIds, pickedAttempts, exp.runs.flatMap((run) => run.attempts)),
    });

  }

  issues.push(...unreadableSnapshotWarnings(record.unreadable, record.root));
  issues.push(...danglingEvidenceIssues(attempts));
  const selectedAttempts = dedupeAttempts(attempts).attempts;
  const historyAttempts = dedupeAttempts(
    experiments.flatMap((exp) =>
      exp.runs.flatMap((run) => run.attempts).filter((attempt) => match(attempt.evalId))
    ),
  ).attempts;
  return makeSample("current", runs, selectedAttempts, issues, coverage, historyAttempts);
}

/** 单 Run 审计选择器；不读取项目定义，也不跨 Run 补齐。 */
export function runSample(run: Run): Sample {
  const knownEvalIds = run.knownEvalIds ?? run.evals.map((entry) => entry.id);
  return makeSample(
    "latest-run",
    run.attempts.length > 0 ? [run] : [],
    [...run.attempts],
    run.completedAt === undefined
      ? [{ code: "unfinished-run", experimentId: run.experimentId, startedAt: run.startedAt, dir: run.dir }]
      : [],
    [{
      experimentId: run.experimentId,
      run,
      knownEvalIds: [...knownEvalIds],
      missing: missingFor(knownEvalIds, run.attempts, run.attempts),
    }],
    [...run.attempts],
  );
}

/**
 * 项目 current：Target 先定义坐标与 canonical 身份，Record 只提供可验证的物理证据。
 * 旧身份与缺身份结果都留在 historyAttempts；只有三层身份完整匹配的最新 slot 进入 attempts。
 */
export function projectCurrentSample(
  record: Record,
  target: ProjectCurrentTarget,
  scope: SampleOptions = {},
): Sample {
  const matchEval =
    scope.evals !== undefined && (!Array.isArray(scope.evals) || scope.evals.length > 0)
      ? evalPrefixPredicate(Array.isArray(scope.evals) ? scope.evals : [scope.evals])
      : () => true;
  const selectedIds = scope.experiments === undefined
    ? new Set(target.experiments.map((entry) => entry.id))
    : new Set(
        (Array.isArray(scope.experiments) ? scope.experiments : [scope.experiments]).flatMap((selector) =>
          matchExperimentSelector(target.experiments.map((entry) => entry.id), selector)
        ),
      );
  const experiments = target.experiments.filter((entry) => selectedIds.has(entry.id));
  const recordById = new Map(record.experiments.map((entry) => [entry.id, entry]));
  const attempts: AttemptHandle[] = [];
  const historyAttempts: AttemptHandle[] = [];
  const issues: SampleIssue[] = [];
  const coverage: SampleCoverage[] = [];
  const usedRuns = new Set<Run>();
  const issueKeys = new Set<string>();

  for (const experimentTarget of experiments) {
    const history = recordById.get(experimentTarget.id)?.runs.flatMap((run) => run.attempts) ?? [];
    const scopedHistory = history.filter((attempt) => matchEval(attempt.evalId));
    historyAttempts.push(...scopedHistory);
    const currentForExperiment: AttemptHandle[] = [];

    for (const evalTarget of experimentTarget.evals.filter((entry) => matchEval(entry.id))) {
      const evalHistory = scopedHistory.filter((attempt) => attempt.evalId === evalTarget.id);
      const latestBySlot = new Map<number, AttemptHandle>();
      for (const attempt of evalHistory) {
        const missing = currentIdentityMissing(attempt);
        if (missing.length > 0) {
          const key = `${attempt.experimentId}\0${attempt.evalId}\0${attempt.result.attempt}\0${missing.join(",")}`;
          if (!issueKeys.has(key)) {
            issueKeys.add(key);
            issues.push({
              code: "unverifiable-current-result",
              experimentId: attempt.experimentId,
              evalId: attempt.evalId,
              attempt: attempt.result.attempt,
              ...(attempt.locator !== undefined ? { locator: attempt.locator } : {}),
              missing,
            });
          }
          continue;
        }
        if (
          attempt.result.attempt >= experimentTarget.attempts ||
          attempt.run.configHash !== experimentTarget.runConfigHash ||
          attempt.result.configHash !== evalTarget.resultConfigHash ||
          attempt.result.fingerprint !== evalTarget.fingerprint
        ) continue;
        const previous = latestBySlot.get(attempt.result.attempt);
        if (previous === undefined || isNewerAttempt(attempt, previous)) {
          latestBySlot.set(attempt.result.attempt, attempt);
        }
      }
      const picked = [...latestBySlot.values()].sort((a, b) => a.result.attempt - b.result.attempt);
      currentForExperiment.push(...picked);
      for (const attempt of picked) usedRuns.add(attempt.run);
    }

    attempts.push(...currentForExperiment);
    const knownEvalIds = experimentTarget.evals.filter((entry) => matchEval(entry.id)).map((entry) => entry.id);
    coverage.push({
      experimentId: experimentTarget.id,
      target: experimentTarget,
      knownEvalIds,
      missing: missingForProjectTarget(knownEvalIds, currentForExperiment, scopedHistory),
    });
  }

  const runs = record.experiments.flatMap((entry) => entry.runs).filter((run) => usedRuns.has(run));
  for (const run of runs) {
    if (run.completedAt === undefined) {
      issues.push({ code: "unfinished-run", experimentId: run.experimentId, startedAt: run.startedAt, dir: run.dir });
    }
  }
  issues.push(...unreadableSnapshotWarnings(record.unreadable, record.root));
  issues.push(...danglingEvidenceIssues(attempts));
  return makeSample(
    "current",
    runs,
    dedupeAttempts(attempts).attempts,
    issues,
    coverage,
    dedupeAttempts(historyAttempts).attempts,
  );
}

function currentIdentityMissing(
  attempt: AttemptHandle,
): ("run-config-hash" | "result-config-hash" | "fingerprint")[] {
  const missing: ("run-config-hash" | "result-config-hash" | "fingerprint")[] = [];
  if (attempt.run.configHash === undefined) missing.push("run-config-hash");
  if (attempt.result.configHash === undefined) missing.push("result-config-hash");
  if (attempt.result.fingerprint === undefined) missing.push("fingerprint");
  return missing;
}

function isNewerAttempt(candidate: AttemptHandle, previous: AttemptHandle): boolean {
  if (isNewerSnapshot(candidate.run, previous.run)) return true;
  if (isNewerSnapshot(previous.run, candidate.run)) return false;
  return (candidate.result.startedAt ?? candidate.run.startedAt) >
    (previous.result.startedAt ?? previous.run.startedAt);
}

function missingForProjectTarget(
  knownEvalIds: readonly string[],
  currentAttempts: readonly AttemptHandle[],
  historyAttempts: readonly AttemptHandle[],
): SampleMissing[] {
  const covered = new Set(currentAttempts.map((attempt) => attempt.evalId));
  return knownEvalIds.flatMap((evalId): SampleMissing[] => {
    if (covered.has(evalId)) return [];
    const history = historyAttempts.filter((attempt) => attempt.evalId === evalId);
    if (history.length === 0) return [{ evalId, reason: "never-run" }];
    const verifiable = history.filter((attempt) => currentIdentityMissing(attempt).length === 0);
    if (verifiable.length === 0) return [{ evalId, reason: "unverifiable-result" }];
    const previous = verifiable.reduce((latest, candidate) => isNewerAttempt(candidate, latest) ? candidate : latest);
    return [{
      evalId,
      reason: "previous-result",
      ...(previous.locator !== undefined
        ? {
            previous: {
              locator: previous.locator,
              verdict: previous.result.verdict,
              startedAt: previous.result.startedAt ?? previous.run.startedAt,
            },
          }
        : {}),
    }];
  });
}

function missingFor(
  knownEvalIds: readonly string[],
  currentAttempts: readonly AttemptHandle[],
  historyAttempts: readonly AttemptHandle[],
): SampleMissing[] {
  const covered = new Set(currentAttempts.map((attempt) => attempt.evalId));
  return knownEvalIds.flatMap((evalId): SampleMissing[] => {
    if (covered.has(evalId)) return [];
    const candidates = historyAttempts.filter((attempt) => attempt.evalId === evalId);
    if (candidates.length === 0) return [{ evalId, reason: "never-run" }];
    const previous = candidates.reduce((latest, candidate) => {
      if (isNewerSnapshot(candidate.run, latest.run)) return candidate;
      if (isNewerSnapshot(latest.run, candidate.run)) return latest;
      const latestAt = latest.result.startedAt ?? latest.run.startedAt;
      const candidateAt = candidate.result.startedAt ?? candidate.run.startedAt;
      return candidateAt > latestAt ? candidate : latest;
    });
    const startedAt = previous.result.startedAt ?? previous.run.startedAt;
    return [{
      evalId,
      reason: "previous-result",
      ...(previous.locator !== undefined
        ? { previous: { locator: previous.locator, verdict: previous.result.verdict, startedAt } }
        : {}),
    }];
  });
}

function danglingEvidenceIssues(attempts: readonly AttemptHandle[]): SampleIssue[] {
  return attempts.flatMap((attempt): SampleIssue[] =>
    attempt.evidenceState === "dangling"
      ? [{
          code: "dangling-evidence",
          experimentId: attempt.experimentId,
          evalId: attempt.evalId,
          attempt: attempt.result.attempt,
          artifactBase: attempt.result.artifactBase ?? "",
          artifacts: [],
        }]
      : [],
  );
}

/**
 * `record.unreadable` 里每一条不可读落盘 → 一条 `unreadable-run` SampleIssue。
 * 非实验作用域(没有 experimentId 字段):`latest()` / `current()` 都原样带上全部
 * `unreadable` 条目,不受 `opts.experiments` 前缀过滤影响(那些落盘本来就没能解析出
 * experimentId,没有前缀可比);`makeSample().filter()` 按「非实验作用域的警告保留」
 * 规则自动放行,不需要额外分支。
 */
function unreadableSnapshotWarnings(unreadable: readonly UnreadableRun[], _root: string): SampleIssue[] {
  return unreadable.map((s): SampleIssue => {
    switch (s.reason) {
      case "incompatible": {
        return {
          code: "unreadable-run",
          dir: s.dir,
          reason: s.reason,
          ...(s.producer !== undefined ? { producer: s.producer } : {}),
        };
      }
      case "malformed": {
        return {
          code: "unreadable-run",
          dir: s.dir,
          reason: s.reason,
        };
      }
      case "incomplete":
        return {
          code: "unreadable-run",
          dir: s.dir,
          reason: s.reason,
        };
    }
  });
}

/**
 * Sample 构造:`attempts` 由调用方按口径显式给出——`latest()` 的全量平铺与 `current()` 的
 * 逐题选择构造它的方式不同,`makeSample` 自己不猜(不再从 `runs` 反推 flatten,因为
 * `current()` 下一个贡献 Run 的 `attempts` 可能只有一部分真正进入这份 Sample)。
 *
 * `filter` 只删不换:按快照删减,`attempts` 只保留 `attempt.run` 仍属于幸存快照的
 * 条目;`coverage` 逐 experiment 用原始 `knownEvalIds`(删减前的分母不变)与幸存 `attempts`
 * 重新计算 `missing`——同一 experiment 删掉部分贡献来源、保留其它来源时,只有被删
 * 来源独占贡献的 eval 转入缺口,不是连带清空或保留整个 experiment;该 experiment 全部来源
 * 都被删除时连同 coverage 项一并丢弃,不留一条「100% 缺失」的假账,但没有快照可依附的
 * coverage 项(如 current() 里全无可比配置贡献的实验)不受快照删减影响,原样保留。
 * `issues` 按「非实验作用域的警告保留,其余随所属 experiment 是否存活」修剪。`coverage`
 * 缺省为 `[]`(测试里手工构造 Sample、不关心覆盖事实时不用逐处补参数)。
 */
export function makeSample(
  mode: Sample["mode"],
  runs: Run[],
  attempts: AttemptHandle[],
  issues: SampleIssue[],
  coverage: SampleCoverage[] = [],
  historyAttempts = attempts,
): Sample {
  const rebuild = (
    nextAttempts: AttemptHandle[],
    nextHistory: AttemptHandle[],
    nextIssues = issues,
    nextCoverage = coverage,
  ): Sample => {
    const runSet = new Set(nextAttempts.map((attempt) => attempt.run));
    const nextRuns = runs.filter((run) => runSet.has(run));
    const rebuiltCoverage = nextCoverage.map((item) => ({
      ...item,
      missing: item.target !== undefined
        ? missingForProjectTarget(
            item.knownEvalIds,
            nextAttempts.filter((attempt) => attempt.experimentId === item.experimentId),
            nextHistory.filter((attempt) => attempt.experimentId === item.experimentId),
          )
        : missingFor(
            item.knownEvalIds,
            nextAttempts.filter((attempt) => attempt.experimentId === item.experimentId),
            nextHistory.filter((attempt) => attempt.experimentId === item.experimentId),
          ),
    }));
    const scopedIssues = nextIssues.filter((issue) => {
      if (!("experimentId" in issue)) return true;
      return nextRuns.some((run) => run.experimentId === issue.experimentId)
        || nextCoverage.some((item) => item.experimentId === issue.experimentId);
    });
    return makeSample(mode, nextRuns, nextAttempts, scopedIssues, rebuiltCoverage, nextHistory);
  };
  return {
    mode,
    runs,
    attempts,
    historyAttempts,
    coverage,
    issues,
    scope(options): Sample {
      const experimentPrefixes = options.experiments === undefined
        ? []
        : (Array.isArray(options.experiments) ? options.experiments : [options.experiments]);
      // matchExperimentSelector 的「精确 id 优先于前缀」规则要看到完整 id 全集才成立:逐 id
      // 单独喂给它(`matchExperimentSelector([id], prefix)`)会让它对每个 id 各自重新判断,
      // 永远看不到"另一个 id 精确命中了 selector"这件事,于是 "compare/codex-gpt-5.6-luna"
      // 会把 "compare/codex-gpt-5.6-luna--mempal" 一起前缀命中,即使前者本身就是一个精确 id
      // (真实 bug,由 standardExperimentPage.load 单一实验窄化的冒烟测试暴露)。
      // 一次性对全集求出匹配集合,与 filterExperiments 的既有正确用法同形。
      const experimentIdUniverse =
        options.experiments === undefined
          ? []
          : [...new Set([
              ...runs.map((entry) => entry.experimentId),
              ...attempts.map((entry) => entry.experimentId),
              ...historyAttempts.map((entry) => entry.experimentId),
              ...coverage.map((entry) => entry.experimentId),
            ])];
      const matchedExperimentIds = new Set(
        experimentPrefixes.flatMap((prefix) => matchExperimentSelector(experimentIdUniverse, prefix)),
      );
      const experimentMatch = options.experiments === undefined ? () => true : (id: string) => matchedExperimentIds.has(id);
      const evalMatch = options.evals === undefined
        ? () => true
        : evalPrefixPredicate(Array.isArray(options.evals) ? options.evals : [options.evals]);
      const keep = (attempt: AttemptHandle) => experimentMatch(attempt.experimentId) && evalMatch(attempt.evalId);
      const scopedCoverage = coverage
        .filter((item) => experimentMatch(item.experimentId))
        .map((item) => ({ ...item, knownEvalIds: item.knownEvalIds.filter(evalMatch) }));
      return rebuild(attempts.filter(keep), historyAttempts.filter(keep), issues, scopedCoverage);
    },
    filter(predicate): Sample {
      return rebuild(attempts.filter(predicate), historyAttempts.filter(predicate));
    },
  };
}

/**
 * 跨快照聚合前的身份键去重:(experimentId, evalId, attempt, startedAt)。
 * 携带合入会把上一轮已通过的结果原样合入新快照,同一 attempt 因此存在于多份落盘;
 * 重复时保留最新快照里的那份(内容相同,取新快照的副本让 ref 落在最新落盘上;
 * 位置取首次出现处,顺序稳定)。startedAt 缺失时宁可不去重也不误删,记入 issues。
 */
export function dedupeAttempts(attempts: AttemptHandle[]): { attempts: AttemptHandle[]; issues: DedupeWarning[] } {
  const deduped: AttemptHandle[] = [];
  const indexByKey = new Map<string, number>();
  const issues: DedupeWarning[] = [];

  for (const attempt of attempts) {
    const r = attempt.result;
    if (!r.startedAt) {
      issues.push({
        kind: "missing-startedAt",
        experimentId: attempt.experimentId,
        evalId: attempt.evalId,
        message: `attempt ${r.attempt} of eval "${attempt.evalId}" in experiment "${attempt.experimentId}" has no startedAt; kept as-is without dedupe`,
      });
      deduped.push(attempt);
      continue;
    }
    const key = JSON.stringify([attempt.experimentId, r.id, r.attempt, r.startedAt]);
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(attempt);
    } else if (isNewerSnapshot(attempt.run, deduped[existing].run)) {
      deduped[existing] = attempt;
    }
  }
  return { attempts: deduped, issues };
}

/** 快照新旧比较:startedAt 优先,同刻按快照目录名(时间戳 + 随机后缀,字典序即时序)。 */
export function isNewerSnapshot(a: Run, b: Run): boolean {
  return isNewerSnapshotPlacement(a, b);
}

/**
 * isNewerSnapshot 的原始口径,供还没组装成 Run 的读取面共用同一判定(收窄读
 * `loadLatestResultsForCase` 只拿到目录名 + run.json 的 startedAt)。同一份磁盘在两条
 * 读取面上必须给出同一个「哪份最新」的答案,否则携带与报告会分叉。
 */
export function isNewerSnapshotPlacement(
  a: Pick<Run, "startedAt" | "dir">,
  b: Pick<Run, "startedAt" | "dir">,
): boolean {
  const byStart = a.startedAt.localeCompare(b.startedAt);
  if (byStart !== 0) return byStart > 0;
  return a.dir.localeCompare(b.dir) > 0;
}

/**
 * experiment 选择器过滤(--exp / latest({ experiments }) 同一语义,与 `niceeval exp` 位置参数
 * 共用 matchExperimentSelector,见 docs/feature/experiments/cli.md「实验选择器怎样解析」);
 * 包内使用,不进公共 barrel。
 */
export function filterExperiments(experiments: Experiment[], filter?: string | string[]): Experiment[] {
  if (filter === undefined) return experiments;
  // 允许 "compare/" 这种带尾斜杠的写法,与 "compare" 等价;分段匹配不误配 "compare2"。
  const prefixes = (Array.isArray(filter) ? filter : [filter]).map((p) => p.replace(/\/+$/, ""));
  const ids = experiments.map((exp) => exp.id);
  const matched = new Set(prefixes.flatMap((p) => matchExperimentSelector(ids, p)));
  return experiments.filter((exp) => matched.has(exp.id));
}
