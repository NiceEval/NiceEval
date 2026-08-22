"use client";

import { Appear, Cursor, Line, TerminalWindow, Typed, useAnimated, useTimeline } from "./site-terminal-shell";

// Hero「给 Agent 看」的终端动画:同一个仓库,换成 Claude Code 在驱动 niceeval。
// 粘一句 prompt 之后,coding agent 自己装包、写 eval、跑 `--json` 事件流、按 locator 下钻、
// 改代码、只重跑失败项——这就是「Agent 也是用户」那条闭环在终端里的样子。
//
// niceeval 侧的每一行仍然是真实输出:`--json` 是 stdout 上的 NDJSON 事件流,字段名复用
// Results 词表(docs/feature/experiments/cli.md「机器怎么读」),locator 是继续调查的主键。
// Claude Code 侧沿用它自己的转录版式(banner、`>` 提示、`●` 工具调用、`⎿` 结果、折叠计数)。
// 这段输出不做 i18n —— 终端里就是这一套英文字面量。

const PROMPT = "READ https://niceeval.com/INIT.md and install niceeval for this repo.";

const T = {
  promptStart: 500,
  promptDone: 2700,
  end: 16600,
} as const;

type Step =
  | {
      kind: "tool";
      at: number;
      outAt: number;
      tool: string;
      arg: string;
      out: string[];
      more?: string;
      spinner?: { verb: string; seconds: number; tokens: string };
    }
  | { kind: "text"; at: number; lines: string[] };

const STEPS: Step[] = [
  {
    kind: "tool",
    at: 3200,
    outAt: 3700,
    tool: "Fetch",
    arg: "https://niceeval.com/INIT.md",
    out: ["Received 4.1k tokens"],
  },
  {
    kind: "tool",
    at: 4200,
    outAt: 5000,
    tool: "Bash",
    arg: "pnpm add -D niceeval",
    out: ["+ niceeval 0.9.1"],
  },
  {
    kind: "tool",
    at: 5500,
    outAt: 6100,
    tool: "Write",
    arg: "evals/checkout/apply-coupon.eval.ts",
    out: ["Wrote 26 lines to evals/checkout/apply-coupon.eval.ts"],
  },
  {
    kind: "tool",
    at: 6600,
    outAt: 9700,
    tool: "Bash",
    arg: "niceeval exp compare --json",
    spinner: { verb: "Evaluating", seconds: 127, tokens: "3.4k" },
    out: [
      '{"format":"niceeval.exp","schemaVersion":1,"event":"start","total":8,"configs":2,"concurrency":4,"reused":2}',
      '{"event":"failure","locator":"@1bwcxxiy","evalId":"checkout/apply-coupon","experimentId":"compare/gpt-5.4","severity":"gate","assertion":"cart total reflects the SAVE20 coupon","matcher":"equals(80)","expected":80,"received":100}',
      '{"event":"result","status":"failed","passed":7,"failed":1,"errored":0,"reused":2,"completion":"complete"}',
    ],
    more: "+6 lines (ctrl+o to expand)",
  },
  {
    kind: "tool",
    at: 10400,
    outAt: 11000,
    tool: "Bash",
    arg: "niceeval show @1bwcxxiy --source --json",
    out: ['{"view":"source","evalId":"checkout/apply-coupon","file":"evals/checkout/apply-coupon.eval.ts","line":18,'],
    more: "+41 lines (ctrl+o to expand)",
  },
  {
    kind: "text",
    at: 11600,
    lines: [
      "The eval is right and the cart is wrong: SAVE20 is applied after tax, so the",
      "total comes back 100 instead of 80. Patching the coupon, then rerunning failures.",
    ],
  },
  {
    kind: "tool",
    at: 12400,
    outAt: 12900,
    tool: "Update",
    arg: "src/cart/coupon.ts",
    out: ["Updated src/cart/coupon.ts with 3 additions and 1 removal"],
  },
  {
    kind: "tool",
    at: 13400,
    outAt: 15200,
    tool: "Bash",
    arg: "niceeval exp compare --rerun --json",
    spinner: { verb: "Rerunning", seconds: 71, tokens: "1.2k" },
    out: [
      '{"event":"result","status":"passed","passed":1,"failed":0,"errored":0,"reused":0,"completion":"complete"}',
    ],
  },
  {
    kind: "text",
    at: 15800,
    lines: [
      "Fixed — checkout/apply-coupon now passes on both configs. Full matrix:",
      "niceeval show --exp compare/gpt-5.4 --exp compare/sonnet-5",
    ],
  },
];

