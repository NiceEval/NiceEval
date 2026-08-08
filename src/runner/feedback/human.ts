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
// 一条失败/errored 的终端投影恒为单行事实行(buildFailureFactLine):TTY 下滚动显示在 live
// 面板内嵌的 FAILURES 分节(最近 5 条本次新发生的失败,carry 携入失败不进分节,不写
// scrollback);非 TTY 单流逐条追加同一投影。结束反馈的 FAILURES 面板改按失败形态聚合
// (buildFailuresPanelRows),不再逐条铺开;新增的 WARNINGS 面板按 code 汇总本次去重后的诊断。
// 详见 docs/feature/experiments/cli.md「运行中的 live 面板」与「人看的结束反馈」。
//
// 完成页(summary/saved 两个永久事件)不再调用 `./reporters/table.ts` 的 `renderRunReport()`
// 大表:失败优先摘要 + locator + show/view 下一步 + 折叠后的快照路径,完整对比留给
// `niceeval show` / `niceeval view`(见 docs 的「人看的结束反馈」)。

import { t } from "../../i18n/index.ts";
import { formatCost } from "../../shared/format.ts";
import { compactAssertionSummary, fitCompactAssertionSummary } from "../../assertions/display.ts";
import { encodeAttemptKey, HALT_DIAGNOSTIC_CODE } from "../types.ts";
import {
  panelCapabilityOf as panelCapability,
  panelContentWidth,
  renderPanel,
  type PanelMode,
  type PanelRow,
} from "../../report/model/panel.ts";
import { charDisplayWidth, padDisplay, padStartDisplay, stringWidth } from "../../report/model/text-layout.ts";
import type {
  ActiveAttempt,
  ActiveExperimentHook,
  ActiveLockWait,
  ActivePrecheck,
  ActiveRunActivity,
  AttemptKey,
  AttemptRef,
  DiagnosticNotice,
  ExperimentHookName,
  FailureNotice,
  LifecyclePhase,
  DurableFeedbackEvent,
  RunFeedbackPlan,
  RunFeedbackState,
} from "../types.ts";
import type { FeedbackRenderer } from "./renderer.ts";
import type { FeedbackIO } from "./io.ts";
import type { JsonValue } from "../../shared/types.ts";
import type { PrimaryAssertionSummary } from "../../assertions/types.ts";

interface HumanFingerprintDelta {
  selector: string;
  _tag?: "Added" | "Removed" | "Changed" | "Unknown";
  kind?: "added" | "removed" | "changed" | "unknown";
  from?: string;
  to?: string;
}

interface HumanFingerprintDiagnosticFactValue {
  label: string;
  value: JsonValue;
}

interface HumanFingerprintDiagnosticFactTransition {
  label: string;
  from: JsonValue;
  to: JsonValue;
}

type HumanFingerprintDiagnosticFact = HumanFingerprintDiagnosticFactValue | HumanFingerprintDiagnosticFactTransition;

interface HumanFingerprintDiagnostic {
  code: string;
  summary: string;
  facts?: readonly HumanFingerprintDiagnosticFact[];
  observedDeltas?: readonly HumanFingerprintDelta[];
  limitations?: readonly string[];
  causes?: readonly HumanFingerprintDiagnostic[];
}

type HumanFingerprintComparison =
  | { kind: "match" }
  | { kind: "changed"; deltas: readonly HumanFingerprintDelta[] }
  | { kind: "unexplained"; diagnostic: HumanFingerprintDiagnostic };

/** live/结束面板的传输能力(docs/feature/reports/library/layout.md「区域框」):是 TTY 且
 *  没有要求朴素输出(`NO_COLOR`)时才画框——`io.env` 而不是直接读 `process.env`,保持
 *  profile renderer 可用假 IO 确定性测试。 */
function panelCapabilityForFeedback(io: FeedbackIO): { mode: PanelMode; width: number } {
  return panelCapability({ isTTY: io.stderr.isTTY, noColor: io.env.NO_COLOR, width: io.stderr.columns });
}

/** 失败/errored 默认展开上限(见 cli.md「'立即追加'也必须有上限」表:human 前 10 条)。
 *  只管非 TTY 追加流的展开条数;TTY live 面板的 FAILURES 分节用 LIVE_FAILURES_VISIBLE,
 *  结束反馈的 FAILURES 面板用 FAILURE_GROUPS_CAP(按失败形态的组数,不是原始条数)。 */
