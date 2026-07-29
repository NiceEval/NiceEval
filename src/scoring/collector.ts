// 断言收集器:test 期间记录断言(值断言就地、作用域断言延迟),test 结束后对完整运行
// 结果(ScoringContext)统一 finalize 成 AssertionResult[],再交判定。

import type { AssertionResult, ScoreEntry, ScoringContext, Severity, SourceLoc } from "../types.ts";
import { captureLoc } from "../source-loc.ts";
import { t } from "../i18n/index.ts";
import { formatThrown } from "../util.ts";

export interface EvalScore {
  score: number;
  detail?: string;
  /** 期望条件的有界文本预览(如 `contains "Brooklyn"`),失败时供 show/view 直接展示。 */
  expected?: string;
  /** 实际值的有界文本预览(被检查值 / 作用域内实际调用清单)。 */
  received?: string;
  /** 这条分数是看着什么材料算出来的(judge 收到的输入等);供 view 展开排查「为什么是这个分」。 */
  evidence?: string;
}

/** evaluate 返回它表示「这条断言评不了」:证据通道不完整 / judge 未解析到模型等。 */
export interface EvalUnavailable {
  unavailable: true;
  /** 机器可读原因,如 "judge-model-unresolved"、"coverage:actions=partial"。 */
  reason: string;
  /** 证据通道的状态或异常摘要；没有可用分数时仍保留排障线索。 */
  evidence?: string;
}

/** 构造 EvalUnavailable 的便捷工厂(scoped / judge 断言用)。 */
export function unavailable(reason: string, evidence?: string): EvalUnavailable {
  return { unavailable: true, reason, ...(evidence !== undefined ? { evidence } : {}) };
}

function isUnavailable(v: unknown): v is EvalUnavailable {
  return typeof v === "object" && v !== null && (v as EvalUnavailable).unavailable === true;
}

/** 一条尚未评估的断言。evaluate 在 finalize 时拿到完整运行结果再算分 [0,1](或报告评不了)。 */
export interface Spec {
  name: string;
  severity: Severity;
  threshold?: number;
  /**
   * 前置断言:就地立即求值、挂了中止 test()。`t.require`(通过制)记录时直接置位;计分制里
   * 由句柄上的 `.gate()` 置位。它同时豁免计分制的「matcher 自带严重度只贡献通过线」降级——
   * 前置是作者在句柄/入口上写下的题目结构声明,不是 matcher 默认值带来的。
   */
  prerequisite?: true;
  /** 作者用 .optional() 显式允许该断言证据缺席;unavailable 只保留在记录里,不影响判定。 */
  optional?: true;
  detail?: string;
  /**
   * 判分断言(t.judge.autoevals.*)。只有它带的求值要发一次裁判模型请求,是 finalize 期间
   * 唯一可能长时间等待的一类;live 面板的判分推进按它逐条上报(见 finalize 的 onJudgeProgress)。
   */
  judge?: true;
  /** 所属分组路径(外层在前的 t.group 标题数组)。纯组织用,不影响打分。 */
  groupPath?: string[];
  /** 断言在 eval 源码里的调用点(record 时栈回溯抠出)。 */
  loc?: SourceLoc;
  /**
   * `.points(n)` 挂在这条断言上的挣分权重(仅计分制 eval 的 `t` 类型上可链):`n × score`。
   * 运行时对全部 eval 一视同仁地记录(不需要按题型守护,见 docs/feature/experiments/score-points.md);
   * 通过制 eval 的 `AssertionHandle` 类型上没有 `.points()`,作者写不出来,这里只是同一个宽 Spec
   * 的可选字段。
   */
  points?: number;
  /** 前置断言就地求值的结果快照;finalize 直接用它,不再求值一次(见 armPrerequisite)。 */
  settled?: number | EvalScore | EvalUnavailable;
  evaluate(ctx: ScoringContext): number | EvalScore | EvalUnavailable | Promise<number | EvalScore | EvalUnavailable>;
}

/** 作者拿到的可链式句柄,改严重度 / 阈值 / optional / 计分权重(回头改 spec)。 */
export interface RecordHandle {
  atLeast(threshold: number): RecordHandle;
  gate(threshold?: number): RecordHandle;
  /** 降级为纯记录的 soft:不设线,分数照实落盘、永不 fail(judge 的默认严重度就是它)。无参数——要设线用 .atLeast(x)。 */
  soft(): RecordHandle;
  optional(): RecordHandle;
  /** 挂计分权重:`n` 必须是正有限数,非法值立即抛错(不是记一条失败断言)。 */
  points(n: number): RecordHandle;
}

export interface CollectorOptions {
  /**
   * 题型(默认通过制)。计分制下句柄语义换一套:`.gate()` 是前置(就地求值、挂了中止),
   * matcher 自带的默认严重度只贡献通过线、不使断言成为前置(否则默认 gate 的 matcher
   * 会让第一条检查点腰斩整题),见 docs/feature/experiments/score-points.md。
   */
  scoring?: "pass" | "points";
  /**
   * 计分制前置断言就地求值时看的实时运行结果(events/diff/沙箱等)。省略时前置退化为
   * 普通 gate(finalize 时才求值、不中止),仅用于直接构造 collector 的单测。
   */
  liveContext?: () => Promise<ScoringContext>;
}

