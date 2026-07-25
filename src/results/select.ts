// 快照 Scope 与 attempt 去重(定稿见 docs/feature/results/library.md「选择快照」「官方现刻水位」「身份键与去重」)。
//
// 选择器长在集合上(results.latest() / results.current()),不是 DSL,只是最常用的两种口径。
// 选择器必须诚实:残缺、落后、未收尾都被算出来,以结构化 warnings 随 Scope 走 ——
// 渲染与否在消费方(message 是渲染好的英文句子,以下一步收尾),但缺口不静默。

import type {
  AttemptHandle,
  DedupeWarning,
  Eval,
  Experiment,
  Results,
  Scope,
  ScopeCoverage,
  ScopeWarning,
  SkippedDir,
  Snapshot,
} from "./types.ts";
import type { ExperimentRunInfo, JsonValue } from "../types.ts";
import { evalPrefixPredicate, matchExperimentSelector } from "../shared/aggregate.ts";

/**
 * Results.latest() 的实现:每个实验取最新一次快照(= exp.snapshots[0]),生成覆盖事实与
 * 挑选警告。收整个 `Results` 而不是裸 `Experiment[]`,是为了同时取 `skipped` / `root` 生成
 * `unreadable-snapshot` 警告(非实验作用域,不受 `opts.experiments` 过滤 —— 那些落盘
 * 本来就没能解析出 experimentId,没有前缀可过滤)。
 */
export function selectLatest(
  results: Pick<Results, "experiments" | "skipped" | "root">,
  opts?: { experiments?: string | string[]; fresh?: boolean },
): Scope {
  const selected = filterExperiments(results.experiments, opts?.experiments);
  const fresh = opts?.fresh === true;
  const warnings: ScopeWarning[] = [];
  const coverage: ScopeCoverage[] = [];
  const snapshots: Snapshot[] = [];
  const attempts: AttemptHandle[] = [];

  for (const exp of selected) {
    const raw = exp.latest;
    snapshots.push(raw); // 真实 Snapshot,原样保留,不重建
    // fresh: true 只保留新执行的 attempt——在 latest() 口径下,选中集合永远只有这一份
    // 快照,「所属快照早于该实验在 Scope 中最新快照」这条历史出身天生不成立(只有它自己),
    // 唯一的历史出身是携带条目(attempt.carried)。只过滤显式物化的 attempts 集,不克隆/
    // 改写来源 Snapshot 的 evals(见 docs/feature/results/library.md「选择快照」)。
    const picked = fresh ? raw.attempts.filter((a) => !a.carried) : raw.attempts;
    attempts.push(...picked);

    // 覆盖事实:分母 = 该实验已知 eval 并集(本地历史 ∪ 各快照携带的 knownEvalIds),
    // 分子 = 当前口径(可能已被 fresh 收窄)下有 attempt 的题。位置参数允许只重跑一道题、
    // fresh 允许全部结果都是携带 —— 两种情况都不能安静吞下,统一进 missingEvalIds。
    const knownEvalIds = exp.evalIds;
    const coveredIds = new Set(picked.map((a) => a.evalId));
    coverage.push({
      experimentId: exp.id,
      knownEvalIds: [...knownEvalIds],
      missingEvalIds: knownEvalIds.filter((id) => !coveredIds.has(id)),
    });

    if (!raw.completedAt) {
      warnings.push({
        kind: "unfinished-snapshot",
        experimentId: exp.id,
        startedAt: raw.startedAt,
        dir: raw.dir,
        message: `snapshot "${exp.id}" (${raw.startedAt}) has no completedAt — the run was interrupted; re-run \`niceeval exp ${exp.id}\` for a complete snapshot`,
        command: `niceeval exp ${exp.id}`,
      });
    }
  }
  warnings.push(...unreadableSnapshotWarnings(results.skipped, results.root));
  return makeScope("latest-snapshots", snapshots, attempts, warnings, coverage);
}

/** selectCurrentResults 的范围输入:experiment id 前缀与 eval id 前缀,都可缺省。 */
export interface ResultScope {
  /** experiment id 前缀(--exp),分段匹配语义同 filterExperiments。 */
  experiment?: string | string[];
  /** eval id 前缀(位置参数),收窄 Scope 覆盖的 eval;覆盖事实分母同步收窄到范围内。 */
  patterns?: string[];
  /** 只保留新执行的 attempt(排除携带条目与跨快照拼入的历史执行);被排除的题进 coverage.missingEvalIds。 */
  fresh?: boolean;
}

