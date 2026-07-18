// cases: docs/engineering/unit-tests/experiments-runner/cases.md
// Agent renderer 测试:全部经真实 FeedbackCoordinator + createFakeFeedbackIO 驱动(不
// monkey-patch process/Date/setInterval),断言具体文本而不是整段 snapshot diff——逐条对应
// plan section E 的 checklist 与 docs/feature/experiments/cli.md「AI agent 怎么用」的例子。
//
// 几个测试直接用 cli.md 给出的字面文本做断言(不只是结构性检查),因为这些例子是这个
// renderer 唯一的书面契约来源——如果哪天悄悄改动了字段名/顺序,这里应该红。

import { afterEach, describe, expect, it } from "vitest";
import { createFeedbackCoordinator, type FeedbackCoordinator } from "./coordinator.ts";
import { createFakeFeedbackIO, type FakeFeedbackIO } from "./testing.ts";
import { activeFeedbackSinkCount } from "./sink.ts";
import { createAgentRenderer, renderAgentPlanEnvelope } from "./agent.ts";
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

/** ANSI escape 起始字节;agent 输出必须永远不出现。 */
const ESC = "\x1B[";

function setup(): { fake: FakeFeedbackIO; coordinator: FeedbackCoordinator } {
  const fake = createFakeFeedbackIO({ stderr: { isTTY: false }, stdout: { isTTY: false } });
  const renderer = createAgentRenderer({ io: fake.io });
  const coordinator = createFeedbackCoordinator({ profile: "agent", renderer, io: fake.io, tickIntervalMs: 250 });
  return { fake, coordinator };
}

afterEach(() => {
  expect(activeFeedbackSinkCount()).toBe(0);
});

// ───────────────────────── 固定 ASCII envelope:无 ANSI、字段转义 ─────────────────────────