/** 一条判分断言开始求值时的推进快照(见 FinalizeOptions.onJudgeProgress)。 */
export interface JudgeProgress {
  /** 正在评第几条(从 1 起)。 */
  index: number;
  /** 这次 finalize 要评的判分断言总数。 */
  total: number;
  /** 检查方式摘要,如 `closedQA("…")`;与落盘的 detail 同一份文本。 */
  check: string;
}

export interface FinalizeOptions {
  includePoints?: boolean;
  /**
   * 每条判分断言**求值开始前**回调一次;非判分断言不回调,没有判分断言时一次都不回调。
   * 纯反馈通道(runner 把它接到 active 行 detail),不进 AssertionResult、不落盘。
   */
  onJudgeProgress?: (progress: JudgeProgress) => void;
}

/** 前置未过时截断到哪里:该前置本身保留,它之后记录的断言与给分记录一律丢弃。 */
interface AbortPoint {
  specCount: number;
  entryCount: number;
  name: string;
}

export class AssertionCollector {
  private readonly specs: Spec[] = [];
  private readonly groupStack: string[] = [];
  private readonly entries: ScoreEntry[] = [];
  private readonly scoring: "pass" | "points";
  private readonly liveContext: (() => Promise<ScoringContext>) | undefined;
  /** 待结算的前置求值(按 arm 顺序);settlePrerequisites 依次等它们。 */
  private pending: Promise<AbortPoint | undefined>[] = [];
  private aborted: AbortPoint | undefined;

  constructor(options: CollectorOptions = {}) {
    this.scoring = options.scoring ?? "pass";
    this.liveContext = options.liveContext;
  }

  get hasEntries(): boolean {
    return this.specs.length > 0;
  }

  /** `t.score(label, n)` 的直接给分:立即记录(不像断言那样要等 finalize 求值),n 必须非负有限数。 */
  score(label: string, points: number): void {
    if (!Number.isFinite(points) || points < 0) {
      throw new Error(t("scoring.scoreInvalid", { label, n: points }));
    }
    this.entries.push({
      label,
      points,
      ...(this.groupStack.length > 0 ? { groupPath: this.groupStack.slice() } : {}),
      loc: captureLoc(),
    });
  }

  /** `t.score(...)` 记录的快照,供 finalize 时随 EvalResult 落盘;数组顺序 = 调用顺序。 */
  get scoreEntries(): ScoreEntry[] {
    return this.entries.slice();
  }

  /** t.group(title, fn) 期间入栈;栈内 record 的断言都打上当前分组路径(嵌套时外层在前)。 */
  async withGroup<T>(title: string, fn: () => Promise<T> | T): Promise<T> {
    this.groupStack.push(title);
    try {
      return await fn();
    } finally {
      this.groupStack.pop();
    }
  }

