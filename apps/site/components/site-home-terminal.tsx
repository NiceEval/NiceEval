"use client";

import {
  Appear,
  Cursor,
  Line,
  Panel,
  PanelDivider,
  PanelRow,
  TerminalWindow,
  Typed,
  useAnimated,
  useTimeline,
} from "./site-terminal-shell";

// Hero 终端动画:跑一次对比实验，再用 `niceeval show` 在同一个终端里读当前结果。
// 结束反馈的面板形态见 docs/feature/experiments/cli/README.md「结束反馈与 receipt」，
// show 的版式见 docs/feature/inspection/cli.md「当前 Results 示例」。数字是自洽的演示值，终端内容不做 i18n。

// ---- 一次自洽的运行:8 attempt = 4 eval × 2 config,2 条缓存携入,6 条本次派发。
// 计数、成本、矩阵三处的数字彼此对得上:本次派发 330.5k tok / $0.51,矩阵覆盖全部 8 条。
const CMD_RUN = "niceeval exp compare";
const CMD_SHOW = "niceeval show";
const RUN_SECONDS = 127;
const RUN_COST_USD = 0.51;
// locator 格式:@1 加 12 位大写 Crockford base32。
const FAILED_LOCATOR = "@1MEMY3VCQ6B5B";
const RUN_GPT = "4c1e9a07-6b2d-4f3a-9e85-2d7f0b6c1a93";
const RUN_SONNET = "b83f2d14-90ce-4a6b-8f17-5e2a9c40d7b8";
const FAILED_EVAL = "checkout/apply-coupon";
const FAILED_WHO = "compare/gpt-5.4";
const FAILED_ASSERTION = "gate: cart total reflects the SAVE20 coupon";
const FAILED_FACTS = "equals(80) · expected 80 · received 100";

