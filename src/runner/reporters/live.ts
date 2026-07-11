// Live terminal reporter:在 TTY 终端里渲染实时状态表,每个 (eval, who) 对占一行。
// spinner 每 80ms 刷新;attempt 完成后行内显示 ✓/✗/~ 符号。
// onRunComplete 时清除状态表,打印和网页榜单同口径的表格报告。

import type { Reporter, ReporterEvent, RunShape, RunSummary } from "../../types.ts";
import { t } from "../../i18n/index.ts";
import { renderRunReport } from "./table.ts";
import { verdictSymbol, WAITING_SYM } from "./shared.ts";
import { runWho } from "../types.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// 进度日志里的基础设施噪声:OTLP 端口、remote-agent 启动提示、trace span 计数。
// 这些在行尾显示毫无意义,直接丢弃。
const NOISE_PATTERNS = [
  /^OTLP /,
  /^使用 remote agent/,
  /^using remote agent/,
  /^驱动 agent/,
  /^driving agent/,
  /^trace:\d/,
  /^agent tracing/,
  /^agent setup/,
];

function isNoise(msg: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(msg));
}

export interface LiveRow {
  evalId: string;
  who: string;
  /** 该 (evalId, who) 对的总 attempt 数(含 earlyExit 估算值)。 */
  total: number;
}

export interface LiveReporter extends Reporter {
  /** 被 RunOptions.onProgress 调用,更新行尾的 lastMsg。 */
  progress(evalId: string, who: string, msg: string): void;
}

interface RowState extends LiveRow {
  completed: number;
  lastMsg: string;
  dominantVerdict: string | undefined;
  /** true 一旦拿到并发名额、attempt effect 真正开始跑;之前是排队等待,不该转圈误导。 */
  started: boolean;
}

