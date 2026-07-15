// Human renderer 测试:全部经真实 FeedbackCoordinator + createFakeFeedbackIO 驱动(不
// monkey-patch process/Date/setInterval),断言具体文本/结构属性而不是整段 ANSI snapshot diff——
// 逐条对应 plan section D 的 checklist(见文件内每个 describe 块的注释)。
//
// 只测「clear/append/redraw 按 coordinator 保证的顺序调用」这一层已经由 coordinator.test.ts
// 用一个 recordingRenderer 覆盖过;这里额外验证的是 human 渲染器自己产出的具体内容/宽高约束/
// 节流行为,以及它如何使用 clear/append/redraw 三个钩子。

import { afterEach, describe, expect, it } from "vitest";
import { createFeedbackCoordinator, type FeedbackCoordinator } from "./coordinator.ts";
import { createFakeFeedbackIO, type FakeFeedbackIO } from "./testing.ts";
import { activeFeedbackSinkCount } from "./sink.ts";
import { createHumanRenderer, formatElapsed, formatTokenCount, renderDurableLines } from "./human.ts";
import { createInitialRunFeedbackState } from "./reducer.ts";
import type { AttemptLocator } from "../../results/locator.ts";
import type { AttemptRef, RunCompletion, RunFeedbackPlan, RunSummary } from "../types.ts";

function locator(id: string): AttemptLocator {
  return `@1${id}` as AttemptLocator;
}

function ref(evalId: string, attempt = 0, experimentId = "compare/bub-e2b"): AttemptRef {
  return { experimentId, evalId, attempt };
}

function plan(overrides: Partial<RunFeedbackPlan["shape"]> = {}, reused = 0): RunFeedbackPlan {
  return {
    shape: { evals: 1, configs: 1, totalRuns: 1, maxConcurrency: 1, ...overrides },
    reused,
    reusedFailures: [],
  };
}

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    agent: "codex",
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:03:21.000Z",
    passed: 1,
    failed: 0,
    skipped: 0,
    errored: 0,
    durationMs: 201_000,
    results: [],
    ...overrides,
  };
}

function completion(overrides: Partial<RunCompletion> = {}): RunCompletion {
  return { status: "complete", unstarted: 0, earlyExitUnstarted: 0, reporterErrors: [], ...overrides };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** ANSI escape 起始字节;非 TTY 输出必须永远不出现。 */
const ESC = "\x1B[";

function setupTty(overrides: { columns?: number; rows?: number } = {}): {
  fake: FakeFeedbackIO;
  coordinator: FeedbackCoordinator;
} {
  const fake = createFakeFeedbackIO({ stderr: { isTTY: true, columns: overrides.columns ?? 100, rows: overrides.rows ?? 40 } });
  const renderer = createHumanRenderer({ io: fake.io, command: "niceeval exp compare" });
  const coordinator = createFeedbackCoordinator({ profile: "human", renderer, io: fake.io, tickIntervalMs: 250 });
  return { fake, coordinator };
}

function setupPlain(): { fake: FakeFeedbackIO; coordinator: FeedbackCoordinator } {
  const fake = createFakeFeedbackIO({ stderr: { isTTY: false } });
  const renderer = createHumanRenderer({ io: fake.io, command: "niceeval exp compare" });
  const coordinator = createFeedbackCoordinator({ profile: "human", renderer, io: fake.io, tickIntervalMs: 1000 });
  return { fake, coordinator };
}

afterEach(() => {
  expect(activeFeedbackSinkCount()).toBe(0);
});

// ───────────────────────── 纯格式化 helper ─────────────────────────

describe("formatElapsed / formatTokenCount: 纯格式化", () => {
  it("elapsed 用 'Xm Ys' / 'Ys' 风格,匹配 cli.md 的 dashboard/完成页示例", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(54_000)).toBe("54s");
    expect(formatElapsed(102_000)).toBe("1m 42s");
    expect(formatElapsed(134_000)).toBe("2m 14s");
  });

  it("token 计数超过 1000/1e6 分别用 k/M 后缀", () => {
    expect(formatTokenCount(500)).toBe("500");
    expect(formatTokenCount(3_400)).toBe("3.4k");
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
  });
});

