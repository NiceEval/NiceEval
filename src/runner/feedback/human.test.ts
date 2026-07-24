// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「human renderer 的面板接线到 panel.ts」:证明 renderDurableLines / live dashboard
// 真的把内容交给 panel.ts 的 renderPanel,而不是各自拼框字符——面板几何本身(截断优先级、
// 宽度上限、CJK 量测……)由 src/report/model/panel.test.ts 覆盖,这里只断言「确实调用了」:
// boxed 能力下产生可识别的框线字符与正确的面板顺序/分隔,plain/非 TTY 下不产生任何框字符。

import { afterEach, describe, expect, it } from "vitest";
import { createHumanRenderer, renderDurableLines, renderHumanDryPlan } from "./human.ts";
import { createFakeFeedbackIO } from "./testing.ts";
import { createInitialRunFeedbackState, reduceRunFeedback } from "./reducer.ts";
import { encodeAttemptKey, HALT_DIAGNOSTIC_CODE } from "../types.ts";
import { stringWidth } from "../../report/model/text-layout.ts";
import type { DurableFeedbackEvent, InvocationCompletion, InvocationSummary, RunFeedbackPlan, RunFeedbackState } from "../types.ts";
import type { AttemptLocator } from "../../results/locator.ts";

function locator(raw: string): AttemptLocator {
  return raw as AttemptLocator;
}

function plan(overrides: Partial<RunFeedbackPlan> = {}): RunFeedbackPlan {
  return {
    shape: { evals: 9, configs: 5, totalAttempts: 45, maxConcurrency: 19 },
    reused: 6,
    reusedFailures: [],
    ...overrides,
  };
}

function summary(overrides: Partial<InvocationSummary> = {}): InvocationSummary {
  return {
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:03:48.000Z",
    passed: 44,
    failed: 1,
    skipped: 0,
    errored: 0,
    durationMs: 228_000,
    results: [],
    ...overrides,
  };
}

function completion(overrides: Partial<InvocationCompletion> = {}): InvocationCompletion {
  return { status: "complete", unstarted: 0, earlyExitUnstarted: 0, reporterErrors: [], ...overrides };
}

const BOX_CHARS = /[╭╮╰╯├┤]/;

function stateWithFailureAndKept(): RunFeedbackState {
  const base = createInitialRunFeedbackState();
  return {
    ...base,
    total: 45,
    reused: 6,
    failures: [
      {
        at: 0,
        locator: locator("@1bwcxxiy"),
        identity: { experimentId: "compare", evalId: "memory/swelancer-manager-15193", attempt: 0 },
        who: "dev-e2b/claude-e2b",
        verdict: "failed",
        reason: "gate failed",
      },
    ],
    kept: [
      {
        at: 0,
        locator: locator("@1x7f3q9k"),
        identity: { experimentId: "compare", evalId: "onboarding/tool-first", attempt: 0 },
        who: "compare/bub-e2b",
        verdict: "errored",
        provider: "docker",
        sandboxId: "a3f9c2d1",
      },
    ],
  };
}

