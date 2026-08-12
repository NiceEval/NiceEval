// JSON profile renderer(见 docs/feature/experiments/cli.md「机器怎么读:--json」与「事件与
// 计划文档的 TypeScript 形状」)。合并了此前 agent.ts + ci.ts 两个 profile —— 逐项对照证实
// agent 档/ci 档是同一消费者模型的两套参数(heartbeat 30/60s、失败展开上限 5/50、流路由、词法
// 前缀……),没有模型差,见 memory/exp-output-two-forms-ruling.md。
//
// 目标读者是任何非交互解析者(coding agent、CI annotation adapter、脚本),不是人眼:
// - 单一 stdout 上的 NDJSON 事件流,一行一个 JSON 对象,词法就是 JSON,没有自造 envelope
//   语法。`stderr` 只留给 run 尚未建立前的 argv/config 错误(那些错误发生在 coordinator/renderer
//   存在之前,根本不经过这个模块——所以这里没有任何写 `io.stderr` 的分支,不是遗漏)。
// - 首行 `start` 携带 `format`/`schemaVersion` 标识整条流;其余事件不重复这两个字段。
// - 失败/错误立即逐条追加,不做展开上限 suppression(机器逐事件消费,截断反而是信息损失,
//   见 cli.md「'立即追加'也必须有上限」表:上限只约束人读文本)。
// - 连续 30 秒没有永久事件才追加一条 `progress` 心跳;任意永久事件重置这个时钟。
// - 事件形状按 `ExpEvent` 判别联合(判别字段 `event`)逐个实现,字段名复用 Record 词表
//   (locator/evalId/experimentId/phase/verdict),不为事件流发明第二套命名。
//
// 不实现 `clearDynamic`/`redrawDynamic`/`activity`/`onLifecycle`:JSON 流没有「动态区域」概念,
// 不展示 active phase、不逐次输出 provisioning retry/backoff、不逐条打印 passed attempt —— 这些
// 目标行为由「不实现对应可选钩子」天然满足(见 renderer.ts 的接口注释)。
//
// 为什么 diagnostic/budget-exhausted/interrupted/reporter-error 仍然去重(只在首次出现时追加)
// 而 failure/error 不做 suppression:cli.md「什么动态更新,什么逐条追加」表把两者分成不同的行——
// 「retry 耗尽、降级、budget 不可执行」是「去重后追加一次」的永久事件,「failed/errored + locator」
// 是「立即追加,不设上限」的独立证据;`--json` 的「不做 suppression」只针对后者(每条失败一个
// 有界事件),不是把去重规则也一起取消。

import type { FeedbackRenderer } from "./renderer.ts";
import type { FeedbackIO } from "./io.ts";
import type {
  DurableFeedbackEvent,
  InvocationCompletion,
  InvocationReceipt,
  InvocationSummary,
  LifecyclePhase,
  RunFeedbackState,
} from "../types.ts";
import type { JsonValue, Verdict } from "../../shared/types.ts";
import { evalConclusionRows, type EvalConclusionRow } from "./eval-conclusions.ts";
import type { CommandPlan } from "../command-plan.ts";

/** `ExpEvent`/`ExpPlanDocument` 的 `format`/`schemaVersion` —— 只在破坏性形状变更时递增
 *  (见 cli.md「事件与计划文档的 TypeScript 形状」)。 */
const EXP_STREAM_FORMAT = "niceeval.exp";
const EXP_PLAN_FORMAT = "niceeval.exp-plan";
const SCHEMA_VERSION = 1;
const EXP_PLAN_SCHEMA_VERSION = 4;

/** 连续无永久事件多久才追加一条 `progress` 心跳(cli.md「机器怎么读:--json」:「连续 30 秒
 *  没有这些永久事件,才追加一条 progress 心跳」——两者合并前分别是 30s/60s,统一取 30s)。 */
const JSON_HEARTBEAT_IDLE_MS = 30_000;

export interface JsonRendererOptions {
  io: FeedbackIO;
}

export interface StartEvent {
  format: typeof EXP_STREAM_FORMAT;
  schemaVersion: number;
  event: "start";
  total: number;
  configs: number;
  concurrency: number;
  experimentConcurrency?: Readonly<globalThis.Record<string, number>>;
  reused: number;
}