const HUMAN_FAILURE_CAP = 10;
/** live 面板 FAILURES 分节滚动保留的条数(见 cli.md「运行中的 live 面板」)。 */
const LIVE_FAILURES_VISIBLE = 5;
/** 结束反馈 FAILURES 面板按失败形态聚合后,展开的组数上限;超出收进
 *  `+K more kinds — niceeval view` 尾行(见 cli.md「人看的结束反馈」)。 */
const FAILURE_GROUPS_CAP = 10;
/** 非 TTY / `--json` 没有可依赖的终端宽度,失败单行投影用固定预算(见
 *  docs/feature/assertions/library/display.md「一条摘要怎样排版」)。 */
const NON_TTY_FAILURE_LINE_MAX_CHARS = 100;
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
      // 只服务非 TTY 退化流:TTY dashboard 的 appendDurable 对 "failure" 直接返回(不写
      // scrollback),这条投影只由下一帧的 live 面板 FAILURES 分节显现(见 cli.md「运行中的
      // live 面板」)。非 TTY 单流逐条追加同一份单行事实投影,预算固定 100(没有可依赖的
      // 终端宽度)。
      const count = state.freshFailureCount;
      if (count <= HUMAN_FAILURE_CAP) return [buildFailureFactLine(event, NON_TTY_FAILURE_LINE_MAX_CHARS)];
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

/** 失败/errored 的最小事实面:TTY live 面板 FAILURES 分节、非 TTY 追加流与结束 FAILURES 面板
 *  的 size=1 组三处共用同一个形状,不各自重复摘一遍字段。 */
interface FailureFact {
  readonly locator: string;
  readonly identity: AttemptRef;
  readonly who: string;
  readonly verdict: "failed" | "errored";
  readonly reason: string;
  readonly assertion?: PrimaryAssertionSummary;
  readonly phase?: LifecyclePhase;
  readonly code?: string;
}

/** exp 失败/errored 单行事实行与 FAILURES 面板组行的行首符号:`failed`/`errored` 两种 verdict
 *  都用 `✗`(见 cli.md 全部失败行示例,含 errored)——不复用报告表通用的 `verdictSymbol()`,
 *  那张表把 `errored` 记成 `!`,是留给诊断/警告行的符号,混进失败行会和诊断行的行首混淆。 */
const FAILURE_SYMBOL = "✗";

/**
 * 一条失败/errored 的单行事实投影(cli.md「框线体裁」:`✗ @<locator>  <evalId>  [<who>]
 * <单行压缩摘要>`)。TTY live 面板 FAILURES 分节与非 TTY 追加流共用这一份,唯一的差别是
 * `maxWidth`:TTY 按当帧面板内容宽传入,非 TTY 固定 100(见
 * docs/feature/assertions/library/display.md「一条摘要怎样排版」)。
 */
function buildFailureFactLine(failure: FailureFact, maxWidth: number): string {
  const prefix = `${FAILURE_SYMBOL} ${failure.locator}  ${failure.identity.evalId}  [${failure.who}]  `;
  const budget = Math.max(0, maxWidth - stringWidth(prefix));
  const info = failure.assertion
    ? fitCompactAssertionSummary(failure.assertion, budget)
    : buildErroredInfo(failure.phase, failure.code, failure.reason);
  return prefix + clipDisplayWidth(info, budget);
}

/**
 * errored 且没有主断言摘要(真正的结构化执行错误,不是 assertion-unavailable)时的信息段:
 * `errored · <phase> · <code>`,余量够再接 `: <message>`。`phase`/`code` 用未翻译的原始字面量
 * (`LifecyclePhase` 枚举值 / `AttemptError.code`),不走 `phaseLabel()` 的人读短语 —— 这一段
 * 是给读者对照 `--json` `error` 事件、`result.json` 与 `show` 里同一个字面量用的,不是散文。
 */
function buildErroredInfo(phase: LifecyclePhase | undefined, code: string | undefined, reason: string): string {
  const parts = ["errored", ...(phase ? [phase] : []), ...(code ? [code] : [])];
  const base = parts.join(" · ");
  return reason ? `${base}: ${reason}` : base;
}