describe("renderDurableLines — 面板事件接线到 panel.ts", () => {
  it("plan 事件在 boxed 能力下产生 PLAN 面板(panel.ts 的框线字符,不是手拼)", () => {
    const state = createInitialRunFeedbackState();
    const event: DurableFeedbackEvent = { type: "plan", at: 0, plan: plan() };
    const lines = renderDurableLines(event, state, { mode: "boxed", width: 82 });
    expect(lines[0]).toMatch(/^╭─ PLAN /);
    expect(lines.at(-1)).toMatch(/^╰─+╯$/);
    expect(lines.join("\n")).toContain("45 attempts");
    expect(lines.join("\n")).toContain("6 of 45 carried in from cache");
  });

  it("plan 事件在 plain 能力下不产生任何框字符,内容仍完整", () => {
    const state = createInitialRunFeedbackState();
    const event: DurableFeedbackEvent = { type: "plan", at: 0, plan: plan() };
    const lines = renderDurableLines(event, state, { mode: "plain", width: 82 });
    expect(lines.join("\n")).not.toMatch(BOX_CHARS);
    expect(lines.join("\n")).toContain("PLAN");
    expect(lines.join("\n")).toContain("45 attempts");
  });

  it("summary 事件产生三个独立的面板(FAILED/FAILURES/KEPT SANDBOXES),各自成框、之间空行分隔", () => {
    const state = stateWithFailureAndKept();
    const event: DurableFeedbackEvent = { type: "summary", at: 0, summary: summary(), completion: completion() };
    const lines = renderDurableLines(event, state, { mode: "boxed", width: 82 });
    const text = lines.join("\n");
    // 三个面板各自的完整边框都出现
    expect(lines.filter((l) => /^╭/.test(l))).toHaveLength(3);
    expect(lines.filter((l) => /^╰/.test(l))).toHaveLength(3);
    expect(text).toMatch(/^╭─ FAILED /m);
    expect(text).toMatch(/^╭─ FAILURES/m);
    expect(text).toMatch(/^╭─ KEPT SANDBOXES /m);
    // 面板之间用空行分隔(不是紧贴在一起的三个框)
    expect(text).toMatch(/╯\n\n╭/);
    // 留存面板下边框嵌批量清理命令,内容携带 locator/provider/enter 命令
    expect(text).toContain("niceeval sandbox stop --all");
    expect(text).toContain("enter: niceeval sandbox enter a3f9c2d1");
  });

  it("summary 事件在 plain 能力下不产生任何框字符,三块内容仍都存在", () => {
    const state = stateWithFailureAndKept();
    const event: DurableFeedbackEvent = { type: "summary", at: 0, summary: summary(), completion: completion() };
    const lines = renderDurableLines(event, state, { mode: "plain", width: 82 });
    const text = lines.join("\n");
    expect(text).not.toMatch(BOX_CHARS);
    expect(text).toContain("FAILED");
    expect(text).toContain("FAILURES");
    expect(text).toContain("KEPT SANDBOXES");
  });

  it("全部通过、没有留存时只有一个 FAILED/PASSED 面板,不留空的 FAILURES/KEPT SANDBOXES 框", () => {
    const state = createInitialRunFeedbackState();
    const event: DurableFeedbackEvent = {
      type: "summary",
      at: 0,
      summary: summary({ passed: 45, failed: 0, errored: 0 }),
      completion: completion(),
    };
    const lines = renderDurableLines(event, state, { mode: "boxed", width: 82 });
    expect(lines.filter((l) => /^╭/.test(l))).toHaveLength(1);
    expect(lines[0]).toMatch(/^╭─ PASSED /);
  });

  it("saved 事件产生 NEXT 面板,内嵌 RESULTS 横隔(不是独立的第二个框)", () => {
    const state = stateWithFailureAndKept();
    const event: DurableFeedbackEvent = {
      type: "saved",
      at: 0,
      paths: [".niceeval/compare/bub-e2b/s1", ".niceeval/compare/codex/s2"],
    };
    const lines = renderDurableLines(event, state, { mode: "boxed", width: 82 });
    const text = lines.join("\n");
    expect(lines[0]).toMatch(/^╭─ NEXT /);
    expect(lines.filter((l) => /^╭/.test(l))).toHaveLength(1); // 只有最外层一个框
    expect(text).toMatch(/^├─ RESULTS ─+┤$/m);
    expect(text).toContain("Inspect: niceeval show @1bwcxxiy"); // 首条失败的下钻命令
    expect(text).toContain("Compare: niceeval view");
    expect(text).toContain(".niceeval/compare/bub-e2b/s1");
  });

  it("saved 事件在没有失败时,NEXT 面板不包含下钻命令,只有 Compare 与 RESULTS", () => {
    const state = createInitialRunFeedbackState();
    const event: DurableFeedbackEvent = { type: "saved", at: 0, paths: [".niceeval/compare/s1"] };
    const lines = renderDurableLines(event, state, { mode: "boxed", width: 82 });
    const text = lines.join("\n");
    expect(text).not.toContain("Inspect:");
    expect(text).toContain("Compare: niceeval view");
    expect(text).toMatch(/^├─ RESULTS ─+┤$/m);
  });
});

