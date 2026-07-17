// Human profile renderer(见 docs/feature/experiments/cli.md「人在终端里怎么用」)。
//
// 两个变体,由 `io.stderr.isTTY` 在构造时选一次(profile 是消费者模型,TTY 只是传输能力 ——
// 显式 `--output human` 在非 TTY 下仍是 human,只是退化成纯追加文案,不悄悄变成 agent 语义):
//
// - TTY:动态 dashboard(命令/elapsed/守恒计数/cost/active slots)覆盖重画,永久事件走
//   clear → append → redraw(coordinator 保证顺序,这里只需正确实现三个钩子)。
// - 非 TTY:零 ANSI 的追加流 —— 只有 start(plan 永久事件天然充当)、永久事件、以及连续 30
//   秒无永久事件时的一条 heartbeat;不追踪 active slot,不重画。
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
import { assertionSummaryLines } from "../../scoring/display.ts";
import { encodeAttemptKey } from "../types.ts";
import type {
  ActiveAttempt,
  AttemptKey,
  LifecyclePhase,
  DurableFeedbackEvent,
  RunFeedbackPlan,
  RunFeedbackState,
} from "../types.ts";
import type { FeedbackRenderer } from "./renderer.ts";
import type { FeedbackIO } from "./io.ts";

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
 *  空数组表示这个事件类型在 human 下没有可见内容(目前没有这种情形,保留以防未来扩展)。 */