/** 按显示列硬夹紧,超宽尾部截断补 `…`。`fitCompactAssertionSummary` 的截断口径是字符数,不是
 *  显示列(见该函数注释「显示宽度的精确裁剪仍归渲染面」);这里补上那道显示宽度的硬夹紧,
 *  堵住 CJK 内容"按字符数收口仍超显示列"的缝,保证渲染行恒不超过预算。 */
function clipDisplayWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (stringWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return "…";
  let out = "";
  let width = 0;
  for (const ch of text) {
    const w = charDisplayWidth(ch.codePointAt(0)!);
    if (width + w > maxWidth - 1) break;
    out += ch;
    width += w;
  }
  return `${out}…`;
}

function buildDiagnosticLines(event: DurableFeedbackEvent & { type: "diagnostic" }, state: RunFeedbackState): string[] {
  // count 从 state.diagnostics 读(reducer 已经按 key 去重累加),不在这里自己维护第二份计数。
  // 人读运行中流对每个 code 至多完整打印一次(见 cli.md「什么动态更新,什么逐条追加」):
  // 第一条给标题与 message 两行,同 code 的后续条目(哪怕 dedupeKey 不同)一律静默 ——
  // 跨用例撞上同一类状况时,读者需要的是「这类事发生了 N 次」,不是 N 段几乎相同的文字;
  // 逐 code 的次数与首条 message 由结束反馈的 WARNINGS 面板汇总(buildWarningsPanelRows)。
  const count = state.diagnostics.find((d) => d.key === event.key)?.count ?? 1;
  if (count > 1) return [];
  const sym = event.severity === "error" ? "✗" : "!";
  if (event.code === HALT_DIAGNOSTIC_CODE) {
    // 止损闸落闸:一行 error 级通知,文案已经是完整的一句话(`experiment halted
    // (dispatch-halted): <message>` / `eval halted: <message>`,见 docs/feature/
    // error-classification/architecture.md「观察面」),不再加标题行。
    return [`${sym} ${event.message}`];
  }
  // 标题用稳定词法(`code`),不是把折叠身份一起编进去的去重 key —— 人读的一行要能一眼认出
  // 「这是哪一类诊断」,`compare/codex|memory/x` 那串身份属于 message 与机器面的具名字段。
  // 阶段标签走与 buildFailureFactLine 不同的投影:诊断标题用人读短语 `phaseLabel()`(散文),
  // 失败行的 errored 信息段用未翻译的原始 LifecyclePhase 字面量(对照机器面)——两者故意不同。
  // attempt 级诊断的 phase 由运行器写进 `data`(见 attempt.ts 的 recordDiagnostic);运行级诊断
  // (止损闸、锁接管、budget)不属于任何单条 attempt,天然没有 phase,标题退化成只有 code 一段。
  const phase = typeof event.data?.phase === "string" ? (event.data.phase as LifecyclePhase) : undefined;
  const heading = phase !== undefined ? `${phaseLabel(phase)} · ${event.code ?? event.key}` : (event.code ?? event.key);
  return [`${sym} ${heading}`, `  ${event.message}`];
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
      text: t(completion.unstarted > 0
        ? "feedback.human.summaryIncompleteLine"
        : fullReuse
          ? "feedback.human.summaryAllReusedLine"
          : "feedback.human.summaryLine", {
        passed: summary.passed,
        failed: summary.failed,
        errored: summary.errored,
        unstarted: completion.unstarted,
        reused: state.reused,
      }),
    },
    { kind: "line", text: formatSummaryCostLine(state) },
  ];
  const blocks: string[][] = [
    renderPanel({ title: verdictWord, meta: formatElapsed(summary.durationMs), rows: summaryRows, width: panel.width, mode: panel.mode }),
  ];

  // 全通过时(state.failures 为空)不留空 FAILURES 面板。fresh 失败来自 durable event，carry
  // 失败由 plan 静态注入；reducer 把两者按 locator 收进同一清单，这里不从 InvocationSummary 再造 ——
  // 整套结果集(含携入)都要出现在这里,不只是本次派发的那部分(见 cli.md「计数口径…」)。
  if (state.failures.length > 0) {
    const { rows: failureRows, meta } = buildFailuresPanelRows(state.failures, panel);
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

  // `WARNINGS`(有诊断才出现,位于 FAILURES 与 NEXT 之间,见 cli.md「人看的结束反馈」):
  // 按 code 汇总本次去重后的诊断,运行中同 code 只完整打印过第一条,这里是「这类事一共
  // 发生了几次」的权威答案。
  const warningsRows = buildWarningsPanelRows(state.diagnostics);
  if (warningsRows) {
    blocks.push(
      renderPanel({ title: t("feedback.human.warningsHeader"), rows: warningsRows, width: panel.width, mode: panel.mode }),
    );
  }

  return blocks.flatMap((block, i) => (i === 0 ? block : ["", ...block]));
}