describe("固定 ASCII envelope,不依赖 locale", () => {
  it("全程(checkpoint + handoff)不出现任何 ANSI 控制字符", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    coordinator.diagnostic({ key: "x", severity: "warning", message: "has a space" });
    await coordinator.finish({
      summary: summary({ passed: 0, failed: 1 }),
      completion: completion(),
      paths: [".niceeval/compare/a/2026"],
    });
    const all = fake.stderr.writes.join("") + fake.stdout.writes.join("");
    expect(all).not.toContain(ESC);
  });

  it("字段值含空格时用 JSON string 转义,不含空格时保持裸 token", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan());
    coordinator.diagnostic({ key: "no-spaces", severity: "warning", message: "cold index" });
    await flush();
    const text = fake.stderr.writes.join("");
    expect(text).toContain('message="cold index"'); // 含空格 → JSON 转义
    expect(text).toContain("key=no-spaces"); // 不含空格 → 裸 token,不加引号
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

// ───────────────────────── start 立即追加 / 30 秒空闲 heartbeat / 永久事件重置时钟 ─────────────────────────

describe("start 立即追加;仅连续 30 秒无永久事件才 heartbeat;failure 后重置心跳时钟", () => {
  it("cli.md 给出的四行 progress/failure 例子:字面文本逐行复现", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 5 }, 1)); // total=5 reused=1 → queued=4

    // 调度已经把 4 个非携入 attempt 派发出去(running=4 queued=0)。
    for (let i = 0; i < 4; i++) {
      coordinator.emit({ type: "attempt:start", at: 0, identity: ref(`memory/eval-${i}`), who: "compare/bub-e2b", phase: "eval.run" });
    }
    fake.advance(250); // t=250:第一次 tick,无条件打印,不等 30 秒
    await flush();

    // 30s 之前有一个 attempt 正常完成(不打印,只改变 running/completed)。
    coordinator.emit({ type: "attempt:complete", at: 250, identity: ref("memory/eval-0"), who: "compare/bub-e2b", verdict: "passed" });
    fake.advance(30_000); // t=30250:距首条 checkpoint(t=250)满 30s → 触发第二条
    await flush();

    // 30s~75s 之间:一个 attempt 正常完成(静默)+ 一个 attempt 失败(立即追加 locator)。
    coordinator.emit({ type: "attempt:complete", at: 30_250, identity: ref("memory/eval-1"), who: "compare/bub-e2b", verdict: "passed" });
    fake.advance(14_750); // t=45000(250 的整数倍,与 tick 网格对齐)
    coordinator.emit({ type: "attempt:complete", at: 45_000, identity: ref("memory/commit0-cachetool"), who: "compare/bub-e2b", verdict: "failed" });
    coordinator.emit({
      type: "failure",
      at: 45_000,
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
    await flush();
    fake.advance(30_000); // t=75000:距 failure(t=45000)满 30s → 触发第三条(网格对齐,不需要多等)
    await flush();

    const lines = fake.stderr.writes.map((w) => w.trimEnd()).filter((w) => w.startsWith("NICEEVAL"));
    expect(lines).toEqual([
      "NICEEVAL progress elapsed=0s total=5 reused=1 running=4 queued=0 completed=0",
      "NICEEVAL progress elapsed=30s total=5 reused=1 running=3 queued=0 completed=1",
      "NICEEVAL failure locator=@17m2k9p eval=memory/commit0-cachetool experiment=compare/bub-e2b verdict=failed",
      "NICEEVAL progress elapsed=75s total=5 reused=1 running=1 queued=0 completed=3",
    ]);

    await coordinator.finish({ summary: summary({ passed: 2, failed: 1 }), completion: completion(), paths: [] });
  });

  it("29.9 秒无永久事件不 heartbeat,满 30 秒才追加一条", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    fake.advance(250); // 第一次 tick,立即打印
    await flush();
    const afterFirst = fake.stderr.writes.length;

    fake.advance(29_500); // 累计 29750,距首条不到 30s
    await flush();
    expect(fake.stderr.writes.length).toBe(afterFirst);

    fake.advance(500); // 累计 30250,满 30s
    await flush();
    expect(fake.stderr.writes.length).toBe(afterFirst + 1);

    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("errored 的 checkpoint 用 'error' 命令词,并携带 phase 字段", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    coordinator.emit({
      type: "failure",
      at: 0,
      locator: locator("2h8m4k1"),
      identity: ref("memory/agent-029-use-cache", 0, "compare/claude-e2b"),
      who: "compare/claude-e2b",
      verdict: "errored",
      reason: "sandbox-rate-limit: E2B sandbox allocation failed after 5 attempts",
      phase: "sandbox.create",
    });
    await flush();
    const text = fake.stderr.writes.join("");
    expect(text).toContain(
      "NICEEVAL error locator=@12h8m4k1 eval=memory/agent-029-use-cache experiment=compare/claude-e2b phase=sandbox.create verdict=errored",
    );
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

// ───────────────────────── 不输出 active phase / waiting 明细 / passed / raw progress / 表格 ─────────────────────────

describe("不输出 active phase、waiting 明细、passed result、raw progress 或表格", () => {
  it("lifecycle 事件(start/phase/progress/complete)不产生任何可见输出", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 2 }));
    coordinator.emit({ type: "attempt:start", at: 0, identity: ref("memory/a"), who: "compare/bub-e2b", phase: "eval.run" });
    coordinator.emit({ type: "attempt:phase", at: 1, identity: ref("memory/a"), phase: "agent.setup" });
    coordinator.emit({ type: "attempt:progress", at: 2, identity: ref("memory/a"), detail: "tool: shell" });
    coordinator.emit({ type: "attempt:complete", at: 3, identity: ref("memory/a"), who: "compare/bub-e2b", verdict: "passed" });
    fake.advance(250);
    await flush();
    const text = fake.stderr.writes.join("");
    expect(text).not.toContain("agent-setup");
    expect(text).not.toContain("agent setup");
    expect(text).not.toContain("tool: shell");
    expect(text).not.toContain("passed"); // passed attempt 本身不逐条打印
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

// ───────────────────────── failure/error 展开上限 5 条 + suppressed ─────────────────────────

describe("failed/errored 立即输出 locator;默认最多展开 5 条,之后输出 suppressed 总数", () => {
  it("12 条 failure 只展开 5 条 checkpoint,第 6 条给一次 suppressed 提示,完整结果不丢", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 12 }));
    for (let i = 0; i < 12; i++) {
      coordinator.emit({
        type: "failure",
        at: i,
        locator: locator(`f${i}`),
        identity: ref(`memory/eval-${i}`),
        who: `who-${i}`,
        verdict: "failed",
        reason: "gate: cache tool not used",
      });
    }
    await flush();
    expect(coordinator.state.failures).toHaveLength(12); // reducer 完整保留,不因展开上限丢数据

    const text = fake.stderr.writes.join("");
    for (let i = 0; i < 5; i++) expect(text).toContain(`memory/eval-${i}`);
    expect(text).not.toContain("memory/eval-5");
    expect(text).not.toContain("memory/eval-11");
    expect(text).toContain("failures-suppressed");
    // suppressed 提示只出现一次(不是每条越限失败都重复一遍)。
    expect(text.split("failures-suppressed").length - 1).toBe(1);

    await coordinator.finish({
      summary: summary({ passed: 0, failed: 12 }),
      completion: completion(),
      paths: [],
    });
  });
});