  record(spec: Spec): RecordHandle {
    if (spec.groupPath === undefined && this.groupStack.length > 0) {
      spec.groupPath = this.groupStack.slice();
    }
    if (spec.loc === undefined) spec.loc = captureLoc();
    // 计分制:角色只从断言句柄读。matcher 自带的默认严重度(includes 等默认 gate)与 matcher
    // 上链的 .gate(x) 只贡献通过线,记录为观测;成为前置要作者在句柄上写 .gate()。降级时把
    // gate 的通过线显式留下(省略即默认满分线),这样没做到的检查点照记 failed、挣 0 分,
    // 只是不参与判定——判定面在计分制只认前置中止(见 computeVerdict 的 scoring 分支)。
    if (this.scoring === "points" && spec.severity === "gate" && spec.prerequisite !== true) {
      spec.severity = "soft";
      spec.threshold = spec.threshold ?? 1;
    }
    this.specs.push(spec);
    // 该断言之前的记录量:这条一旦成为未过的前置,就截断回这里(它自己保留)。
    const before = { specCount: this.specs.length, entryCount: this.entries.length };
    const collector = this;
    const handle: RecordHandle = {
      atLeast(threshold) {
        spec.severity = "soft";
        spec.threshold = threshold;
        return handle;
      },
      gate(threshold) {
        spec.severity = "gate";
        spec.threshold = threshold;
        if (collector.scoring === "points") {
          spec.prerequisite = true;
          collector.armPrerequisite(spec, before);
        }
        return handle;
      },
      soft() {
        spec.severity = "soft";
        spec.threshold = undefined;
        return handle;
      },
      optional() {
        spec.optional = true;
        return handle;
      },
      points(n) {
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(t("scoring.pointsInvalid", { n }));
        }
        spec.points = n;
        return handle;
      },
    };
    return handle;
  }

  /**
   * 计分制前置:就地求值(不进延迟队列),结论定在写下的位置——之后发生的事不改变它。
   * 求值本身是异步的,结果挂进 pending 队列,由下一次 `settlePrerequisites()` 结算。
   */
  private armPrerequisite(spec: Spec, before: { specCount: number; entryCount: number }): void {
    const live = this.liveContext;
    if (live === undefined) return; // 无实时上下文(裸 collector 单测):退化为普通 gate,不中止
    this.pending.push(
      (async (): Promise<AbortPoint | undefined> => {
        let raw: number | EvalScore | EvalUnavailable;
        try {
          raw = await spec.evaluate(await live());
        } catch {
          raw = 0; // 求值抛错 = 0 分,与 finalize 的 catch 同口径;详情在 finalize 里落成 detail
          spec.settled = undefined;
          return { ...before, name: spec.name };
        }
        spec.settled = raw;
        // 证据评不了不算「前置未过」:非 optional 的 unavailable 会把整个 attempt 判成 errored,
        // 那是比中止更强的结论,不需要再中止一次。
        if (isUnavailable(raw)) return undefined;
        const score = typeof raw === "number" ? raw : raw.score;
        return computePassed("gate", spec.threshold, score) ? undefined : { ...before, name: spec.name };
      })(),
    );
  }

  /**
   * 结算待决前置。返回未过前置的断言名(调用方据此抛中止信号),没有则 undefined。
   * 一旦中止过就一直返回同一个名字——后续每个 `t.*` 入口都会再抛一次,直到 test() 退出。
   */
  async settlePrerequisites(): Promise<string | undefined> {
    while (this.pending.length > 0) {
      const batch = this.pending;
      this.pending = [];
      for (const task of batch) {
        const failure = await task;
        if (failure !== undefined && this.aborted === undefined) this.aborted = failure;
      }
    }
    if (this.aborted === undefined) return undefined;
    // 中止后写下的断言与给分记录一律丢弃:作者写不写 await 都得到同一份结果
    // (不 await 时后续同步调用仍会记录,这里统一截断回中止点)。
    this.specs.length = Math.min(this.specs.length, this.aborted.specCount);
    this.entries.length = Math.min(this.entries.length, this.aborted.entryCount);
    return this.aborted.name;
  }

  async finalize(ctx: ScoringContext, options: FinalizeOptions = {}): Promise<AssertionResult[]> {
    const out: AssertionResult[] = [];
    const judgeTotal = this.specs.filter((s) => s.judge === true).length;
    let judgeIndex = 0;
    for (const spec of this.specs) {
      // 判分推进只是给运行反馈看的短命信号:求值开始前报一次,不进 AssertionResult、不落盘。
      if (spec.judge === true) {
        judgeIndex++;
        options.onJudgeProgress?.({ index: judgeIndex, total: judgeTotal, check: spec.detail ?? spec.name });
      }
      const base = {
        name: spec.name,
        severity: spec.severity,
        ...(spec.optional ? { optional: true as const } : {}),
        ...(spec.detail !== undefined ? { detail: spec.detail } : {}),
        ...(spec.groupPath !== undefined ? { groupPath: spec.groupPath } : {}),
        ...(spec.loc !== undefined ? { loc: spec.loc } : {}),
      };
      let score = 0;
      let detail = spec.detail;
      let expected: string | undefined;
      let received: string | undefined;
      let evidence: string | undefined;
      try {
        // 前置断言已在写下的位置就地求值过,直接用那份快照——之后发生的事不改变它的结论。
        const raw = spec.settled ?? (await spec.evaluate(ctx));
        if (isUnavailable(raw)) {
          out.push({
            ...base,
            outcome: "unavailable",
            reason: raw.reason,
            ...(raw.evidence !== undefined ? { evidence: raw.evidence } : {}),
          });
          continue;
        }
        if (typeof raw === "number") {
          score = raw;
        } else {
          score = raw.score;
          if (raw.detail) detail = detail ? `${detail}; ${raw.detail}` : raw.detail;
          expected = raw.expected;
          received = raw.received;
          evidence = raw.evidence;
        }
      } catch (e) {
        score = 0;
        detail = `${detail ? detail + "; " : ""}${t("scoring.evalError", {
          error: formatThrown(e),
        })}`;
      }
      const passed = computePassed(spec.severity, spec.threshold, score);
      out.push({
        ...base,
        ...(detail !== undefined ? { detail } : {}),
        outcome: passed ? "passed" : "failed",
        score,
        ...(spec.threshold !== undefined ? { threshold: spec.threshold } : {}),
        ...(expected !== undefined ? { expected } : {}),
        ...(received !== undefined ? { received } : {}),
        ...(evidence !== undefined ? { evidence } : {}),
        // .points(n) 挂了才有:0/1 断言通过挣 n、不过挣 0;打分断言按连续分比例挣 n × score。
        // 求值抛错时 score 已经归零(见上面的 catch),points 自然也归零,不需要再判一次。
        ...(options.includePoints !== false && spec.points !== undefined ? { points: spec.points * score } : {}),
      });
    }
    return out;
  }
}

export function computePassed(severity: Severity, threshold: number | undefined, score: number): boolean {
  if (severity === "gate") return threshold === undefined ? score >= 1 : score >= threshold;
  return threshold === undefined ? true : score >= threshold;
}