/**
 * `FAILURES` 面板的内容:未通过的 attempt 按失败形态分组(见 cli.md「人看的结束反馈」)。
 * `failed` 的组 key 是主失败断言的标题 + 检查方式,`errored`(没有主断言摘要的结构化执行错误)
 * 的组 key 是 `phase · code`;`received`/message 各条不同,不进 key 也不进组行。size > 1 的组
 * 只占一行(右对齐 `×N` + 形态摘要 + 组内首现的代表 locator);size = 1 的组展开成身份行 +
 * 悬挂的单行压缩摘要两行。组按条数降序,超过 `FAILURE_GROUPS_CAP` 收进尾行。
 */
function buildFailuresPanelRows(
  failures: readonly FailureNotice[],
  panel: { mode: PanelMode; width: number },
): { rows: PanelRow[]; meta: string } {
  const groups = groupFailuresByShape(failures);
  const contentWidth = panelContentWidth(panel.width, panel.mode);
  const shown = groups.slice(0, FAILURE_GROUPS_CAP);
  const multi = shown.filter((g) => g.size > 1);
  const countWidth = Math.max(0, ...multi.map((g) => stringWidth(`${FAILURE_SYMBOL} ×${g.size}`)));

  const rows: PanelRow[] = [];
  for (const group of shown) {
    if (group.size === 1) {
      rows.push(...buildSingleFailureGroupRows(group.representative, contentWidth));
    } else {
      rows.push(buildMultiFailureGroupRow(group, countWidth));
    }
  }
  if (groups.length > FAILURE_GROUPS_CAP) {
    rows.push({
      kind: "line",
      text: t("feedback.human.moreFailureKinds", { count: groups.length - FAILURE_GROUPS_CAP }),
    });
  }
  return { rows, meta: t("feedback.human.failuresTotalKinds", { total: failures.length, kinds: groups.length }) };
}

/** 一个失败形态组:同一 key 下的全部失败共享同一条 `shapeText`(已经剥掉 `received`/message
 *  这类逐条不同的字段),`representative` 是组内首现的那一条(给 `e.g. <locator>`)。 */
interface FailureShapeGroup {
  readonly key: string;
  readonly size: number;
  readonly representative: FailureNotice;
  readonly shapeText: string;
}

function groupFailuresByShape(failures: readonly FailureNotice[]): FailureShapeGroup[] {
  const groups = new Map<string, { size: number; representative: FailureNotice; shapeText: string }>();
  for (const failure of failures) {
    const { key, shapeText } = failureShapeOf(failure);
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, { ...existing, size: existing.size + 1 });
    } else {
      groups.set(key, { size: 1, representative: failure, shapeText });
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => b.size - a.size);
}

/** 组 key 与形态摘要文本共用同一个"剥掉 received 的断言摘要"投影(有主断言摘要时,`failed`
 *  与 assertion-unavailable 造成的 `errored` 都走这条);没有主断言摘要的 `errored`(真正的
 *  结构化执行错误)按 `phase · code` 分组,摘要文本复用 `buildErroredInfo`(不带 message)。 */
function failureShapeOf(failure: FailureNotice): { key: string; shapeText: string } {
  if (failure.assertion) {
    const shapeText = compactAssertionSummary({ ...failure.assertion, received: undefined, additionalFailures: 0 });
    return { key: `assertion\u0000${failure.assertion.assertion}\u0000${failure.assertion.matcher ?? ""}`, shapeText };
  }
  return {
    key: `errored\u0000${failure.phase ?? "?"}\u0000${failure.code ?? "?"}`,
    shapeText: buildErroredInfo(failure.phase, failure.code, ""),
  };
}

/** 行内 facts 摘要提示(cli.md「人看的结束反馈」):有 `ctx.fact()` 上报的运行事实才提示,
 *  只给键数,不展开值——完整键值表留给 `niceeval show @<locator>`,面板保持密度不展开。 */