// ───────────────────────── 最终 stdout handoff:有界、逐条一层原因 + show 下钻 ─────────────────────────

describe("最终 stdout handoff:status/summary/快照/最多 5 个失败/show 下钻命令", () => {
  it("cli.md 的 RESULT 例子:字面文本逐行复现", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 5 }, 1));
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
      summary: summary({ passed: 4, failed: 1, errored: 0 }),
      completion: completion(),
      paths: [".niceeval/compare/bub-e2b/<snapshot>", ".niceeval/compare/codex/<snapshot>"],
    });

    const expected = [
      "NICEEVAL RESULT failed",
      "summary: 4 passed, 1 failed, 0 errored (1 reused)",
      "snapshots:",
      "  - .niceeval/compare/bub-e2b/<snapshot>",
      "  - .niceeval/compare/codex/<snapshot>",
      "failures:",
      "  - @17m2k9p memory/commit0-cachetool [compare/bub-e2b]",
      "    gate: Issue 15193: selected proposal matches the accepted proposal",
      "      equals(4) · expected 4 · received 3",
      "next:",
      "  niceeval show @17m2k9p",
      "  niceeval show @17m2k9p --eval",
      "  niceeval show @17m2k9p --execution",
      "  niceeval show @17m2k9p --diff",
      "",
    ].join("\n");
    expect(fake.stdout.writes.join("")).toBe(expected);
    // handoff 完全在 stdout;checkpoint(failure 行)完全在 stderr,两者不混流。
    expect(fake.stderr.writes.join("")).not.toContain("RESULT");
    expect(fake.stdout.writes.join("")).not.toContain("NICEEVAL progress");
  });

  it("全部通过时不留空的 failures/next 区块", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    await coordinator.finish({
      summary: summary({ passed: 1, failed: 0, errored: 0 }),
      completion: completion(),
      paths: [".niceeval/compare/a/2026"],
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("NICEEVAL RESULT passed");
    expect(text).not.toContain("failures:");
    expect(text).not.toContain("next:");
  });

  it("incomplete/interrupted 时状态词优先于 verdict 计数,summary 带 unstarted", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 5 }));
    await coordinator.finish({
      summary: summary({ passed: 3, failed: 0, errored: 0 }),
      completion: completion({ status: "incomplete", unstarted: 2 }),
      paths: [],
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("NICEEVAL RESULT incomplete");
    expect(text).toContain("summary: 3 passed, 0 failed, 0 errored (0 reused, 2 unstarted)");
  });

  // required reporter(默认 artifacts、显式 --json/--junit)写失败必须让 handoff 判红,即便
  // 全部 attempt 都通过——退出码已经因此非零(见 computeCiExitCode 对 reporterErrors 的同一
  // 条判断),handoff 不能反过来印一个会被误读成"全绿"的 passed(与 ci.ts 的
  // resultStatusWord() 同一契约)。
  it("required reporter 写失败时即便全部 attempt 通过,也报 failed 而不是 passed", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    await coordinator.finish({
      summary: summary({ passed: 1, failed: 0, errored: 0 }),
      completion: completion({
        reporterErrors: [{ reporter: "json", required: true, message: "EEXIST: mkdir failed" }],
      }),
      paths: [],
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("NICEEVAL RESULT failed");
    expect(text).not.toContain("NICEEVAL RESULT passed");
  });

  // best-effort reporter(用户 config.reporters)写失败只折成 diagnostic,不影响退出码——
  // handoff 同样不应该判红,否则和实际退出码矛盾。
  it("非 required reporter 写失败不影响 handoff 判定,仍报 passed", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    await coordinator.finish({
      summary: summary({ passed: 1, failed: 0, errored: 0 }),
      completion: completion({
        reporterErrors: [{ reporter: "config-reporter-0", required: false, message: "network timeout" }],
      }),
      paths: [],
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("NICEEVAL RESULT passed");
    expect(text).not.toContain("NICEEVAL RESULT failed");
  });

  it("handoff 不内联 transcript/trace/diff——只给 locator 与 show 下钻命令", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    coordinator.emit({
      type: "failure",
      at: 0,
      locator: locator("x"),
      identity: ref("memory/a"),
      who: "compare/bub-e2b",
      verdict: "failed",
      reason: "gate: something failed with a long human explanation",
    });
    await coordinator.finish({ summary: summary({ passed: 0, failed: 1 }), completion: completion(), paths: [] });
    const text = fake.stdout.writes.join("");
    expect(text).not.toContain("transcript");
    expect(text).not.toContain("trace");
    // "diff" 只应该以 "--diff" 下钻命令的形式出现一次,不应该有第二处(内联 diff 内容)。
    expect(text.split("diff").length - 1).toBe(1);
    expect(text).toContain("niceeval show @1x");
  });

  it("失败超过 5 条时:'N total, showing 5' + 只展开前 5 条 + 一次 suppressed footer", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 12 }));
    for (let i = 0; i < 12; i++) {
      coordinator.emit({
        type: "failure",
        at: i,
        locator: locator(`f${i}`),
        identity: ref(`memory/eval-${i}`),
        who: `who-${i}`,
        verdict: "failed",
        reason: "gate: cache tool not used",
      });
    }
    await coordinator.finish({
      summary: summary({ passed: 0, failed: 12 }),
      completion: completion(),
      paths: [".niceeval/compare/a/2026", ".niceeval/compare/b/2026"],
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("failures: 12 total, showing 5");
    for (let i = 0; i < 5; i++) expect(text).toContain(`memory/eval-${i}`);
    expect(text).not.toContain("memory/eval-5 ");
    expect(text).toContain("… 7 more; inspect the JSON result or run `niceeval view compare`");
  });

  it("快照路径超过上限时折叠成 '… N more'", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    const paths = Array.from({ length: 8 }, (_, i) => `.niceeval/compare/agent-${i}/2026`);
    await coordinator.finish({ summary: summary(), completion: completion(), paths });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("agent-0");
    expect(text).not.toContain("agent-7");
    expect(text).toContain("… 3 more");
  });
});