// ---- 时间轴(ms):关键帧集中在这里,不散进 JSX。
const T = {
  cmd1Start: 300,
  cmd1Done: 1500,
  plan: 1850,
  panelIn: 2250,
  failure: 6900,
  panelOut: 11000,
  summary: 11200,
  failures: 11550,
  next: 11900,
  cmd2Start: 12900,
  cmd2Done: 15000,
  head2: 15350,
  table: 15800,
  row1: 16000,
  row2: 16200,
  hidden: 16500,
  end: 17100,
} as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** CLI 的 formatElapsed:一分钟以内只给秒,超过后分钟数 + 两位秒。 */
function fmtSec(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`;
  return `${Math.floor(totalSec / 60)}m ${String(totalSec % 60).padStart(2, "0")}s`;
}

// ---- 本次派发的 6 条 attempt。from/to 是运行进度(0..1),phase 段落按各自的生命周期推进;
// 谁在跑、谁排队、谁已了结全部由这张表算出来,首行计数因此恒满足
// total = reused + running + queued + passed + failed(见 cli.md 的守恒式)。
type Attempt = {
  evalId: string;
  who: string;
  from: number;
  to: number;
  verdict: "passed" | "failed";
  phases: Array<[number, string]>;
};

const REUSED = 2;
const TOTAL = 8;

const ATTEMPTS: Attempt[] = [
  {
    evalId: "checkout/apply-coupon",
    who: "compare/gpt-5.4",
    from: 0,
    to: 0.5,
    verdict: "failed",
    phases: [
      [0, "creating sandbox"],
      [0.1, "running eval: tool: pnpm install"],
      [0.24, "running eval: tool: pnpm vitest run"],
      [0.42, "evaluating assertions: Judge 1/2 · answer-quality ≥ 0.7"],
    ],
  },
  {
    evalId: "checkout/apply-coupon",
    who: "compare/sonnet-5",
    from: 0.012,
    to: 0.78,
    verdict: "passed",
    phases: [
      [0, "creating sandbox"],
      [0.13, "running eval: tool: pnpm vitest run"],
      [0.55, "running eval: assistant: the coupon is applied…"],
      [0.7, "capturing diff"],
    ],
  },
  {
    evalId: "checkout/refund-window",
    who: "compare/gpt-5.4",
    from: 0.03,
    to: 1.2,
    verdict: "passed",
    phases: [
      [0, "queued for sandbox"],
      [0.06, "creating sandbox"],
      [0.2, "running eval: tool: rg refundWindow src/"],
      [0.62, "running eval: turn 3"],
    ],
  },
  {
    evalId: "checkout/refund-window",
    who: "compare/sonnet-5",
    from: 0.05,
    to: 1.2,
    verdict: "passed",
    phases: [
      [0, "creating sandbox"],
      [0.16, "sandbox setup"],
      [0.34, "running eval: tool: pnpm vitest run refund"],
      [0.9, "running eval: assistant: patching src/refund.ts"],
    ],
  },
  {
    evalId: "support/escalation",
    who: "compare/gpt-5.4",
    from: 0.5,
    to: 1.2,
    verdict: "passed",
    phases: [
      [0.5, "creating sandbox"],
      [0.62, "running eval: turn 2"],
      [0.95, "running eval: tool: pnpm vitest run support"],
    ],
  },
  {
    evalId: "support/escalation",
    who: "compare/sonnet-5",
    from: 0.78,
    to: 1.2,
    verdict: "passed",
    phases: [
      [0.78, "creating sandbox"],
      [0.92, "running eval: tool: pnpm install"],
    ],
  },
];

const VISIBLE_SLOTS = 3;

function phaseAt(attempt: Attempt, p: number): string {
  let text = attempt.phases[0][1];
  for (const [at, label] of attempt.phases) if (p >= at) text = label;
  return text;
}

function countsAt(p: number) {
  const running = ATTEMPTS.filter((a) => p >= a.from && p < a.to).length;
  const queued = ATTEMPTS.filter((a) => p < a.from).length;
  const done = ATTEMPTS.filter((a) => p >= a.to);
  return {
    running,
    queued,
    passed: done.filter((a) => a.verdict === "passed").length,
    failed: done.filter((a) => a.verdict === "failed").length,
  };
}

export default function TerminalDemo({ ariaLabel, replayLabel }: { ariaLabel: string; replayLabel: string }) {
  const animated = useAnimated();
  const { now, play } = useTimeline(T.end, animated);

  const p = clamp01((now - T.panelIn) / (T.panelOut - T.panelIn));
  const counts = countsAt(p);
  const active = ATTEMPTS.filter((a) => p >= a.from && p < a.to);
  const shown = active.slice(0, VISIBLE_SLOTS);
  const hidden = active.length - shown.length;

  return (
    <TerminalWindow
      label="niceeval"
      animated={animated}
      onReplay={play}
      replayLabel={replayLabel}
      ariaLabel={ariaLabel}
    >
      <Line>
        <span className="term-prompt">$ </span>
        <Typed text={CMD_RUN} msPerChar={(T.cmd1Done - T.cmd1Start) / CMD_RUN.length} start={T.cmd1Start} now={now} />
        {animated && now < T.plan ? <Cursor /> : null}
      </Line>

      {now >= T.plan ? (
        <Appear>
          <Panel title="PLAN">
            <PanelRow>8 attempts · 4 evals × 2 configs · concurrency 4</PanelRow>
            <PanelRow>2 of 8 carried in from cache · 6 to run</PanelRow>
          </Panel>
        </Appear>
      ) : null}

      {/* 失败证据:live 面板先撤下,这两行永久追加进 scrollback,面板再在下方重建。 */}
      {now >= T.failure ? (
        <Appear>
          <Line>
            <b className="fail">✗</b> {`${FAILED_LOCATOR} ${FAILED_EVAL} [${FAILED_WHO}]`}
          </Line>
          <Line className="soft term-indent-4">{FAILED_ASSERTION}</Line>
          <Line className="soft term-indent-8">{FAILED_FACTS}</Line>
        </Appear>
      ) : null}

      {/* live 面板:只在运行期间存在,结束后被结论面板取代(TTY 动态区的真实行为)。 */}
      {now >= T.panelIn && now < T.panelOut ? (
        <Panel title={CMD_RUN} meta={fmtSec(Math.round(p * RUN_SECONDS))} footer={`$${(p * RUN_COST_USD).toFixed(2)}`}>
          {/* 首行守恒计数。放不下时按 cli.md 的面板降级规则先丢值为零的结局项(errored、
              unreadable),非零结局与 failed 永不丢弃 —— 窄终端打出来的就是下面这条短行。 */}
          <PanelRow>
            <span className="counts-wide">
              {`${TOTAL} total · ${REUSED} reused · ${counts.running} running · ${counts.queued} queued · ` +
                `${counts.passed} passed · ${counts.failed} failed · 0 errored · 0 unreadable`}
            </span>
            <span className="counts-narrow">
              {`${TOTAL} total · ${REUSED} reused · ${counts.running} running · ${counts.queued} queued · ` +
                `${counts.passed} passed · ${counts.failed} failed`}
            </span>
          </PanelRow>
          <PanelDivider title="ACTIVE" />
          {shown.map((a) => (
            <PanelRow key={`${a.evalId}-${a.who}`} className="slot">
              <span className="term-dot">●</span>
              <span className="slot-eval">{a.evalId}</span>
              <span className="soft slot-who">{a.who}</span>
              <span className="slot-time">{fmtSec(Math.max(1, Math.round((p - a.from) * RUN_SECONDS)))}</span>
              <span className="soft slot-phase">{phaseAt(a, p)}</span>
            </PanelRow>
          ))}
          {hidden > 0 ? <PanelRow className="soft">{`… ${hidden} more active`}</PanelRow> : null}
        </Panel>
      ) : null}

      {now >= T.summary ? (
        <Appear>
          <Panel title="FAILED" titleTone="fail" meta={fmtSec(RUN_SECONDS)}>
            <PanelRow>7 passed · 1 failed · 0 errored  (2 reused)</PanelRow>
            <PanelRow className="soft">330.5k new tok · $0.51</PanelRow>
          </Panel>
        </Appear>
      ) : null}

      {now >= T.failures ? (
        <Appear>
          <Panel title="FAILURES" meta="1 failed attempt">
            <PanelRow>
              <b className="fail">✗</b> {`${FAILED_LOCATOR}  ${FAILED_EVAL}  [${FAILED_WHO}]`}
            </PanelRow>
            <PanelRow className="soft">{`  ${FAILED_ASSERTION}`}</PanelRow>
            <PanelRow className="soft">{`  details: niceeval show ${FAILED_LOCATOR}`}</PanelRow>
          </Panel>
        </Appear>
      ) : null}

      {now >= T.next ? (
        <Appear>
          <Panel title="NEXT">
            <PanelRow>compare/gpt-5.4</PanelRow>
            <PanelRow className="soft">{`  show: niceeval show --run ${RUN_GPT}`}</PanelRow>
            <PanelRow className="soft">{`  view: niceeval view --run ${RUN_GPT}`}</PanelRow>
            <PanelRow>compare/sonnet-5</PanelRow>
            <PanelRow className="soft">{`  show: niceeval show --run ${RUN_SONNET}`}</PanelRow>
            <PanelRow className="soft">{`  view: niceeval view --run ${RUN_SONNET}`}</PanelRow>
          </Panel>
        </Appear>
      ) : null}

      {now >= T.cmd2Start ? (
        <Line>
          <span className="term-prompt">$ </span>
          <Typed
            text={CMD_SHOW}
            msPerChar={(T.cmd2Done - T.cmd2Start) / CMD_SHOW.length}
            start={T.cmd2Start}
            now={now}
          />
          {animated && now < T.head2 ? <Cursor /> : null}
        </Line>
      ) : null}

      {now >= T.head2 ? (
        <Appear>
          <Line>Current results</Line>
          <Line className="soft term-indent-4">Covered 8/8 · Gaps 0 · 7 passed; 1 failed; 0 errored; 0 skipped</Line>
        </Appear>
      ) : null}

      {now >= T.table ? (
        <div className="term-table">
          <span className="soft">Experiment</span>
          <span className="soft">Covered</span>
          <span className="soft">Gaps</span>
          <span className="soft">Pass rate</span>
          {now >= T.row1 ? (
            <>
              <span>compare/gpt-5.4</span>
              <span>4/4</span>
              <span>0</span>
              <span>
                <b className="fail">75.00%</b>
              </span>
            </>
          ) : null}
          {now >= T.row2 ? (
            <>
              <span>compare/sonnet-5</span>
              <span>4/4</span>
              <span>0</span>
              <span>
                <b className="pass">100.00%</b>
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      {now >= T.hidden ? (
        <Appear>
          <Line>{`Attempts · compare/gpt-5.4`}</Line>
          <Line className="soft term-indent-4">{`Eval ${FAILED_EVAL}  ${FAILED_LOCATOR}  failed  41.20 s`}</Line>
          <Line className="soft term-indent-4">3 passed Attempts hidden</Line>
        </Appear>
      ) : null}

      {now >= T.end ? (
        <Line>
          <span className="term-prompt">$ </span>
          <Cursor />
        </Line>
      ) : null}
    </TerminalWindow>
  );
}