export interface ProgressEvent {
  event: "progress";
  elapsedMs: number;
  total: number;
  reused: number;
  running: number;
  elsewhere: number;
  queued: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

export interface FailureEvent {
  event: "failure";
  locator: string;
  evalId: string;
  experimentId: string;
  verdict: "failed" | "errored";
  fact: string;
  matcher?: string;
  expected?: JsonValue;
  received?: JsonValue;
}

export interface ErrorEvent {
  event: "error";
  locator: string;
  evalId: string;
  experimentId: string;
  phase: LifecyclePhase;
  reason: string;
}

interface EvalEventBase {
  event: "eval";
  locator: string;
  evalId: string;
  experimentId: string;
  verdict: Verdict;
  attempts: number;
}

export type EvalEvent = EvalEventBase & (
  | { passed: number; planned?: never; unstarted?: never; reason?: never }
  | { passed?: never; planned: number; unstarted: number; reason: "early_exit" }
);

export interface KeptEvent {
  event: "kept";
  locator: string;
  evalId: string;
  attempt: number;
  verdict: Exclude<Verdict, "skipped">;
  provider: string;
  sandboxId: string;
  enter: string;
}

export interface WarningEvent {
  event: "warning";
  code: string;
  level: "warning" | "error";
  message: string;
  phase?: LifecyclePhase;
  experimentId?: string;
  evalId?: string;
}

export interface BudgetExhaustedEvent {
  event: "budget_exhausted";
  experimentId: string;
  spent: number;
  unstarted: number;
}

export interface ReporterErrorEvent {
  event: "reporter_error";
  reporter: string;
  required: boolean;
  message: string;
}

export interface InterruptedEvent {
  event: "interrupted";
}

export interface JudgePrecheckEvent {
  event: "judge_precheck";
  status: "started" | "done" | "failed";
  durationMs?: number;
}

export interface ExperimentSetupEvent {
  event: "experiment_setup";
  experimentId: string;
  status: "started" | "done" | "failed";
  durationMs?: number;
}

export interface ExperimentTeardownEvent {
  event: "experiment_teardown";
  experimentId: string;
  status: "started" | "done" | "failed";
  durationMs?: number;
}

export interface LockWaitEvent {
  event: "lock_wait";
  experimentId: string;
  evalId: string;
  status: "started" | "resolved";
  holderPid?: number;
  holderHost?: string;
  resolution?: "carried" | "dispatched";
  waitedMs?: number;
}

/** The final machine hand-off is the Record v1 receipt, without paths or snapshots. */
export interface ReceiptEvent {
  type: "receipt";
  receipt: InvocationReceipt;
}

/** `niceeval exp --json` 唯一公开事件词表；新增事件必须先进入已采纳文档与这个闭合联合。 */
export type ExpEvent =
  | StartEvent
  | ProgressEvent
  | FailureEvent
  | ErrorEvent
  | EvalEvent
  | KeptEvent
  | WarningEvent
  | BudgetExhaustedEvent
  | ReporterErrorEvent
  | InterruptedEvent
  | JudgePrecheckEvent
  | ExperimentSetupEvent
  | ExperimentTeardownEvent
  | LockWaitEvent
  | ReceiptEvent;

function writeEvent(io: FeedbackIO, event: ExpEvent): void {
  io.stdout.write(`${JSON.stringify(event)}\n`);
}

/**
 * 创建 JSON profile 的 `FeedbackRenderer`。只用 `io.stdout` 写文本——`--json` 的全部正常事件
 * 走一个 stdout sink,不拆到 stderr(两个 OS stream 被 CI runner 或 agent 工具层分开缓冲时会
 * 打乱顺序,单流才能保证事件序就是发生序)。
 */
export function createJsonRenderer(options: JsonRendererOptions): FeedbackRenderer {
  const { io } = options;

  // 距上一次「有意义的输出」(任意一次永久事件)过了多久,用来判断要不要追加一条心跳;
  // 由 appendDurable 无条件更新——"plan" 本身就是第一次永久事件,天然把这个时钟从 0 开始计。
  let lastCheckpointAtMs = 0;
  // "summary" 与 "receipt" 是 coordinator.finish() 里连续 emit 的两个独立永久事件(中间不会插入
  // 其它事件)。先暂存 summary，receipt 到达时再写 eval 结论行与唯一的最终 receipt。
  let pendingSummary: InvocationSummary | undefined;

  function noteCheckpoint(atMs: number): void {
    lastCheckpointAtMs = atMs;
  }

  return {
    appendDurable(event, state) {
      switch (event.type) {
        case "plan": {
          noteCheckpoint(event.at);
          const { shape, reused, experimentConcurrency } = event.plan;
          writeEvent(io, {
            format: EXP_STREAM_FORMAT,
            schemaVersion: SCHEMA_VERSION,
            event: "start",
            total: shape.totalAttempts,
            configs: shape.configs,
            concurrency: shape.maxConcurrency,
            // 一个实验都没声明 maxConcurrency 时省略整个字段,不输出空对象(cli.md 的 StartEvent)。
            ...(experimentConcurrency && Object.keys(experimentConcurrency).length > 0
              ? { experimentConcurrency }
              : {}),
            reused,
          });
          return;
        }

        case "failure": {
          noteCheckpoint(event.at);
          writeFailureOrError(io, event);
          return;
        }

        case "diagnostic": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, event.key)) return; // 去重后只追加一次(cli.md)
          const phase = lifecyclePhaseField(event.data?.phase);
          // `code` 是 cli.md `WarningEvent` 里那个稳定词法(`lock-taken-over` / `dispatch-halted`),
          // **不是**去重 key:去重 key 常把折叠身份编进去(`lock-taken-over:<exp>|<eval>`),原样
          // 透出会让消费方拿到一个每次运行都不同的 code、没法按值分支。折叠到哪一条实验/用例
          // 由下面的 experimentId/evalId 两个具名字段回答。
          const code = event.code ?? event.key;
          // 身份两字段:attempt 级诊断从 identity 取;运行级诊断(实验闸 / eval 闸这类不属于
          // 任何单条 attempt 的事实)不许伪造 identity,从 `data` 的同名字段取(见 ../types.ts
          // "diagnostic" 变体的 identity 注释)。
          const experimentId = event.identity?.experimentId ?? stringField(event.data?.experimentId);
          const evalId = event.identity?.evalId ?? stringField(event.data?.evalId);
          writeEvent(io, {
            event: "warning",
            code,
            level: event.severity,
            message: event.message,
            ...(phase !== undefined ? { phase } : {}),
            ...(experimentId !== undefined ? { experimentId } : {}),
            ...(evalId !== undefined ? { evalId } : {}),
          });
          return;
        }

        case "budget-exhausted": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, `budget-exhausted:${event.experimentId}`)) return;
          writeEvent(io, {
            event: "budget_exhausted",
            experimentId: event.experimentId,
            spent: event.spent,
            unstarted: event.unstarted,
          });
          return;
        }

        case "experiment-hook": {
          noteCheckpoint(event.at);
          writeEvent(io, {
            event: event.hook === "setup" ? "experiment_setup" : "experiment_teardown",
            experimentId: event.experimentId,
            status: event.status,
            ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          });
          return;
        }

        case "precheck": {
          noteCheckpoint(event.at);
          writeEvent(io, {
            event: "judge_precheck",
            status: event.status,
            ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          });
          return;
        }

        case "lock-wait": {
          noteCheckpoint(event.at);
          writeEvent(io, {
            event: "lock_wait",
            experimentId: event.experimentId,
            evalId: event.evalId,
            status: event.status,
            ...(event.holderPid !== undefined ? { holderPid: event.holderPid } : {}),
            ...(event.holderHost !== undefined ? { holderHost: event.holderHost } : {}),
            // 折叠 carried/dispatched 两个内部计数为一个公开 resolution:仍有 attempt 需要真实
            // 派发(dispatched > 0)记 "dispatched",全部由携带满足才记 "carried"
            // (见 ../types.ts 里 DurableFeedbackEvent "lock-wait" 变体的字段注释)。
            ...(event.status === "resolved"
              ? { resolution: (event.dispatched ?? 0) > 0 ? "dispatched" : "carried" }
              : {}),
            ...(event.waitedMs !== undefined ? { waitedMs: event.waitedMs } : {}),
          });
          return;
        }

        case "run-activity": {
          // Run activity 只服务 human live 面；ExpEvent 的已采纳词表没有这一种事件。
          return;
        }

        case "interrupted": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, "interrupted")) return;
          writeEvent(io, { event: "interrupted" });
          return;
        }

        case "reporter-error": {
          noteCheckpoint(event.at);
          if (!isFirstOccurrence(state, `reporter-error:${event.reporter}`)) return;
          writeEvent(io, {
            event: "reporter_error",
            reporter: event.reporter,
            required: event.required,
            message: event.message,
          });
          return;
        }

        case "summary":
          pendingSummary = event.summary;
          return;

        case "kept": {
          if (event.verdict === "skipped") {
            throw new Error("A skipped attempt cannot own a retained sandbox");
          }
          writeEvent(io, {
            event: "kept",
            locator: String(event.locator),
            evalId: event.identity.evalId,
            attempt: event.identity.attempt,
            verdict: event.verdict,
            provider: event.provider,
            sandboxId: event.sandboxId,
            enter: event.enter ?? `niceeval sandbox enter ${event.sandboxId.slice(0, 12)}`,
          });
          return;
        }

        case "receipt":
          writeEvalConclusions(io, pendingSummary, state);
          writeEvent(io, { type: "receipt", receipt: event.receipt });
          return;

        default: {
          // 穷尽性检查:新增 DurableFeedbackEvent 变体时这里编译期报错提醒补上对应分支。
          const exhaustive: never = event;
          return exhaustive;
        }
      }
    },

    onTick(event, state) {
      const idle = event.at - lastCheckpointAtMs;
      if (idle < JSON_HEARTBEAT_IDLE_MS) return;
      noteCheckpoint(event.at);
      writeEvent(io, {
        event: "progress",
        elapsedMs: event.elapsedMs,
        total: state.total,
        reused: state.reused,
        running: state.running,
        elsewhere: state.elsewhere,
        queued: state.queued,
        // 与 human 首行同一份状态、同一套划分:已了结的 attempt 按 verdict 分项,消费方不必
        // 自己从合计数里猜成败(契约见 docs/feature/experiments/cli.md 的 ProgressEvent)。
        passed: state.passed,
        failed: state.failed,
        errored: state.errored,
        skipped: state.skipped,
      });
    },

    // 没有 clearDynamic/redrawDynamic/activity/onLifecycle:见文件顶部注释——JSON 流不维护
    // 动态区域、不逐次输出 provisioning retry/backoff、不逐条展示 active phase 或 passed attempt。
  };
}

