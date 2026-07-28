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
  InvocationSummary,
  LifecyclePhase,
  RunFeedbackState,
} from "../types.ts";
import { evalConclusionRows, type EvalConclusionRow } from "./eval-conclusions.ts";

/** `ExpEvent`/`ExpPlanDocument` 的 `format`/`schemaVersion` —— 只在破坏性形状变更时递增
 *  (见 cli.md「事件与计划文档的 TypeScript 形状」)。 */
const EXP_STREAM_FORMAT = "niceeval.exp";
const EXP_PLAN_FORMAT = "niceeval.exp-plan";
const SCHEMA_VERSION = 1;

/** 连续无永久事件多久才追加一条 `progress` 心跳(cli.md「机器怎么读:--json」:「连续 30 秒
 *  没有这些永久事件,才追加一条 progress 心跳」——两者合并前分别是 30s/60s,统一取 30s)。 */
const JSON_HEARTBEAT_IDLE_MS = 30_000;

export interface JsonRendererOptions {
  io: FeedbackIO;
}

/** JSON 值:与 Record run.json 的 `JsonValue` 同一定义(见 cli.md)。 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function writeEvent(io: FeedbackIO, event: globalThis.Record<string, JsonValue | undefined>): void {
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
  // "summary" 与 "saved" 是 coordinator.finish() 里连续 emit 的两个独立永久事件(中间不会插入
  // 其它事件)——`result` 收尾需要两者合并,所以 "summary" 到达时先记下来,"saved" 到达时才
  // 真正写出 eval 结论行 + `result` 事件。
  let pendingSummary: { summary: InvocationSummary; completion: InvocationCompletion; reused: number } | undefined;

  function noteCheckpoint(atMs: number): void {
    lastCheckpointAtMs = atMs;
  }

  return {
    appendDurable(event, state) {
      switch (event.type) {
        case "plan": {
          noteCheckpoint(event.at);
          const { shape, reused } = event.plan;
          writeEvent(io, {
            format: EXP_STREAM_FORMAT,
            schemaVersion: SCHEMA_VERSION,
            event: "start",
            total: shape.totalAttempts,
            configs: shape.configs,
            concurrency: shape.maxConcurrency,
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
          const phase = typeof event.data?.phase === "string" ? (event.data.phase as LifecyclePhase) : undefined;
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
          pendingSummary = { summary: event.summary, completion: event.completion, reused: state.reused };
          return;

        case "kept": {
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

        case "saved":
          writeEvalConclusions(io, pendingSummary, state);
          writeResultEvent(io, pendingSummary, event);
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
        unreadable: state.unreadable,
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

// ───────────────────────── failure / error 事件(不设上限) ─────────────────────────

function writeFailureOrError(io: FeedbackIO, event: DurableFeedbackEvent & { type: "failure" }): void {
  if (event.verdict === "errored") {
    writeEvent(io, {
      event: "error",
      locator: String(event.locator),
      evalId: event.identity.evalId,
      ...(event.identity.experimentId !== undefined ? { experimentId: event.identity.experimentId } : {}),
      phase: event.phase ?? "eval.run",
      reason: event.reason,
    });
    return;
  }
  const a = event.assertion;
  writeEvent(io, {
    event: "failure",
    locator: String(event.locator),
    evalId: event.identity.evalId,
    ...(event.identity.experimentId !== undefined ? { experimentId: event.identity.experimentId } : {}),
    severity: a?.severity ?? "gate",
    assertion: a?.assertion ?? event.reason,
    ...(a?.matcher !== undefined ? { matcher: a.matcher } : {}),
    ...(a?.expected !== undefined ? { expected: a.expected } : {}),
    ...(a?.received !== undefined ? { received: a.received } : {}),
  });
}

// ───────────────────────── 逐 eval 结论行(不设上限,写在 result 之前) ─────────────────────────

/** 一条 `eval` 事件(cli.md「runs 与首过即停怎样展示」):字段随 earlyExit 是否触发在
 *  planned/unstarted/reason 与 passed 两组间二选一,不同时出现两组字段。`rate` 是
 *  `EvalConclusionRow` 派生出的额外读数,不在 `ExpEvent` 的 `EvalEvent` 形状里,这里不透出。 */