export function renderDurableLines(event: DurableFeedbackEvent, state: RunFeedbackState): string[] {
  switch (event.type) {
    case "plan":
      return buildPlanLines(event.plan);
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
    case "summary":
      return buildSummaryLines(event, state);
    case "saved":
      return buildSavedLines(event);
    default: {
      // 穷尽性检查:新增 DurableFeedbackEvent 变体时这里编译期报错提醒补上对应分支。
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** 把一条永久事件的渲染行写到正确的流(见 docs/feature/experiments/cli.md「输出流和落盘
 *  节奏」的 stream 边界表:human 的 `stdout` 只留给"最终摘要与结果路径",也就是 "summary" /
 *  "saved" 这两个事件;计划、失败、诊断等其它永久事件与 dashboard 本身都在 `stderr`)。
 *  TTY/非 TTY 两个变体共用这一份判断,不各自重复一遍分支。 */
function writeDurable(io: FeedbackIO, event: DurableFeedbackEvent, state: RunFeedbackState): void {
  const lines = renderDurableLines(event, state);
  if (lines.length === 0) return;
  const text = `${lines.join("\n")}\n`;
  if (event.type === "summary" || event.type === "saved") io.stdout.write(text);
  else io.stderr.write(text);
}

function buildPlanLines(plan: RunFeedbackPlan): string[] {
  const lines = [
    t("feedback.human.plan", {
      total: plan.shape.totalRuns,
      evals: plan.shape.evals,
      configs: plan.shape.configs,
      concurrency: plan.shape.maxConcurrency,
    }),
  ];
  if (plan.reused > 0) {
    lines.push(t("feedback.human.reuse", {
      reused: plan.reused,
      total: plan.shape.totalRuns,
      toRun: Math.max(0, plan.shape.totalRuns - plan.reused),
    }));
  }
  return lines;
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
  const suffix = count > 1 ? ` (${count} attempts)` : "";
  return [`${sym} ${event.key}${suffix}`, `  ${event.message}`];
}

function buildSummaryLines(event: DurableFeedbackEvent & { type: "summary" }, state: RunFeedbackState): string[] {
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

  const lines: string[] = [
    `${verdictWord}  ${t(fullReuse ? "feedback.human.summaryAllReusedLine" : "feedback.human.summaryLine", {
      passed: summary.passed,
      failed: summary.failed,
      errored: summary.errored,
      reused: state.reused,
    })}`,
    `        ${formatSummaryDetail(summary.durationMs, state)}`,
  ];

  // 全通过时(state.failures 为空)不留空 FAILURES 区块。fresh 失败来自 durable event，carry
  // 失败由 plan 静态注入；reducer 把两者按 locator 收进同一清单，这里不从 RunSummary 再造。
  if (state.failures.length > 0) {
    lines.push("", t("feedback.human.failuresHeader"));
    const shown = state.failures.slice(0, HUMAN_FAILURE_CAP);
    for (const f of shown) lines.push(buildFailureLine({ ...f, type: "failure" }));
    if (state.failures.length > HUMAN_FAILURE_CAP) {
      lines.push(t("feedback.human.suppressedFailures", { count: state.failures.length - HUMAN_FAILURE_CAP }));
    }
    // 下钻命令只给第一条失败做示范(cli.md 的完成页示例只有一条失败时展示了一组;多条失败
    // 时逐条重复三行命令会让「有界摘要」变成新的刷屏源,和「不逐条输出」的原则冲突)。
    const first = shown[0];
    if (first) {
      lines.push("", t("feedback.human.inspect", { locator: first.locator }));
      lines.push(t("feedback.human.evalHint", { locator: first.locator }));
      lines.push(t("feedback.human.trace", { locator: first.locator }));
      lines.push(t("feedback.human.diffHint", { locator: first.locator }));
    }
  }

  // 留存授予块(--keep-sandbox,见 docs/feature/sandbox/cli.md「run 收尾输出」):
  // 每条给 locator(接 niceeval show)、provider 与实例 id、进入现场的命令。
  if (state.kept.length > 0) {
    lines.push("", `Kept sandboxes (${state.kept.length})`);
    for (const k of state.kept) {
      lines.push(`  ${k.locator}  ${k.identity.evalId} #${k.identity.attempt}  ${k.verdict}  ${k.provider} · ${k.sandboxId}`);
      lines.push(`             enter: niceeval sandbox enter ${k.sandboxId.slice(0, 12)}`);
    }
    lines.push(`Stop them with: niceeval sandbox stop --all`);
  }
  return lines;
}

function buildSavedLines(event: DurableFeedbackEvent & { type: "saved" }): string[] {
  const paths = event.paths;
  const lines: string[] = [];
  const group = deriveResultGroup(paths);
  if (group) lines.push(t("feedback.human.compare", { group }));
  if (paths.length === 0) return lines;
  if (paths.length === 1) {
    lines.push(`${t("feedback.human.resultsHeader")} ${paths[0]}`);
    return lines;
  }
  lines.push(t("feedback.human.resultsHeader"));
  for (const p of paths.slice(0, RESULTS_PATH_CAP)) lines.push(`  ${p}`);
  if (paths.length > RESULTS_PATH_CAP) {
    lines.push(`  ${t("feedback.human.resultsMore", { count: paths.length - RESULTS_PATH_CAP })}`);
  }
  return lines;
}

/** 快照路径的共同「组」段(如 `.niceeval/compare/bub-e2b/<snapshot>` → `compare`)。
 *  多个 experiment 组混在同一次 invocation 里(不带 group 前缀的 `niceeval exp` 全量运行)时
 *  组名不唯一,不猜一个可能就 wrong 的 view 目标,直接省略 Compare 行 —— Results 路径仍然完整。 */
function deriveResultGroup(paths: readonly string[]): string | undefined {
  const groups = new Set<string>();
  for (const p of paths) {
    const seg = p.split("/")[1];
    if (seg) groups.add(seg);
  }
  return groups.size === 1 ? [...groups][0] : undefined;
}

function formatSummaryDetail(durationMs: number, state: RunFeedbackState): string {
  const parts = [formatElapsed(durationMs)];
  const fullReuse = state.total > 0 && state.total === state.reused;
  if (fullReuse) {
    parts.push("0 new tok", "$0.00");
    return parts.join(" · ");
  }
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
 *  机器面(agent/ci 的 `phase=` 与落盘)保留精确的点分名,收尾段在 Human 侧合并显示为一档。 */
function phaseLabel(phase: LifecyclePhase): string {
  switch (phase) {
    // 实验级两员不会作为 ActiveAttempt.phase 出现(钩子跑的时候没有活跃 attempt),
    // 这里只服务 failure 行的 phase 标注(experiment.setup 失败的合成 errored 结果)。
    case "experiment.setup":
      return t("feedback.phase.experimentSetup");
    case "experiment.teardown":
      return t("feedback.phase.teardown");
    case "sandbox.queue":
      return t("feedback.phase.sandboxQueue");
    case "sandbox.create":
      return t("feedback.phase.sandboxCreate");
    case "sandbox.setup":
      return t("feedback.phase.sandboxSetup");
    case "workspace.baseline":
      return t("feedback.phase.workspaceBaseline");
    case "eval.setup":
      return t("feedback.phase.evalSetup");
    case "agent.setup":
      return t("feedback.phase.agentSetup");
    case "telemetry.configure":
      return t("feedback.phase.telemetryConfigure");
    case "eval.run":
    case "agent.run": // 嵌套成员:Human 展示不切换顶层阶段
      return t("feedback.phase.evalRun");
    case "workspace.diff":
      return t("feedback.phase.workspaceDiff");
    case "scoring.evaluate":
      return t("feedback.phase.scoring");
    case "telemetry.collect":
      return t("feedback.phase.telemetryCollect");
    case "eval.teardown":
    case "agent.teardown":
    case "sandbox.teardown":
    case "sandbox.suspend":
    case "sandbox.stop":
      return t("feedback.phase.teardown");
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}

function formatCounts(state: RunFeedbackState): string {
  const counts = t("feedback.human.counts", {
    total: state.total,
    reused: state.reused,
    running: state.running,
    queued: state.queued,
    completed: state.completed,
  });
  if (state.estimatedCostUSD === undefined || state.estimatedCostUSD <= 0) return counts;
  return `${counts}  ${formatCost(state.estimatedCostUSD)}`;
}

/** 命令名靠左、elapsed 靠右对齐到 `columns`;放不下两端对齐时退化成单空格分隔,并按 `columns`
 *  硬截断 —— 不产生软换行(见 checklist「窄终端…不产生软换行」)。 */
function formatCommandLine(command: string, elapsedMs: number, columns: number): string {
  const elapsed = formatElapsed(elapsedMs);
  const gap = columns - command.length - elapsed.length;
  if (gap >= 1) return command + " ".repeat(gap) + elapsed;
  const line = `${command} ${elapsed}`;
  return truncateNoWrap(line, columns);
}

function truncateNoWrap(s: string, columns: number): string {
  if (columns <= 0) return "";
  return s.length <= columns ? s : s.slice(0, Math.max(0, columns - 1)) + "…";
}

function padTrunc(s: string, width: number): string {
  return s.length > width ? s.slice(0, width) : s.padEnd(width);
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

  function buildFrameLines(state: RunFeedbackState): string[] {
    // 全量复用没有 active attempt，也没有“本次执行中”状态；plan/reuse 与终局摘要已经完整，
    // 不画一块只有 0 running 的 dashboard。
    if (state.total > 0 && state.total === state.reused) return [];
    const columns = io.stderr.columns;
    const lines: string[] = [formatCommandLine(command, state.elapsedMs, columns), formatCounts(state)];
    if (activeOrder.length === 0) return lines.map((l) => truncateNoWrap(l, columns));

    lines.push("", t("feedback.human.active"));
    const rowBudget = Math.max(0, io.stderr.rows - lines.length - DASHBOARD_ROW_RESERVE);
    const total = activeOrder.length;
    // 窄/矮终端先减 active slots(减少行数),而不是先压缩单行内容 ——
    // 单行内容的截断在 formatActiveRow 里按 columns 单独处理。
    const showCount = total <= rowBudget ? total : Math.max(0, rowBudget - 1);
    for (let i = 0; i < showCount; i++) {
      const active = state.active.get(activeOrder[i]!);
      if (active) lines.push(formatActiveRow(active, io));
    }
    if (total > showCount) {
      lines.push(t("feedback.human.moreActive", { count: total - showCount }));
    }
    // 宽度是硬上限:formatCommandLine/formatActiveRow 已经按 columns 自己算好了,但守恒计数行、
    // "ACTIVE" 标题、overflow 摘要行都是变长文本(i18n 插值后长度不定,数字多位、experiment 名长
    // 都可能超),这里统一兜底截断,不产生软换行。
    return lines.map((l) => truncateNoWrap(l, columns));
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
      writeDurable(io, event, state);
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

/** evalId/who 列宽按可用宽度成比例分配(约 55/45),不是固定 26/18 —— 固定宽度在窄终端下
 *  会让整行早早超出 `columns`(违反「宽度以 columns 为硬上限」),给宽终端又会截得比必要更早。
 *  身份列不能吞掉全部剩余宽度：phase/detail 才是 active 行存在的理由，必须预留可见空间。 */
function formatActiveRow(active: ActiveAttempt, io: FeedbackIO): string {
  const columns = io.stderr.columns;
  const elapsed = formatElapsed(io.clock.now() - active.phaseStartedAt).padStart(6);
  const sym = "● ";
  const fixedWidth = sym.length + elapsed.length + 6; // 6 = 三处两两分隔空格
  // 之前把 `columns - fixedWidth` 全给了 identity，导致 prefix 恒占满一行，detail
  // budget 恒为 0；lifecycle/progress 已进 reducer，却永远无法画到终端。
  const detailReserve = Math.min(80, Math.max(0, Math.floor(columns * 0.35)));
  const remaining = Math.max(0, columns - fixedWidth - detailReserve);
  const evalWidth = Math.max(0, Math.round(remaining * 0.55));
  const whoWidth = Math.max(0, remaining - evalWidth);
  const evalCol = padTrunc(active.identity.evalId, evalWidth);
  const whoCol = padTrunc(active.who, whoWidth);
  const prefix = `${sym}${evalCol}  ${whoCol}  ${elapsed}  `;
  const budget = Math.max(0, columns - prefix.length);
  const detail = active.detail ? `${phaseLabel(active.phase)}: ${active.detail}` : phaseLabel(active.phase);
  return prefix + detail.slice(0, budget);
}

// ───────────────────────── 非 TTY:human 文案的纯追加流 ─────────────────────────

function createPlainRenderer(io: FeedbackIO): FeedbackRenderer {
  // 上一条永久事件的时间戳:heartbeat 只在「连续 30 秒没有永久事件」时才追加一条
  //(见 checklist「显式 human + 非 TTY」),failure/diagnostic 出现后立即重新计时。
  let lastDurableAtMs = 0;
  return {
    appendDurable(event, state) {
      lastDurableAtMs = event.at;
      writeDurable(io, event, state);
    },
    onTick(event, state) {
      if (event.at - lastDurableAtMs < NON_TTY_HEARTBEAT_IDLE_MS) return;
      lastDurableAtMs = event.at;
      io.stderr.write(
        `${t("feedback.human.heartbeat", { elapsed: formatElapsed(state.elapsedMs), counts: formatCounts(state) })}\n`,
      );
    },
    // 没有 clearDynamic/redrawDynamic/activity/onLifecycle:非 TTY 退化流不维护动态区域,
    // 不展示 active attempt 的逐次阶段变化,也不逐次输出 provisioning retry/backoff ——
    // 这些行为由「不实现对应可选钩子」天然满足,不需要在这里写 profile 分支。
  };
}

// ───────────────────────── `--dry`(human profile):稳定预览,不经 coordinator ─────────────────────────

/** 一个 (config, eval) 组合在 `--dry` 预览里的一行;字段形状与 cli.ts 里已有的 dry 数据一一对应,
 *  只是把 `t("cli.dry.row", ...)` 的拼装从 CLI 分支搬进这里 —— dry 预览同样是「展示」,
 *  不该留在 cli.ts(见 docs/feature/experiments/cli.md 与 plan 对「CLI 只负责解析/构造/退出」的
 *  要求)。dry run 不派发 attempt,没有 `RunFeedbackState` 可言,所以这是独立于
 *  `FeedbackRenderer`/coordinator 的纯函数,与 `renderAgentPlanEnvelope`(agent.ts)同一定位。 */
export interface HumanDryPlanRow {
  who: string;
  /** `run.experimentId` 存在时的后缀,如 `" (exp compare/bub-e2b)"`;否则空串。 */
  experimentSuffix: string;
  evalIds: readonly string[];
  runs: number;
}

export interface HumanDryPlanInput {
  /** 去重前的候选 eval 数(= discover 到、按 `--tag` 过滤后的 eval 总数,与 `cli.dry.header`
   *  历来的口径一致 —— 不是「实际会跑」的去重数,那个概念属于真正开跑时的 `RunFeedbackPlan`)。 */
  evals: number;
  configs: number;
  rows: readonly HumanDryPlanRow[];
}

/** 沿用既有 `cli.dry.header`/`cli.dry.row` 文案(见 src/i18n/{en,zh-CN}.ts),逐行列出每个
 *  (config, eval) 组合会匹配到哪些 eval —— 与 CI/agent 的 dry 预览不同,human 不折叠、不设行数
 *  上限:这条路径历来就是给人逐行读的完整清单。 */
export function renderHumanDryPlan(input: HumanDryPlanInput): string {
  const lines = [t("cli.dry.header", { evals: input.evals, configs: input.configs })];
  for (const row of input.rows) {
    lines.push(
      t("cli.dry.row", {
        who: row.who,
        experiment: row.experimentSuffix,
        evals: row.evalIds.join(", ") || t("cli.dry.noMatches"),
        runs: row.runs,
      }),
    );
  }
  return lines.join("");
}