function factsHint(factsCount: number | undefined): string {
  return factsCount !== undefined && factsCount > 0 ? `  ${t("feedback.human.failureFacts", { count: factsCount })}` : "";
}

function buildMultiFailureGroupRow(group: FailureShapeGroup, countWidth: number): PanelRow {
  const countToken = padStartDisplay(`${FAILURE_SYMBOL} ×${group.size}`, countWidth);
  return {
    kind: "line",
    text: `${countToken}  ${group.shapeText}  ${t("feedback.human.exampleLocator", { locator: group.representative.locator })}${factsHint(group.representative.factsCount)}`,
  };
}

/** size = 1 组的两行:身份行(`✗ @locator  evalId  [who]`)+ 悬挂到身份内容起始列的单行压缩
 *  摘要——与 `buildFailureFactLine` 共用同一套 info 组装逻辑,只是拆成两行而不是塞进一行。
 *  facts 摘要提示挂在身份行尾(有 facts 才出现)。 */
function buildSingleFailureGroupRows(failure: FailureNotice, contentWidth: number): PanelRow[] {
  const identityLine = `${FAILURE_SYMBOL} ${failure.locator}  ${failure.identity.evalId}  [${failure.who}]${factsHint(failure.factsCount)}`;
  const indent = stringWidth(`${FAILURE_SYMBOL} `);
  const budget = Math.max(0, contentWidth - indent);
  const info = failure.assertion
    ? fitCompactAssertionSummary(failure.assertion, budget)
    : buildErroredInfo(failure.phase, failure.code, failure.reason);
  return [
    { kind: "line", text: identityLine },
    { kind: "line", text: `${" ".repeat(indent)}${clipDisplayWidth(info, budget)}` },
  ];
}

/** `WARNINGS` 面板:`state.diagnostics` 已经按去重 key 折叠,这里再按对外稳定词法 `code` 二次
 *  聚合(同一 code 可能有多个不同折叠 key,如逐用例的锁接管);没有诊断时返回 undefined,
 *  调用方据此不画空面板。 */
function buildWarningsPanelRows(diagnostics: readonly DiagnosticNotice[]): PanelRow[] | undefined {
  if (diagnostics.length === 0) return undefined;
  const byCode = new Map<string, { count: number; message: string; severity: "warning" | "error" }>();
  for (const d of diagnostics) {
    const code = d.code ?? d.key;
    const existing = byCode.get(code);
    if (existing) {
      byCode.set(code, { ...existing, count: existing.count + d.count });
    } else {
      byCode.set(code, { count: d.count, message: d.message, severity: d.severity });
    }
  }
  const entries = [...byCode.entries()];
  const labelWidth = Math.max(0, ...entries.map(([code, v]) => stringWidth(warningCodeLabel(code, v.count))));
  return entries.map(([code, v]) => ({
    kind: "line",
    text: `${v.severity === "error" ? "✗" : "!"} ${padDisplay(warningCodeLabel(code, v.count), labelWidth)}  ${v.message}`,
  }));
}