/** 某个去重 key 在 `state.diagnostics` 里是不是第一次出现(count === 1)。budget-exhausted /
 *  interrupted / reporter-error 的去重 key 计算方式与 reducer.ts 完全一致(见该文件的
 *  `budget-exhausted:${experimentId}` / `"interrupted"` / `reporter-error:${reporter}`)。 */
function isFirstOccurrence(state: RunFeedbackState, key: string): boolean {
  return (state.diagnostics.find((d) => d.key === key)?.count ?? 0) <= 1;
}

/** `data` 里的一个字符串字段;非字符串(或缺失)一律当没有,不把数字/对象硬塞进只接受
 *  字符串的事件字段里。 */
function stringField(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** 诊断 data 是 JSON 边界；只有全局 LifecyclePhase 闭集成员才能进入 WarningEvent.phase。 */
function lifecyclePhaseField(value: JsonValue | undefined): LifecyclePhase | undefined {
  switch (value) {
    case "judge.precheck":
    case "experiment.setup":
    case "experiment.teardown":
    case "sandbox.queue":
    case "sandbox.create":
    case "sandbox.prepare":
    case "sandbox.prepare.eval":
    case "sandbox.prepare.group":
    case "sandbox.prepare.experiment":
    case "agent.ensure":
    case "workspace.baseline":
    case "agent.setup":
    case "telemetry.configure":
    case "eval.run":
    case "agent.run":
    case "workspace.diff":
    case "assertions.evaluate":
    case "telemetry.collect":
    case "agent.teardown":
    case "sandbox.cleanup":
    case "sandbox.suspend":
    case "sandbox.stop":
      return value;
    default:
      return undefined;
  }
}

// ───────────────────────── failure / error 事件(不设上限) ─────────────────────────

function writeFailureOrError(io: FeedbackIO, event: DurableFeedbackEvent & { type: "failure" }): void {
  const experimentId = requiredExperimentId(event.identity.experimentId, event.identity.evalId);
  const fact = event.fact;
  if (fact !== undefined) {
    writeEvent(io, {
      event: "failure",
      locator: String(event.locator),
      evalId: event.identity.evalId,
      experimentId,
      verdict: event.verdict,
      fact: fact.title,
      ...(fact.matcher !== undefined ? { matcher: fact.matcher } : {}),
      ...(fact.expected !== undefined ? { expected: fact.expected } : {}),
      ...(fact.received !== undefined ? { received: fact.received } : {}),
    });
    return;
  }
  if (event.verdict === "errored") {
    writeEvent(io, {
      event: "error",
      locator: String(event.locator),
      evalId: event.identity.evalId,
      experimentId,
      phase: event.phase ?? "eval.run",
      reason: event.reason,
    });
    return;
  }
  writeEvent(io, {
    event: "failure",
    locator: String(event.locator),
    evalId: event.identity.evalId,
    experimentId,
    verdict: event.verdict,
    fact: event.reason,
  });
}

function requiredExperimentId(experimentId: string | undefined, evalId: string): string {
  if (experimentId === undefined) {
    throw new Error(`JSON experiment event is missing experimentId for eval ${evalId}`);
  }
  return experimentId;
}

// ───────────────────────── 逐 eval 结论行(不设上限,写在 result 之前) ─────────────────────────

/** 一条 `eval` 事件(cli.md「runs 与首过即停怎样展示」):字段随 earlyExit 是否触发在
 *  planned/unstarted/reason 与 passed 两组间二选一,不同时出现两组字段。`rate` 是
 *  `EvalConclusionRow` 派生出的额外读数,不在 `ExpEvent` 的 `EvalEvent` 形状里,这里不透出。 */
function evalConclusionEvent(row: EvalConclusionRow): EvalEvent {
  const experimentId = requiredExperimentId(row.experimentId, row.evalId);
  if (row.locator === undefined) {
    throw new Error(`JSON experiment event is missing locator for eval ${row.evalId}`);
  }
  const base: EvalEventBase = {
    event: "eval",
    locator: row.locator,
    evalId: row.evalId,
    experimentId,
    verdict: row.verdict,
    attempts: row.attempts,
  };
  if (row.reason === "early_exit") {
    if (row.planned === undefined || row.unstarted === undefined) {
      throw new Error(`Early-exit eval event is missing planned counts for eval ${row.evalId}`);
    }
    return { ...base, planned: row.planned, unstarted: row.unstarted, reason: row.reason };
  }
  if (row.passed === undefined) {
    throw new Error(`Completed eval event is missing passed count for eval ${row.evalId}`);
  }
  return { ...base, passed: row.passed };
}

function writeEvalConclusions(
  io: FeedbackIO,
  pending: InvocationSummary | undefined,
  state: RunFeedbackState,
): void {
  if (!pending) return;
  const rows = evalConclusionRows(pending.results, state.earlyExitByEval, state.diagnostics);
  for (const row of rows) writeEvent(io, evalConclusionEvent(row));
}

// ───────────────────────── 退出码(CompletionStatus 驱动) ─────────────────────────

/**
 * 把 `InvocationSummary` + `InvocationCompletion` 折成 CLI 退出码(cli.md「机器怎么读:--json」
 * 的退出码表)。纯函数,不看 CLI flag、不读 `process.env`;两种输出形态(human/json)共用同一套
 * 退出码,不是某一种 profile 专属——放在这个模块只是历史沿革(此前 `computeCiExitCode` 定义在
 * ci.ts,合并后更名为不带 profile 前缀的 `computeExitCode`)。
 *
 * 不在这里处理「2 = CLI/runner 未捕获崩溃」——那是进程级 uncaught exception/rejection 处理器
 * 的职责,不是「一次 run 正常收尾后该给什么退出码」的问题,不应该由 completion 驱动。
 */
export function computeExitCode(summary: InvocationSummary, completion: InvocationCompletion): number {
  if (completion.status === "interrupted") return 130;
  if (completion.status === "incomplete") return 1;
  if (completion.reporterErrors.some((e) => e.required)) return 1;
  return summary.failed > 0 || summary.errored > 0 ? 1 : 0;
}

// ───────────────────────── `--dry --json`:单个 ExpPlanDocument,不是流 ─────────────────────────

/** 一个 (experiment, eval) 组合在 `ExpPlanDocument.matrix` 里的一行(cli.md「`--dry --json`
 *  输出单个 `ExpPlanDocument`」)。 */
/** 一条具名差异的机器面投影(`ExpPlanDelta`);selector 只解释本次指纹变化。 */
export interface JsonPlanDelta {
  /** 指纹差异词表:`config:<路径>` / `source:<路径>` / `data:<路径>` / `opaque:no-manifest`。 */
  selector: string;
  /** 差异方向。`unknown` 表示历史 manifest 缺失，无法列出具体值。 */
  kind: "added" | "removed" | "changed" | "unknown";
  /** 值或内容哈希的有界摘要;opaque 与新增/删除侧按缺省略。 */
  from?: string;
  to?: string;
}

export interface JsonPlanFingerprintComparisonChanged {
  kind: "changed";
  deltas: [JsonPlanDelta, ...JsonPlanDelta[]];
}

export interface JsonPlanFingerprintComparisonUnexplained {
  kind: "unexplained";
  diagnostic: JsonPlanDiagnostic;
}

export type JsonPlanDiagnosticFact =
  | { label: string; value: JsonValue }
  | { label: string; from: JsonValue; to: JsonValue };

export interface JsonPlanDiagnostic {
  /** producer 命名空间内的开放 code；消费者不得按当前已知值穷举。 */
  code: string;
  /** 不依赖 code 才能读懂的单句摘要。 */
  summary: string;
  facts?: JsonPlanDiagnosticFact[];
  /** 省略=不可比较，[]=可比较字段未观察到差异，非空=观察到具名差异。 */
  observedDeltas?: JsonPlanDelta[];
  limitations?: string[];
  causes?: JsonPlanDiagnostic[];
}

export type JsonPlanFingerprintComparison =
  | JsonPlanFingerprintComparisonChanged
  | JsonPlanFingerprintComparisonUnexplained;

/** 本行要派发的 attempt 按未携带原因分组(`ExpPlanDispatch`);gate 词表与六道门同名。 */
export interface JsonPlanDispatch {
  gate: "fingerprint" | "terminal" | "eligibility" | "rerun" | "mode" | "missing";
  /** 这组原因覆盖的 attempt 序号。 */
  attempts: number[];
  /** 指纹门的比较解释；其它 gate 省略。 */
  comparison?: JsonPlanFingerprintComparison;
}

export interface JsonPlanRow {
  experimentId: string;
  evalId: string;
  evalGroupId?: string;
  /** 命中缓存指纹,本次不会派发新 attempt。 */
  reused: boolean;
  /** previous-result 历史结果。`acceptance: legacy-locator` 表示旧 locator 不符合当前命令语法，不能接受。 */
  prior?: readonly {
    locator: string;
    verdict: "passed" | "failed" | "errored" | "skipped";
    acceptance: "available" | "legacy-locator";
    evidenceState: "local" | "borrowed" | "dangling";
  }[];
  /** 本行要派发的 attempt 按未携带原因分组;全部携带时省略。 */
  dispatch?: JsonPlanDispatch[];
  /** 该用例正被另一条并行 Invocation 持锁运行,真实运行时将等待后携带或补跑(见
   *  docs/feature/experiments/architecture.md「并发 Invocation:用例锁」)。`--dry` 只读锁
   *  目录,不取锁、不等待;省略等于 `false`(JSON.stringify 丢弃 `undefined` 属性,
   *  天然满足这条省略语义,不需要显式写 `locked: false`)。 */
  locked?: boolean;
}

export interface JsonPlanInput {
  /** 与 `start` 事件同一口径的总 attempt 数。 */
  total: number;
  /** 去重后的 eval 数。 */
  evals: number;
  /** (agent, model, flags) 配置组合数。 */
  configs: number;
  /** 代表性的 `--attempts` 值(多个实验取值不同时,展示层不逐配置拆分——见 cli.md 未声明混合 attempts
   *  场景的展示规则,这里与 human/agent 既有的 dry 预览取同一个近似口径:最大值)。 */
  attempts: number;
  matrix: readonly JsonPlanRow[];
  /** 只在 `--dry --commands` 出现；普通 `--dry --json` 仍只给选择/carry 矩阵。 */
  commandPlan?: CommandPlan;
}

/**
 * `--dry --json`(cli.md:「一次完成的读取,不是事件流」)。dry run 不派发 attempt,没有
 * `RunFeedbackState` 可言,这是独立于 `FeedbackRenderer`/coordinator 的纯函数。
 */
export function renderJsonPlanDocument(input: JsonPlanInput): string {
  const reused = input.matrix.reduce((n, row) => n + (row.reused ? 1 : 0), 0);
  return `${JSON.stringify({
    format: EXP_PLAN_FORMAT,
    schemaVersion: EXP_PLAN_SCHEMA_VERSION,
    total: input.total,
    evals: input.evals,
    configs: input.configs,
    attempts: input.attempts,
    reused,
    matrix: input.matrix,
    ...(input.commandPlan === undefined ? {} : { commandPlan: input.commandPlan }),
  })}\n`;
}
