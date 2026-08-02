// Human profile renderer(见 docs/feature/experiments/cli.md「人在终端里怎么用」)。
//
// 两个变体,由 `io.stderr.isTTY` 在构造时选一次(profile 是消费者模型,TTY 只是传输能力 ——
// 不加 `--json` 在非 TTY 下仍是人读文本,只是退化成纯追加文案,不悄悄变成 `--json` 语义):
//
// - TTY:动态 dashboard(命令/elapsed/守恒计数/cost/active slots)覆盖重画,永久事件走
//   clear → append → redraw(coordinator 保证顺序,这里只需正确实现三个钩子)。
// - 非 TTY:零 ANSI 的单一有序 stdout 追加流 —— 只有 start(plan 永久事件天然充当)、永久事件、
//   运行级瞬时通知、以及连续 30 秒无永久事件时的一条 heartbeat;不追踪 active slot,不重画。
//
// 两个变体共用同一份「永久事件 → 文本行」的纯函数(renderDurableLines 及其子函数),保证
// 完成页/失败行/诊断行的实际文案在两种模式下完全一致,只有「要不要用 ANSI 维护一块动态区域」
// 不同 —— 不是两套平行的文案实现。
//
// 完成页(summary/saved 两个永久事件)不再调用 `./reporters/table.ts` 的 `renderRunReport()`
// 大表:失败优先摘要 + locator + show/view 下一步 + 折叠后的快照路径,完整对比留给
// `niceeval show` / `niceeval view`(见 docs 的「人看的结束反馈」)。

import { t } from "../../i18n/index.ts";
import { verdictSymbol } from "../reporters/shared.ts";
import { formatCost } from "../../shared/format.ts";
import { assertionSummaryLines } from "../../assertions/display.ts";
import { encodeAttemptKey, HALT_DIAGNOSTIC_CODE } from "../types.ts";
import {
  panelCapabilityOf as panelCapability,
  panelContentWidth,
  renderPanel,
  type PanelMode,
  type PanelRow,
} from "../../report/model/panel.ts";
import { stringWidth } from "../../report/model/text-layout.ts";
import type {
  ActiveAttempt,
  ActiveExperimentHook,
  ActiveLockWait,
  ActivePrecheck,
  ActiveRunActivity,
  AttemptKey,
  ExperimentHookName,
  LifecyclePhase,
  DurableFeedbackEvent,
  RunFeedbackPlan,
  RunFeedbackState,
} from "../types.ts";
import type { FeedbackRenderer } from "./renderer.ts";
import type { FeedbackIO } from "./io.ts";

/** live/结束面板的传输能力(docs/feature/reports/library/layout.md「区域框」):是 TTY 且
 *  没有要求朴素输出(`NO_COLOR`)时才画框——`io.env` 而不是直接读 `process.env`,保持
 *  profile renderer 可用假 IO 确定性测试。 */
function panelCapabilityForFeedback(io: FeedbackIO): { mode: PanelMode; width: number } {
  return panelCapability({ isTTY: io.stderr.isTTY, noColor: io.env.NO_COLOR, width: io.stderr.columns });
}

/** 失败/errored 默认展开上限(见 cli.md「'立即追加'也必须有上限」表:human 前 10 条)。 */
const HUMAN_FAILURE_CAP = 10;
/** 快照结果路径超过这个数量才折叠成「前 N 个 + … 还有 M 个」,不是 cli.md 的强制数字 ——
 *  docs 的两个完成页示例(FAILED / PASSED)对同样 5 条路径给了两种不同的排版,契约本身只要求
 *  「多时折叠,不逐行刷满几十个」,这里选一个单一、可预测的算法同时满足两边。 */
const RESULTS_PATH_CAP = 3;
/** 非 TTY human 退化流的空闲 heartbeat 阈值(见 cli.md「什么动态更新,什么逐条追加」表)。 */
const NON_TTY_HEARTBEAT_IDLE_MS = 30_000;
/** dashboard 高度预留:避免最后一行触发终端自动滚动(与 live.ts 旧实现的 `rows - 2` 同一动机,
 *  这里只需要给「下一帧」留出一行余地,不需要额外的表头/尾行预留)。 */
const DASHBOARD_ROW_RESERVE = 1;

export interface HumanRendererOptions {
  io: FeedbackIO;
  /** dashboard 首行的命令名(如 "niceeval exp compare");CLI 层按 argv 拼好传入 —— renderer
   *  不解析 argv,不重新发明「这次跑的是什么命令」。 */
  command: string;
}

/** 按 `io.stderr.isTTY` 派发:构造时选一次,运行期不再切换。 */
export function createHumanRenderer(options: HumanRendererOptions): FeedbackRenderer {
  const { io, command } = options;
  return io.stderr.isTTY ? createDashboardRenderer(io, command) : createPlainRenderer(io);
}

// ───────────────────────── 共享:永久事件 → 文本行(纯函数,两种模式同一份文案) ─────────────────────────

/** 一条永久事件 → 待写入的整行文本(不含结尾换行,调用方统一 join("\n") + "\n")。
 *  空数组表示这个事件类型在 human 下没有可见内容(目前没有这种情形,保留以防未来扩展)。
 *  `panel` 是面板的传输能力(见 `panelCapabilityOf`)——只有面板体裁(plan/summary/saved)
 *  消费它;流事件(failure/diagnostic/…)不画框,不需要这份能力。 */