// ───────────────────────── 可比性配置 ─────────────────────────

/**
 * current() 跨快照拼接的可比性前提所比较的字段集(docs/feature/results/library.md
 * 「官方现刻水位」):会改变单题被测行为或判定的字段。runs / earlyExit / maxConcurrency /
 * selectedEvalIds / evalFilterFingerprint / description 是编排与选题字段,不参与比较。
 */
export interface ComparabilityConfig {
  agent: string;
  model?: string;
  reasoningEffort?: string;
  flags?: Record<string, JsonValue>;
  budget?: number;
  timeoutMs?: number;
  sandbox?: ExperimentRunInfo["sandbox"];
}

/** 一个快照的可比性配置投影;conditionsByFlag 与 experimentListData 复用同一字段集。 */
export function comparabilityConfigOf(snapshot: Snapshot): ComparabilityConfig {
  const info = snapshot.experiment;
  return {
    agent: snapshot.agent,
    ...(snapshot.model !== undefined ? { model: snapshot.model } : {}),
    ...(info?.reasoningEffort !== undefined ? { reasoningEffort: info.reasoningEffort } : {}),
    ...(info?.flags !== undefined ? { flags: info.flags } : {}),
    ...(info?.budget !== undefined ? { budget: info.budget } : {}),
    ...(info?.timeoutMs !== undefined ? { timeoutMs: info.timeoutMs } : {}),
    ...(info?.sandbox !== undefined ? { sandbox: info.sandbox } : {}),
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
    const keysA = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const keysB = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) =>
      deepEqualJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/**
 * 一个快照实际选中的 eval id 全集:优先读落盘的 `experiment.selectedEvalIds`(niceeval 自己的
 * 写入面必有此字段);第三方 harness 未实现该字段时退化为该快照实际写出的 `evals`,不把整份
 * 来源排除在外(见 docs/feature/results/architecture.md「selectedEvalIds」)。
 */
export function selectedEvalIdsOf(snapshot: Snapshot): readonly string[] {
  return snapshot.experiment?.selectedEvalIds ?? snapshot.evals.map((ev) => ev.id);
}

/**
 * 两个宿主(show / view)共用的现刻水位选择器:每个 experiment × eval 取「包含该 eval 的
 * 最新快照」里的全部 attempt,跨 run 拼出当前判定水位。results.latest() 只挑「每实验最新
 * 快照」,带 eval 前缀的局部重跑会产出残缺快照;现刻水位承诺「不会因为一次局部重跑变残缺」,
 * 所以在实验的历史快照上逐 eval 向更早的 run 补齐——但补齐只发生在 `Scope.attempts` 这份
 * 物化选择上,真正贡献过至少一道题的来源 Snapshot 原样进 `Scope.snapshots`,不重建、不
 * 合并成报告专用对象(见 docs/feature/results/library.md「官方现刻水位」)。
 *
 * **可比性前提**:每个 experiment 以最新快照的可比性配置(agent / model / reasoningEffort /
 * flags / budget / timeoutMs / sandbox)为基准,只有配置与基准深相等的历史快照才参与补齐;
 * 改过配置后只补跑部分 eval 时,旧配置快照覆盖的其余题不冒充新配置的水位,进
 * `coverage.missingEvalIds` 如实呈现。这保证 current() 产出的每个 experiment 只对应一套配置。
 *
 * 同一 eval 的全部 attempts 必须整批取自包含它的最新快照,不把历史快照的 attempts 平铺后
 * 按 eval 聚合——否则会把不同运行的重试混成一次虚构运行。
 */
export function selectCurrentResults(results: Results, scope: ResultScope = {}): Scope {
  const match =
    scope.patterns && scope.patterns.length > 0 ? evalPrefixPredicate(scope.patterns) : () => true;
  const experiments = filterExperiments(results.experiments, scope.experiment);
  const fresh = scope.fresh === true;

  const snapshots: Snapshot[] = [];
  const attempts: AttemptHandle[] = [];
  const warnings: ScopeWarning[] = [];
  const coverage: ScopeCoverage[] = [];

  for (const exp of experiments) {
    // 可比性基准 = 该实验最新快照的可比性配置;不一致的旧快照整份跳过,不贡献 attempt。
    const baseline = comparabilityConfigOf(exp.latest);
    // 逐题取最新:快照按最新在前,首个出现即最新判定
    const taken = new Map<string, { ev: Eval; snapshot: Snapshot }>();
    for (const snapshot of exp.snapshots) {
      if (!deepEqualJson(comparabilityConfigOf(snapshot), baseline)) continue;
      // 一个来源快照只贡献它自己选中的 eval——不在其 selectedEvalIds(或第三方退化后的实际
      // evals)内的历史 attempt 不进入现刻水位,即使它恰好出现在 snapshot.evals 里。第三方
      // 无该字段时 selectedEvalIdsOf 退化为快照实际 evals,这里的过滤天然是 no-op。
      const selectedIds = new Set(selectedEvalIdsOf(snapshot));
      for (const ev of snapshot.evals) {
        if (!selectedIds.has(ev.id) || !match(ev.id) || taken.has(ev.id)) continue;
        taken.set(ev.id, { ev, snapshot });
      }
    }
    if (taken.size === 0) {
      // 即使没有任何可比配置的历史贡献,该实验已知(范围内)的题仍然是覆盖缺口。
      const knownEvalIds = exp.evalIds.filter(match);
      if (knownEvalIds.length > 0) {
        coverage.push({ experimentId: exp.id, knownEvalIds, missingEvalIds: [...knownEvalIds] });
      }
      continue;
    }

    // attempts 按 eval id 字典序物化(与旧 evals 顺序同一口径),不随贡献来源的快照分布而变。
    const picks = [...taken.values()].sort((a, b) => a.ev.id.localeCompare(b.ev.id));

    // 水位基准:贡献来源(fresh 过滤前)里 startedAt 最新的一个——用于判断"新执行"阈值与
    // 该实验现刻是否收尾,不受 fresh 是否连它自己的数据都排除影响。
    let watermark: Snapshot = picks[0]!.snapshot;
    for (const pick of picks) {
      if (pick.snapshot.startedAt > watermark.startedAt) watermark = pick.snapshot;
    }

    // fresh 只过滤显式物化的 attempts 集,不克隆/改写来源 Snapshot 的 evals——真实 Snapshot
    // 原样留在 `snapshots` 里。保留该实验「新执行」的 attempt:属于水位基准快照
    // (startedAt 就是它的 startedAt)且非携带;历史执行整条排除,题内全部历史执行时该题
    // 在 `attempts` 里自然消失,由下面的覆盖事实计算转入 missingEvalIds。
    const pickedAttempts = fresh
      ? picks.flatMap((pick) => pick.ev.attempts.filter((a) => !a.carried && a.snapshot.startedAt >= watermark.startedAt))
      : picks.flatMap((pick) => pick.ev.attempts);
    attempts.push(...pickedAttempts);

    // 真实贡献 Snapshot:只收物化进 `pickedAttempts` 的来源——fresh 排除掉的来源不再列入,
    // `Scope.snapshots` 里每个成员都真正 backs 至少一条 `Scope.attempts`。按 exp.snapshots
    // 既有的最新在前顺序去重,原对象身份保留。
    const usedSnapshots = new Set(pickedAttempts.map((a) => a.snapshot));
    const contributing = exp.snapshots.filter((s) => usedSnapshots.has(s));
    snapshots.push(...contributing);

    // 覆盖事实:分母收窄到范围内(--exp / 位置参数),不让范围外的缺口刷屏;跨快照补齐后
    // 仍缺的题——「历史上见过却从未在可比配置的可读落盘里出现」(含改配置后未补跑的题)、
    // 或被 fresh 排除的题——统一进 missingEvalIds,不静默。
    const knownEvalIds = exp.evalIds.filter(match);
    const coveredIds = new Set(pickedAttempts.map((a) => a.evalId));
    coverage.push({
      experimentId: exp.id,
      knownEvalIds,
      missingEvalIds: knownEvalIds.filter((id) => !coveredIds.has(id)),
    });

    if (watermark.completedAt === undefined) {
      warnings.push({
        kind: "unfinished-snapshot",
        experimentId: exp.id,
        startedAt: watermark.startedAt,
        dir: watermark.dir,
        message: `snapshot "${exp.id}" (${watermark.startedAt}) is unfinished (the process was interrupted); completed attempts are read as-is, but the set may be incomplete — re-run \`niceeval exp ${exp.id}\` for a complete snapshot`,
        command: `niceeval exp ${exp.id}`,
      });
    }
  }

  warnings.push(...unreadableSnapshotWarnings(results.skipped, results.root));
  return makeScope("current-evals", snapshots, attempts, warnings, coverage);
}

/**
 * `results.skipped` 里每一条不可读落盘 → 一条 `unreadable-snapshot` ScopeWarning。
 * 非实验作用域(没有 experimentId 字段):`latest()` / `current()` 都原样带上全部
 * `skipped` 条目,不受 `opts.experiments` 前缀过滤影响(那些落盘本来就没能解析出
 * experimentId,没有前缀可比);`makeScope().filter()` 按「非实验作用域的警告保留」
 * 规则自动放行,不需要额外分支。
 */
function unreadableSnapshotWarnings(skipped: readonly SkippedDir[], root: string): ScopeWarning[] {
  return skipped.map((s): ScopeWarning => {
    switch (s.reason) {
      case "incompatible-version": {
        const producer = s.producer;
        const schemaText = s.schemaVersion !== undefined ? ` (schemaVersion ${s.schemaVersion})` : "";
        if (producer?.name === "niceeval" && producer.version) {
          const command = `npx niceeval@${producer.version} show --results ${root}`;
          return {
            kind: "unreadable-snapshot",
            dir: s.dir,
            reason: s.reason,
            message: `snapshot at "${s.dir}" was written by niceeval ${producer.version}${schemaText} and cannot be read by this version; run \`${command}\` to open it`,
            command,
          };
        }
        const writtenBy = producer?.name
          ? `${producer.name}${producer.version ? ` ${producer.version}` : ""}`
          : "an incompatible tool version";
        return {
          kind: "unreadable-snapshot",
          dir: s.dir,
          reason: s.reason,
          message: `snapshot at "${s.dir}" was written by ${writtenBy}${schemaText} and cannot be read by this version; open it with the tool version that produced it`,
        };
      }
      case "malformed": {
        const detail = s.detail ? ` (${s.detail})` : "";
        return {
          kind: "unreadable-snapshot",
          dir: s.dir,
          reason: s.reason,
          message: `snapshot at "${s.dir}" is malformed${detail} and was skipped; inspect snapshot.json in that directory for corrupted JSON or a missing required field`,
        };
      }
      case "incomplete":
        return {
          kind: "unreadable-snapshot",
          dir: s.dir,
          reason: s.reason,
          message: `snapshot at "${s.dir}" has attempt data but no snapshot.json (likely interrupted before metadata was written) and was skipped; inspect ${s.dir} — completed attempts remain on disk for manual review`,
        };
    }
  });
}

/**
 * Scope 构造:`attempts` 由调用方按口径显式给出——`latest()` 的全量平铺与 `current()` 的
 * 逐题选择构造它的方式不同,`makeScope` 自己不猜(不再从 `snapshots` 反推 flatten,因为
 * `current()` 下一个贡献 Snapshot 的 `attempts` 可能只有一部分真正进入这份 Scope)。
 *
 * `filter` 只删不换:按快照删减,`attempts` 只保留 `attempt.snapshot` 仍属于幸存快照的
 * 条目;`coverage` 逐 experiment 用原始 `knownEvalIds`(删减前的分母不变)与幸存 `attempts`
 * 重新计算 `missingEvalIds`——同一 experiment 删掉部分贡献来源、保留其它来源时,只有被删
 * 来源独占贡献的 eval 转入缺口,不是连带清空或保留整个 experiment;该 experiment 全部来源
 * 都被删除时连同 coverage 项一并丢弃,不留一条「100% 缺失」的假账,但没有快照可依附的
 * coverage 项(如 current() 里全无可比配置贡献的实验)不受快照删减影响,原样保留。
 * `warnings` 按「非实验作用域的警告保留,其余随所属 experiment 是否存活」修剪。`coverage`
 * 缺省为 `[]`(测试里手工构造 Scope、不关心覆盖事实时不用逐处补参数)。
 */
export function makeScope(
  mode: Scope["mode"],
  snapshots: Snapshot[],
  attempts: AttemptHandle[],
  warnings: ScopeWarning[],
  coverage: ScopeCoverage[] = [],
): Scope {
  return {
    mode,
    snapshots,
    attempts,
    coverage,
    warnings,
    filter(predicate: (snapshot: Snapshot) => boolean): Scope {
      const kept = snapshots.filter(predicate);
      const keptSet = new Set(kept);
      const survivors = new Set(kept.map((s) => s.experimentId));
      const keptAttempts = attempts.filter((a) => keptSet.has(a.snapshot));
      const keptWarnings = warnings.filter((w) => {
        const scope = (w as { experimentId?: unknown }).experimentId;
        return typeof scope !== "string" || survivors.has(scope);
      });
      const experimentIdsWithSnapshots = new Set(snapshots.map((s) => s.experimentId));
      const keptCoverage = coverage.flatMap((c) => {
        if (!experimentIdsWithSnapshots.has(c.experimentId)) return [c]; // snapshot-less,不受删减影响
        if (!survivors.has(c.experimentId)) return []; // 全部来源已删除,连同缺口一起丢弃
        const coveredIds = new Set(
          keptAttempts.filter((a) => a.experimentId === c.experimentId).map((a) => a.evalId),
        );
        return [{ ...c, missingEvalIds: c.knownEvalIds.filter((id) => !coveredIds.has(id)) }];
      });
      return makeScope(mode, kept, keptAttempts, keptWarnings, keptCoverage);
    },
  };
}

/**
 * 跨快照聚合前的身份键去重:(experimentId, evalId, attempt, startedAt)。
 * 携带合入会把上一轮已通过的结果原样合入新快照,同一 attempt 因此存在于多份落盘;
 * 重复时保留最新快照里的那份(内容相同,取新快照的副本让 ref 落在最新落盘上;
 * 位置取首次出现处,顺序稳定)。startedAt 缺失时宁可不去重也不误删,记入 warnings。
 */
export function dedupeAttempts(attempts: AttemptHandle[]): { attempts: AttemptHandle[]; warnings: DedupeWarning[] } {
  const deduped: AttemptHandle[] = [];
  const indexByKey = new Map<string, number>();
  const warnings: DedupeWarning[] = [];

  for (const attempt of attempts) {
    const r = attempt.result;
    if (!r.startedAt) {
      warnings.push({
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
    } else if (isNewerSnapshot(attempt.snapshot, deduped[existing].snapshot)) {
      deduped[existing] = attempt;
    }
  }
  return { attempts: deduped, warnings };
}

/** 快照新旧比较:startedAt 优先,同刻按快照目录名(时间戳 + 随机后缀,字典序即时序)。 */
export function isNewerSnapshot(a: Snapshot, b: Snapshot): boolean {
  return isNewerSnapshotPlacement(a, b);
}

/**
 * isNewerSnapshot 的原始口径,供还没组装成 Snapshot 的读取面共用同一判定(收窄读
 * `loadLatestResultsForCase` 只拿到目录名 + snapshot.json 的 startedAt)。同一份磁盘在两条
 * 读取面上必须给出同一个「哪份最新」的答案,否则携带与报告会分叉。
 */
export function isNewerSnapshotPlacement(
  a: Pick<Snapshot, "startedAt" | "dir">,
  b: Pick<Snapshot, "startedAt" | "dir">,
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

/**
 * 时效标注(`↩` + 人话时距)的粒度选择:选粒度最大的单位,四舍五入。结构化形态是单源——
 * entity-lists 渲染面的紧凑时距("3d")与曾经的 stale-snapshot message 用同一套阈值,
 * 阈值不写两份(docs/feature/reports/components/entity-lists.md「时效标注」)。
 */
export function gapParts(fromIso: string, toIso: string): { n: number; unit: "second" | "minute" | "hour" | "day" } {
  const ms = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return { n: seconds, unit: "second" };
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return { n: minutes, unit: "minute" };
  const hours = Math.round(minutes / 60);
  if (hours < 36) return { n: hours, unit: "hour" };
  return { n: Math.round(hours / 24), unit: "day" };
}
