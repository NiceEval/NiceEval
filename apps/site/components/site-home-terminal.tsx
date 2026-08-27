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

// Hero 终端动画:运行 Eval 后，机器先发现固定 Inspection operation，再执行固定 request；
// 人需要连续阅读时在第一方 View 中打开相同结果。数字是自洽的演示值，终端内容不做 i18n。

// ---- 一次自洽的运行:8 attempt = 4 eval × 2 config,2 条缓存携入,6 条本次派发。
// 计数、成本、矩阵三处的数字彼此对得上:本次派发 330.5k tok / $0.51,矩阵覆盖全部 8 条。
const CMD_RUN = "niceeval exp compare";
const CMD_SHOW = "niceeval query run --request runs-compare.json";
const RUN_SECONDS = 127;
const RUN_COST_USD = 0.51;
const FAILED_LOCATOR = "@1bwcxxiy";
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
  table: 15700,
  row1: 15850,
  row2: 16000,
  row3: 16150,
  row4: 16300,
  totals: 16600,
  delta: 16800,
  end: 17300,
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
      [0.42, 'evaluating assertions: judge 1/2 · closedQA("cart total …")'],
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
          <Panel title="FAILURES">
            <PanelRow>{`${FAILED_LOCATOR}  ${FAILED_EVAL}  [${FAILED_WHO}]`}</PanelRow>
            <PanelRow className="soft">{`  ${FAILED_ASSERTION}`}</PanelRow>
            <PanelRow className="soft">{`        ${FAILED_FACTS}`}</PanelRow>
          </Panel>
        </Appear>
      ) : null}

      {now >= T.next ? (
        <Appear>
          <Panel title="NEXT">
            <PanelRow>Catalog: niceeval query discover</PanelRow>
            <PanelRow>Runs:    niceeval query run --request runs-list.json</PanelRow>
            <PanelRow>Attempt: niceeval query run --request attempt.json</PanelRow>
            <PanelRow>Compare: niceeval query run --request runs-compare.json</PanelRow>
            <PanelRow>{`Human:   niceeval view ${FAILED_LOCATOR}`}</PanelRow>
            <PanelDivider title="RESULTS" />
            <PanelRow className="soft">.niceeval/compare/gpt-5.4/2026-07-30T09-14-22-118Z-i080</PanelRow>
            <PanelRow className="soft">.niceeval/compare/sonnet-5/2026-07-30T09-14-22-140Z-b3kq</PanelRow>
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
          <Line>compare · 2 conditions · paired by eval id · baseline compare/gpt-5.4</Line>
          <Line className="soft">common 4 · compare/gpt-5.4 only 0 · compare/sonnet-5 only 0</Line>
        </Appear>
      ) : null}

      {now >= T.table ? (
        <div className="term-table">
          <span className="soft">eval</span>
          <span className="soft">gpt-5.4</span>
          <span className="soft">sonnet-5</span>
          <span className="soft">Δ sonnet-5</span>
          {now >= T.row1 ? (
            <>
              <span>checkout/apply-coupon</span>
              <span>
                <b className="fail">✗</b> 84.9k $0.14
              </span>
              <span>
                <b className="pass">✓</b> 61.2k $0.09
              </span>
              <span className="soft">⇄ -23.7k -$0.05</span>
            </>
          ) : null}
          {now >= T.row2 ? (
            <>
              <span>checkout/refund-window</span>
              <span>
                <b className="pass">✓</b> 52.4k $0.08
              </span>
              <span>
                <b className="pass">✓</b> 57.9k $0.09
              </span>
              <span className="soft">+5.5k +$0.01</span>
            </>
          ) : null}
          {now >= T.row3 ? (
            <>
              <span>support/order-status</span>
              <span>
                <b className="pass">✓</b> ↩ 2h 38.1k $0.06
              </span>
              <span>
                <b className="pass">✓</b> ↩ 2h 35.2k $0.05
              </span>
              <span className="soft">-2.9k -$0.01</span>
            </>
          ) : null}
          {now >= T.row4 ? (
            <>
              <span>support/escalation</span>
              <span>
                <b className="pass">✓</b> 40.3k $0.06
              </span>
              <span>
                <b className="pass">✓</b> 33.8k $0.05
              </span>
              <span className="soft">-6.5k -$0.01</span>
            </>
          ) : null}
          {now >= T.totals ? (
            <>
              <span className="soft">totals</span>
              <span>3/4 passed 215.7k $0.34</span>
              <span>4/4 passed 188.1k $0.28</span>
              <span />
            </>
          ) : null}
        </div>
      ) : null}

      {now >= T.delta ? (
        <Line className="soft">common vs baseline · pass rate +25.0pt · tokens -27.6k · cost -$0.06</Line>
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