export function renderDurableLines(
  event: DurableFeedbackEvent,
  state: RunFeedbackState,
  panel: { mode: PanelMode; width: number },
): string[] {
  switch (event.type) {
    case "plan":
      return buildPlanLines(event.plan, panel);
    case "failure": {
      // 立即追加也要遵守展开上限(见 cli.md「'立即追加'也必须有上限,防止失败风暴重新淹没
      // 输出」)。reducer 已经把这一条计入 state.failures(emit() 先 reduce 再入队),所以
      // freshFailureCount 就是「本次新发生且算上这一条」的累计数；plan 静态注入的复用失败
      // 不消耗流式上限。越过上限
      // 的第一条给一次 suppressed 提示(让人立刻知道开始折叠了);再往后的每一条都静默 ——
      // 不然「追加一次」会变成每条失败都重复一遍「还剩多少条」,完成页的 FAILURES 区块才是
      // 最终准确总数的权威来源。
      const count = state.freshFailureCount;
      if (count <= HUMAN_FAILURE_CAP) return [buildFailureLine(event)];
      if (count === HUMAN_FAILURE_CAP + 1) {
        return [t("feedback.human.suppressedFailures", { count: 1 })];
      }
      return [];
    }
    case "diagnostic":
      return buildDiagnosticLines(event, state);
    case "budget-exhausted":
      return [
        `! ${t("feedback.human.budgetExhausted", {
          experimentId: event.experimentId,
          spent: event.spent.toFixed(2),
          unstarted: event.unstarted,
        })}`,
      ];
    case "interrupted":
      return [t("runner.interrupted").trimEnd()];
    case "reporter-error":
      return [t("runner.reporterDiagnostic", { stage: event.reporter, message: event.message }).trimEnd()];
    case "kept":
      // 留存授予单条不即时打印;run 摘要后由 buildSummaryLines 汇总成 Kept sandboxes 块
      // (见 docs/feature/sandbox/cli.md「run 收尾输出」)。
      return [];
    case "experiment-hook": {
      // 只服务非 TTY 退化流(TTY dashboard 的 appendDurable 对这个事件直接返回,运行级行
      // 由 state.experimentHooks 驱动,成功钩子不进 scrollback,见 cli.md「实验级 Hook 的显示」)。
      const label = experimentHookLabel(event.hook);
      const duration = event.durationMs !== undefined ? ` (${formatElapsed(event.durationMs)})` : "";
      const recoverySuffix = event.recovery ? ` (recovery)` : "";
      if (event.status === "started") return [`${label} · ${event.experimentId}${recoverySuffix}`];
      const statusWord =
        event.status === "done" ? t("feedback.human.hookDone") : t("feedback.human.hookFailed");
      return [`${label} ${statusWord} · ${event.experimentId}${duration}`];
    }
    case "precheck": {
      // 只服务非 TTY 退化流(TTY dashboard 的 appendDurable 对这个事件直接返回,运行级行
      // 由 state.activePrecheck 驱动,不进 scrollback,见 cli.md「judge 预检的显示」)。
      if (event.status === "started") return [t("feedback.human.precheckJudge")];
      const duration = event.durationMs !== undefined ? ` (${formatElapsed(event.durationMs)})` : "";
      // failed 只说预检本身的结局:受影响 eval 逐条的 errored 由随后的 failure 事件解释,
      // 这行不重复它们(见 cli.md「判分预检的显示」)。
      const word =
        event.status === "done" ? t("feedback.human.precheckJudgeDone") : t("feedback.human.precheckJudgeFailed");
      return [`${word}${duration}`];
    }
    case "lock-wait": {
      // 只服务非 TTY 退化流(TTY dashboard 的 appendDurable 对这个事件直接返回,运行级行由
      // state.lockWaits 驱动,不进 scrollback,见 cli.md「等待并发 run 的显示」)。按实验聚合
      // ——同一实验可能有多个用例先后撞锁,只在这个「有等待用例」窗口第一次打开(这是当前
      // 唯一一条等待中的用例)与最后一次关闭(等待全部解决)各打印一行,中途加入/解决的用例
      // 不逐条刷屏,与诊断按 dedupeKey 折叠同一种克制(state 已经是这条事件 reduce 之后的
      // 快照,size 天然反映"这条事件之后"的计数)。
      const agg = state.lockWaits.get(event.experimentId);
      if (event.status === "started") {
        if (!agg || agg.waiting.size !== 1) return []; // 不是这个窗口的第一条,静默
        const holder = agg.waiting.get(event.evalId);
        return [
          t("feedback.human.lockWaitStarted", {
            experimentId: event.experimentId,
            count: agg.waiting.size,
            pid: holder?.holderPid ?? "?",
          }),
        ];
      }
      if (!agg || agg.waiting.size !== 0) return []; // 窗口还没关闭,静默
      const parts: string[] = [];
      if (agg.resolvedCarried > 0) parts.push(t("feedback.human.lockWaitCarried", { count: agg.resolvedCarried }));
      if (agg.resolvedDispatched > 0) {
        parts.push(t("feedback.human.lockWaitDispatched", { count: agg.resolvedDispatched }));
      }
      const summary = parts.length > 0 ? parts.join(" · ") : t("feedback.human.lockWaitCarried", { count: 0 });
      return [
        t("feedback.human.lockWaitResolved", {
          experimentId: event.experimentId,
          summary,
          elapsed: formatElapsed(event.waitedMs ?? 0),
        }),
      ];
    }
    case "run-activity": {
      // 只服务非 TTY 退化流(TTY dashboard 由 state.runActivities 驱动运行级行)。
      // 人读文本用 producer 的 label,不查 LifecyclePhase 锚点表;未知 key 同样通用投影。
      const duration = event.durationMs !== undefined ? ` (${formatElapsed(event.durationMs)})` : "";
      if (event.status === "started") return [event.label];
      const statusWord =
        event.status === "done" ? t("feedback.human.hookDone") : t("feedback.human.hookFailed");
      return [`${event.label} ${statusWord}${duration}`];
    }
    case "summary":
      return buildSummaryLines(event, state, panel);
    case "saved":
      return buildSavedLines(event, state, panel);
    default: {
      // 穷尽性检查:新增 DurableFeedbackEvent 变体时这里编译期报错提醒补上对应分支。
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/**
 * 把一条永久事件的渲染行写到正确的流(见 docs/feature/experiments/cli.md「输出流和落盘节奏」
 * 的流边界表)。TTY 与非 TTY 两个变体在这里分岔,共用同一份「事件 → 文本行」的纯函数:
 *
 * - TTY(`allStdout: false`):`stdout` 只留给"最终摘要与结果路径"("summary"/"saved" 两个
 *   事件);计划、失败、诊断等其它永久事件与 live 面板本身都在 `stderr`。
 * - 非 TTY(`allStdout: true`):从 start 到结束摘要是单一有序的 `stdout` 追加流,`stderr` 只留
 *   给启动期用法/配置错误——两个 OS stream 被 CI runner 或 agent 工具层分开缓冲时会打乱顺序,
 *   单流才能保证事件序就是发生序(见 memory/exp-output-two-forms-ruling.md 的补充裁决)。
 */
function writeDurable(io: FeedbackIO, event: DurableFeedbackEvent, state: RunFeedbackState, allStdout: boolean): void {
  const lines = renderDurableLines(event, state, panelCapabilityForFeedback(io));
  if (lines.length === 0) return;
  const text = `${lines.join("\n")}\n`;
  if (allStdout || event.type === "summary" || event.type === "saved") io.stdout.write(text);
  else io.stderr.write(text);
}

/** `PLAN` 面板(docs/feature/experiments/cli.md「运行中的 live 面板」):规模一行 + 复用一行
 *  (全新派发时省略),经 panel.ts 画框——面板体裁全仓只有一个渲染件,这里不手拼 `╭─`。 */
function buildPlanLines(plan: RunFeedbackPlan, panel: { mode: PanelMode; width: number }): string[] {
  // 实验闸让声明了 maxConcurrency 的实验的有效宽度小于全局值:只印全局值会被读成
  // 「这批要开 19 路」。逐个附注在全局值之后(`concurrency 19 · mempal ≤1 · nowledge ≤4`),
  // 未声明的实验不列(见 docs/feature/experiments/cli.md「运行中的 live 面板」)。
  const experimentConcurrency = Object.entries(plan.experimentConcurrency ?? {});
  const concurrencyNotes = experimentConcurrency
    .map(([experimentId, limit]) => t("feedback.human.planExperimentConcurrency", { experimentId, limit }))
    .join(" · ");
  const rows: PanelRow[] = [
    {
      kind: "line",
      text:
        t("feedback.human.plan", {
          total: plan.shape.totalAttempts,
          evals: plan.shape.evals,
          configs: plan.shape.configs,
          concurrency: plan.shape.maxConcurrency,
        }) + (concurrencyNotes ? ` · ${concurrencyNotes}` : ""),
    },
  ];
  if (plan.reused > 0) {
    rows.push({
      kind: "line",
      text: t("feedback.human.reuse", {
        reused: plan.reused,
        total: plan.shape.totalAttempts,
        toRun: Math.max(0, plan.shape.totalAttempts - plan.reused),
      }),
    });
  }
  return renderPanel({ title: t("feedback.human.planHeader"), rows, width: panel.width, mode: panel.mode });
}

function buildFailureLine(event: DurableFeedbackEvent & { type: "failure" }): string {
  const phaseSuffix = event.phase ? ` · ${phaseLabel(event.phase)}` : "";
  const summary = event.assertion ? assertionSummaryLines(event.assertion) : [event.reason];
  const body = summary.map((line, index) => `${index === 0 ? "    " : "        "}${line}`).join("\n");
  return `${verdictSymbol(event.verdict)} ${event.locator} ${event.identity.evalId} [${event.who}]${phaseSuffix}\n${body}`;
}

function buildDiagnosticLines(event: DurableFeedbackEvent & { type: "diagnostic" }, state: RunFeedbackState): string[] {
  // count 从 state.diagnostics 读(reducer 已经按 key 去重累加),不在这里自己维护第二份计数。
  const count = state.diagnostics.find((d) => d.key === event.key)?.count ?? 1;
  const sym = event.severity === "error" ? "✗" : "!";
  if (event.code === HALT_DIAGNOSTIC_CODE) {
    // 止损闸落闸:一行 error 级通知,文案已经是完整的一句话(`experiment halted
    // (dispatch-halted): <message>` / `eval halted: <message>`,见 docs/feature/
    // error-classification/architecture.md「观察面」),不再加标题行、也不加 ×N 后缀——
    // emitter 对每条未派发 attempt 都刷一次这条诊断以更新 data.unstarted,逐次打印就是
    // 同一页文档明令禁止的「被中止的等待集 attempt 逐条刷屏」;未派发的数量由完成状态的
    // `unstarted` 回答,不在这行重复。因此只在第一次出现时落一行(与 json profile 的
    // isFirstOccurrence 同一条去重纪律)。
    if (count > 1) return [];
    return [`${sym} ${event.message}`];
  }
  // 标题用稳定词法(`code`),不是把折叠身份一起编进去的去重 key —— 人读的一行要能一眼认出
  // 「这是哪一类诊断」,`compare/codex|memory/x` 那串身份属于 message 与机器面的具名字段。
  const suffix = count > 1 ? ` (${count} attempts)` : "";
  // 阶段标签走与失败行(`buildFailureLine`)同一个 `phaseLabel()` 投影:「在哪一步降级的」是
  // 读者的第一个问题,message 里未必答得上。attempt 级诊断的 phase 由运行器写进 `data`
  // (见 attempt.ts 的 recordDiagnostic);运行级诊断(止损闸、锁接管、budget)不属于任何
  // 单条 attempt,天然没有 phase,标题退化成只有 code 一段。
  const phase = typeof event.data?.phase === "string" ? (event.data.phase as LifecyclePhase) : undefined;
  const heading = phase !== undefined ? `${phaseLabel(phase)} · ${event.code ?? event.key}` : (event.code ?? event.key);
  return [`${sym} ${heading}${suffix}`, `  ${event.message}`];
}

/** 结束结论(`FAILED`/`PASSED`/…)+ `FAILURES`(有失败才出现)+ `KEPT SANDBOXES`(有留存才
 *  出现)——三个各自独立的面板,用空行分隔(docs/feature/experiments/cli.md「人看的结束反馈」、
 *  docs/feature/sandbox/cli.md「run 收尾输出」)。`NEXT` 面板不在这里:它要等 `saved` 事件
 *  的落盘路径,见 `buildSavedLines`。 */
function buildSummaryLines(
  event: DurableFeedbackEvent & { type: "summary" },
  state: RunFeedbackState,
  panel: { mode: PanelMode; width: number },
): string[] {
  const { summary, completion } = event;
  const fullReuse = state.total > 0 && state.total === state.reused;
  // required reporter(默认 artifacts、显式 --json/--junit)写失败必须让这行判红——它不是
  // CompletionStatus 的第四个值(那个枚举只有 complete/incomplete/interrupted 三态),但和
  // ci.ts 的 resultStatusWord() 同一个判断顺序:不能让人看到一句会被误读成"全绿"的 PASSED,
  // 而进程实际以非零退出(见 computeCiExitCode 对 reporterErrors 的同一条判断)。
  const verdictWord =
    completion.status === "interrupted"
      ? t("feedback.human.resultInterrupted")
      : completion.status === "incomplete"
        ? t("feedback.human.resultIncomplete")
        : summary.failed > 0 || summary.errored > 0 || completion.reporterErrors.some((e) => e.required)
          ? t("feedback.human.resultFailed")
          : t("feedback.human.resultPassed");

  const summaryRows: PanelRow[] = [
    {
      kind: "line",
      text: t(fullReuse ? "feedback.human.summaryAllReusedLine" : "feedback.human.summaryLine", {
        passed: summary.passed,
        failed: summary.failed,
        errored: summary.errored,
        reused: state.reused,
      }),
    },
    { kind: "line", text: formatSummaryCostLine(state) },
  ];
  const blocks: string[][] = [
    renderPanel({ title: verdictWord, meta: formatElapsed(summary.durationMs), rows: summaryRows, width: panel.width, mode: panel.mode }),
  ];

  // 全通过时(state.failures 为空)不留空 FAILURES 面板。fresh 失败来自 durable event，carry
  // 失败由 plan 静态注入；reducer 把两者按 locator 收进同一清单，这里不从 InvocationSummary 再造。
  if (state.failures.length > 0) {
    const shown = state.failures.slice(0, HUMAN_FAILURE_CAP);
    const failureRows: PanelRow[] = [
      { kind: "line", text: shown.map((f) => buildFailureLine({ ...f, type: "failure" })).join("\n\n") },
    ];
    if (state.failures.length > HUMAN_FAILURE_CAP) {
      failureRows.push({
        kind: "line",
        text: t("feedback.human.suppressedFailures", { count: state.failures.length - HUMAN_FAILURE_CAP }),
      });
    }
    const meta =
      state.failures.length > HUMAN_FAILURE_CAP
        ? `${state.failures.length} total · showing ${HUMAN_FAILURE_CAP}`
        : undefined;
    blocks.push(
      renderPanel({ title: t("feedback.human.failuresHeader"), meta, rows: failureRows, width: panel.width, mode: panel.mode }),
    );
  }

  // 留存授予块(--keep-sandbox,见 docs/feature/sandbox/cli.md「run 收尾输出」):
  // 每条给 locator(接 niceeval show)、provider 与实例 id、进入现场的命令,下边框嵌批量清理。
  if (state.kept.length > 0) {
    const keptRows: PanelRow[] = [];
    for (const k of state.kept) {
      keptRows.push({
        kind: "line",
        text: `${k.locator}  ${k.identity.evalId} #${k.identity.attempt}  ${k.verdict}  ${k.provider} · ${k.sandboxId}`,
      });
      keptRows.push({
        kind: "line",
        text: `${" ".repeat(stringWidth(k.locator) + 2)}enter: niceeval sandbox enter ${k.sandboxId.slice(0, 12)}`,
      });
    }
    blocks.push(
      renderPanel({
        title: t("feedback.human.keptSandboxesHeader"),
        meta: `${state.kept.length} kept`,
        footerCommand: "niceeval sandbox stop --all",
        rows: keptRows,
        width: panel.width,
        mode: panel.mode,
      }),
    );
  }

  return blocks.flatMap((block, i) => (i === 0 ? block : ["", ...block]));
}

/** `NEXT` 面板(docs/feature/experiments/cli.md「人看的结束反馈」):下钻命令(只给第一条
 *  失败做示范)+ `Compare:`,再加一条嵌套 `RESULTS` 横隔带出本次落盘的快照路径——两部分
 *  在旧实现里分属两个事件(summary 的下钻命令 / saved 的路径),现在合成同一个面板,
 *  借 `state.failures` 在 `saved` 事件触发时仍然可读(reducer 早已把失败收进 state)。 */
function buildSavedLines(
  event: DurableFeedbackEvent & { type: "saved" },
  state: RunFeedbackState,
  panel: { mode: PanelMode; width: number },
): string[] {
  const rows: PanelRow[] = [];
  const first = state.failures[0];
  if (first) {
    rows.push({ kind: "line", text: t("feedback.human.inspect", { locator: first.locator }) });
    rows.push({ kind: "line", text: t("feedback.human.evalHint", { locator: first.locator }) });
    rows.push({ kind: "line", text: t("feedback.human.trace", { locator: first.locator }) });
    rows.push({ kind: "line", text: t("feedback.human.diffHint", { locator: first.locator }) });
  }
  // 比较命令直接是 `niceeval view`——它读整个结果根,不需要(也不该被)目录路径收窄成
  // 一个 eval 位置参数(那是选择语义,不是报告分组语义);见 docs/feature/experiments/cli.md。
  rows.push({ kind: "line", text: t("feedback.human.compare") });

  const paths = event.paths;
  if (paths.length > 0) {
    rows.push({ kind: "divider", title: t("feedback.human.resultsHeader") });
    for (const p of paths.slice(0, RESULTS_PATH_CAP)) rows.push({ kind: "line", text: p });
    if (paths.length > RESULTS_PATH_CAP) {
      rows.push({ kind: "line", text: t("feedback.human.resultsMore", { count: paths.length - RESULTS_PATH_CAP }) });
    }
  }
  return renderPanel({ title: t("feedback.human.nextHeader"), rows, width: panel.width, mode: panel.mode });
}

/** tok/cost 一行(不含时长——时长已经嵌在面板上边框右侧的 meta 里,不在正文里重复一遍)。 */
function formatSummaryCostLine(state: RunFeedbackState): string {
  const fullReuse = state.total > 0 && state.total === state.reused;
  if (fullReuse) return "0 new tok · $0.00";
  const parts: string[] = [];
  if (state.newTokenCount !== undefined) parts.push(`${formatTokenCount(state.newTokenCount)} new tok`);
  const cost = formatCost(state.estimatedCostUSD);
  if (cost !== "—") parts.push(cost);
  return parts.join(" · ");
}

// ───────────────────────── 共享:纯格式化 helper ─────────────────────────

/** "2m 14s" / "54s" 风格,匹配 cli.md 全部 dashboard/完成页示例;`shared/format.ts` 的
 *  `formatDuration` 是 "2.3m"/"120ms" 风格,服务的是 view/表格场景,不是这里要的格式。 */
export function formatElapsed(ms: number): string {
  const totalS = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** "1.2M tok" / "3.4k" 风格;`table.ts` 的 `formatTokens` 只到 k 档,凑不出 cli.md 完成页
 *  示例里的 "1.2M tok"。 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** LifecyclePhase → Human 展示列的人读投影(见 docs/feature/experiments/cli.md「Attempt 阶段」);
 *  机器面(json 的 `phase=` 与落盘)保留精确的点分名,收尾段在 Human 侧合并显示为一档。 */
function phaseLabel(phase: LifecyclePhase): string {
  switch (phase) {
    // 运行级 / 实验级三员不会作为 ActiveAttempt.phase 出现(它们跑的时候没有活跃 attempt),
    // 这里只服务 failure 行的 phase 标注(judge 预检失败、experiment.setup 失败这两类派发前
    // 确定性失败合成的 errored 结果)。
    case "judge.precheck":
      return t("feedback.phase.judgePrecheck");
    case "experiment.setup":
      return t("feedback.phase.experimentSetup");
    case "experiment.teardown":
      return t("feedback.phase.teardown");
    case "sandbox.queue":
      return t("feedback.phase.sandboxQueue");
    case "sandbox.create":
      return t("feedback.phase.sandboxCreate");
    case "sandbox.prepare":
    case "sandbox.prepare.eval":
    case "sandbox.prepare.experiment":
      return t("feedback.phase.sandboxPrepare");
    case "agent.ensure":
      return t("feedback.phase.agentEnsure");
    case "workspace.baseline":
      return t("feedback.phase.workspaceBaseline");
    case "agent.setup":
      return t("feedback.phase.agentSetup");
    case "telemetry.configure":
      return t("feedback.phase.telemetryConfigure");
    case "eval.run":
    case "agent.run": // 嵌套成员:Human 展示不切换顶层阶段
      return t("feedback.phase.evalRun");
    case "workspace.diff":
      return t("feedback.phase.workspaceDiff");
    case "assertions.evaluate":
      return t("feedback.phase.assertions");
    case "telemetry.collect":
      return t("feedback.phase.telemetryCollect");
    case "agent.teardown":
    case "sandbox.cleanup":
    case "sandbox.suspend":
    case "sandbox.stop":
      return t("feedback.phase.teardown");
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}

/** 实验级钩子的运行级行标签。`phaseLabel` 把 `experiment.teardown` 与其它收尾段合并成
 *  「cleaning up」一档(那是 attempt failure 行的语境);运行级行没有 attempt 语境,必须
 *  自报家门是哪个实验级钩子,所以这里用独立的两个词。 */
function experimentHookLabel(hook: ExperimentHookName): string {
  return hook === "setup" ? t("feedback.phase.experimentSetup") : t("feedback.phase.experimentTeardown");
}

/** 首行守恒计数的文案(见 cli.md「运行中的 live 面板」)。四项结局恒显示、零值不省略——
 *  「0 errored」是一句有价值的肯定;`elsewhere` 只在非零时出现,没有并发 run 的场景少一项。
 *  行长不是压缩它的理由:首行跟随终端全宽,九项写满仍是一行。两个调用点(live dashboard
 *  首行、非 TTY heartbeat)共用这一份,不各自维护一份键选择逻辑。 */
function countsText(state: RunFeedbackState): string {
  const outcomes = {
    passed: state.passed,
    failed: state.failed,
    errored: state.errored,
    skipped: state.skipped,
  };
  return state.elsewhere > 0
    ? t("feedback.human.countsWithElsewhere", {
        total: state.total,
        reused: state.reused,
        running: state.running,
        elsewhere: state.elsewhere,
        queued: state.queued,
        ...outcomes,
      })
    : t("feedback.human.counts", {
        total: state.total,
        reused: state.reused,
        running: state.running,
        queued: state.queued,
        ...outcomes,
      });
}

function formatCounts(state: RunFeedbackState): string {
  const counts = countsText(state);
  if (state.estimatedCostUSD === undefined || state.estimatedCostUSD <= 0) return counts;
  return `${counts}  ${formatCost(state.estimatedCostUSD)}`;
}

/** 定宽格式化:内容按 `width` 左对齐补空格对齐后面的列;超宽时尾部截断补 `…`(cli.md
 *  「active 行的列序」:身份列「超宽截尾补 `…`」),不是硬切丢字符。`width <= 0` 退化为空串。 */
function padTrunc(s: string, width: number): string {
  if (width <= 0) return "";
  if (s.length <= width) return s.padEnd(width);
  if (width === 1) return "…";
  return `${s.slice(0, width - 1)}…`;
}

// ───────────────────────── TTY:动态 dashboard ─────────────────────────

function createDashboardRenderer(io: FeedbackIO, command: string): FeedbackRenderer {
  // active slot 的稳定顺序:只在这里追加/删除(attempt:start 追加到末尾,
  // attempt:complete/early-exit 删除),phase/detail 变化不改变顺序或成员 ——
  // 可见 attempt 完成前不会因为别的 attempt 更新而换位(checklist「active slots 稳定」)。
  const activeOrder: AttemptKey[] = [];
  // 上一帧写了多少行(供 \x1B[nA 回跳)与上一帧的完整文本(供「同帧不写」判断)。
  let linesDrawn = 0;
  let lastFrameText: string | undefined;
  // 身份两列(evalId/who)本次运行里"实际出现过的最长值"宽度——跨帧单调只放宽不回缩
  // (cli.md「active 行的列序」),存在这个闭包里而不是每次从当前行现算,完成的 attempt
  // 让出 slot 后也不应该让列宽跟着变窄。渲染时还要叠加当帧内容宽算出的封顶(见
  // identityColumnWidths)——封顶随终端 resize 每帧重新从 contentWidth 推导,这里的
  // 「见过的最长值」本身不因为封顶变严就被吃掉,分辨率更宽的下一帧仍能用得上。
  let maxEvalIdWidth = 0;
  let maxWhoWidth = 0;

  /** 身份两列本帧的渲染宽度:观测到的最长值与本帧内容宽算出的 40% / 20% 封顶取较小值。 */
  function identityColumnWidths(contentWidth: number): { evalWidth: number; whoWidth: number } {
    const evalCap = Math.floor(contentWidth * 0.4);
    const whoCap = Math.floor(contentWidth * 0.2);
    return { evalWidth: Math.min(maxEvalIdWidth, evalCap), whoWidth: Math.min(maxWhoWidth, whoCap) };
  }

  /** 上边框标题 = 本次命令、meta = 已运行时长;下边框 footerCommand = 本次新派发的累计成本
   *  (docs/feature/experiments/cli.md「运行中的 live 面板」)。ACTIVE 是嵌套 Section 的
   *  同构体裁——一条贯穿框宽的横隔,不是独立的框;非 boxed(非 TTY 或 NO_COLOR)时
   *  panel.ts 自动降级成无框文本,dashboard 的覆盖重画机制不因此改变,只是重画的内容
   *  换成了无框版本。 */
  function buildFrameLines(state: RunFeedbackState): string[] {
    // 全量复用没有 active attempt，也没有“本次执行中”状态；plan/reuse 与终局摘要已经完整，
    // 不画一块只有 0 running 的 dashboard。
    if (state.total > 0 && state.total === state.reused) return [];
    const capability = panelCapabilityForFeedback(io);
    // live 面板豁免 100 列上限、跟随终端全宽(cli.md「框线体裁」);contentWidth 与下面
    // renderPanel 的 width/capWidth 必须传同一份豁免声明,否则行按这里的宽度排版、框却在
    // renderPanel 内部按另一个宽度钳制,行尾会被框吃掉——这正是 memory/
    // live-dashboard-active-row-width-clamp-mismatch.md 的根因类别。
    const contentWidth = panelContentWidth(capability.width, capability.mode, false);
    const rows: PanelRow[] = [{ kind: "line", text: countsText(state) }];
    // 运行级行(judge 预检 + Run activity + 实验钩子 + 用例锁等待)排在 attempt 行前面:
    // 它们解释了为什么后面的 attempt 还停在 queued。预检排最前(发生在任何 attempt 派发
    // 之前),其次共享准备(sandbox.build 等),再是实验钩子,再是锁等待。Map 按插入序迭代,
    // 天然满足稳定 slot。Run activity 不占 attempt active 位。
    const precheck = state.activePrecheck;
    const runActivityRows = [...state.runActivities.values()];
    const hookRows = [...state.experimentHooks.values()];
    // 只有仍在等待(waiting 非空)的实验才占运行级行;窗口已关闭(全部 resolved)的条目只是
    // 给非 TTY 聚合收尾行留的历史计数,TTY 不展示。
    const lockWaitRows = [...state.lockWaits.values()].filter((w) => w.waiting.size > 0);
    if (
      activeOrder.length > 0 ||
      runActivityRows.length > 0 ||
      hookRows.length > 0 ||
      lockWaitRows.length > 0 ||
      precheck
    ) {
      rows.push({ kind: "divider", title: t("feedback.human.active") });
      // 固定开销:上边框 + counts 行 + ACTIVE 横隔 + 下边框(boxed);plain 时同样按 4 行估算,
      // 差一两行不影响「窄/矮终端先减 active slots」这条大方向。
      const rowBudget = Math.max(0, io.stderr.rows - 4 - DASHBOARD_ROW_RESERVE);
      const precheckCount = precheck ? 1 : 0;
      const total =
        precheckCount + runActivityRows.length + hookRows.length + lockWaitRows.length + activeOrder.length;
      // 窄/矮终端先减 active slots(减少行数),而不是先压缩单行内容 ——
      // 单行内容的截断在 formatActiveRow 里按 contentWidth 单独处理。
      const showCount = total <= rowBudget ? total : Math.max(0, rowBudget - 1);

      // 先选出本帧真正会显示的行(运行级行恒排在前面,与旧实现一致),再统一量测/定宽——
      // 同一帧内所有行必须共用同一套身份列宽度,不能让前面几行按旧宽度格式化、后面
      // 的行又观测到更长的值再推宽,导致同一帧内本该对齐的列错位。
      const shownPrecheck = precheck && showCount > 0 ? precheck : undefined;
      let remaining = Math.max(0, showCount - (shownPrecheck ? 1 : 0));
      const shownRunActivities = runActivityRows.slice(0, remaining);
      remaining = Math.max(0, remaining - shownRunActivities.length);
      const shownHooks = hookRows.slice(0, remaining);
      remaining = Math.max(0, remaining - shownHooks.length);
      const shownLockWaits = lockWaitRows.slice(0, remaining);
      const shownRunLevel =
        (shownPrecheck ? 1 : 0) + shownRunActivities.length + shownHooks.length + shownLockWaits.length;
      const shownActive: ActiveAttempt[] = [];
      for (const key of activeOrder) {
        if (shownRunLevel + shownActive.length >= showCount) break;
        const active = state.active.get(key);
        if (active) shownActive.push(active);
      }
      // 身份列本次运行"实际出现过的最长值"只放宽不回缩:运行级行的 label 是拼好的一整块
      // 文本,不是 evalId/who 两个独立字段,不单独参与这里的放宽,只复用下面算出的宽度
      // (cli.md「active 行的列序」:「同一套算法」= 复用同一份结果,不是各自维护一份)。
      for (const active of shownActive) {
        maxEvalIdWidth = Math.max(maxEvalIdWidth, active.identity.evalId.length);
        maxWhoWidth = Math.max(maxWhoWidth, active.who.length);
      }
      const { evalWidth, whoWidth } = identityColumnWidths(contentWidth);

      const activeLines: string[] = [];
      if (shownPrecheck) activeLines.push(formatPrecheckRow(shownPrecheck, io, contentWidth));
      for (const activity of shownRunActivities) {
        activeLines.push(formatRunActivityRow(activity, io, contentWidth));
      }
      for (const hookRow of shownHooks) {
        activeLines.push(formatExperimentHookRow(hookRow, io, contentWidth, evalWidth, whoWidth));
      }
      for (const lockWaitRow of shownLockWaits) {
        activeLines.push(formatLockWaitRow(lockWaitRow, io, contentWidth));
      }
      for (const active of shownActive) {
        activeLines.push(formatActiveRow(active, io, contentWidth, evalWidth, whoWidth));
      }
      for (const line of activeLines) rows.push({ kind: "line", text: line });
      if (total > showCount) {
        rows.push({ kind: "line", text: t("feedback.human.moreActive", { count: total - showCount }) });
      }
    }
    const footerCommand =
      state.estimatedCostUSD !== undefined && state.estimatedCostUSD > 0 ? formatCost(state.estimatedCostUSD) : undefined;
    return renderPanel({
      title: command,
      meta: formatElapsed(state.elapsedMs),
      footerCommand,
      rows,
      width: capability.width,
      mode: capability.mode,
      capWidth: false,
    });
  }

  function redraw(state: RunFeedbackState): void {
    const lines = buildFrameLines(state);
    const text = lines.join("\n");
    if (text === lastFrameText) return; // 真实内容没变化,不写(checklist「rendered frame 与上一帧相同则不写」)
    if (lines.length === 0) {
      if (linesDrawn > 0) {
        let out = `\x1B[${linesDrawn}A`;
        out += "\x1B[2K\n".repeat(linesDrawn) + `\x1B[${linesDrawn}A`;
        io.stderr.write(out);
      }
      linesDrawn = 0;
      lastFrameText = text;
      return;
    }
    let out = linesDrawn > 0 ? `\x1B[${linesDrawn}A` : "";
    out += lines.map((l) => `\x1B[2K${l}`).join("\n") + "\n";
    // 本帧比上帧短(行完成后折叠、终端拉高)时,清掉下方残留的旧行,与 live.ts 旧实现同一手法。
    const extra = linesDrawn - lines.length;
    if (extra > 0) out += "\x1B[2K\n".repeat(extra) + `\x1B[${extra}A`;
    io.stderr.write(out);
    linesDrawn = lines.length;
    lastFrameText = text;
  }

  return {
    appendDurable(event, state) {
      // 实验级钩子起止在 TTY 下只驱动运行级 active 行(state.experimentHooks 已由 reducer
      // 更新,coordinator 紧接着的 redrawDynamic 会画出来);成功钩子不写 scrollback 永久行
      // (见 cli.md「实验级 Hook 的显示」)。非 TTY 退化流才逐行追加(见 renderDurableLines)。
      // judge 预检同理:TTY 下只驱动 state.activePrecheck 的运行级 active 行(coordinator 紧接着的
      // redrawDynamic 会画出来),不写 scrollback 永久行(见 cli.md「judge 预检的显示」)。用例锁
      // 等待同理:TTY 下由 state.lockWaits 驱动运行级 active 行(见 cli.md「等待并发 run 的显示」)。
      // Run 级 activity(共享构建等)同理:TTY 下由 state.runActivities 驱动,不占 attempt slot。
      if (
        event.type === "experiment-hook" ||
        event.type === "precheck" ||
        event.type === "lock-wait" ||
        event.type === "run-activity"
      ) {
        return;
      }
      writeDurable(io, event, state, false);
    },
    activity(text) {
      // 运行级瞬时通知(judge 预检、provider 一次性通知……):coordinator 已按
      // clearDynamic → activity → redrawDynamic 包好顺序,这里只管把这一行落进 scrollback。
      // TTY 下永久事件与 live 面板都在 stderr(见 writeDurable 的流边界注释)。
      io.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
    },
    clearDynamic() {
      if (linesDrawn === 0) return; // 幂等:coordinator 收尾时会无条件再调一次
      let out = `\x1B[${linesDrawn}A`;
      out += "\x1B[2K\n".repeat(linesDrawn) + `\x1B[${linesDrawn}A`;
      io.stderr.write(out);
      linesDrawn = 0;
      lastFrameText = undefined; // 物理终端已清空,下一帧必须真的重写,不能被「同帧」判断吞掉
    },
    redrawDynamic(state) {
      redraw(state);
    },
    onTick(_event, state) {
      // coordinator 的 tick 周期(默认 250ms = 4fps)已经是重画的硬上限 —— 这里每个 tick 最多
      // 重画一次;elapsed 按整秒渲染进 formatCommandLine,连同「同帧不写」,自然满足
      // 「elapsed 最多每秒变化一次」而不需要单独的节流变量。
      redraw(state);
    },
    onLifecycle(event) {
      if (event.type === "attempt:start") {
        const key = encodeAttemptKey(event.identity);
        if (!activeOrder.includes(key)) activeOrder.push(key);
      } else if (event.type === "attempt:complete" || event.type === "attempt:early-exit") {
        const key = encodeAttemptKey(event.identity);
        const idx = activeOrder.indexOf(key);
        if (idx !== -1) activeOrder.splice(idx, 1);
      }
      // attempt:phase / attempt:progress 不改变 activeOrder 成员;下一次 tick 的 redraw()
      // 会从 state.active 读到最新 phase/detail,不需要在这里强制重画(见 checklist
      // 「真实 state 变化合并渲染」—— 逐条 lifecycle 事件不各自触发一次重画)。
    },
  };
}

/** active 行的身份两列(evalId/who)按调用方传入的 `evalWidth`/`whoWidth` 定宽——这两个数
 *  是 `createDashboardRenderer` 闭包按「本次运行实际出现过的最长值,封顶内容宽 40% / 20%」
 *  算出来再传进来的(见 `identityColumnWidths`),这个函数本身不比例分配、也不知道 `columns`
 *  的其余部分怎么分。elapsed 固定 6 列右对齐;detail 拿到 `sym + 身份两列 + elapsed + 分隔符`
 *  之后剩下的全部宽度——不是某个比例或固定预留,宽终端因此把整段 phase/detail 露出来
 *  (cli.md「active 行的列序」)。 */
function formatActiveRow(
  active: ActiveAttempt,
  io: FeedbackIO,
  columns: number,
  evalWidth: number,
  whoWidth: number,
): string {
  // 时间列从 attempt 派发起算,阶段推进不重置(见 ActiveAttempt.startedAt):这一列是存活性的
  // 唯一证明,归零会被读成「这条 eval 重跑了」。
  const elapsed = formatElapsed(io.clock.now() - active.startedAt).padStart(6);
  const sym = "● ";
  const evalCol = padTrunc(active.identity.evalId, evalWidth);
  const whoCol = padTrunc(active.who, whoWidth);
  const prefix = `${sym}${evalCol}  ${whoCol}  ${elapsed}  `;
  const budget = Math.max(0, columns - prefix.length);
  const detail = active.detail ? `${phaseLabel(active.phase)}: ${active.detail}` : phaseLabel(active.phase);
  return prefix + detail.slice(0, budget);
}

/** 实验级钩子的运行级行:与 attempt 行同一套定宽结果,label 跨过 evalId + 两格间隔 + who
 *  两列的合计宽度(不单独维护第三份"最长值"状态——label 是拼好的一整块文本,拆不出
 *  evalId/who 两个独立字段,所以只复用 attempt 行算出的宽度,而不是各自决定),elapsed 列
 *  因此与 attempt 行对齐;detail 来自实验级 `ctx.progress`,没有就只留标签行。 */
/** judge 预检的运行级行:`● prechecking judge config   <elapsed>`。预检发生在任何 attempt 派发
 *  之前,此刻没有 attempt 行、也没有实验钩子行(setup 在派发时才跑),它恒是单独一行——所以
 *  label 不受身份列宽约束(那时列宽还压在初始最小值,会把标签截成 `p…`),直接用整行宽度。
 *  没有 experimentId、没有 detail:预检只有「在跑」与「跑了多久」两个事实。 */
function formatPrecheckRow(precheck: ActivePrecheck, io: FeedbackIO, columns: number): string {
  const elapsed = formatElapsed(io.clock.now() - precheck.startedAt).padStart(6);
  const sym = "● ";
  return padTrunc(`${sym}${t("feedback.human.precheckJudge")}  ${elapsed}`, columns);
}

/** Run 级 activity 的运行级行:`● <producer label>   <elapsed>`。
 *  label 原样来自 producer,不查 LifecyclePhase 锚点表,也不对 key 做 switch 穷尽。
 *  与预检同理:构建阶段常常还没有任何 attempt 行,身份列宽仍是 0,label 直接用整行宽度。 */
function formatRunActivityRow(activity: ActiveRunActivity, io: FeedbackIO, columns: number): string {
  const elapsed = formatElapsed(io.clock.now() - activity.startedAt).padStart(6);
  const sym = "● ";
  return padTrunc(`${sym}${activity.label}  ${elapsed}`, columns);
}

function formatExperimentHookRow(
  hook: ActiveExperimentHook,
  io: FeedbackIO,
  columns: number,
  evalWidth: number,
  whoWidth: number,
): string {
  const elapsed = formatElapsed(io.clock.now() - hook.startedAt).padStart(6);
  const sym = "● ";
  const label = padTrunc(
    `${experimentHookLabel(hook.hook)} · ${hook.experimentId}${hook.recovery ? " (recovery)" : ""}`,
    evalWidth + 2 + whoWidth,
  );
  const prefix = `${sym}${label}  ${elapsed}  `;
  const budget = Math.max(0, columns - prefix.length);
  return prefix + (hook.detail ?? "").slice(0, budget);
}

/** 用例锁等待的运行级行:`● waiting on another run · <exp>   <elapsed>  <n> evals · pid <pid>`
 *  (cli.md「等待并发 run 的显示」)。elapsed 从最早一条等待的 startedAt 算(存活性证明,
 *  与其它运行级行同一约定);pid 取最早一条等待对应的持有方——一个实验可能同时撞上多把不同
 *  持有方的锁,这里选一个稳定的代表值展示,不逐条列出(与 earlyExit 代表 attempt 的选法同一
 *  种「挑一个确定性代表」思路)。不吃 evalWidth/whoWidth 身份列宽约束——与 `formatPrecheckRow`
 *  同理:选中用例全在等锁时,本实验没有派发中的 attempt,那两个宽度还压在初始值 0,会把
 *  label 截成 "w…"(与 memory/live-dashboard-active-row-width-clamp-mismatch.md 同一根因类别,
 *  只是发生在锁等待场景);label 直接用整行宽度。 */
function formatLockWaitRow(wait: ActiveLockWait, io: FeedbackIO, columns: number): string {
  const entries = [...wait.waiting.values()].sort((a, b) => a.startedAt - b.startedAt);
  const earliest = entries[0]!;
  const elapsed = formatElapsed(io.clock.now() - earliest.startedAt).padStart(6);
  const sym = "● ";
  const label = `${t("feedback.human.waitingOnAnotherRun")} · ${wait.experimentId}`;
  const prefix = `${sym}${label}  ${elapsed}  `;
  const budget = Math.max(0, columns - prefix.length);
  const detail = t("feedback.human.lockWaitDetail", { count: entries.length, pid: earliest.holderPid ?? "?" });
  return padTrunc(prefix + detail.slice(0, budget), columns);
}

// ───────────────────────── 非 TTY:human 文案的纯追加流 ─────────────────────────
//
// 单一 stdout 有序流(见 memory/exp-output-two-forms-ruling.md 的补充裁决):从 start 到结束
// 摘要——计划、失败、诊断、运行级瞬时通知、heartbeat、最终摘要——全部落 `stdout`;`stderr` 只留
// 给启动期用法/配置错误(那些错误发生在 coordinator 存在之前,根本不经过这个 renderer)。这与
// TTY 变体（live 面板 + 永久事件在 stderr、只有最终摘要在 stdout）刻意不同:非 TTY 没有可覆盖的
// 动态区域,两个 OS stream 被 CI runner 或 agent 工具层分开缓冲时交错写会打乱真实发生顺序,
// 单流才能保证事件序就是发生序。

function createPlainRenderer(io: FeedbackIO): FeedbackRenderer {
  // 上一条永久事件的时间戳:heartbeat 只在「连续 30 秒没有永久事件」时才追加一条
  //(见 cli.md「什么动态更新,什么逐条追加」表),failure/diagnostic 出现后立即重新计时。
  let lastDurableAtMs = 0;
  return {
    appendDurable(event, state) {
      lastDurableAtMs = event.at;
      writeDurable(io, event, state, true);
    },
    activity(text) {
      // 运行级瞬时通知按永久行追加(非 TTY 没有可覆盖的动态区域),并重置 heartbeat 计时——
      // 刚有输出就不需要紧跟一条「还活着」。单一 stdout 流,不分流到 stderr。
      lastDurableAtMs = io.clock.now();
      io.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    },
    onTick(event, state) {
      if (event.at - lastDurableAtMs < NON_TTY_HEARTBEAT_IDLE_MS) return;
      lastDurableAtMs = event.at;
      io.stdout.write(
        `${t("feedback.human.heartbeat", { elapsed: formatElapsed(state.elapsedMs), counts: formatCounts(state) })}\n`,
      );
    },
    // 没有 clearDynamic/redrawDynamic/onLifecycle:非 TTY 退化流不维护动态区域,
    // 不展示 active attempt 的逐次阶段变化,也不逐次输出 provisioning retry/backoff ——
    // 这些行为由「不实现对应可选钩子」天然满足,不需要在这里写 profile 分支。
  };
}

// ───────────────────────── `--dry`(human profile):稳定预览,不经 coordinator ─────────────────────────

/** 一个 (experimentId, evalId) 组合在 `--dry` 预览里的一行,与 cli.ts 里 `matchedByRun` 摊平后
 *  的矩阵、以及 `--dry --json` 的 `ExpPlanRow`(去掉 `reused` 字段)三处同一份数据一一对应——
 *  dry 预览同样是「展示」,不该留在 cli.ts(见 docs/feature/experiments/cli.md 与 plan 对
 *  「CLI 只负责解析/构造/退出」的要求)。dry run 不派发 attempt,没有 `RunFeedbackState` 可言,
 *  所以这是独立于 `FeedbackRenderer`/coordinator 的纯函数,与 `renderAgentPlanEnvelope`
 *  (agent.ts)同一定位。 */
export interface HumanDryPlanRow {
  experimentId: string;
  evalId: string;
  /** 本行计划内的 attempt 总数；混合 `attempts` 的多个 Experiment 不共用 input 的最大值。 */
  attempts?: number;
  /** 该用例正被另一条并行 Invocation 持锁运行(见 docs/feature/experiments/architecture.md
   *  「并发 Invocation:用例锁」);计划行尾如实标注,`--dry` 本身不取锁、不等待。 */
  locked?: boolean;
  /** 本行实际携入的终态结果；只会出现 `passed` / `failed`，供人读面显示已确定判定。 */
  carried?: readonly {
    attempt: number;
    verdict: "passed" | "failed";
  }[];
  /** 本行要派发的 attempt 卡在哪几道门上(词表见 docs/feature/experiments/cli.md
   *  「`--dry`:计划矩阵与作废原因」);`attempts` 是这组原因覆盖的 0-based 序号。
   *  省略或空数组 = 全部携带(兼容直接调用 formatter 的旧 fixture)。 */
  dispatch?: readonly {
    reason: string;
    attempts?: readonly number[];
    deltas?: readonly { selector: string; kind?: "added" | "removed" | "changed" | "unknown"; from?: string; to?: string }[];
    blockers?: readonly { code: string; reason: string }[];
  }[];
  /** stale 行对应的历史结果；旧格式 locator 会明确显示为不可接受。 */
  prior?: readonly {
    attempt?: number;
    locator: string;
    verdict: "passed" | "failed" | "errored" | "skipped";
    acceptance: "available" | "legacy-locator";
    deltas?: readonly { selector: string; kind?: "added" | "removed" | "changed" | "unknown"; from?: string; to?: string }[];
  }[];
}

export interface HumanDryPlanInput {
  /** 矩阵行数 × runs,与 `--dry --json` 的 `ExpPlanDocument.total` 同口径。 */
  totalAttempts: number;
  /** 去重后的候选 eval 数,与 `ExpPlanDocument.evals` 同口径(即 `rows` 里 `evalId` 的去重数,
   *  不是 discover 到的 eval 总数)。 */
  evals: number;
  configs: number;
  attempts: number;
  /** 携带预测的复用 attempt 数;省略或 `0` 时不追加复用摘要行(docs 契约首行示例展示的是
   *  全新派发场景,没有第二行)。 */
  reused?: number;
  rows: readonly HumanDryPlanRow[];
  /** 兼容旧调用方的命令前缀；accept 行现在固定指向每条历史结果的 locator。 */
  command?: string;
}

/** 契约首行(docs/feature/experiments/cli.md 开头的 `--dry` 示例):
 *  `plan: <total> attempts · <N> eval[s] × <M> config[s] · runs <R>`,单复数随计数变化。
 *  有携带预测时紧跟一行,沿用 `PLAN` 面板缓存摘要既有的 `feedback.human.reuse` 文案(见
 *  `buildPlanLines`)而不是为 `--dry` 另造一套词。逐行按 `experimentId`/`evalId` 两列对齐,
 *  第一列按实际出现过的最长值定宽——与 CI/agent 的 dry 预览不同,human 不折叠、不设行数上限:
 *  这条路径历来就是给人逐行读的完整清单。 */
export function renderHumanDryPlan(input: HumanDryPlanInput): string {
  const lines = [
    t("cli.dry.header", {
      attempts: pluralUnit(input.totalAttempts, "cli.dry.unit.attempt", "cli.dry.unit.attempts"),
      evals: pluralUnit(input.evals, "cli.dry.unit.eval", "cli.dry.unit.evals"),
      configs: pluralUnit(input.configs, "cli.dry.unit.config", "cli.dry.unit.configs"),
      attemptCount: input.attempts,
    }),
  ];
  if (input.reused) {
    lines.push(
      t("feedback.human.reuse", {
        reused: input.reused,
        total: input.totalAttempts,
        toRun: Math.max(0, input.totalAttempts - input.reused),
      }),
    );
  }
  const idWidth = Math.max(0, ...input.rows.map((row) => stringWidth(row.experimentId)));
  const evalWidth = Math.max(0, ...input.rows.map((row) => stringWidth(row.evalId)));
  for (const row of input.rows) {
    const base = `${row.experimentId}${" ".repeat(idWidth - stringWidth(row.experimentId) + 2)}${row.evalId}`;
    // 行尾恒有一个标注:要派发的行逐条给门的原因词,全部携带的行标 carried,
    // 正被别人持锁的行沿用既有的 locked(它回答的是「本次会不会自己跑」,不是哪道门)。
    const suffix = row.locked
      ? t("feedback.human.lockedRowSuffix")
      : dryPlanReasonSuffix(row.dispatch, row.prior, row.carried, row.attempts ?? input.attempts);
    lines.push(`${base}${" ".repeat(evalWidth - stringWidth(row.evalId) + 3)}${suffix}`);
  }
  const staleBlocks = renderStaleDeltaGroups(input);
  if (staleBlocks.length > 0) lines.push("", ...staleBlocks);
  return `${lines.join("\n")}\n`;
}

/** stale 行逐条列出历史 locator；接受命令永远只影响这一条结果，不按 selector 聚合。 */
function renderStaleDeltaGroups(input: HumanDryPlanInput): string[] {
  const out: string[] = [];
  for (const row of input.rows) {
    if (!row.prior || row.prior.length === 0) continue;
    // carry-disabled 已经给出 pair 的具体阻断原因；历史结果不能再伪装成普通 stale，
    // 也不能为这个当前必失败的 accept 路径打印命令。
    if (row.dispatch?.some((group) => (group.blockers?.length ?? 0) > 0)) continue;
    for (const prior of row.prior) {
      const staleGroup = row.dispatch?.find((group) => group.reason === "stale" && group.deltas?.length);
      const deltas = prior.deltas ?? staleGroup?.deltas;
      const summary = deltas?.map(formatDryDelta).join(", ") ?? "details unavailable";
      out.push(`${row.experimentId}  ${row.evalId}  stale ${prior.verdict}: ${summary}`);
      out.push(`  prior:  ${prior.locator} (${prior.verdict})`);
      out.push(prior.acceptance === "available"
        ? `  accept: niceeval accept ${prior.locator}`
        : "  accept: unavailable (legacy locator; rerun to create an acceptable result)");
    }
  }
  return out;
}

/**
 * `baseline01`…`baseline06` → `baseline 01/02/03/05/06`:同一批受影响的 eval 通常只差编号,
 * 把公共前缀提出来一次,人一眼看得出「缺的是哪几号」。没有公共前缀就逐个列。
 */
function foldIds(ids: string[]): string {
  const sorted = [...ids].sort();
  if (sorted.length < 2) return sorted.join(", ");
  let prefix = sorted[0]!;
  for (const id of sorted) {
    while (prefix !== "" && !id.startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (prefix === "") break;
  }
  // 公共前缀不许切进一段数字中间:`baseline01`…`baseline06` 的字面公共前缀是 `baseline0`,
  // 折出来的 `1/3/6` 读起来不是编号。退到数字段边界,给出 `baseline 01/03/06`。
  while (prefix !== "" && /\d$/.test(prefix)) prefix = prefix.slice(0, -1);
  if (prefix === "") return sorted.join(", ");
  return `${prefix} ${sorted.map((id) => id.slice(prefix.length)).join("/")}`;
}

/**
 * `stale: config:judge.model · new` —— 同一行的多组原因按门的出现序连排,stale 附差异 selector。
 * 当一行有多个 attempt 时,每个派发组带 `N/total`;携入组只在部分携入时带这个分数,避免把
 * `carried` 的来源判定折叠成一个没有 verdict 的总数。
 */
function dryPlanReasonSuffix(
  dispatch: HumanDryPlanRow["dispatch"],
  prior: HumanDryPlanRow["prior"],
  carried: HumanDryPlanRow["carried"] = [],
  totalAttempts = 1,
): string {
  const carriedSuffix = carried.length > 0 ? formatCarriedSuffix(carried, totalAttempts) : undefined;
  if (dispatch === undefined || dispatch.length === 0) return carriedSuffix ?? "carried";
  return [
    ...(carriedSuffix === undefined ? [] : [carriedSuffix]),
    ...dispatch.map((group) => formatDispatchGroup(group, prior, totalAttempts)),
  ].join(" · ");
}

function formatCarriedSuffix(
  carried: NonNullable<HumanDryPlanRow["carried"]>,
  totalAttempts: number,
): string {
  if (totalAttempts === 1 && carried.length === 1) return `carried (${carried[0]!.verdict})`;
  const verdicts = formatVerdictCounts(carried.map((result) => result.verdict));
  if (carried.length < totalAttempts) return `carried ${carried.length}/${totalAttempts} (${verdicts})`;
  return `carried (${verdicts})`;
}

function formatVerdictCounts(verdicts: readonly ("passed" | "failed")[]): string {
  const counts = { passed: 0, failed: 0 };
  for (const verdict of verdicts) counts[verdict] += 1;
  return (["passed", "failed"] as const)
    .filter((verdict) => counts[verdict] > 0)
    .map((verdict) => `${counts[verdict]} ${verdict}`)
    .join(" · ");
}

function formatDispatchGroup(
  group: NonNullable<HumanDryPlanRow["dispatch"]>[number],
  prior: HumanDryPlanRow["prior"],
  totalAttempts: number,
): string {
  const countSuffix = group.attempts !== undefined && totalAttempts > 1
    ? ` ${group.attempts.length}/${totalAttempts}`
    : "";
  if (group.blockers !== undefined && group.blockers.length > 0) {
    return `carry-disabled${countSuffix}: ${group.blockers.map(({ code, reason }) => `${code}: ${reason}`).join("; ")}`;
  }
  const selectors = (group.deltas ?? []).map(formatDryDelta);
  const relevantPrior = (prior ?? []).filter((result) =>
    group.attempts === undefined || result.attempt === undefined || group.attempts.includes(result.attempt));
  const staleVerdicts = group.reason === "stale"
    ? (["passed", "failed", "errored", "skipped"] as const).filter((verdict) =>
        relevantPrior.some((result) => result.verdict === verdict))
    : [];
  const reason = staleVerdicts.length > 0 ? `stale ${staleVerdicts.join("/")}` : group.reason;
  if (selectors.length > 0) return `${reason}${countSuffix}: ${selectors.join(", ")}`;
  return group.reason === "stale" ? `${reason}${countSuffix}: details unavailable` : `${reason}${countSuffix}`;
}

function formatDryDelta(delta: { selector: string; kind?: "added" | "removed" | "changed" | "unknown"; from?: string; to?: string }): string {
  switch (delta.kind) {
    case "added": return `${delta.selector} added (${delta.to ?? ""})`;
    case "removed": return `${delta.selector} removed (was ${delta.from ?? ""})`;
    case "unknown": return `${delta.selector} changed (details unavailable)`;
    case "changed":
    default:
      return delta.from !== undefined || delta.to !== undefined
        ? `${delta.selector} changed (${delta.from ?? ""} → ${delta.to ?? ""})`
        : delta.selector;
  }
}

/** `${n} ${unit}` 的单复数投影;zh 的 singular/plural key 值相同(中文不做语法数变化),
 *  实现照旧走同一条路径,不需要按 locale 分支。 */
function pluralUnit(n: number, singularKey: Parameters<typeof t>[0], pluralKey: Parameters<typeof t>[0]): string {
  return `${n} ${t(n === 1 ? singularKey : pluralKey)}`;
}