// ───────────────────────── budget-exhausted / interrupted / reporter-error:去重后追加一次 ─────────────────────────

describe("diagnostic 类永久事件去重后只追加一次", () => {
  it("同一 budget-exhausted experimentId 触发 3 次只打印第一次", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 3 }));
    for (let i = 0; i < 3; i++) {
      coordinator.emit({ type: "budget-exhausted", at: i, experimentId: "regression/codex", spent: 25.31, unstarted: i + 1 });
    }
    await flush();
    const text = fake.stderr.writes.join("");
    expect(text.split("budget_exhausted").length - 1).toBe(1);
    expect(text).toContain("NICEEVAL budget_exhausted experiment=regression/codex spent=25.31 unstarted=1");
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("interrupted 只追加一次", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    coordinator.interrupted();
    await flush();
    const text = fake.stderr.writes.join("");
    expect(text).toContain("NICEEVAL interrupted elapsed=0s");
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("reporter-error 去重后追加一次,携带 required 字段", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    coordinator.reporterError({ reporter: "artifacts", required: true, message: "EACCES: permission denied" });
    coordinator.reporterError({ reporter: "artifacts", required: true, message: "EACCES: permission denied" });
    await flush();
    const text = fake.stderr.writes.join("");
    expect(text.split("reporter_error").length - 1).toBe(1);
    expect(text).toContain('NICEEVAL reporter_error reporter=artifacts required=true message="EACCES: permission denied"');
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

// ───────────────────────── `--dry --output agent`:稳定 PLAN envelope ─────────────────────────

describe("`--dry --output agent`:不经 coordinator,直接渲染 PLAN envelope", () => {
  it("cli.md 的 PLAN 例子:5 个组合展开 2 行 + '… 3 more'", () => {
    const text = renderAgentPlanEnvelope({
      total: 5,
      evals: 1,
      configs: 5,
      runs: 1,
      rows: [
        { label: "compare/bub-e2b", evalId: "memory/commit0-cachetool" },
        { label: "compare/codex", evalId: "memory/commit0-cachetool" },
        { label: "compare/claude-e2b", evalId: "memory/commit0-cachetool" },
        { label: "compare/deepseek", evalId: "memory/commit0-cachetool" },
        { label: "compare/gpt-5-1", evalId: "memory/commit0-cachetool" },
      ],
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("NICEEVAL PLAN total=5 evals=1 configs=5 runs=1");
    expect(lines[1]).toContain("compare/bub-e2b");
    expect(lines[1]).toContain("memory/commit0-cachetool");
    expect(lines[2]).toContain("compare/codex");
    expect(lines.at(-1)).toBe("… 3 more");
    expect(lines).toHaveLength(4);
  });

  it("不超过上限时不折叠,也不出现任何 ANSI", () => {
    const text = renderAgentPlanEnvelope({
      total: 2,
      evals: 2,
      configs: 1,
      runs: 1,
      rows: [
        { label: "compare/bub-e2b", evalId: "memory/a" },
        { label: "compare/bub-e2b", evalId: "memory/b" },
      ],
    });
    expect(text).not.toContain(ESC);
    expect(text).not.toContain("more");
    expect(text.split("\n")).toHaveLength(3);
  });
});

// ───────────────────────── 实验级钩子起止行(cases.md「实验级生命周期」) ─────────────────────────

describe("agent: 实验级钩子起止各追加一行", () => {
  it("experiment_setup / experiment_teardown 各含 experiment 与 status 字段,done/failed 带 duration", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 2, evals: 2 }));
    coordinator.experimentHook({ experimentId: "compare/bub-e2b", hook: "setup", status: "started" });
    coordinator.experimentHook({ experimentId: "compare/bub-e2b", hook: "setup", status: "done", durationMs: 42_000 });
    coordinator.experimentHook({ experimentId: "compare/bub-e2b", hook: "teardown", status: "started" });
    coordinator.experimentHook({ experimentId: "compare/bub-e2b", hook: "teardown", status: "failed", durationMs: 3_000 });
    await flush();
    const lines = fake.stderr.writes.join("").split("\n");
    expect(lines).toContain("NICEEVAL experiment_setup experiment=compare/bub-e2b status=started");
    expect(lines).toContain("NICEEVAL experiment_setup experiment=compare/bub-e2b status=done duration=42s");
    expect(lines).toContain("NICEEVAL experiment_teardown experiment=compare/bub-e2b status=started");
    expect(lines).toContain("NICEEVAL experiment_teardown experiment=compare/bub-e2b status=failed duration=3s");
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("实验级 progress 与 activity 在 agent 下零输出(短命状态不进 checkpoint 流)", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan());
    await flush(); // 先排空 start 事件的队列任务,再取零输出基线
    const before = fake.stderr.writes.length;
    coordinator.experimentProgress({ experimentId: "compare/bub-e2b", detail: "starting tunnel" });
    coordinator.activity("prechecking judge config...");
    await flush();
    expect(fake.stderr.writes.slice(before).join("")).toBe("");
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});
