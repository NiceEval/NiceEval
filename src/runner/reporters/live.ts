// Live terminal reporter:在 TTY 终端里渲染实时状态表,每个 (eval, who) 对占一行。
// spinner 每 80ms 刷新;attempt 完成后行内显示 ✓/✗/~ 符号。
// onRunComplete 时清除状态表,打印和网页榜单同口径的表格报告。

import type { Reporter, RunShape, RunSummary } from "../../types.ts";
import { t } from "../../i18n/index.ts";
import { renderRunReport } from "./table.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const OUTCOME_SYM: Record<string, string> = {
  passed: "✓",
  failed: "✗",
  errored: "!",
  skipped: "○",
};

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
  dominantOutcome: string | undefined;
}

export function Live(rows: LiveRow[], totalAttempts: number): LiveReporter {
  const stateMap = new Map<string, RowState>();
  const keyOrder: string[] = [];

  for (const r of rows) {
    const k = `${r.evalId}|${r.who}`;
    if (!stateMap.has(k)) {
      stateMap.set(k, { ...r, completed: 0, lastMsg: "", dominantOutcome: undefined });
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
      ? (OUTCOME_SYM[state.dominantOutcome ?? ""] ?? "?")
      : SPINNER[frame % SPINNER.length];

    const evalCol = state.evalId.slice(0, 24).padEnd(24);
    const whoCol = `[${state.who}]`.slice(0, 26).padEnd(26);
    const cntCol = `${state.completed}/${state.total}`.padEnd(5);

    const prefix = `  ${sym} ${evalCol} ${whoCol} ${cntCol}  `;
    const budget = Math.max(0, cols() - prefix.length - 1);
    const msg = done ? "" : state.lastMsg.slice(0, budget);

    return `\x1B[2K${prefix}${msg}`;
  }

  function renderHeader(): string {
    const hdr = shape
      ? t("live.running", {
          totalRuns: shape.totalRuns,
          evals: shape.evals,
          configs: shape.configs,
          completed: totalCompleted,
          total: totalAttempts,
        })
      : t("live.runningUnknown", { completed: totalCompleted, total: totalAttempts });
    return `\x1B[2K${hdr}`;
  }

  function draw(frame: number) {
    if (!process.stderr.isTTY) return;

    if (drawnLines > 0) {
      process.stderr.write(`\x1B[${drawnLines}A`);
    }

    let out = renderHeader() + "\n";
    for (const k of keyOrder) {
      out += renderRow(stateMap.get(k)!, frame) + "\n";
    }

    process.stderr.write(out);
    drawnLines = 1 + keyOrder.length;
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
      const who = result.model ? `${result.agent}/${result.model}` : result.agent;
      const state = stateMap.get(`${result.id}|${who}`);
      if (state) {
        state.completed += 1;
        totalCompleted += 1;
        const prev = state.dominantOutcome;
        if (!prev || (prev === "passed" && result.outcome !== "passed")) {
          state.dominantOutcome = result.outcome;
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
