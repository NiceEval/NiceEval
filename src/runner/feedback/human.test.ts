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
import { en } from "../../i18n/en.ts";
import { zhCN } from "../../i18n/zh-CN.ts";
import { t } from "../../i18n/index.ts";
import type {
  DiagnosticNotice,
  DurableFeedbackEvent,
  FailureNotice,
  InvocationCompletion,
  InvocationSummary,
  RunFeedbackPlan,
  RunFeedbackState,
} from "../types.ts";
import type { AttemptLocator } from "../../record/locator.ts";
import type { PrimaryAssertionSummary } from "../../assertions/types.ts";

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

  // cases: docs/engineering/testing/unit/experiments-runner.md「PLAN 的实验并发附注」
  // 契约见 docs/feature/experiments/cli.md「运行中的 live 面板」:实验闸让这些实验的有效宽度
  // 小于全局值,只印全局值会被读成「这批要开 19 路」。文案断言到格式化输出,字节渲染归 E2E。
  it("plan 行在全局并发之后逐个附注声明了 maxConcurrency 的实验,未声明的不列", () => {
    const state = createInitialRunFeedbackState();
    const event: DurableFeedbackEvent = {
      type: "plan",
      at: 0,
      plan: plan({ experimentConcurrency: { mempal: 1, nowledge: 4 } }),
    };
    const text = renderDurableLines(event, state, { mode: "plain", width: 100 }).join("\n");
    expect(text).toContain("· mempal ≤1 · nowledge ≤4");
    // 全局值仍在,附注是它的补充而不是替代。
    expect(text).toMatch(/19/);
  });

  it("没有实验声明 maxConcurrency 时 plan 行不带任何附注", () => {
    const state = createInitialRunFeedbackState();
    const text = renderDurableLines({ type: "plan", at: 0, plan: plan() }, state, { mode: "plain", width: 100 }).join("\n");
    expect(text).not.toContain("≤");
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

  // bug: memory/incomplete-summary-hides-unstarted.md
  it("INCOMPLETE 结论行给出未派发数量,不让操作者手算计划与 verdict 的差", () => {
    const state = createInitialRunFeedbackState();
    const event: DurableFeedbackEvent = {
      type: "summary",
      at: 0,
      summary: summary({ passed: 91, failed: 9, errored: 1 }),
      completion: completion({ status: "incomplete", unstarted: 7 }),
    };
    const text = renderDurableLines(event, state, { mode: "plain", width: 82 }).join("\n");

    expect(text).toContain("91 passed · 9 failed · 1 errored · 7 unstarted");
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

  it("agent.ensure 的 Human 文案面向结果,不暴露 ensure/probe/install/recheck 内部词", () => {
    expect(en["feedback.phase.agentEnsure"]).toBe("preparing agent");
    expect(en["runner.startAgentEnsure"]).toBe("preparing agent...");
    expect(zhCN["feedback.phase.agentEnsure"]).toBe("正在准备 Agent");
    expect(zhCN["runner.startAgentEnsure"]).toBe("正在准备 Agent…");

    const visible = [
      en["feedback.phase.agentEnsure"],
      en["runner.startAgentEnsure"],
      zhCN["feedback.phase.agentEnsure"],
      zhCN["runner.startAgentEnsure"],
    ].join(" ");
    expect(visible).not.toMatch(/agent ensure|ensuring agent|probe|install|recheck|探测|安装|复检/);
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
      passed: 6,
      failed: 2,
      elapsedMs: 134_000,
      estimatedCostUSD: 0.84,
      active: new Map([[key, { identity, who: "compare/bub-e2b", phase: "eval.run", startedAt: 0 }]]),
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

  // cases: docs/engineering/testing/unit/experiments-runner.md「live 面板的键盘接管与自愈重绘」——
  // 区分力:回车重绘必须在 lastFrameText 未变化时也真的写出一帧。input-guard.ts 收到回车/
  // SIGWINCH 时经 coordinator.forceRedraw() 调用 clearDynamic() → redrawDynamic(state),
  // clearDynamic() 把 lastFrameText 置 undefined,天然绕过「真实内容没变化就不写」的判断。
  it("clearDynamic() 之后重新 redrawDynamic(相同 state)仍然真的写出一帧,不被「同帧不写」吞掉", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 100, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    const state: RunFeedbackState = { ...createInitialRunFeedbackState(), total: 45, reused: 6, running: 19, queued: 20 };

    renderer.redrawDynamic?.(state);
    const firstWriteCount = stderr.writes.length;
    expect(firstWriteCount).toBeGreaterThan(0);

    // 同一份 state 再画一次:内容没变化,正常应该被「同帧不写」吞掉,写入次数不增长。
    renderer.redrawDynamic?.(state);
    expect(stderr.writes.length).toBe(firstWriteCount);

    // 回车手势:先 clearDynamic()(重置 lastFrameText),再用同一份 state 重画——这次必须
    // 真的写出新的一帧,而不是被同帧判断挡住。
    renderer.clearDynamic?.();
    renderer.redrawDynamic?.(state);
    expect(stderr.writes.length).toBeGreaterThan(firstWriteCount);
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
    const longDetail = "pnpm vitest run --coverage --reporter=verbose src/runner/feedback/human.test.ts --update-runs";
    const state: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 45,
      reused: 6,
      running: 19,
      queued: 12,
      passed: 6,
      failed: 2,
      elapsedMs: 134_000,
      active: new Map([
        [key, { identity, who: "compare/bub-e2b", phase: "eval.run", startedAt: 0, detail: longDetail }],
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

  // cases: docs/engineering/testing/unit/experiments-runner.md
  // 「共享 Run activity 不占 attempt 位」/「live feedback 的未知 activity 通用投影」
  it("共享 Run activity 显示为运行级行,用 producer label,不占 attempt active 位", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 100, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compose" });
    const identity = { experimentId: "compose/docker", evalId: "sql-injection", attempt: 0 };
    const key = encodeAttemptKey(identity);
    const state: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 2,
      running: 1,
      queued: 1,
      elapsedMs: 45_000,
      runActivities: new Map([
        [
          "build-1",
          {
            id: "build-1",
            key: "sandbox.build",
            label: "build docker client",
            startedAt: 0,
          },
        ],
        [
          "warm-1",
          {
            id: "warm-1",
            key: "acme.cache.warm",
            label: "warming acme cache shard-3",
            startedAt: 1_000,
          },
        ],
      ]),
      active: new Map([[key, { identity, who: "compose/docker", phase: "eval.run", startedAt: 10_000 }]]),
    };
    renderer.onLifecycle?.(
      { type: "attempt:start", at: 10_000, identity, who: "compose/docker", phase: "eval.run" },
      state,
    );
    renderer.redrawDynamic?.(state);

    const plain = stripAnsi(stderr.writes.join(""));
    expect(plain).toMatch(/├─ ACTIVE ─+┤/);
    expect(plain).toContain("build docker client");
    expect(plain).toContain("warming acme cache shard-3");
    expect(plain).toContain("sql-injection");
    // 未知 key 不进 LifecyclePhase 锚点标签表(那些词不会冒充成 phase 列)。
    expect(plain).not.toContain("acme.cache.warm");
    expect(plain).toContain("1 running · 1 queued");
  });

  it("非 TTY 对未知 activity 用 label 通用投影起止行", () => {
    const { io, stdout } = createFakeFeedbackIO({ stderr: { isTTY: false } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compose" });
    const state = createInitialRunFeedbackState();
    renderer.appendDurable(
      {
        type: "run-activity",
        at: 1,
        id: "warm-1",
        key: "acme.cache.warm",
        label: "warming acme cache shard-3",
        status: "started",
      },
      state,
    );
    renderer.appendDurable(
      {
        type: "run-activity",
        at: 2,
        id: "warm-1",
        key: "acme.cache.warm",
        label: "warming acme cache shard-3",
        status: "failed",
        durationMs: 1_200,
      },
      {
        ...state,
        runActivities: new Map(),
      },
    );
    const plain = stdout.writes.join("");
    expect(plain).toContain("warming acme cache shard-3\n");
    expect(plain).toMatch(/warming acme cache shard-3 failed/);
    expect(plain).not.toContain("acme.cache.warm");
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
      active: new Map([[key, { identity, who: "w1", phase: "eval.run", startedAt: 0 }]]),
    };
    renderer.onLifecycle?.({ type: "attempt:start", at: 0, identity, who: "w1", phase: "eval.run" }, state);
    renderer.redrawDynamic?.(state);

    const plain = stripAnsi(stderr.writes.join(""));
    // "e1"/"w1" 是本次运行里唯一出现过的值,列宽就该等于各自的实际长度——不是旧 bug 那样
    // 按比例把短 id 垫到一大段空白(memory 台账截图:eval 22 字符垫到 27、who 6 字符垫到 22)。
    expect(plain).toContain("● e1  w1  ");
  });

  it("时间列从 attempt 派发起算:阶段推进只换标签,不把时钟归零(存活性证明必须单调)", () => {
    const { io, stderr, advance } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 200, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    const identity = { experimentId: "compare", evalId: "react-tooltip/pr-1271", attempt: 0 };
    const who = "compare/codex--nowledge";
    let state = reduceRunFeedback(createInitialRunFeedbackState(), {
      type: "plan",
      at: 0,
      plan: { shape: { evals: 1, configs: 1, totalAttempts: 1, maxConcurrency: 1 }, reused: 0, reusedFailures: [] },
    });
    const start = { type: "attempt:start", at: 0, identity, who, phase: "eval.run" } as const;
    state = reduceRunFeedback(state, start);
    renderer.onLifecycle?.(start, state);
    advance(262_000);
    renderer.redrawDynamic?.(state);
    expect(stripAnsi(stderr.writes.join(""))).toContain("4m 22s  running eval");

    // eval.run(几分钟)→ workspace.diff(秒级)是真实运行里最刺眼的一跳:旧实现按当前 phase
    // 计时,这里回到 0s,读起来像这条 eval 重跑了。时间列答的是「这条派发多久了」,不是
    // 「当前阶段跑了多久」——阶段各自的耗时由结果的 timing.phases 负责。
    const mark = stderr.writes.length;
    state = reduceRunFeedback(state, { type: "attempt:phase", at: 262_000, identity, phase: "workspace.diff" });
    advance(1_000);
    renderer.redrawDynamic?.(state);
    const frame2 = stripAnsi(stderr.writes.slice(mark).join(""));
    expect(frame2).toContain("4m 23s  capturing diff");
    expect(frame2).not.toContain(" 0s  ");
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
      active: new Map([[longKey, { identity: longIdentity, who, phase: "eval.run", startedAt: 0 }]]),
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
      passed: 1,
      active: new Map([[shortKey, { identity: shortIdentity, who, phase: "eval.run", startedAt: 1 }]]),
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
      active: new Map([[key, { identity, who: longWho, phase: "eval.run", startedAt: 0 }]]),
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

describe("诊断行:标题是「阶段标签 · code」,止损闸落闸是一行 error 级通知", () => {
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

  it("同一 key 再次出现时人读运行中流静默:只有首次完整打印两行(见 cli.md「什么动态更新,什么逐条追加」)", () => {
    const rounds = replayDiagnostic(
      { type: "diagnostic", at: 0, key: "memory-warmup-degraded", severity: "warning", message: "cold index" },
      3,
    );
    expect(rounds[0]).toEqual(["! memory-warmup-degraded", "  cold index"]);
    expect(rounds[1]).toEqual([]);
    expect(rounds[2]).toEqual([]);
  });

  it("attempt 级诊断的标题是「阶段标签 · code」,阶段标签走人读短语投影(不是原始 LifecyclePhase 字面量)", () => {
    // 与失败行的 errored 信息段故意不同:诊断标题是给人读的散文,用 phaseLabel() 的翻译短语;
    // 失败行的 `errored · <phase> · <code>` 是给人对照机器面的,用未翻译的原始字面量
    // (见 buildErroredInfo 的注释)。这里直接取翻译值,不依赖失败行反推,不硬编码语言
    // (en/zh-CN 两种 locale 下都成立)。
    const label = t("feedback.phase.sandboxPrepare");

    const rounds = replayDiagnostic(
      {
        type: "diagnostic",
        at: 0,
        // 作者没传 dedupeKey 时 attempt.ts 折出来的 key —— 编了身份,不能出现在人读标题里。
        key: "memory-warmup-degraded:compare/codex|memory/x|1",
        code: "memory-warmup-degraded",
        severity: "warning",
        message: "Memory warmup failed; continuing with a cold index",
        identity: { experimentId: "compare/codex", evalId: "memory/x", attempt: 1 },
        data: { phase: "sandbox.prepare" },
      },
      3,
    );
    expect(rounds[0]).toEqual([
      `! ${label} · memory-warmup-degraded`,
      "  Memory warmup failed; continuing with a cold index",
    ]);
    expect(rounds[1]).toEqual([]);
    expect(rounds[2]).toEqual([]);
  });

  it("运行级诊断没有 phase:标题只有 code,不留空的 · 分隔符", () => {
    const [lines] = replayDiagnostic(
      {
        type: "diagnostic",
        at: 0,
        key: "budget-unenforceable:compare/codex",
        code: "budget-unenforceable",
        severity: "warning",
        message: "no cost data; budget cannot be enforced",
        data: { experimentId: "compare/codex" },
      },
      1,
    );
    expect(lines![0]).toBe("! budget-unenforceable");
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

// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「失败的单行投影与 live FAILURES 分节」:契约见
// docs/feature/experiments/cli.md#框线体裁 与 #运行中的-live-面板。
describe("失败的单行投影与 live FAILURES 分节", () => {
  // 没有 group 的原始 `equals(4)` 断言:matcher 与标题相同时省略 matcher 字段(见
  // docs/feature/assertions/library/display.md「单行压缩形态」),单行压缩形态因此不带
  // `gate:`/`soft:` 前缀——这是绝大多数无 `t.group(...)` 断言的常见形态,用它做单行投影的
  // 默认 fixture 能直接对照 compactAssertionSummary 的字面输出,不需要在测试里重算前缀规则。
  function assertionSummary(overrides: Partial<PrimaryAssertionSummary> = {}): PrimaryAssertionSummary {
    return {
      severity: "gate",
      assertion: "equals(4)",
      expected: "4",
      received: "3",
      additionalFailures: 0,
      ...overrides,
    };
  }

  function failureEvent(
    overrides: Partial<DurableFeedbackEvent & { type: "failure" }> = {},
  ): DurableFeedbackEvent & { type: "failure" } {
    return {
      type: "failure",
      at: 0,
      locator: locator("@1bwcxxiy"),
      identity: { experimentId: "compare", evalId: "memory/x", attempt: 0 },
      who: "codex",
      verdict: "failed",
      reason: "gate failed",
      assertion: assertionSummary(),
      ...overrides,
    };
  }

  it("failed 单行投影是 ✗ @locator  evalId  [who]  单行压缩摘要", () => {
    const state = { ...createInitialRunFeedbackState(), freshFailureCount: 1 };
    const lines = renderDurableLines(failureEvent(), state, { mode: "plain", width: 300 });
    expect(lines).toEqual(["✗ @1bwcxxiy  memory/x  [codex]  equals(4) · expected 4 · received 3"]);
  });

  it("errored(没有主断言摘要的结构化执行错误)单行投影是 errored · <原始 phase 字面量> · <code>,余量够再接 message", () => {
    const state = { ...createInitialRunFeedbackState(), freshFailureCount: 1 };
    const event = failureEvent({
      verdict: "errored",
      assertion: undefined,
      reason: "allocation failed",
      phase: "sandbox.create",
      code: "sandbox-rate-limit",
    });
    const lines = renderDurableLines(event, state, { mode: "plain", width: 300 });
    expect(lines).toEqual([
      "✗ @1bwcxxiy  memory/x  [codex]  errored · sandbox.create · sandbox-rate-limit: allocation failed",
    ]);
  });

  it("errored 且是 assertion-unavailable 造成的(有主断言摘要)时走断言摘要投影,不套 errored · phase · code 语法", () => {
    const state = { ...createInitialRunFeedbackState(), freshFailureCount: 1 };
    const event = failureEvent({
      verdict: "errored",
      assertion: assertionSummary({
        assertion: 'closedQA("修改是否聚焦问题?")',
        expected: undefined,
        received: undefined,
        reason: "judge-model-unresolved",
      }),
      reason: "judge-model-unresolved",
      phase: "assertions.evaluate",
    });
    const lines = renderDurableLines(event, state, { mode: "plain", width: 300 });
    expect(lines[0]).toContain('closedQA("修改是否聚焦问题?")');
    expect(lines[0]).not.toContain("errored ·");
  });

  it("非 TTY 单流固定 100 字符预算:渲染行恒不超过预算,即便 received 很长", () => {
    const state = { ...createInitialRunFeedbackState(), freshFailureCount: 1 };
    const event = failureEvent({
      assertion: assertionSummary({
        received: "a".repeat(400),
      }),
    });
    // 非 TTY 追加流没有可依赖的终端宽度,固定用 100——传入的 width 只影响面板体裁探测,
    // 不改变这条单行事实行自己的预算(与 TTY live 面板按帧内容宽传入是两条不同的口径)。
    const lines = renderDurableLines(event, state, { mode: "plain", width: 300 });
    expect(stringWidth(lines[0]!)).toBeLessThanOrEqual(100);
  });

  it("TTY live 面板按当帧内容宽传入预算,窄终端 + CJK 长 received 也不超过预算(按显示列量,不是字符数)", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 40, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    let state = createInitialRunFeedbackState();
    state = reduceRunFeedback(state, { type: "plan", at: 0, plan: plan() });
    state = reduceRunFeedback(
      state,
      failureEvent({
        identity: { experimentId: "compare", evalId: "eval-id", attempt: 0 },
        who: "who",
        assertion: assertionSummary({
          assertion: "标题",
          expected: undefined,
          received: "中文很长的接收值一二三四五六七八九十一二三四五六七八九十".repeat(3),
        }),
      }),
    );
    renderer.redrawDynamic?.(state);

    const written = stderr.writes.join("");
    // eslint-disable-next-line no-control-regex
    const plainLines = written.replace(/\x1B\[[0-9]*[A-Za-z]/g, "").split("\n");
    const failureLine = plainLines.find((l) => l.includes("eval-id"));
    expect(failureLine).toBeDefined();
    // 渲染行(含边框)恒不超过终端宽度——按显示列量;字符数口径下这条 CJK 长 received
    // 会明显超宽,只有按 stringWidth 收口才能保证这个不变量。
    expect(stringWidth(failureLine!)).toBeLessThanOrEqual(40);
  });

  it("TTY live 面板:counts 行与 ACTIVE 之间插入 FAILURES 分节,滚动保留最近 5 条本次新发生的失败,横隔 meta 是累计数", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 100, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    let state = createInitialRunFeedbackState();
    state = reduceRunFeedback(state, {
      type: "plan",
      at: 0,
      plan: plan({
        reusedFailures: [
          {
            locator: locator("@carry0000"),
            identity: { experimentId: "compare", evalId: "memory/carried", attempt: 0 },
            who: "compare/codex",
            verdict: "failed",
            reason: "carried failure",
            assertion: assertionSummary({ assertion: "carried" }),
          },
        ],
      }),
    });
    for (let i = 0; i < 7; i++) {
      state = reduceRunFeedback(state,
        failureEvent({
          at: i,
          locator: locator(`@fresh${i}`),
          identity: { experimentId: "compare", evalId: `memory/fresh-${i}`, attempt: 0 },
        }),
      );
    }
    renderer.redrawDynamic?.(state);

    const written = stderr.writes.join("");
    // eslint-disable-next-line no-control-regex
    const plainText = written.replace(/\x1B\[[0-9]*[A-Za-z]/g, "");
    expect(plainText).toMatch(/├─ FAILURES/);
    expect(plainText).toContain(t("feedback.human.failuresSoFar", { count: 7 }));
    // 只保留最近 5 条(fresh4..fresh6 之外,早发生的 fresh0/fresh1 已滚出分节)。
    expect(plainText).not.toContain("memory/fresh-0");
    expect(plainText).not.toContain("memory/fresh-1");
    expect(plainText).toContain("memory/fresh-2");
    expect(plainText).toContain("memory/fresh-6");
    // carry 携入失败不进分节。
    expect(plainText).not.toContain("memory/carried");
  });

  it("TTY appendDurable 对 failure 直接返回,不写 scrollback 永久行(由下一帧的 FAILURES 分节显现)", () => {
    const { io, stdout, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 100, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    const state = { ...createInitialRunFeedbackState(), freshFailureCount: 1 };
    renderer.appendDurable(failureEvent(), state);
    expect(stdout.writes).toEqual([]);
    expect(stderr.writes).toEqual([]);
  });

  it("矮终端先减 ACTIVE 可见项,再减 FAILURES 分节的可见条数", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 100, rows: 12 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    let state = createInitialRunFeedbackState();
    state = reduceRunFeedback(state, { type: "plan", at: 0, plan: plan() });
    // 5 条 fresh 失败(占满 FAILURES 分节的滚动上限)。
    for (let i = 0; i < 5; i++) {
      state = reduceRunFeedback(state,
        failureEvent({ at: i, locator: locator(`@fresh${i}`), identity: { experimentId: "compare", evalId: `memory/fresh-${i}`, attempt: 0 } }),
      );
    }
    // 8 条 active attempt——矮终端(12 行)容不下全部,ACTIVE 应该先被压缩。
    for (let i = 0; i < 8; i++) {
      const identity = { experimentId: "compare", evalId: `memory/active-${i}`, attempt: 0 };
      state = reduceRunFeedback(state, { type: "attempt:start", at: 0, identity, who: "compare/codex", phase: "eval.run" });
      renderer.onLifecycle?.({ type: "attempt:start", at: 0, identity, who: "compare/codex", phase: "eval.run" }, state);
    }
    renderer.redrawDynamic?.(state);

    const written = stderr.writes.join("");
    // eslint-disable-next-line no-control-regex
    const plainText = written.replace(/\x1B\[[0-9]*[A-Za-z]/g, "");
    // FAILURES 分节的 5 条全部保留。
    for (let i = 0; i < 5; i++) expect(plainText).toContain(`memory/fresh-${i}`);
    // ACTIVE 被压缩,出现「还有 N 项运行中」的折叠提示。
    expect(plainText).toMatch(/more active/);
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「结束反馈的失败形态聚合与 WARNINGS 汇总」:契约见
// docs/feature/experiments/cli.md#人看的结束反馈。
describe("结束反馈的失败形态聚合与 WARNINGS 汇总", () => {
  function failedNotice(overrides: Partial<FailureNotice> = {}): FailureNotice {
    return {
      at: 0,
      locator: locator("@1bwcxxiy"),
      identity: { experimentId: "compare", evalId: "memory/x", attempt: 0 },
      who: "compare/codex",
      verdict: "failed",
      reason: "gate failed",
      assertion: {
        severity: "gate",
        assertion: "tests pass after fix",
        matcher: "commandSucceeded()",
        expected: "exit 0",
        additionalFailures: 0,
      },
      ...overrides,
    };
  }

  it("205 条同 matcher 失败聚成一行,右对齐 ×N,代表 locator 是组内首现那条", () => {
    const failures: FailureNotice[] = [];
    for (let i = 0; i < 205; i++) {
      failures.push(
        failedNotice({ locator: locator(`@f${String(i).padStart(4, "0")}`), identity: { experimentId: "compare", evalId: `memory/x-${i}`, attempt: 0 } }),
      );
    }
    const state: RunFeedbackState = { ...createInitialRunFeedbackState(), total: 205, failures };
    const event: DurableFeedbackEvent = {
      type: "summary",
      at: 0,
      summary: summary({ passed: 0, failed: 205, errored: 0 }),
      completion: completion(),
    };
    const text = renderDurableLines(event, state, { mode: "plain", width: 100 }).join("\n");
    expect(text).toContain("×205");
    expect(text).toContain("commandSucceeded() · expected exit 0");
    expect(text).toContain("@f0000"); // 组内首现的代表 locator
    expect(text).not.toContain("@f0001"); // 其余 204 条不逐条铺开
    expect(text).toContain(t("feedback.human.failuresTotalKinds", { total: 205, kinds: 1 }));
  });

  it("只有一条失败时展开成完整身份两行(悬挂单行摘要),不折成 ×1 的组行", () => {
    const state: RunFeedbackState = { ...createInitialRunFeedbackState(), total: 1, failures: [failedNotice()] };
    const event: DurableFeedbackEvent = {
      type: "summary",
      at: 0,
      summary: summary({ passed: 0, failed: 1, errored: 0 }),
      completion: completion(),
    };
    const lines = renderDurableLines(event, state, { mode: "plain", width: 100 });
    const text = lines.join("\n");
    expect(text).toContain("✗ @1bwcxxiy  memory/x  [compare/codex]");
    expect(text).toContain("commandSucceeded() · expected exit 0");
    expect(text).not.toMatch(/×1\b/);
  });

  it("errored 按 phase · code 分组,与 failed 分属不同的组(不同形态互不聚合)", () => {
    const failed = [failedNotice({ locator: locator("@f1") }), failedNotice({ locator: locator("@f2") })];
    const errored = [
      failedNotice({
        locator: locator("@e1"),
        verdict: "errored",
        assertion: undefined,
        reason: "boom",
        phase: "workspace.diff",
        code: "diff-export-failed",
      }),
      failedNotice({
        locator: locator("@e2"),
        verdict: "errored",
        assertion: undefined,
        reason: "boom again",
        phase: "workspace.diff",
        code: "diff-export-failed",
      }),
      failedNotice({
        locator: locator("@e3"),
        verdict: "errored",
        assertion: undefined,
        reason: "different",
        phase: "sandbox.create",
        code: "sandbox-rate-limit",
      }),
    ];
    const state: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 5,
      failures: [...failed, ...errored],
    };
    const event: DurableFeedbackEvent = {
      type: "summary",
      at: 0,
      summary: summary({ passed: 0, failed: 2, errored: 3 }),
      completion: completion(),
    };
    const text = renderDurableLines(event, state, { mode: "plain", width: 100 }).join("\n");
    expect(text).toContain(t("feedback.human.failuresTotalKinds", { total: 5, kinds: 3 }));
    expect(text).toContain("×2  errored · workspace.diff · diff-export-failed");
  });

  it("超过 10 个形态组时收进「+K more kinds」尾行", () => {
    const failures: FailureNotice[] = [];
    for (let i = 0; i < 12; i++) {
      // 每个形态自己只出现一次(assertion 标题各不相同),制造 12 个 size=1 的组。
      failures.push(
        failedNotice({
          locator: locator(`@k${String(i).padStart(2, "0")}`),
          identity: { experimentId: "compare", evalId: `memory/k-${i}`, attempt: 0 },
          assertion: {
            severity: "gate",
            assertion: `kind ${i}`,
            matcher: "commandSucceeded()",
            expected: "exit 0",
            additionalFailures: 0,
          },
        }),
      );
    }
    const state: RunFeedbackState = { ...createInitialRunFeedbackState(), total: 12, failures };
    const event: DurableFeedbackEvent = {
      type: "summary",
      at: 0,
      summary: summary({ passed: 0, failed: 12, errored: 0 }),
      completion: completion(),
    };
    const text = renderDurableLines(event, state, { mode: "plain", width: 100 }).join("\n");
    expect(text).toContain(t("feedback.human.moreFailureKinds", { count: 2 }));
  });

  it("WARNINGS 面板按 code 汇总本次去重后的诊断,有诊断才出现,位于 FAILURES 与 KEPT SANDBOXES 之后", () => {
    const diagnostics: DiagnosticNotice[] = [
      { at: 0, key: "lock-taken-over:compare/codex|a", code: "lock-taken-over", severity: "warning", message: "took over an expired case lock for codex/term…", count: 4 },
      { at: 1, key: "lock-taken-over:compare/codex|b", code: "lock-taken-over", severity: "warning", message: "took over an expired case lock for another…", count: 3 },
      { at: 2, key: "workspace-diff-unavailable", code: "workspace-diff-unavailable", severity: "warning", message: "workspace diff export failed; continuing with…", count: 1 },
    ];
    const state: RunFeedbackState = { ...createInitialRunFeedbackState(), diagnostics };
    const event: DurableFeedbackEvent = {
      type: "summary",
      at: 0,
      summary: summary({ passed: 45, failed: 0, errored: 0 }),
      completion: completion(),
    };
    const text = renderDurableLines(event, state, { mode: "plain", width: 100 }).join("\n");
    expect(text).toContain("WARNINGS");
    // 同 code 的两条不同折叠 key 的诊断汇总成一行,次数相加。
    expect(text).toContain("lock-taken-over ×7");
    expect(text).toContain("took over an expired case lock for codex/term…");
    expect(text).toContain("workspace-diff-unavailable");
    expect(text).not.toMatch(/workspace-diff-unavailable ×/); // count=1 不带 ×N
  });

  it("没有诊断时不画空的 WARNINGS 面板", () => {
    const state: RunFeedbackState = createInitialRunFeedbackState();
    const event: DurableFeedbackEvent = {
      type: "summary",
      at: 0,
      summary: summary({ passed: 45, failed: 0, errored: 0 }),
      completion: completion(),
    };
    const text = renderDurableLines(event, state, { mode: "plain", width: 100 }).join("\n");
    expect(text).not.toContain("WARNINGS");
  });
});

describe("renderHumanDryPlan: locked 标注", () => {
  it("locked 为 true 的行尾标注 locked;false/省略的行不受影响", () => {
    const text = renderHumanDryPlan({
      totalAttempts: 2,
      evals: 2,
      configs: 1,
      attempts: 1,
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

describe("renderHumanDryPlan: 逐条未携带原因", () => {
  const rowOf = (text: string, evalId: string): string => text.trim().split("\n").find((l) => l.includes(evalId))!;

  it("要派发的行标出门的人读词,stale 行逐条引用 locator,全携带的行标 carried", () => {
    const text = renderHumanDryPlan({
      totalAttempts: 4,
      evals: 4,
      configs: 1,
      attempts: 1,
      reused: 1,
      rows: [
        {
          experimentId: "compare/codex",
          evalId: "memory/stale",
          dispatch: [{ reason: "stale", comparison: { kind: "changed", deltas: [{ selector: "config:judge.model" }] } }],
        },
        { experimentId: "compare/codex", evalId: "memory/fresh", dispatch: [{ reason: "new" }] },
        { experimentId: "compare/codex", evalId: "memory/carried", dispatch: [] },
        {
          experimentId: "compare/codex",
          evalId: "memory/mixed",
          dispatch: [{ reason: "errored" }, { reason: "new" }],
        },
      ],
    });

    expect(rowOf(text, "memory/stale")).toContain("stale: config:judge.model");
    expect(rowOf(text, "memory/fresh")).toMatch(/\bnew$/);
    expect(rowOf(text, "memory/carried")).toMatch(/\bcarried$/);
    // 同一行卡在两道门上时逐组连排,不折成一个笼统的词。
    expect(rowOf(text, "memory/mixed")).toContain("errored · new");
  });

  // cases: docs/engineering/testing/unit/experiments-runner.md「--dry 的 carried verdict 与 attempt 汇总」
  it("全携带的单 attempt 显示实际 carried verdict,不把 failed 隐藏成裸 carried", () => {
    const text = renderHumanDryPlan({
      totalAttempts: 2,
      evals: 2,
      configs: 1,
      attempts: 1,
      rows: [
        {
          experimentId: "compare/codex",
          evalId: "memory/passed",
          attempts: 1,
          carried: [{ attempt: 0, verdict: "passed" }],
          dispatch: [],
        },
        {
          experimentId: "compare/codex",
          evalId: "memory/failed",
          attempts: 1,
          carried: [{ attempt: 0, verdict: "failed" }],
          dispatch: [],
        },
      ],
    });

    expect(rowOf(text, "memory/passed")).toMatch(/carried \(passed\)$/);
    expect(rowOf(text, "memory/failed")).toMatch(/carried \(failed\)$/);
  });

  it("全携带的多 attempt 按 carried 结果汇总 passed 与 failed", () => {
    const text = renderHumanDryPlan({
      totalAttempts: 3,
      evals: 1,
      configs: 1,
      attempts: 3,
      rows: [{
        experimentId: "compare/codex",
        evalId: "memory/mixed-verdicts",
        attempts: 3,
        carried: [
          { attempt: 0, verdict: "passed" },
          { attempt: 1, verdict: "failed" },
          { attempt: 2, verdict: "passed" },
        ],
        dispatch: [],
      }],
    });

    expect(rowOf(text, "memory/mixed-verdicts")).toMatch(/carried \(2 passed · 1 failed\)$/);
  });

  it("部分携入时保留 carried verdict,并按 dispatch 分组显示各原因的 attempt 分数", () => {
    const text = renderHumanDryPlan({
      totalAttempts: 4,
      evals: 1,
      configs: 1,
      attempts: 4,
      rows: [{
        experimentId: "compare/codex",
        evalId: "memory/partial",
        attempts: 4,
        carried: [
          { attempt: 0, verdict: "passed" },
          { attempt: 1, verdict: "failed" },
        ],
        dispatch: [
          { reason: "errored", attempts: [2] },
          { reason: "new", attempts: [3] },
        ],
      }],
    });

    expect(rowOf(text, "memory/partial")).toContain("carried 2/4 (1 passed · 1 failed) · errored 1/4 · new 1/4");
  });

  it("stale 行显示历史 verdict、具名差异与独立 accept 命令", () => {
    const delta = { selector: "config:judge.model", kind: "changed" as const, from: "gpt-5.6", to: "gpt-5.6-sol" };
    const text = renderHumanDryPlan({
      totalAttempts: 3,
      evals: 3,
      configs: 1,
      attempts: 1,
      rows: [
        { experimentId: "compare/codex", evalId: "baseline01", dispatch: [{ reason: "stale", comparison: { kind: "changed", deltas: [delta] } }], prior: [{ locator: "@1A1B2C3D4E5F", verdict: "passed", acceptance: "available", comparison: { kind: "changed", deltas: [delta] } }] },
        { experimentId: "compare/codex", evalId: "baseline03", dispatch: [{ reason: "stale", comparison: { kind: "changed", deltas: [delta] } }], prior: [{ locator: "@1E5F6G7H8J9K", verdict: "failed", acceptance: "available", comparison: { kind: "changed", deltas: [delta] } }] },
        { experimentId: "compare/codex", evalId: "baseline04", dispatch: [{ reason: "keep-sandbox" }] },
      ],
    });

    expect(text).toContain("compare/codex  baseline01  stale passed: config:judge.model changed (gpt-5.6 → gpt-5.6-sol)");
    expect(text).toContain("prior:  @1A1B2C3D4E5F (passed · evidence available)");
    expect(text).toContain("accept: niceeval accept @1A1B2C3D4E5F");
    expect(text).toContain("prior:  @1E5F6G7H8J9K (failed · evidence available)");
    expect(text).not.toContain("baseline04  stale"); // keep-sandbox 无 prior,不提供接受入口
  });

  it("unexplained 用开放 code 与递归 cause 通用投影,并区分 observedDeltas 三态", () => {
    const deltas = Array.from({ length: 10 }, (_, index) => ({
      selector: `data:field-${index}`,
      kind: "changed" as const,
      from: "old",
      to: "new",
    }));
    const text = renderHumanDryPlan({
      totalAttempts: 1,
      evals: 1,
      configs: 1,
      attempts: 1,
      rows: [{
        experimentId: "compare/codex",
        evalId: "future-diagnostic",
        dispatch: [{
          reason: "stale",
          comparison: {
            kind: "unexplained",
            diagnostic: {
              code: "producer.future-code",
              summary: "future producer needs review",
              facts: [{ label: "mode", value: "opaque" }],
              observedDeltas: deltas,
              causes: [
                { code: "cause.future", summary: "nested open cause" },
                { code: "cause.empty", summary: "comparable but equal", observedDeltas: [] },
              ],
            },
          },
        }],
        prior: [{
          locator: "@1A2B3C4D5E6F",
          verdict: "passed",
          acceptance: "available",
          evidenceState: "local",
        }],
      }],
    });

    expect(text).toContain("stale passed: future producer needs review");
    expect(text).toContain("producer.future-code: future producer needs review");
    expect(text).toContain("mode: opaque");
    expect(text).toContain("data:field-0 changed (old → new)");
    expect(text).toContain("data:field-7 changed (old → new)");
    expect(text).not.toContain("data:field-8 changed");
    expect(text).toContain("+2 more observed deltas");
    expect(text).toContain("cause.future: nested open cause");
    expect(text).toContain("observed inputs: unavailable");
    expect(text).toContain("cause.empty: comparable but equal");
    expect(text).toContain("observed inputs: no differences in comparable manifest fields");
    expect(text).not.toContain("no input delta");
    expect(text).toContain("review: niceeval show @1A2B3C4D5E6F");
    expect(text).toContain("accept: niceeval accept @1A2B3C4D5E6F");
  });

  it("diagnostic cause 展示最多四层且总节点不超过十六个", () => {
    type DiagnosticFixture = {
      code: string;
      summary: string;
      causes?: readonly DiagnosticFixture[];
    };
    const chain = (level: number): DiagnosticFixture => ({
      code: `cause.level.${level}`,
      summary: `level ${level}`,
      ...(level > 0 ? { causes: [chain(level - 1)] } : {}),
    });
    const manyCauses: DiagnosticFixture[] = Array.from({ length: 20 }, (_, index) => ({
      code: `cause.broad.${index}`,
      summary: `broad ${index}`,
    }));

    const render = (diagnostic: DiagnosticFixture): string => renderHumanDryPlan({
      totalAttempts: 1,
      evals: 1,
      configs: 1,
      attempts: 1,
      rows: [{
        experimentId: "compare/codex",
        evalId: "budgeted-diagnostic",
        dispatch: [{ reason: "stale", comparison: { kind: "unexplained", diagnostic } }],
        prior: [{
          locator: "@1A2B3C4D5E6F",
          verdict: "passed",
          acceptance: "available",
          evidenceState: "local",
        }],
      }],
    });

    const depthText = render({ code: "future.root", summary: "root", causes: [chain(6)] });
    expect(depthText).toContain("cause.level.3: level 3");
    expect(depthText).not.toContain("cause.level.2: level 2");
    expect(depthText).toContain("+3 more diagnostic nodes suppressed");

    const nodeText = render({ code: "future.root", summary: "root", causes: manyCauses });
    expect(nodeText).toContain("cause.broad.14: broad 14");
    expect(nodeText).not.toContain("cause.broad.15: broad 15");
    expect(nodeText).toContain("+5 more diagnostic nodes suppressed");
  });

  it("同一 selector 的不同旧值各随自己的 locator 输出", () => {
    const text = renderHumanDryPlan({
      totalAttempts: 3,
      evals: 3,
      configs: 1,
      attempts: 1,
      rows: [
        {
          experimentId: "compare/codex",
          evalId: "from-old-a",
          dispatch: [{
            reason: "stale",
            comparison: { kind: "changed", deltas: [{ selector: "config:judge.model", kind: "changed", from: "old-a", to: "current" }] },
          }],
          prior: [{ locator: "@1A1B2C3D4E5F", verdict: "passed", acceptance: "available" }],
        },
        {
          experimentId: "compare/codex",
          evalId: "from-old-b-1",
          dispatch: [{
            reason: "stale",
            comparison: { kind: "changed", deltas: [{ selector: "config:judge.model", kind: "changed", from: "old-b", to: "current" }] },
          }],
          prior: [{ locator: "@1E5F6G7H8J9K", verdict: "passed", acceptance: "available" }],
        },
        {
          experimentId: "compare/codex",
          evalId: "from-old-b-2",
          dispatch: [{
            reason: "stale",
            comparison: { kind: "changed", deltas: [{ selector: "config:judge.model", kind: "changed", from: "old-b", to: "current" }] },
          }],
          prior: [{ locator: "@1J9K0L1M2N3P", verdict: "passed", acceptance: "available" }],
        },
      ],
    });

    // 每条结果既有矩阵行尾的 stale 原因，也有带 prior/accept 的详细行。
    expect(text.match(/^compare\/codex  from-old-.*stale passed:/gm)).toHaveLength(6);
    expect(text).toContain("prior:  @1A1B2C3D4E5F");
    expect(text).toContain("prior:  @1E5F6G7H8J9K");
    expect(text).toContain("prior:  @1J9K0L1M2N3P");
    expect(text.match(/niceeval accept @/g)).toHaveLength(3);
  });

  it("旧格式 locator 不给出会失败的 accept 命令", () => {
    const text = renderHumanDryPlan({
      totalAttempts: 1,
      evals: 1,
      configs: 1,
      attempts: 1,
      rows: [{
        experimentId: "compare/codex",
        evalId: "legacy",
        dispatch: [{ reason: "stale", comparison: { kind: "changed", deltas: [{ selector: "config:state", kind: "removed", from: '{"_tag":"Stateless"}' }] } }],
        prior: [{ locator: "@1rtu4f1f", verdict: "passed", acceptance: "legacy-locator" }],
      }],
    });

    expect(text).toContain("stale passed: config:state removed (was {\"_tag\":\"Stateless\"})");
    expect(text).toContain("accept: unavailable (legacy locator; rerun to create an acceptable result)");
    expect(text).not.toContain("niceeval accept @1rtu4f1f");
  });

  it("没有 stale 行时整块不打印", () => {
    const text = renderHumanDryPlan({
      totalAttempts: 1,
      evals: 1,
      configs: 1,
      attempts: 1,
      command: "niceeval exp compare/codex",
      rows: [{ experimentId: "compare/codex", evalId: "memory/a", dispatch: [{ reason: "new" }] }],
    });
    expect(text).not.toContain("accept:");
  });

  it("locked 行沿用 locked 标注,不被门的原因词顶掉", () => {
    const text = renderHumanDryPlan({
      totalAttempts: 1,
      evals: 1,
      configs: 1,
      attempts: 1,
      rows: [{ experimentId: "compare/codex", evalId: "memory/a", locked: true, dispatch: [{ reason: "new" }] }],
    });
    expect(rowOf(text, "memory/a")).toMatch(/\blocked$/);
  });
});