function evalConclusionEvent(row: EvalConclusionRow): globalThis.Record<string, JsonValue | undefined> {
  return {
    event: "eval",
    ...(row.locator !== undefined ? { locator: row.locator } : {}),
    evalId: row.evalId,
    ...(row.experimentId !== undefined ? { experimentId: row.experimentId } : {}),
    verdict: row.verdict,
    attempts: row.attempts,
    ...(row.reason !== undefined
      ? { planned: row.planned!, unstarted: row.unstarted!, reason: row.reason }
      : { passed: row.passed! }),
  };
}

function writeEvalConclusions(
  io: FeedbackIO,
  pending: { summary: InvocationSummary; completion: InvocationCompletion; reused: number } | undefined,
  state: RunFeedbackState,
): void {
  if (!pending) return;
  const rows = evalConclusionRows(pending.summary.results, state.earlyExitByEval, state.diagnostics);
  for (const row of rows) writeEvent(io, evalConclusionEvent(row));
}

// ───────────────────────── result 收尾 ─────────────────────────

/** completion 优先于 verdict 计数——interrupted/incomplete 时即便全部 attempt 都通过,也不能
 *  说 "passed"(cli.md「事件与计划文档的 TypeScript 形状」的 `ResultEvent.status` 注释)。
 *  required reporter 失败同样折进 "failed":它不是 `CompletionStatus` 的第四个值,但必须让
 *  退出码非零、状态词不能显示一个会被误读成「全绿」的 "passed"。 */
function resultStatusWord(
  summary: InvocationSummary,
  completion: InvocationCompletion,
): "passed" | "failed" | "incomplete" | "interrupted" {
  if (completion.status === "interrupted") return "interrupted";
  if (completion.status === "incomplete") return "incomplete";
  if (completion.reporterErrors.some((e) => e.required)) return "failed";
  return summary.failed > 0 || summary.errored > 0 ? "failed" : "passed";
}

function writeResultEvent(
  io: FeedbackIO,
  pending: { summary: InvocationSummary; completion: InvocationCompletion; reused: number } | undefined,
  event: DurableFeedbackEvent & { type: "saved" },
): void {
  if (!pending) return; // 不应发生:coordinator.finish() 恒先 emit "summary" 再 emit "saved"。
  const { summary, completion, reused } = pending;
  writeEvent(io, {
    event: "result",
    status: resultStatusWord(summary, completion),
    passed: summary.passed,
    failed: summary.failed,
    errored: summary.errored,
    ...(reused > 0 ? { reused } : {}),
    ...(completion.unstarted > 0 ? { unstarted: completion.unstarted } : {}),
    completion: completion.status,
    runs: [...event.paths],
    ...(event.junit !== undefined ? { junit: event.junit } : {}),
  });
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
export interface JsonPlanRow {
  experimentId: string;
  evalId: string;
  /** 命中缓存指纹,本次不会派发新 attempt。 */
  reused: boolean;
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
  /** 代表性的 `--runs` 值(多个实验取值不同时,展示层不逐配置拆分——见 cli.md 未声明混合 runs
   *  场景的展示规则,这里与 human/agent 既有的 dry 预览取同一个近似口径:最大值)。 */
  attempts: number;
  matrix: readonly JsonPlanRow[];
}

/**
 * `--dry --json`(cli.md:「一次完成的读取,不是事件流」)。dry run 不派发 attempt,没有
 * `RunFeedbackState` 可言,这是独立于 `FeedbackRenderer`/coordinator 的纯函数。
 */
export function renderJsonPlanDocument(input: JsonPlanInput): string {
  const reused = input.matrix.reduce((n, row) => n + (row.reused ? 1 : 0), 0);
  return `${JSON.stringify({
    format: EXP_PLAN_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    total: input.total,
    evals: input.evals,
    configs: input.configs,
    attempts: input.attempts,
    reused,
    matrix: input.matrix,
  })}\n`;
}