export function Live(rows: LiveRow[], totalAttempts: number): LiveReporter {
  const stateMap = new Map<string, RowState>();
  const keyOrder: string[] = [];

  for (const r of rows) {
    const k = `${r.evalId}|${r.who}`;
    if (!stateMap.has(k)) {
      stateMap.set(k, { ...r, completed: 0, lastMsg: "", dominantVerdict: undefined, started: false });
      keyOrder.push(k);
    } else {
      // 同一 (evalId, who) 可能在多个 agentRun 里出现(不应发生,但做防御)
      stateMap.get(k)!.total += r.total;
    }
  }

  let spinFrame = 0;
  let totalCompleted = 0;
  let drawnLines = 0; // 上次 draw() 写了多少行,用于 \x1B[nA 回跳
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let shape: RunShape | undefined;

  const cols = () => process.stderr.columns || 100;

  function renderRow(state: RowState, frame: number): string {
    const done = state.completed >= state.total;
    const sym = done
      ? verdictSymbol(state.dominantVerdict ?? "")
      : state.started
        ? SPINNER[frame % SPINNER.length]
        : WAITING_SYM;

    const evalCol = state.evalId.slice(0, 24).padEnd(24);
    const whoCol = `[${state.who}]`.slice(0, 26).padEnd(26);
    const cntCol = `${state.completed}/${state.total}`.padEnd(5);

    const prefix = `  ${sym} ${evalCol} ${whoCol} ${cntCol}  `;
    const budget = Math.max(0, cols() - prefix.length - 1);
    const msg = done ? "" : state.started ? state.lastMsg.slice(0, budget) : t("live.waiting").slice(0, budget);

    return `\x1B[2K${prefix}${msg}`;
  }

  function renderHeader(): string {
    const hdr = shape
      ? t("live.running", {
          totalRuns: shape.totalRuns,
          evals: shape.evals,
          configs: shape.configs,
          concurrency: shape.maxConcurrency,
          completed: totalCompleted,
          total: totalAttempts,
        })
      : t("live.runningUnknown", { completed: totalCompleted, total: totalAttempts });
    return `\x1B[2K${hdr}`;
  }

  // 终端放不下全部行时,光标回跳会被屏幕顶端截断,导致每帧往下追加整表。
  // 所以按终端高度截断:优先显示运行中的行,放不下的折叠成一行摘要。
  function frameLines(frame: number): string[] {
    const lines = [renderHeader()];
    const termRows = process.stderr.rows || 30;
    // 预留:1 行表头 + 1 行防止末尾换行触发滚动
    const budget = Math.max(1, termRows - 2);

    if (keyOrder.length <= budget) {
      for (const k of keyOrder) lines.push(renderRow(stateMap.get(k)!, frame));
      return lines;
    }

    const running: string[] = [];
    const waiting: string[] = [];
    const done: string[] = [];
    for (const k of keyOrder) {
      const s = stateMap.get(k)!;
      if (s.completed >= s.total) done.push(k);
      else if (s.started) running.push(k);
      else waiting.push(k);
    }
    // 选出要显示的 key(运行中 > 等待 > 已完成),但按原始顺序渲染,避免行来回跳动
    const shown = new Set([...running, ...waiting, ...done].slice(0, budget - 1));
    for (const k of keyOrder) {
      if (shown.has(k)) lines.push(renderRow(stateMap.get(k)!, frame));
    }
    lines.push(
      `\x1B[2K  ${t("live.more", {
        hidden: keyOrder.length - shown.size,
        running: running.filter((k) => !shown.has(k)).length,
        waiting: waiting.filter((k) => !shown.has(k)).length,
        done: done.filter((k) => !shown.has(k)).length,
      })}`,
    );
    return lines;
  }

  function draw(frame: number) {
    if (!process.stderr.isTTY) return;

    const lines = frameLines(frame);
    let out = drawnLines > 0 ? `\x1B[${drawnLines}A` : "";
    out += lines.join("\n") + "\n";
    // 本帧比上帧短(行完成后折叠、终端拉高)时,清掉下方残留的旧行
    const extra = drawnLines - lines.length;
    if (extra > 0) {
      out += "\x1B[2K\n".repeat(extra) + `\x1B[${extra}A`;
    }
    process.stderr.write(out);
    drawnLines = lines.length;
  }

  function clearDisplay() {
    if (!process.stderr.isTTY || drawnLines === 0) return;
    // 回到起点,逐行清空
    process.stderr.write(`\x1B[${drawnLines}A`);
    for (let i = 0; i < drawnLines; i++) {
      process.stderr.write("\x1B[2K\n");
    }
    process.stderr.write(`\x1B[${drawnLines}A`);
    drawnLines = 0;
  }

  return {
    progress(evalId, who, msg) {
      if (isNoise(msg)) return;
      const state = stateMap.get(`${evalId}|${who}`);
      if (state) state.lastMsg = msg;
      // 不在这里 draw();由 interval 驱动,避免每条日志都刷屏
    },

    onEvent(event: ReporterEvent) {
      if (event.type !== "eval:start") return;
      const who = runWho({ agentName: event.agent.name, model: event.model, experimentId: event.experimentId });
      const state = stateMap.get(`${event.eval.id}|${who}`);
      if (state) state.started = true;
    },

    onRunStart(_evals, _agent, s) {
      shape = s;
      // 初始渲染:让用户看到行表
      draw(0);
      intervalId = setInterval(() => {
        spinFrame = (spinFrame + 1) % SPINNER.length;
        draw(spinFrame);
      }, 80);
    },

    onEvalComplete(result) {
      const who = runWho({ agentName: result.agent, model: result.model, experimentId: result.experimentId });
      const state = stateMap.get(`${result.id}|${who}`);
      if (state) {
        state.completed += 1;
        totalCompleted += 1;
        const prev = state.dominantVerdict;
        if (!prev || (prev === "passed" && result.verdict !== "passed")) {
          state.dominantVerdict = result.verdict;
        }
      } else {
        totalCompleted += 1;
      }
    },

    onRunComplete(summary) {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
      // 最后刷一帧(所有行都 done)
      draw(spinFrame);
      clearDisplay();

      process.stdout.write(renderRunReport(summary));
    },
  };
}