describe("live dashboard — 接线到 panel.ts", () => {
  afterEach(() => {
    // 无需清理:createHumanRenderer 不挂全局状态,只是确保测试之间互不影响的显式记号。
  });

  it("TTY + boxed 能力下,live 面板产生完整框线,ACTIVE 降为横隔而不是独立框", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 82, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    const identity = { experimentId: "compare", evalId: "memory/agent-029-use-cac", attempt: 0 };
    const key = encodeAttemptKey(identity);
    const state: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 45,
      reused: 6,
      running: 19,
      queued: 12,
      completed: 8,
      elapsedMs: 134_000,
      estimatedCostUSD: 0.84,
      active: new Map([[key, { identity, who: "compare/bub-e2b", phase: "eval.run", phaseStartedAt: 0 }]]),
    };
    renderer.onLifecycle?.({ type: "attempt:start", at: 0, identity, who: "compare/bub-e2b", phase: "eval.run" }, state);
    renderer.redrawDynamic?.(state);

    const written = stderr.writes.join("");
    // eslint-disable-next-line no-control-regex
    const plain = written.replace(/\x1B\[[0-9]*[A-Za-z]/g, "");
    expect(plain).toMatch(/^╭─ niceeval exp compare /);
    expect(plain).toMatch(/├─ ACTIVE ─+┤/);
    expect(plain).toMatch(/╰─+ \$0\.84\d* ─╯/);
    expect(plain).toContain("memory/agent-029-use-cac".slice(0, 10)); // 身份列可能因窄宽被截断,只核对前缀
  });

  it("非 TTY(append-only 变体)不产生任何框字符——同一 renderDurableLines 但走 plain 能力", () => {
    const { io, stdout, stderr } = createFakeFeedbackIO({ stderr: { isTTY: false } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    renderer.appendDurable(
      { type: "plan", at: 0, plan: plan() },
      { ...createInitialRunFeedbackState(), total: 45, reused: 6 },
    );
    const written = stdout.writes.join("") + stderr.writes.join("");
    expect(written).not.toMatch(BOX_CHARS);
    expect(written).toContain("PLAN");
  });

  // 补充裁决(memory/exp-output-two-forms-ruling.md):非 TTY 人读文本从 start 到结束摘要走单一
  // 有序 stdout 流,stderr 只留启动期错误——不再像 TTY 变体那样把永久事件分流到 stderr。
  it("非 TTY:永久事件、运行级瞬时通知、heartbeat 全部落 stdout,stderr 全程为空", () => {
    const { io, stdout, stderr } = createFakeFeedbackIO({ stderr: { isTTY: false } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    const state = { ...createInitialRunFeedbackState(), total: 45, reused: 6 };
    renderer.appendDurable({ type: "plan", at: 0, plan: plan() }, state);
    renderer.activity?.("pulling docker image node:24-slim...", state);
    renderer.onTick?.({ type: "tick", at: 40_000, elapsedMs: 40_000 }, state);
    renderer.appendDurable(
      { type: "summary", at: 40_000, summary: summary({ passed: 45, failed: 0, errored: 0 }), completion: completion() },
      state,
    );
    renderer.appendDurable({ type: "saved", at: 40_000, paths: [".niceeval/compare/s1"] }, state);

    expect(stderr.writes).toEqual([]);
    const out = stdout.writes.join("");
    expect(out).toContain("PLAN");
    expect(out).toContain("pulling docker image node:24-slim...");
    expect(out).toContain("PASSED");
  });
});

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1B\[[0-9]*[A-Za-z]/g;
function stripAnsi(written: string): string {
  return written.replace(ANSI_ESCAPE, "");
}

// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「live 面板的宽度与 ACTIVE 列分配」:live 面板豁免 100 列上限跟随终端全宽,行内容与
// 外框同一个宽度值;身份列(evalId/who)按本次运行实际出现过的最长值定宽,只放宽不回缩,
// 各自封顶内容宽 40% / 20%,超宽尾部截断补「…」;detail 拿到其余全部宽度。断言面是
// `redrawDynamic` 实际写入 stderr 的渲染帧文本(剥离 ANSI 光标控制序列后),不是内部算式。
describe("live dashboard — 宽终端下 ACTIVE 行与身份列分配", () => {
  it("宽终端(columns 200)ACTIVE 行 phase/detail 完整可见,行内容与外框同一个宽度值 // bug: memory/live-dashboard-active-row-width-clamp-mismatch.md", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 200, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    const identity = { experimentId: "compare", evalId: "memory/agent-029-use-cache", attempt: 0 };
    const key = encodeAttemptKey(identity);
    // 98 个字符:比旧 bug 里实际生效的框内容宽(100 列上限下约 96 列)更长,只有两处宽度
    // 计算(contentWidth 与 renderPanel 内部 boxWidth)真的用同一个豁免声明时才会整段可见。
    const longDetail = "pnpm vitest run --coverage --reporter=verbose src/runner/feedback/human.test.ts --update-snapshots";
    const state: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 45,
      reused: 6,
      running: 19,
      queued: 12,
      completed: 8,
      elapsedMs: 134_000,
      active: new Map([
        [key, { identity, who: "compare/bub-e2b", phase: "eval.run", phaseStartedAt: 0, detail: longDetail }],
      ]),
    };
    renderer.onLifecycle?.(
      { type: "attempt:start", at: 0, identity, who: "compare/bub-e2b", phase: "eval.run" },
      state,
    );
    renderer.redrawDynamic?.(state);

    const plain = stripAnsi(stderr.writes.join(""));
    const lines = plain.split("\n").filter(Boolean);
    // 行内容与外框必须按同一个宽度值计算:每一行(边框 + ACTIVE 行)显示宽度恒等,且跟随
    // 200 列终端全宽,不被 100 上限钳制。
    const widths = new Set(lines.map((l) => stringWidth(l)));
    expect(widths.size).toBe(1);
    expect([...widths][0]).toBe(200);
    // phase/detail 完整出现,不在中途被框吃掉。
    expect(plain).toContain(longDetail);
  });

  it("judge 预检期间显示运行级行:面板停在 0 running · 1 queued 时给出「在预检」的解释,而不是看起来卡死", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 100, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp install/canary" });
    // 复现用户报的场景:预检未返回时计数预置为 1 queued、0 running。运行级行是它停在
    // queued 的解释(排在 ACTIVE 区),不加这行时面板只有一个冻在 queued 的计数,像调度卡死。
    const state: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 1,
      running: 0,
      queued: 1,
      elapsedMs: 12_000,
      activePrecheck: { startedAt: 0 },
    };
    renderer.redrawDynamic?.(state);

    const plain = stripAnsi(stderr.writes.join(""));
    expect(plain).toMatch(/├─ ACTIVE ─+┤/);
    expect(plain).toContain("prechecking judge config");
    expect(plain).toContain("0 running · 1 queued");
  });

  it("短 id 不垫空格:身份列贴着实际内容定宽,不按比例预留大段空白", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 200, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    const identity = { experimentId: "compare", evalId: "e1", attempt: 0 };
    const key = encodeAttemptKey(identity);
    const state: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 1,
      running: 1,
      active: new Map([[key, { identity, who: "w1", phase: "eval.run", phaseStartedAt: 0 }]]),
    };
    renderer.onLifecycle?.({ type: "attempt:start", at: 0, identity, who: "w1", phase: "eval.run" }, state);
    renderer.redrawDynamic?.(state);

    const plain = stripAnsi(stderr.writes.join(""));
    // "e1"/"w1" 是本次运行里唯一出现过的值,列宽就该等于各自的实际长度——不是旧 bug 那样
    // 按比例把短 id 垫到一大段空白(memory 台账截图:eval 22 字符垫到 27、who 6 字符垫到 22)。
    expect(plain).toContain("● e1  w1  ");
  });

  it("身份列跨帧单调:长 id 出现后,后续短 id 所在帧的列宽不回缩", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 200, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    const who = "compare/bub-e2b";
    const longIdentity = { experimentId: "compare", evalId: "memory/agent-100-a-fairly-long-eval-id", attempt: 0 };
    const shortIdentity = { experimentId: "compare", evalId: "short/id", attempt: 0 };
    const longKey = encodeAttemptKey(longIdentity);
    const shortKey = encodeAttemptKey(shortIdentity);

    const frame1State: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 2,
      running: 1,
      queued: 1,
      active: new Map([[longKey, { identity: longIdentity, who, phase: "eval.run", phaseStartedAt: 0 }]]),
    };
    renderer.onLifecycle?.(
      { type: "attempt:start", at: 0, identity: longIdentity, who, phase: "eval.run" },
      frame1State,
    );
    renderer.redrawDynamic?.(frame1State);
    const frame1 = stripAnsi(stderr.writes.join(""));
    const whoIndexFrame1 = frame1.indexOf(who);
    expect(whoIndexFrame1).toBeGreaterThan(-1);

    const markBeforeFrame2 = stderr.writes.length;
    renderer.onLifecycle?.(
      { type: "attempt:complete", at: 1, identity: longIdentity, who, verdict: "passed" },
      frame1State,
    );
    const frame2State: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 2,
      running: 1,
      completed: 1,
      active: new Map([[shortKey, { identity: shortIdentity, who, phase: "eval.run", phaseStartedAt: 1 }]]),
    };
    renderer.onLifecycle?.(
      { type: "attempt:start", at: 1, identity: shortIdentity, who, phase: "eval.run" },
      frame2State,
    );
    renderer.redrawDynamic?.(frame2State);
    const frame2 = stripAnsi(stderr.writes.slice(markBeforeFrame2).join(""));
    const whoIndexFrame2 = frame2.indexOf(who);

    // 短 id 这一帧,"who" 列仍从与长 id 那一帧相同的位置开始起——列宽只放宽不回缩,
    // 不因为当前行内容变短就跟着变窄。
    expect(frame2).toContain("short/id");
    expect(whoIndexFrame2).toBe(whoIndexFrame1);
  });

  it("身份列各自封顶内容宽的 40% / 20%,超出封顶的值尾部截断补 …", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 200, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    // contentWidth = 200 - 4(边框+padding)= 196;封顶 = floor(196*0.4)=78 / floor(196*0.2)=39。
    const longEvalId = `memory/${"a".repeat(100)}`; // 107 字符,远超 78 的封顶
    const longWho = `compare/${"b".repeat(50)}`; // 58 字符,远超 39 的封顶
    const identity = { experimentId: "compare", evalId: longEvalId, attempt: 0 };
    const key = encodeAttemptKey(identity);
    const state: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 1,
      running: 1,
      active: new Map([[key, { identity, who: longWho, phase: "eval.run", phaseStartedAt: 0 }]]),
    };
    renderer.onLifecycle?.({ type: "attempt:start", at: 0, identity, who: longWho, phase: "eval.run" }, state);
    renderer.redrawDynamic?.(state);

    const plain = stripAnsi(stderr.writes.join(""));
    const evalCap = 78;
    const whoCap = 39;
    const evalCol = `${longEvalId.slice(0, evalCap - 1)}…`;
    const whoCol = `${longWho.slice(0, whoCap - 1)}…`;
    expect(plain).toContain(`● ${evalCol}  ${whoCol}  `);
  });

  it("scrollback 永久面板(PLAN/FAILED/FAILURES)在宽终端下仍封顶 100,不继承 live 面板的豁免", () => {
    const planLines = renderDurableLines(
      { type: "plan", at: 0, plan: plan() },
      createInitialRunFeedbackState(),
      { mode: "boxed", width: 200 },
    );
    expect(stringWidth(planLines[0]!)).toBe(100);

    const summaryLines = renderDurableLines(
      { type: "summary", at: 0, summary: summary(), completion: completion() },
      stateWithFailureAndKept(),
      { mode: "boxed", width: 200 },
    );
    const framedLines = summaryLines.filter((l) => /^[╭╰├]/.test(l));
    expect(framedLines.length).toBeGreaterThan(0);
    for (const l of framedLines) expect(stringWidth(l)).toBe(100);
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「用例锁与并发 Invocation」——
// 字节级精确渲染归 E2E · CLI「反馈输出格式」;这里只做与 precheck/experiment-hook 同等级别
// 的最小 smoke 断言(行是否出现、关键子串是否存在),不断言列宽算术。
describe("用例锁等待(elsewhere)的显示", () => {
  it("TTY:等待期间显示运行级行,面板首行的 elsewhere 计数非零", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 100, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare/codex" });
    const state: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 3,
      elsewhere: 2,
      queued: 1,
      lockWaits: new Map([
        [
          "compare/codex",
          {
            experimentId: "compare/codex",
            waiting: new Map([
              ["memory/a", { startedAt: 0, holderPid: 41267, holderHost: "mba.local" }],
              ["memory/b", { startedAt: 5, holderPid: 41267, holderHost: "mba.local" }],
            ]),
            resolvedCarried: 0,
            resolvedDispatched: 0,
          },
        ],
      ]),
    };
    renderer.redrawDynamic?.(state);

    const plain = stripAnsi(stderr.writes.join(""));
    expect(plain).toMatch(/├─ ACTIVE ─+┤/);
    expect(plain).toContain("waiting on another run");
    expect(plain).toContain("compare/codex");
    expect(plain).toContain("2 evals");
    expect(plain).toContain("pid 41267");
    expect(plain).toContain("2 elsewhere");
  });

  it("TTY appendDurable 对 lock-wait 直接返回,不写 scrollback 永久行(运行级行由 state.lockWaits 驱动)", () => {
    const { io, stdout, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 100, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare/codex" });
    const state: RunFeedbackState = { ...createInitialRunFeedbackState(), total: 1, elsewhere: 1 };
    renderer.appendDurable(
      { type: "lock-wait", at: 0, experimentId: "compare/codex", evalId: "memory/a", status: "started", attempts: 1, holderPid: 1, holderHost: "h" },
      state,
    );
    expect(stdout.writes.join("") + stderr.writes.join("")).toBe("");
  });

  it("非 TTY:started 只在窗口第一次打开(唯一等待用例)时追加一行,中途加入的用例不逐条刷屏", () => {
    const { io, stdout } = createFakeFeedbackIO({ stderr: { isTTY: false } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare/codex" });
    const firstState: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 2,
      elsewhere: 1,
      lockWaits: new Map([
        [
          "compare/codex",
          {
            experimentId: "compare/codex",
            waiting: new Map([["memory/a", { startedAt: 0, holderPid: 41267 }]]),
            resolvedCarried: 0,
            resolvedDispatched: 0,
          },
        ],
      ]),
    };
    renderer.appendDurable(
      { type: "lock-wait", at: 0, experimentId: "compare/codex", evalId: "memory/a", status: "started", attempts: 1, holderPid: 41267, holderHost: "h" },
      firstState,
    );
    const secondState: RunFeedbackState = {
      ...firstState,
      elsewhere: 2,
      lockWaits: new Map([
        [
          "compare/codex",
          {
            ...firstState.lockWaits.get("compare/codex")!,
            waiting: new Map([
              ["memory/a", { startedAt: 0, holderPid: 41267 }],
              ["memory/b", { startedAt: 1, holderPid: 41267 }],
            ]),
          },
        ],
      ]),
    };
    renderer.appendDurable(
      { type: "lock-wait", at: 1, experimentId: "compare/codex", evalId: "memory/b", status: "started", attempts: 1, holderPid: 41267, holderHost: "h" },
      secondState,
    );

    const out = stdout.writes.join("");
    expect(out).toContain("waiting on another run · compare/codex");
    // 只出现一次:第二条(memory/b 加入)是同一窗口内的非首条,静默不刷屏。
    expect(out.split("waiting on another run").length - 1).toBe(1);
  });

  it("非 TTY:resolved 只在窗口最后一次关闭(全部等待用例都已解决)时追加聚合收尾行", () => {
    const { io, stdout } = createFakeFeedbackIO({ stderr: { isTTY: false } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare/codex" });
    // 还剩一个用例没解决:窗口未关闭,静默。
    const stillWaitingState: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      lockWaits: new Map([
        [
          "compare/codex",
          {
            experimentId: "compare/codex",
            waiting: new Map([["memory/b", { startedAt: 1, holderPid: 1 }]]),
            resolvedCarried: 2,
            resolvedDispatched: 0,
          },
        ],
      ]),
    };
    renderer.appendDurable(
      { type: "lock-wait", at: 5, experimentId: "compare/codex", evalId: "memory/a", status: "resolved", carried: 2, dispatched: 0, waitedMs: 5_000 },
      stillWaitingState,
    );
    expect(stdout.writes.join("")).toBe("");

    // 最后一个也解决了:窗口关闭,打印聚合收尾行(carried + dispatched 混合的措辞两面都要覆盖)。
    const closedState: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      lockWaits: new Map([
        [
          "compare/codex",
          {
            experimentId: "compare/codex",
            waiting: new Map(),
            resolvedCarried: 2,
            resolvedDispatched: 1,
          },
        ],
      ]),
    };
    renderer.appendDurable(
      { type: "lock-wait", at: 94_000, experimentId: "compare/codex", evalId: "memory/b", status: "resolved", carried: 0, dispatched: 1, waitedMs: 94_000 },
      closedState,
    );
    const out = stdout.writes.join("");
    expect(out).toContain("lock wait resolved · compare/codex");
    expect(out).toContain("2 carried");
    expect(out).toContain("1 to run");
  });
});

describe("诊断行:标题读稳定词法,止损闸落闸是一行 error 级通知", () => {
  /** 把同一条诊断喂 N 次(emitter 刷新 data.unstarted 时就是这个形状),返回每一次的渲染行。 */
  function replayDiagnostic(event: DurableFeedbackEvent & { type: "diagnostic" }, times: number): string[][] {
    let state = createInitialRunFeedbackState();
    const out: string[][] = [];
    for (let i = 0; i < times; i++) {
      state = reduceRunFeedback(state, event);
      out.push(renderDurableLines(event, state, { mode: "plain", width: 100 }));
    }
    return out;
  }

  it("普通诊断的标题用 code,不把编了身份的去重 key 甩进人读的一行", () => {
    const [lines] = replayDiagnostic(
      {
        type: "diagnostic",
        at: 0,
        key: "lock-taken-over:compare/codex|memory/retention",
        code: "lock-taken-over",
        severity: "warning",
        message: "took over a stale lock from pid 41267",
      },
      1,
    );
    expect(lines![0]).toBe("! lock-taken-over");
    expect(lines![1]).toContain("took over a stale lock");
  });

  it("同一 key 再次出现时标题带 ×N 折叠计数(非止损闸诊断保持既有形态)", () => {
    const rounds = replayDiagnostic(
      { type: "diagnostic", at: 0, key: "memory-warmup-degraded", severity: "warning", message: "cold index" },
      3,
    );
    expect(rounds[0]![0]).toBe("! memory-warmup-degraded");
    expect(rounds[2]![0]).toBe("! memory-warmup-degraded (3 attempts)");
  });

  it("实验闸落闸:一行 error 级通知,文案就是契约字面,不再多一行标题", () => {
    const [lines] = replayDiagnostic(
      {
        type: "diagnostic",
        at: 0,
        key: "dispatch-halted:experiment:compare/codex",
        code: HALT_DIAGNOSTIC_CODE,
        severity: "error",
        message: "experiment halted (dispatch-halted): shared service is down; restart the tunnel",
        data: { experimentId: "compare/codex", scope: "experiment", phase: "eval.run", unstarted: 0 },
      },
      1,
    );
    expect(lines).toEqual(["✗ experiment halted (dispatch-halted): shared service is down; restart the tunnel"]);
  });

  it("每条未派发 attempt 刷一次的后续声明零输出:被中止的等待集不逐条刷屏,数量归完成状态的 unstarted", () => {
    const rounds = replayDiagnostic(
      {
        type: "diagnostic",
        at: 0,
        key: "dispatch-halted:eval:compare/codex|memory/retention",
        code: HALT_DIAGNOSTIC_CODE,
        severity: "error",
        message: "eval halted: fixture db is empty; run scripts/seed.ts",
        data: { experimentId: "compare/codex", scope: "eval", evalId: "memory/retention", phase: "eval.run", unstarted: 4 },
      },
      5,
    );
    expect(rounds[0]).toEqual(["✗ eval halted: fixture db is empty; run scripts/seed.ts"]);
    expect(rounds.slice(1).flat()).toEqual([]);
  });
});

describe("renderHumanDryPlan: locked 标注", () => {
  it("locked 为 true 的行尾标注 locked;false/省略的行不受影响", () => {
    const text = renderHumanDryPlan({
      totalAttempts: 2,
      evals: 2,
      configs: 1,
      runs: 1,
      rows: [
        { experimentId: "compare/codex", evalId: "memory/a", locked: true },
        { experimentId: "compare/codex", evalId: "memory/b" },
      ],
    });
    const lines = text.trim().split("\n");
    expect(lines.find((l) => l.includes("memory/a"))).toContain("locked");
    expect(lines.find((l) => l.includes("memory/b"))).not.toContain("locked");
  });
});