// ───────────────────────── TTY dashboard: 静态符号 / 节流 / 同帧不写 ─────────────────────────

describe("TTY dashboard: 静态符号,不用 spinner 帧驱动重画", () => {
  it("active 行恒用静态 ● 号,从不出现任何 spinner 字符", async () => {
    const { fake, coordinator } = setupTty();
    coordinator.start(plan());
    coordinator.emit({ type: "attempt:start", at: 0, identity: ref("memory/a"), who: "bub-e2b", phase: "eval.run" });
    fake.advance(1000);
    await flush();
    const all = fake.stderr.writes.join("");
    expect(all).toContain("●");
    // 老 live.ts 的 spinner 帧字符集,新实现绝不应再出现。
    for (const frame of ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]) {
      expect(all).not.toContain(frame);
    }
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

describe("TTY dashboard: 真实 state 变化合并渲染,同帧不写,elapsed 最多每秒变化一次", () => {
  it("state 没有真实变化的 tick 不产生新的 ANSI 重画;elapsed 跨过整秒边界才重画", async () => {
    const { fake, coordinator } = setupTty();
    coordinator.start(plan());
    coordinator.emit({ type: "attempt:start", at: 0, identity: ref("memory/a"), who: "bub-e2b", phase: "eval.run" });
    await flush();
    const ansiWriteCount = () => fake.stderr.writes.filter((w) => w.includes(ESC)).length;
    const afterStart = ansiWriteCount();

    fake.advance(250); // tick #1:activeOrder 刚变化(第一次画出这一行)→ 必然重画
    await flush();
    expect(ansiWriteCount()).toBe(afterStart + 1);

    fake.advance(250); // tick #2 (t=500ms):elapsed 仍是 "0s",且 active 内容没变 → 不应重画
    await flush();
    expect(ansiWriteCount()).toBe(afterStart + 1);

    fake.advance(250); // tick #3 (t=750ms):同上,仍 "0s"
    await flush();
    expect(ansiWriteCount()).toBe(afterStart + 1);

    fake.advance(250); // tick #4 (t=1000ms):跨过整秒边界,elapsed 变成 "1s" → 必须重画
    await flush();
    expect(ansiWriteCount()).toBe(afterStart + 2);

    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

// ───────────────────────── TTY dashboard: 高度/宽度硬上限 ─────────────────────────

describe("TTY dashboard: 高度以 stderr.rows 为硬上限,窄终端先减 active slots", () => {
  it("active attempt 数超过可视预算时,先折叠成更少的行 + 一条 overflow 摘要,总行数不超过 rows", async () => {
    const { fake, coordinator } = setupTty({ rows: 8, columns: 100 });
    coordinator.start(plan({ totalRuns: 5 }));
    for (let i = 0; i < 5; i++) {
      coordinator.emit({ type: "attempt:start", at: 0, identity: ref(`memory/eval-${i}`), who: `who-${i}`, phase: "eval.run" });
    }
    fake.advance(250);
    await flush();

    const lastAnsiFrame = fake.stderr.writes.filter((w) => w.includes(ESC)).at(-1)!;
    const lineCount = lastAnsiFrame.split("\n").filter((l) => l.length > 0).length;
    expect(lineCount).toBeLessThanOrEqual(8);
    expect(lastAnsiFrame).toMatch(/… \d+ more active/);
    // 5 个 attempt 放不下,但至少展示了一部分(不是把全部都折叠成 0 行摘要)。
    const shownRows = (lastAnsiFrame.match(/●/g) ?? []).length;
    expect(shownRows).toBeGreaterThan(0);
    expect(shownRows).toBeLessThan(5);

    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

describe("TTY dashboard: 宽度以 stderr.columns 为硬上限,截断消息而不是软换行", () => {
  it("始终给 phase/detail 留出列宽，不能让身份列吞掉整行", async () => {
    const { fake, coordinator } = setupTty({ rows: 40, columns: 180 });
    coordinator.start(plan());
    coordinator.emit({
      type: "attempt:start",
      at: 0,
      identity: ref("memory/agent-029-use-cache-directive"),
      who: "codex-e2b",
      phase: "eval.run",
    });
    coordinator.emit({
      type: "attempt:progress",
      at: 0,
      identity: ref("memory/agent-029-use-cache-directive"),
      detail: "tool: pnpm test",
    });
    fake.advance(250);
    await flush();

    const lastAnsiFrame = fake.stderr.writes.filter((w) => w.includes(ESC)).at(-1)!;
    expect(lastAnsiFrame).toContain("running eval: tool: pnpm test");

    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("窄终端下 active 行的纯文本长度不超过 columns,且不含内嵌换行", async () => {
    const { fake, coordinator } = setupTty({ rows: 40, columns: 36 });
    coordinator.start(plan());
    coordinator.emit({
      type: "attempt:start",
      at: 0,
      identity: ref("memory/a-very-long-eval-id-that-does-not-fit"),
      who: "compare/a-very-long-agent-name",
      phase: "eval.run",
    });
    coordinator.emit({
      type: "attempt:progress",
      at: 0,
      identity: ref("memory/a-very-long-eval-id-that-does-not-fit"),
      detail: "a very long detail string that should be truncated, not wrapped",
    });
    fake.advance(250);
    await flush();

    const lastAnsiFrame = fake.stderr.writes.filter((w) => w.includes(ESC)).at(-1)!;
    // 逐个「视觉行」核对:按 \x1B[2K 切开(每个视觉行都以它开头),每段本身不应再含 "\n"
    // (即行内容没有被软换行拆成两个终端行),且刨去 ANSI 控制序列后的可见宽度不超过 columns。
    const rows = lastAnsiFrame.split(`${ESC}2K`).slice(1);
    for (const row of rows) {
      const visible = row.replace(/\n$/, "");
      expect(visible.includes("\n")).toBe(false);
      // eslint-disable-next-line no-control-regex
      const stripped = visible.replace(/\x1B\[[0-9]*[A-Za-z]/g, "");
      expect(stripped.length).toBeLessThanOrEqual(36);
    }

    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

// ───────────────────────── TTY dashboard: active slot 稳定 ─────────────────────────

describe("TTY dashboard: active slots 稳定,完成前不因其它 attempt 更新而换位", () => {
  it("A 完成、C 加入后,B 仍保持在 C 之前(不重新排序成到达/字母序)", async () => {
    const { fake, coordinator } = setupTty({ rows: 40, columns: 100 });
    coordinator.start(plan({ totalRuns: 3 }));
    coordinator.emit({ type: "attempt:start", at: 0, identity: ref("memory/a"), who: "who-a", phase: "eval.run" });
    coordinator.emit({ type: "attempt:start", at: 0, identity: ref("memory/b"), who: "who-b", phase: "eval.run" });
    fake.advance(250);
    await flush();

    coordinator.emit({ type: "attempt:complete", at: 0, identity: ref("memory/a"), who: "who-a", verdict: "passed" });
    coordinator.emit({ type: "attempt:start", at: 0, identity: ref("memory/c"), who: "who-c", phase: "eval.run" });
    fake.advance(250);
    await flush();

    const lastAnsiFrame = fake.stderr.writes.filter((w) => w.includes(ESC)).at(-1)!;
    expect(lastAnsiFrame).not.toContain("memory/a"); // 已完成,退出 active
    const idxB = lastAnsiFrame.indexOf("memory/b");
    const idxC = lastAnsiFrame.indexOf("memory/c");
    expect(idxB).toBeGreaterThan(-1);
    expect(idxC).toBeGreaterThan(-1);
    expect(idxB).toBeLessThan(idxC); // B 先于 C:C 是新到达的,追加在末尾,不插到 B 前面

    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

// ───────────────────────── TTY dashboard: 内容边界 ─────────────────────────

describe("TTY dashboard: 只含命令/elapsed/守恒计数/cost/active slots,不做会消失的诊断区块", () => {
  it("diagnostic 永久事件的文本只出现在一次性追加行里,不进入持续重画的 dashboard 帧", async () => {
    const { fake, coordinator } = setupTty();
    coordinator.start(plan());
    coordinator.diagnostic({ key: "memory-warmup-degraded", severity: "warning", message: "cold index (12 attempts)" });
    fake.advance(250);
    await flush();

    const lastAnsiFrame = fake.stderr.writes.filter((w) => w.includes(ESC)).at(-1)!;
    expect(lastAnsiFrame).not.toContain("memory-warmup-degraded");
    expect(lastAnsiFrame).not.toContain("cold index");
    // 但诊断本身确实被写过(非 ANSI 的那次纯文本追加)。
    expect(fake.stderr.writes.some((w) => w.includes("memory-warmup-degraded"))).toBe(true);

    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

// ───────────────────────── failure 展开上限 ─────────────────────────

describe("failed/errored 默认展开前 10 条,超过后追加一次 suppressed 提示且不丢总数", () => {
  it("12 条 failure 只展开 10 条,并给出 '… 2 more failures suppressed'", async () => {
    const { fake, coordinator } = setupTty();
    coordinator.start(plan({ totalRuns: 12 }));
    for (let i = 0; i < 12; i++) {
      coordinator.emit({
        type: "failure",
        at: i,
        locator: locator(`fail${i}`),
        identity: ref(`memory/eval-${i}`),
        who: `who-${i}`,
        verdict: "failed",
        reason: "gate: cache tool not used",
      });
    }
    await flush();
    expect(coordinator.state.failures).toHaveLength(12); // 完整结果不丢

    await coordinator.finish({
      summary: summary({ passed: 0, failed: 12 }),
      completion: completion(),
      paths: [],
    });
    // 单条 failure 立即追加走 stderr;完成页的 FAILURES 汇总(含最终 suppressed 总数)属于
    // "summary" 事件,走 stdout(见 human.ts 的 writeDurable/输出流边界测试)—— 这里两条流都要看。
    const text = fake.stderr.writes.join("") + fake.stdout.writes.join("");
    for (let i = 0; i < 10; i++) expect(text).toContain(`memory/eval-${i}`);
    expect(text).not.toContain("memory/eval-10");
    expect(text).not.toContain("memory/eval-11");
    expect(text).toContain("… 2 more failures suppressed");
  });
});

// ───────────────────────── 完成页 ─────────────────────────

describe("完成页:失败优先摘要 + locator + show/view 下一步 + 快照路径,不调用 renderRunReport 大表", () => {
  it("有失败时给出 FAILED 摘要、locator、Inspect/Eval/Trace/Diff/Compare 下一步命令", async () => {
    const { fake, coordinator } = setupTty();
    coordinator.start(plan({ totalRuns: 45 }, 6));
    coordinator.emit({
      type: "failure",
      at: 0,
      locator: locator("7m2k9p"),
      identity: ref("memory/commit0-cachetool"),
      who: "compare/bub-e2b",
      verdict: "failed",
      reason: "failed",
      assertion: {
        severity: "gate",
        assertion: "Issue 15193: selected proposal matches the accepted proposal",
        matcher: "equals(4)",
        expected: "4",
        received: "3",
        additionalFailures: 0,
      },
    });
    await coordinator.finish({
      summary: summary({ passed: 44, failed: 1, errored: 0, durationMs: 228_000 }),
      completion: completion(),
      paths: [".niceeval/compare/bub-e2b/2026-07-13T000000", ".niceeval/compare/codex/2026-07-13T000000"],
    });

    // 单条 failure 立即追加走 stderr;完成页(FAILED 摘要/Inspect 等下一步/Results 路径)属于
    // "summary"/"saved" 事件,走 stdout(见 human.ts 的 writeDurable/输出流边界测试)。
    const text = fake.stderr.writes.join("") + fake.stdout.writes.join("");
    expect(text).toContain("FAILED");
    expect(text).toContain("44 passed");
    expect(text).toContain("1 failed");
    expect(text).toContain("@17m2k9p");
    expect(text).toContain("memory/commit0-cachetool");
    expect(text).toContain("gate: Issue 15193: selected proposal matches the accepted proposal");
    expect(text).toContain("equals(4) · expected 4 · received 3");
    expect(text).toContain("Inspect: niceeval show @17m2k9p");
    expect(text).toContain("Eval:    niceeval show @17m2k9p --eval");
    expect(text).toContain("Trace:   niceeval show @17m2k9p --execution");
    expect(text).toContain("Diff:    niceeval show @17m2k9p --diff");
    expect(text).toContain("Compare: niceeval view compare");
    expect(text).toContain(".niceeval/compare/bub-e2b/2026-07-13T000000");
    // 不再是 renderRunReport() 的大表(表格标志性的竖线分隔表头在这里不应出现)。
    expect(text).not.toMatch(/-\+-/);
  });
});

describe("全通过:不显示空 FAILURES 区块;结果路径多时折叠", () => {
  it("全部通过时不出现 FAILURES 字样", async () => {
    const { fake, coordinator } = setupTty();
    coordinator.start(plan({ totalRuns: 45 }));
    await coordinator.finish({
      summary: summary({ passed: 45, failed: 0, errored: 0, durationMs: 201_000, estimatedCostUSD: 1.22 }),
      completion: completion(),
      paths: [
        ".niceeval/compare/a/2026",
        ".niceeval/compare/b/2026",
        ".niceeval/compare/c/2026",
        ".niceeval/compare/d/2026",
        ".niceeval/compare/e/2026",
      ],
    });
    // 完成页(PASSED 摘要)属于 "summary" 事件,走 stdout(见 human.ts 的 writeDurable/
    // 输出流边界测试)。
    const text = fake.stdout.writes.join("");
    expect(text).toContain("PASSED");
    expect(text).not.toContain("FAILURES");
  });

  it("结果路径超过折叠上限时只展示前几个 + '… N more',不逐行刷满几十个", async () => {
    const { fake, coordinator } = setupTty();
    coordinator.start(plan());
    const paths = Array.from({ length: 40 }, (_, i) => `.niceeval/compare/agent-${i}/2026`);
    await coordinator.finish({ summary: summary(), completion: completion(), paths });
    // 结果路径属于 "saved" 事件,走 stdout。
    const text = fake.stdout.writes.join("");
    expect(text).toContain("agent-0");
    expect(text).not.toContain("agent-39"); // 第 40 个不应该被逐行列出
    expect(text).toMatch(/… \d+ more/);
  });

  // required reporter(默认 artifacts、显式 --json/--junit)写失败必须让完成页判红,即便全部
  // attempt 都通过——退出码已经因此非零(见 computeCiExitCode 对 reporterErrors 的同一条判断),
  // 完成页不能反过来印一个会被误读成"全绿"的 PASSED(与 ci.ts 的 resultStatusWord() 同一契约)。
  it("required reporter 写失败时即便全部 attempt 通过,也显示 FAILED 而不是 PASSED", async () => {
    const { fake, coordinator } = setupTty();
    coordinator.start(plan());
    await coordinator.finish({
      summary: summary({ passed: 45, failed: 0, errored: 0 }),
      completion: completion({
        reporterErrors: [{ reporter: "json", required: true, message: "EEXIST: mkdir failed" }],
      }),
      paths: [],
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("FAILED");
    expect(text).not.toContain("PASSED");
  });

  // best-effort reporter(用户 config.reporters,如未显式 --json/--junit 的自定义出口)写失败
  // 只折成 diagnostic,不影响退出码——完成页同样不应该判红,否则和实际退出码矛盾。
  it("非 required reporter 写失败不影响完成页判定,仍显示 PASSED", async () => {
    const { fake, coordinator } = setupTty();
    coordinator.start(plan());
    await coordinator.finish({
      summary: summary({ passed: 45, failed: 0, errored: 0 }),
      completion: completion({
        reporterErrors: [{ reporter: "config-reporter-0", required: false, message: "network timeout" }],
      }),
      paths: [],
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("PASSED");
    expect(text).not.toContain("FAILED");
  });
});

describe("全量复用:只展示静态计划与终局,本次执行指标归零", () => {
  it("不画 dashboard,历史失败进入 FAILURES,历史 usage/cost 不进入本次摘要", async () => {
    const { fake, coordinator } = setupTty();
    const carriedLocator = locator("carried-failure");
    coordinator.start({
      ...plan({ totalRuns: 2, evals: 2 }, 2),
      reusedFailures: [{
        locator: carriedLocator,
        identity: ref("memory/carried"),
        who: "compare/bub-e2b",
        verdict: "failed",
        reason: "gate: carried assertion failed",
      }],
    });
    await coordinator.finish({
      summary: summary({
        passed: 1,
        failed: 1,
        durationMs: 0,
        usage: { inputTokens: 7_000, outputTokens: 40 },
        estimatedCostUSD: 7.04,
      }),
      completion: completion(),
      paths: [],
    });

    const stderr = fake.stderr.writes.join("");
    const stdout = fake.stdout.writes.join("");
    expect(stderr).toContain("Reuse: 2 of 2 carried in from cache · 0 to run");
    expect(stderr).not.toContain("niceeval exp compare");
    expect(stderr).not.toContain(ESC);
    expect(stdout).toContain("FAILURES");
    expect(stdout).toContain("(all 2 reused)");
    expect(stdout).toContain(String(carriedLocator));
    expect(stdout).toContain("0s · 0 new tok · $0.00");
    expect(stdout).not.toContain("7.0k");
    expect(stdout).not.toContain("$7.04");
  });
});

// ───────────────────────── 输出流边界:stdout 只留给最终摘要与结果路径 ─────────────────────────

describe("输出流边界:human 的 stdout 只留给最终摘要与结果路径,其它永久事件都在 stderr", () => {
  it("plan/failure/diagnostic 只出现在 stderr,完成页(FAILED/Results)只出现在 stdout", async () => {
    const { fake, coordinator } = setupTty();
    coordinator.start(plan({ totalRuns: 45 }, 6));
    coordinator.diagnostic({ key: "memory-warmup-degraded", severity: "warning", message: "cold index" });
    coordinator.emit({
      type: "failure",
      at: 0,
      locator: locator("7m2k9p"),
      identity: ref("memory/commit0-cachetool"),
      who: "compare/bub-e2b",
      verdict: "failed",
      reason: "gate: cache tool not used",
    });
    await coordinator.finish({
      summary: summary({ passed: 44, failed: 1, errored: 0 }),
      completion: completion(),
      paths: [".niceeval/compare/bub-e2b/2026-07-13T000000"],
    });

    const stderrText = fake.stderr.writes.join("");
    const stdoutText = fake.stdout.writes.join("");

    // 计划/诊断/失败的一次性追加行在 stderr,不在 stdout(否则 `niceeval exp > out.txt` 会把
    // 过程噪音混进理应只含最终结论的文件)。
    expect(stderrText).toContain("Plan:");
    expect(stderrText).toContain("memory-warmup-degraded");
    expect(stderrText).toContain("gate: cache tool not used");
    expect(stdoutText).not.toContain("Plan:");
    expect(stdoutText).not.toContain("memory-warmup-degraded");

    // 完成页(FAILED 摘要 + 结果路径)在 stdout,不在 stderr。
    expect(stdoutText).toContain("FAILED");
    expect(stdoutText).toContain(".niceeval/compare/bub-e2b/2026-07-13T000000");
    expect(stderrText).not.toContain("FAILED");
    expect(stderrText).not.toContain(".niceeval/compare/bub-e2b/2026-07-13T000000");
  });
});

// ───────────────────────── 非 TTY 退化流 ─────────────────────────

describe("显式 human + 非 TTY:无 ANSI,start + 永久事件 + 30 秒空闲 heartbeat,结束仍用 human 摘要", () => {
  it("全程没有任何 ANSI 控制字符", async () => {
    const { fake, coordinator } = setupPlain();
    coordinator.start(plan());
    coordinator.diagnostic({ key: "x", severity: "warning", message: "y" });
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [".niceeval/compare/a/2026"] });
    // 非 TTY 退化流全程零 ANSI——不管落在 stderr(计划/诊断)还是 stdout(最终摘要/结果路径)。
    expect(fake.stderr.writes.join("")).not.toContain(ESC);
    expect(fake.stdout.writes.join("")).not.toContain(ESC);
  });

  it("start(plan) 立即追加一行;之后 29.9 秒无永久事件不 heartbeat,满 30 秒才追加一条", async () => {
    const { fake, coordinator } = setupPlain();
    coordinator.start(plan({ totalRuns: 5 }));
    await flush();
    expect(fake.stderr.writes.some((w) => w.includes("Plan:"))).toBe(true);
    const afterPlan = fake.stderr.writes.length;

    fake.advance(29_000);
    await flush();
    expect(fake.stderr.writes.length).toBe(afterPlan); // 还没到 30s,不 heartbeat

    fake.advance(1_000); // 累计 30s
    await flush();
    expect(fake.stderr.writes.length).toBe(afterPlan + 1);
    expect(fake.stderr.writes.at(-1)).toMatch(/elapsed/);

    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("永久事件(diagnostic)会重置空闲计时器,不会紧跟着再冒出一条冗余 heartbeat", async () => {
    const { fake, coordinator } = setupPlain();
    coordinator.start(plan());
    await flush();
    fake.advance(20_000);
    coordinator.diagnostic({ key: "reset", severity: "warning", message: "resets the clock" });
    await flush();
    const afterDiagnostic = fake.stderr.writes.length;

    fake.advance(29_000); // 距 diagnostic 才 29s,还没到 30s
    await flush();
    expect(fake.stderr.writes.length).toBe(afterDiagnostic);

    fake.advance(1_000); // 距 diagnostic 满 30s
    await flush();
    expect(fake.stderr.writes.length).toBe(afterDiagnostic + 1);

    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("结束仍然是 human 文案摘要(不是 agent/ci 的 key=value envelope)", async () => {
    const { fake, coordinator } = setupPlain();
    coordinator.start(plan());
    await coordinator.finish({
      summary: summary({ passed: 0, failed: 1, errored: 0 }),
      completion: completion(),
      paths: [],
    });
    // 完成页(FAILED 摘要)属于 "summary" 事件,走 stdout。
    const text = fake.stdout.writes.join("");
    expect(text).toContain("FAILED");
    expect(text).not.toContain("NICEEVAL"); // agent/ci envelope 的标志前缀,human 不应该出现
    expect(text).not.toContain("=passed"); // ci 的 key=value 形态
  });

  it("非 TTY 不维护 active slot,不逐次展示阶段变化(不实现 onLifecycle/redrawDynamic)", async () => {
    const { fake, coordinator } = setupPlain();
    coordinator.start(plan());
    coordinator.emit({ type: "attempt:start", at: 0, identity: ref("memory/a"), who: "bub-e2b", phase: "eval.run" });
    coordinator.emit({ type: "attempt:phase", at: 1, identity: ref("memory/a"), phase: "agent.setup" });
    await flush();
    const text = fake.stderr.writes.join("");
    expect(text).not.toContain("agent setup");
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

// ───────────────────────── renderDurableLines:纯函数直接单测 ─────────────────────────

describe("renderDurableLines: 纯函数,不需要经过 coordinator 也能验证具体文案", () => {
  it("plan 事件在有 reused 时只给出聚合 Reuse 行,不展开每个配置", () => {
    const state = createInitialRunFeedbackState();
    const lines = renderDurableLines(
      { type: "plan", at: 0, plan: plan({ totalRuns: 45, evals: 9, configs: 5, maxConcurrency: 19 }, 6) },
      state,
    );
    expect(lines[0]).toContain("45 attempts");
    expect(lines).toContain("Reuse: 6 of 45 carried in from cache · 39 to run");
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes("compare/bub-e2b"))).toBe(false);
  });

  it("interrupted 事件复用现有 runner.interrupted 文案,不重新发明一份", () => {
    const state = createInitialRunFeedbackState();
    const lines = renderDurableLines({ type: "interrupted", at: 0 }, state);
    expect(lines.join("\n")).toContain("interrupted");
  });
});