function fmtSec(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`;
  return `${Math.floor(totalSec / 60)}m ${String(totalSec % 60).padStart(2, "0")}s`;
}

function ToolResult({ out, more }: { out: string[]; more?: string }) {
  return (
    <>
      {out.map((text, index) => (
        <Line key={text} className="cc-out">
          <span className="cc-gutter">{index === 0 ? "  ⎿  " : "     "}</span>
          {text}
        </Line>
      ))}
      {more ? (
        <Line className="cc-out cc-more">
          <span className="cc-gutter">{out.length === 0 ? "  ⎿  " : "     "}</span>
          {`… ${more}`}
        </Line>
      ) : null}
    </>
  );
}

export default function AgentTerminalDemo({ ariaLabel, replayLabel }: { ariaLabel: string; replayLabel: string }) {
  const animated = useAnimated();
  const { now, play } = useTimeline(T.end, animated);

  return (
    <TerminalWindow
      label="claude"
      animated={animated}
      onReplay={play}
      replayLabel={replayLabel}
      ariaLabel={ariaLabel}
    >
      <Line className="cc-banner">{" ▐▛███▜▌   Claude Code v2.1.220"}</Line>
      <Line className="cc-banner">{"▝▜█████▛▘  Opus 5 (1M context) with high effort · Claude Max"}</Line>
      <Line className="cc-banner">{"  ▘▘ ▝▝    ~/Code/acme-checkout"}</Line>
      <Line className="cc-gap" />

      <Line className="cc-user">
        <span className="cc-caret">{"> "}</span>
        <Typed
          text={PROMPT}
          msPerChar={(T.promptDone - T.promptStart) / PROMPT.length}
          start={T.promptStart}
          now={now}
        />
        {animated && now < STEPS[0].at ? <Cursor /> : null}
      </Line>

      {STEPS.map((step) => {
        if (now < step.at) return null;
        if (step.kind === "text") {
          return (
            <Appear key={step.at} className="cc-block">
              {step.lines.map((text, index) => (
                <Line key={text} className="cc-say">
                  <span className="cc-bullet">{index === 0 ? "● " : "  "}</span>
                  {text}
                </Line>
              ))}
            </Appear>
          );
        }
        const running = now < step.outAt;
        const spinner = step.spinner;
        const elapsed = spinner ? Math.round(((now - step.at) / (step.outAt - step.at)) * spinner.seconds) : 0;
        return (
          <Appear key={step.at} className="cc-block">
            <Line className="cc-tool">
              <span className="cc-bullet">{"● "}</span>
              <span className="cc-tool-name">{step.tool}</span>
              <span className="cc-tool-arg">{`(${step.arg})`}</span>
            </Line>
            {running ? (
              spinner ? (
                <>
                  <Line className="cc-out">
                    <span className="cc-gutter">{"  ⎿  "}</span>
                    Running…
                  </Line>
                  {/* 转录末尾那条状态行:命令跑多久了、这一轮往上送了多少 token、怎么中断。 */}
                  <Line className="cc-spin">
                    {`✻ ${spinner.verb}… (${fmtSec(elapsed)} · ↑ ${spinner.tokens} tokens · esc to interrupt)`}
                  </Line>
                </>
              ) : null
            ) : (
              <ToolResult out={step.out} more={step.more} />
            )}
          </Appear>
        );
      })}

      {now >= T.end ? (
        <Line className="cc-user">
          <span className="cc-caret">{"> "}</span>
          <Cursor />
        </Line>
      ) : null}
    </TerminalWindow>
  );
}