function warningCodeLabel(code: string, count: number): string {
  return count > 1 ? `${code} ×${count}` : code;
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

    // FAILURES 分节(cli.md「运行中的 live 面板」):插在 counts 行与 ACTIVE 横隔之间,滚动
    // 保留最近 LIVE_FAILURES_VISIBLE 条本次新发生的失败——state.failures 是「carry(plan 静态
    // 注入)+ fresh(本次事件追加)」按发生序拼起来的同一份清单,fresh 段恒是尾部
    // freshFailureCount 条(carry 只在 "plan" 时一次性写入、之后只追加,不重排),因此按长度
    // 切片就能拿到"本次新发生的失败",不需要给 FailureNotice 再加一个 origin 标记。横隔 meta
    // 用累计数(如 `12 so far`),不是"这一帧展示了几条"。
    const freshFailures = state.failures.slice(Math.max(0, state.failures.length - state.freshFailureCount));
    const maxFailureRows = Math.min(LIVE_FAILURES_VISIBLE, freshFailures.length);

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

    // 矮终端先减 ACTIVE 可见项,再减 FAILURES 分节的可见条数(cli.md「运行中的 live 面板」):
    // FAILURES 分节按"全量意愿"优先占位,ACTIVE 拿剩下的;只有终端矮到连 FAILURES 分节自己
    // 都放不下时才反过来压缩它。固定开销:上下边框(2)+ counts 行(1)。
    const restBudget = Math.max(0, io.stderr.rows - 3 - DASHBOARD_ROW_RESERVE);
    const failuresDesired = maxFailureRows > 0 ? 1 + maxFailureRows : 0; // 横隔 + 条目
    const shownFailureCount =
      maxFailureRows > 0 ? Math.min(maxFailureRows, Math.max(0, failuresDesired <= restBudget ? maxFailureRows : restBudget - 1)) : 0;
    if (shownFailureCount > 0) {
      rows.push({
        kind: "divider",
        title: t("feedback.human.failuresHeader"),
        meta: t("feedback.human.failuresSoFar", { count: state.freshFailureCount }),
      });
      for (const failure of freshFailures.slice(-shownFailureCount)) {
        rows.push({ kind: "line", text: buildFailureFactLine(failure, contentWidth) });
      }
    }
    const failuresRowsUsed = shownFailureCount > 0 ? 1 + shownFailureCount : 0;
    const activeSectionBudget = Math.max(0, restBudget - failuresRowsUsed);

    if (
      activeOrder.length > 0 ||
      runActivityRows.length > 0 ||
      hookRows.length > 0 ||
      lockWaitRows.length > 0 ||
      precheck
    ) {
      rows.push({ kind: "divider", title: t("feedback.human.active") });
      // ACTIVE 横隔自己也占一行,从分给 ACTIVE 小节的预算里再扣一行,剩下的才是内容行数。
      const rowBudget = Math.max(0, activeSectionBudget - 1);
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
      // 失败(verdict failed/errored)同理:TTY 下失败不进 scrollback 流,只更新 state.failures/
      // freshFailureCount,由下一帧 buildFrameLines 的 FAILURES 分节显现(见 cli.md「框线体裁」
      // 「一条失败的多行证据…不进终端,细节的家是 show」)——reducer 已经在 emit() 里同步更新过
      // state,这里的 no-op 只是不写字节;coordinator 仍会围着这次投递做 clear→append→redraw,
      // redraw 读到的是已经含这条失败的最新 state。
      if (
        event.type === "experiment-hook" ||
        event.type === "precheck" ||
        event.type === "lock-wait" ||
        event.type === "run-activity" ||
        event.type === "failure"
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
  evalGroupId?: string;
  evalGroupIndex?: number;
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
    comparison?: HumanFingerprintComparison;
  }[];
  /** previous-result 行对应的历史结果；旧格式 locator 会明确显示为不可接受。 */
  prior?: readonly {
    attempt?: number;
    locator: string;
    verdict: "passed" | "failed" | "errored" | "skipped";
    acceptance: "available" | "legacy-locator";
    evidenceState?: "local" | "borrowed" | "dangling";
    comparison?: HumanFingerprintComparison;
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
  const evalLabel = (row: HumanDryPlanRow): string => row.evalGroupId === undefined
    ? row.evalId
    : `${row.evalId} [group ${row.evalGroupId} #${row.evalGroupIndex}]`;
  const evalWidth = Math.max(0, ...input.rows.map((row) => stringWidth(evalLabel(row))));
  for (const row of input.rows) {
    const label = evalLabel(row);
    const base = `${row.experimentId}${" ".repeat(idWidth - stringWidth(row.experimentId) + 2)}${label}`;
    // 行尾恒有一个标注:要派发的行逐条给门的原因词,全部携带的行标 carried,
    // 正被别人持锁的行沿用既有的 locked(它回答的是「本次会不会自己跑」,不是哪道门)。
    const suffix = row.locked
      ? t("feedback.human.lockedRowSuffix")
      : dryPlanReasonSuffix(row.dispatch, row.prior, row.carried, row.attempts ?? input.attempts);
    lines.push(`${base}${" ".repeat(evalWidth - stringWidth(label) + 3)}${suffix}`);
  }
  const previousResultBlocks = renderPreviousResultDeltaGroups(input);
  if (previousResultBlocks.length > 0) lines.push("", ...previousResultBlocks);
  return `${lines.join("\n")}\n`;
}

/** previous-result 行逐条列出历史 locator；接受命令永远只影响这一条结果，不按 selector 聚合。 */
function renderPreviousResultDeltaGroups(input: HumanDryPlanInput): string[] {
  const out: string[] = [];
  for (const row of input.rows) {
    if (!row.prior || row.prior.length === 0) continue;
    for (const prior of row.prior) {
      const previousResultGroup = row.dispatch?.find((group) => group.reason === "previous-result" && group.comparison !== undefined);
      const comparison = prior.comparison ?? previousResultGroup?.comparison;
      const summary = comparison === undefined
        ? "fingerprint comparison explanation unavailable"
        : formatFingerprintComparison(comparison);
      out.push(`${row.experimentId}  ${row.evalId}  previous-result ${prior.verdict}: ${summary}`);
      if (comparison !== undefined) out.push(...renderFingerprintComparisonDetails(comparison, "  "));
      const evidence = prior.evidenceState === "dangling" ? "evidence unavailable" : "evidence available";
      out.push(`  prior:  ${prior.locator} (${prior.verdict} · ${evidence})`);
      if (prior.evidenceState !== "dangling") out.push(`  review: niceeval show ${prior.locator}`);
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
 * `previous-result: config:judge.model · new` —— 同一行的多组原因按门的出现序连排，旧结果附差异 selector。
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
  const comparison = group.comparison;
  const relevantPrior = (prior ?? []).filter((result) =>
    group.attempts === undefined || result.attempt === undefined || group.attempts.includes(result.attempt));
  const previousResultVerdicts = group.reason === "previous-result"
    ? (["passed", "failed", "errored", "skipped"] as const).filter((verdict) =>
        relevantPrior.some((result) => result.verdict === verdict))
    : [];
  const reason = previousResultVerdicts.length > 0
    ? `previous-result ${previousResultVerdicts.join("/")}`
    : group.reason;
  if (comparison !== undefined) return `${reason}${countSuffix}: ${formatFingerprintComparison(comparison)}`;
  return `${reason}${countSuffix}`;
}

function formatFingerprintComparison(comparison: NonNullable<HumanDryPlanRow["dispatch"]>[number]["comparison"]): string {
  if (comparison === undefined) return "fingerprint comparison explanation unavailable";
  if (comparison.kind === "match") return "fingerprint matches";
  if (comparison.kind === "changed") return comparison.deltas.map(formatDryDelta).join(", ");
  return comparison.diagnostic.summary;
}

const DELTA_COMMON_PREFIX_CAP = 24;
const DELTA_DIFF_WINDOW = 56;
const DELTA_SINGLE_SIDE_CAP = 80;

/**
 * Changed 差异的双侧值对齐到第一处不同字符,而不是各自从头独立截断——独立截断在长公共前缀下
 * 会把两侧都截在差异点之前,读者看到的是两份相同的省略串,分不清到底哪里变了。差异点起两侧
 * 各留一个有界窗口,公共前缀过长时压缩显示但保留其尾部作为定位上下文。
 */
export function windowChangedDeltaValues(from: string, to: string): [string, string] {
  if (from === to) return [from, to];
  const max = Math.min(from.length, to.length);
  let shared = 0;
  while (shared < max && from[shared] === to[shared]) shared += 1;
  const prefix = shared > DELTA_COMMON_PREFIX_CAP
    ? `…${from.slice(shared - DELTA_COMMON_PREFIX_CAP, shared)}`
    : from.slice(0, shared);
  return [
    `${prefix}${boundedDiffTail(from.slice(shared))}`,
    `${prefix}${boundedDiffTail(to.slice(shared))}`,
  ];
}

function boundedDiffTail(text: string): string {
  return text.length > DELTA_DIFF_WINDOW ? `${text.slice(0, DELTA_DIFF_WINDOW)}…` : text;
}

function boundedSingleSide(text: string): string {
  return text.length > DELTA_SINGLE_SIDE_CAP ? `${text.slice(0, DELTA_SINGLE_SIDE_CAP - 1)}…` : text;
}

function formatDryDelta(delta: {
  selector: string;
  _tag?: "Added" | "Removed" | "Changed" | "Unknown";
  kind?: "added" | "removed" | "changed" | "unknown";
  from?: string;
  to?: string;
}): string {
  const kind = delta.kind ?? (
    delta._tag === "Added"
      ? "added"
      : delta._tag === "Removed"
        ? "removed"
        : delta._tag === "Unknown"
          ? "unknown"
          : delta._tag === "Changed"
            ? "changed"
            : undefined
  );
  switch (kind) {
    case "added": return `${delta.selector} added (${boundedSingleSide(delta.to ?? "")})`;
    case "removed": return `${delta.selector} removed (was ${boundedSingleSide(delta.from ?? "")})`;
    case "unknown": return `${delta.selector}`;
    case "changed":
    default: {
      if (delta.from === undefined && delta.to === undefined) return delta.selector;
      const [from, to] = windowChangedDeltaValues(delta.from ?? "", delta.to ?? "");
      return `${delta.selector} changed (${from} → ${to})`;
    }
  }
}

const DIAGNOSTIC_CAUSE_DEPTH_CAP = 4;
const DIAGNOSTIC_NODE_CAP = 16;
const DIAGNOSTIC_DELTA_CAP = 8;

function renderFingerprintComparisonDetails(comparison: HumanFingerprintComparison, indent: string): string[] {
  if (comparison.kind !== "unexplained") return [];
  const budget = { nodes: 0 };
  return renderFingerprintDiagnostic(comparison.diagnostic, indent, 0, budget);
}

function renderFingerprintDiagnostic(
  diagnostic: Extract<HumanFingerprintComparison, { kind: "unexplained" }>["diagnostic"],
  indent: string,
  depth: number,
  budget: { nodes: number },
): string[] {
  if (budget.nodes >= DIAGNOSTIC_NODE_CAP) return [];
  budget.nodes += 1;
  const lines = [`${indent}${diagnostic.code}: ${diagnostic.summary}`];
  for (const fact of diagnostic.facts ?? []) {
    if ("value" in fact) {
      lines.push(`${indent}  ${fact.label}: ${formatDiagnosticValue(fact.value)}`);
    } else {
      lines.push(`${indent}  ${fact.label}: ${formatDiagnosticValue(fact.from)} → ${formatDiagnosticValue(fact.to)}`);
    }
  }
  if (diagnostic.observedDeltas === undefined) {
    lines.push(`${indent}  observed inputs: unavailable (comparable manifest inputs were not available)`);
  } else if (diagnostic.observedDeltas.length === 0) {
    lines.push(`${indent}  observed inputs: no differences in comparable manifest fields`);
  } else {
    lines.push(`${indent}  observed inputs:`);
    const visible = diagnostic.observedDeltas.slice(0, DIAGNOSTIC_DELTA_CAP);
    for (const delta of visible) lines.push(`${indent}    ${formatDryDelta(delta)}`);
    if (diagnostic.observedDeltas.length > visible.length) {
      lines.push(`${indent}    +${diagnostic.observedDeltas.length - visible.length} more observed deltas`);
    }
  }
  for (const limitation of diagnostic.limitations ?? []) lines.push(`${indent}  limitation: ${limitation}`);
  const causes = diagnostic.causes ?? [];
  if (causes.length === 0) return lines;
  if (depth >= DIAGNOSTIC_CAUSE_DEPTH_CAP) {
    lines.push(`${indent}  +${causes.reduce((count, cause) => count + diagnosticNodeCount(cause), 0)} more diagnostic nodes suppressed`);
    return lines;
  }
  for (let index = 0; index < causes.length; index++) {
    const cause = causes[index];
    if (cause === undefined) continue;
    if (budget.nodes >= DIAGNOSTIC_NODE_CAP) {
      const remaining = causes.slice(index).reduce((count, rest) => count + diagnosticNodeCount(rest), 0);
      lines.push(`${indent}  +${remaining} more diagnostic nodes suppressed`);
      break;
    }
    lines.push(`${indent}  cause:`);
    lines.push(...renderFingerprintDiagnostic(cause, `${indent}    `, depth + 1, budget));
  }
  return lines;
}

function diagnosticNodeCount(diagnostic: Extract<HumanFingerprintComparison, { kind: "unexplained" }>["diagnostic"]): number {
  return 1 + (diagnostic.causes ?? []).reduce((count, cause) => count + diagnosticNodeCount(cause), 0);
}

function formatDiagnosticValue(value: JsonValue): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

/** `${n} ${unit}` 的单复数投影;zh 的 singular/plural key 值相同(中文不做语法数变化),
 *  实现照旧走同一条路径,不需要按 locale 分支。 */
function pluralUnit(n: number, singularKey: Parameters<typeof t>[0], pluralKey: Parameters<typeof t>[0]): string {
  return `${n} ${t(n === 1 ? singularKey : pluralKey)}`;
}
