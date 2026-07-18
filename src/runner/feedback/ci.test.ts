// cases: docs/engineering/unit-tests/experiments-runner/cases.md
// CI renderer 测试:全部经真实 FeedbackCoordinator + createFakeFeedbackIO 驱动(不
// monkey-patch process/Date/setInterval),断言具体文本而不是整段 snapshot diff——逐条对应
// plan section F 的 checklist 与 docs/feature/experiments/cli.md「CI 怎么用」的例子。
//
// 「PR / nightly --no-early-exit / budget incomplete 三类集成测试覆盖文档示例」(checklist
// 第七条)在文件末尾单独成一个 describe 块,分别对应 cli.md「CI 常见 case」给出的三条命令。

import { afterEach, describe, expect, it } from "vitest";
import { createFeedbackCoordinator, type FeedbackCoordinator } from "./coordinator.ts";
import { createFakeFeedbackIO, type FakeFeedbackIO } from "./testing.ts";
import { activeFeedbackSinkCount } from "./sink.ts";
import { createCiRenderer, computeCiExitCode } from "./ci.ts";
import type { AttemptLocator } from "../../results/locator.ts";
import type { AttemptRef, RunCompletion, RunFeedbackPlan, RunSummary } from "../types.ts";

function loc(id: string): AttemptLocator {
  return id as AttemptLocator;
}

function ref(evalId: string, attempt = 0, experimentId = "ci/bub"): AttemptRef {
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
    durationMs: 60_000,
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

/** ANSI escape 起始字节;CI 输出必须永远不出现。 */
const ESC = "\x1B[";

function setup(): { fake: FakeFeedbackIO; coordinator: FeedbackCoordinator } {
  const fake = createFakeFeedbackIO({ stderr: { isTTY: false }, stdout: { isTTY: false } });
  const renderer = createCiRenderer({ io: fake.io });
  const coordinator = createFeedbackCoordinator({ profile: "ci", renderer, io: fake.io, tickIntervalMs: 250 });
  return { fake, coordinator };
}

afterEach(() => {
  expect(activeFeedbackSinkCount()).toBe(0);
});

// ───────────────────────── 单一 stdout sink,不与 stderr 混流 ─────────────────────────

describe("CI 正常事件全部走一个 stdout sink", () => {
  it("start/progress/failed/result/json/junit/snapshots 全部在 stdout,stderr 全程为空", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 2 }));
    coordinator.emit({
      type: "failure",
      at: 0,
      locator: loc("@x"),
      identity: ref("memory/a"),
      who: "ci/bub",
      verdict: "failed",
      reason: "gate failed",
      assertion: {
        severity: "gate",
        assertion: "Issue 15193: selected proposal matches the accepted proposal",
        matcher: "equals(4)",
        expected: "4",
        received: "3",
        additionalFailures: 0,
      },
    });
    coordinator.diagnostic({ key: "warn-1", severity: "warning", message: "cold cache" });
    await coordinator.finish({
      summary: summary({ passed: 1, failed: 1 }),
      completion: completion(),
      paths: [".niceeval/ci/a/2026"],
      json: ".niceeval/ci-summary.json",
      junit: ".niceeval/junit.xml",
    });
    expect(fake.stderr.writes.join("")).toBe("");
    const text = fake.stdout.writes.join("");
    expect(text).toContain("niceeval: start");
    expect(text).toContain("niceeval: failed");
    expect(text).toContain('severity=gate assertion="Issue 15193: selected proposal matches the accepted proposal" matcher=equals(4) expected=4 received=3');
    expect(text).toContain("niceeval: warning");
    expect(text).toContain("niceeval: result=");
    expect(text).toContain("niceeval: json=");
    expect(text).toContain("niceeval: junit=");
    expect(text).toContain("niceeval: snapshots=");
  });

  it("不出现任何 ANSI 控制字符", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan());
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
    expect(fake.stdout.writes.join("") + fake.stderr.writes.join("")).not.toContain(ESC);
  });
});

// ───────────────────────── 固定 ASCII key=value,不随 NICEEVAL_LANG 变化 ─────────────────────────

describe("固定 English/ASCII key=value 行", () => {
  it("字段值含空格时用 JSON string 转义,不含空格时保持裸 token", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan());
    coordinator.diagnostic({ key: "no-spaces", severity: "warning", message: "cold index warmup" });
    await flush();
    const text = fake.stdout.writes.join("");
    expect(text).toContain('message="cold index warmup"');
    expect(text).toContain("key=no-spaces");
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("字段名与格式不读 io.env——renderer 不接触 NICEEVAL_LANG 之类的环境变量", async () => {
    const fake = createFakeFeedbackIO({
      stderr: { isTTY: false },
      stdout: { isTTY: false },
      env: { NICEEVAL_LANG: "zh-CN" },
    });
    const renderer = createCiRenderer({ io: fake.io });
    const coordinator = createFeedbackCoordinator({ profile: "ci", renderer, io: fake.io, tickIntervalMs: 250 });
    coordinator.start(plan({ totalRuns: 24, configs: 3, maxConcurrency: 10 }, 18));
    await coordinator.finish({ summary: summary({ passed: 23, failed: 1 }), completion: completion(), paths: [] });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("niceeval: start total=24 configs=3 concurrency=10 reused=18");
    expect(text).toContain("niceeval: result=failed passed=23 failed=1 errored=0");
  });
});

// ───────────────────────── start 立即追加 / 60 秒空闲 heartbeat / 永久事件重置时钟 ─────────────────────────

describe("start 立即追加;仅连续 60 秒无永久事件才 heartbeat;failure 后重置时钟", () => {
  it("cli.md「CI 怎么用」给出的字面例子:逐行复现", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ evals: 8, configs: 3, totalRuns: 24, maxConcurrency: 10 }, 18));

    // 调度把 6 个非携入 attempt(24 total - 18 reused)派发出去。
    for (let i = 0; i < 6; i++) {
      coordinator.emit({ type: "attempt:start", at: 100, identity: ref(`memory/eval-${i}`), who: "ci/bub", phase: "eval.run" });
    }
    fake.advance(60_000); // t=60000:距 "plan"(t=0)满 60s → 第一条 progress heartbeat
    await flush();

    coordinator.emit({
      type: "failure",
      at: 60_000,
      locator: loc("@7m2k9p"),
      identity: ref("memory/commit0-cachetool"),
      who: "ci/bub",
      verdict: "failed",
      reason: "gate: cache tool not used",
    });
    await flush();

    // 4 个 attempt 完成(running 6→2,completed 0→4),都在下一次 heartbeat 之前。
    for (let i = 0; i < 4; i++) {
      coordinator.emit({ type: "attempt:complete", at: 60_500 + i, identity: ref(`memory/eval-${i}`), who: "ci/bub", verdict: "passed" });
    }
    fake.advance(60_000); // t=120000:距 failure(t=60000)满 60s → 第二条 heartbeat
    await flush();

    await coordinator.finish({
      summary: summary({ passed: 23, failed: 1, errored: 0, durationMs: 128_000 }),
      completion: completion(),
      paths: [".niceeval/ci/bub/<snapshot>", ".niceeval/ci/codex/<snapshot>", ".niceeval/ci/claude/<snapshot>"],
      json: ".niceeval/ci-summary.json",
      junit: ".niceeval/junit.xml",
    });

    const lines = fake.stdout.writes.join("").split("\n").filter(Boolean);
    expect(lines).toEqual([
      "niceeval: start total=24 configs=3 concurrency=10 reused=18",
      "niceeval: progress elapsed=60s reused=18 running=6 queued=0 completed=0",
      'niceeval: failed locator=@7m2k9p eval=memory/commit0-cachetool experiment=ci/bub reason="gate: cache tool not used"',
      "niceeval: progress elapsed=120s reused=18 running=2 queued=0 completed=4",
      "niceeval: result=failed passed=23 failed=1 errored=0 reused=18 duration=128s",
      "niceeval: json=.niceeval/ci-summary.json",
      "niceeval: junit=.niceeval/junit.xml",
      "niceeval: snapshots=.niceeval/ci/<3 snapshots>",
    ]);
    expect(fake.stderr.writes.join("")).toBe("");
  });

  it("59.9 秒无永久事件不 heartbeat,满 60 秒才追加一条", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    await flush(); // "plan" 的 "start" 行是异步队列任务,先让它落地再取基线计数
    const afterStart = fake.stdout.writes.length;
    expect(afterStart).toBe(1);

    fake.advance(59_750); // 不到 60s(网格对齐到 250 的倍数)
    await flush();
    expect(fake.stdout.writes.length).toBe(afterStart);

    fake.advance(250); // 累计满 60000
    await flush();
    expect(fake.stdout.writes.length).toBe(afterStart + 1);
    expect(fake.stdout.writes.at(-1)).toContain("niceeval: progress elapsed=60s");

    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("errored 的 checkpoint 用 'errored' 命令词,携带 phase 字段", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    coordinator.emit({
      type: "failure",
      at: 0,
      locator: loc("@2h8m4k1"),
      identity: ref("memory/agent-029-use-cache", 0, "ci/claude-e2b"),
      who: "ci/claude-e2b",
      verdict: "errored",
      reason: "E2B sandbox allocation failed after 5 attempts",
      phase: "sandbox.create",
    });
    await flush();
    const text = fake.stdout.writes.join("");
    expect(text).toContain(
      'niceeval: errored locator=@2h8m4k1 eval=memory/agent-029-use-cache experiment=ci/claude-e2b phase=sandbox.create reason="E2B sandbox allocation failed after 5 attempts"',
    );
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("diagnostic 出现后重置时钟:紧接着的 heartbeat 相对 diagnostic 的时间戳,不是相对 start", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    fake.advance(40_000);
    coordinator.diagnostic({ key: "memory-warmup-degraded", severity: "warning", message: "continuing with a cold index" });
    await flush();
    fake.advance(59_750); // 距 diagnostic(t=40000)不到 60s
    await flush();
    const beforeHeartbeat = fake.stdout.writes.filter((w) => w.includes("progress")).length;
    expect(beforeHeartbeat).toBe(0);
    fake.advance(250); // 距 diagnostic 满 60s(t=100000)
    await flush();
    expect(fake.stdout.writes.filter((w) => w.includes("progress"))).toHaveLength(1);
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

// ───────────────────────── passed 不逐条打印;failed/errored 立即打印;展开上限 50 ─────────────────────────

describe("passed 不逐条打印;failed/errored 立即打印 locator;默认展开上限 50", () => {
  it("passed attempt 的 lifecycle 事件不产生任何额外 stdout 输出", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 3 }));
    await flush(); // "plan" 的 "start" 行是异步队列任务,先让它落地再取基线计数
    const afterStart = fake.stdout.writes.length;
    coordinator.emit({ type: "attempt:start", at: 0, identity: ref("memory/a"), who: "ci/bub", phase: "eval.run" });
    coordinator.emit({ type: "attempt:phase", at: 1, identity: ref("memory/a"), phase: "scoring.evaluate" });
    coordinator.emit({ type: "attempt:progress", at: 2, identity: ref("memory/a"), detail: "tool: shell" });
    coordinator.emit({ type: "attempt:complete", at: 3, identity: ref("memory/a"), who: "ci/bub", verdict: "passed" });
    await flush();
    expect(fake.stdout.writes.length).toBe(afterStart);
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("51 条 failure 只展开 50 条,第 51 条给一次 suppressed 提示,完整结果不丢", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 51 }));
    for (let i = 0; i < 51; i++) {
      coordinator.emit({
        type: "failure",
        at: i,
        locator: loc(`@f${i}`),
        identity: ref(`memory/eval-${i}`),
        who: `who-${i}`,
        verdict: "failed",
        reason: "gate failed",
      });
    }
    await flush();
    expect(coordinator.state.failures).toHaveLength(51); // reducer 完整保留,不因展开上限丢数据

    const text = fake.stdout.writes.join("");
    for (let i = 0; i < 50; i++) expect(text).toContain(`memory/eval-${i}`);
    expect(text).not.toContain("memory/eval-50");
    expect(text).toContain("failures-suppressed");
    expect(text.split("failures-suppressed").length - 1).toBe(1);

    await coordinator.finish({ summary: summary({ passed: 0, failed: 51 }), completion: completion(), paths: [] });
  });
});

// ───────────────────────── result 收尾:status/counts/reused/unstarted/duration + 产物路径 ─────────────────────────

describe("最后一条 result 行独立说明 status/counts/reused/unstarted/duration;随后打印实际生成的产物路径", () => {
  it("全部通过:result=passed,不带 unstarted 字段", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 5 }, 2));
    await coordinator.finish({
      summary: summary({ passed: 5, failed: 0, errored: 0, durationMs: 12_000 }),
      completion: completion(),
      paths: [],
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("niceeval: result=passed passed=5 failed=0 errored=0 reused=2 duration=12s");
    expect(text).not.toContain("unstarted=");
  });

  it("只传 --junit 不传 --json 时,只打印 junit= 行", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [], junit: ".niceeval/junit.xml" });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("niceeval: junit=.niceeval/junit.xml");
    expect(text).not.toContain("niceeval: json=");
  });

  it("单条快照路径直接打印,不折叠成 <1 snapshots>", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [".niceeval/ci/only/2026"] });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("niceeval: snapshots=.niceeval/ci/only/2026");
  });

  it("多组不同 experiment 前缀的快照路径:折叠成不带前缀的 <N snapshots>", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 2 }));
    await coordinator.finish({
      summary: summary(),
      completion: completion(),
      paths: [".niceeval/pr/a/2026", ".niceeval/nightly/b/2026"],
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("niceeval: snapshots=<2 snapshots>");
  });

  it("incomplete 时状态词优先于 verdict 计数,result 行带 unstarted 不带 reused", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 40 }));
    await coordinator.finish({
      summary: summary({ passed: 36, failed: 0, errored: 0, durationMs: 5_000 }),
      completion: completion({ status: "incomplete", unstarted: 4 }),
      paths: [],
    });
    const text = fake.stdout.writes.join("");
    const resultLine = text.split("\n").find((l) => l.startsWith("niceeval: result="));
    expect(resultLine).toBe("niceeval: result=incomplete passed=36 failed=0 errored=0 unstarted=4 duration=5s");
    expect(resultLine).not.toContain("reused="); // reused=0(未携入)不出现在 result 行——与 start 行的
    // 字面 "reused=0" 无关,那一行本来就无条件带这个字段(见 "niceeval: start" 的实现)。
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
    const text = fake.stdout.writes.join("");
    expect(text.split("budget_exhausted").length - 1).toBe(1);
    expect(text).toContain("niceeval: budget_exhausted experiment=regression/codex spent=25.31 unstarted=1");
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("interrupted 只追加一次,退出码由 CompletionStatus 决定为 130", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    coordinator.interrupted();
    coordinator.interrupted();
    await flush();
    const text = fake.stdout.writes.join("");
    expect(text.split("niceeval: interrupted").length - 1).toBe(1);
    expect(text).toContain("niceeval: interrupted elapsed=0s");
    const runCompletion = completion({ status: "interrupted" });
    await coordinator.finish({ summary: summary({ passed: 0, failed: 0 }), completion: runCompletion, paths: [] });
    expect(computeCiExitCode(summary({ passed: 0, failed: 0 }), runCompletion)).toBe(130);
  });

  it("reporter-error 去重后追加一次,携带 required 字段", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 1 }));
    coordinator.reporterError({ reporter: "artifacts", required: true, message: "EACCES: permission denied" });
    coordinator.reporterError({ reporter: "artifacts", required: true, message: "EACCES: permission denied" });
    await flush();
    const text = fake.stdout.writes.join("");
    expect(text.split("reporter_error").length - 1).toBe(1);
    expect(text).toContain('niceeval: reporter_error reporter=artifacts required=true message="EACCES: permission denied"');
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

// ───────────────────────── 退出码:budget → incomplete 非零;required reporter → 非零;中断 → 130 ─────────────────────────

describe("computeCiExitCode:CompletionStatus 驱动退出码,不只看 failed/errored", () => {
  it("全部通过、complete → 0", () => {
    expect(computeCiExitCode(summary({ passed: 5, failed: 0, errored: 0 }), completion())).toBe(0);
  });

  it("有 failed → 1", () => {
    expect(computeCiExitCode(summary({ passed: 4, failed: 1 }), completion())).toBe(1);
  });

  it("有 errored → 1", () => {
    expect(computeCiExitCode(summary({ passed: 4, errored: 1 }), completion())).toBe(1);
  });

  it("budget 耗尽导致 unstarted、completion.status=incomplete → 1,即便全部已跑的都通过", () => {
    expect(
      computeCiExitCode(summary({ passed: 36, failed: 0, errored: 0 }), completion({ status: "incomplete", unstarted: 4 })),
    ).toBe(1);
  });

  it("用户/平台中断、completion.status=interrupted → 130", () => {
    expect(computeCiExitCode(summary({ passed: 3, failed: 0, errored: 0 }), completion({ status: "interrupted" }))).toBe(130);
  });

  it("required reporter 失败 → 1,即便全部 attempt 都通过", () => {
    expect(
      computeCiExitCode(
        summary({ passed: 10, failed: 0, errored: 0 }),
        completion({ reporterErrors: [{ reporter: "artifacts", required: true, message: "EACCES" }] }),
      ),
    ).toBe(1);
  });

  it("best-effort(非 required)reporter 失败不强制非零", () => {
    expect(
      computeCiExitCode(
        summary({ passed: 10, failed: 0, errored: 0 }),
        completion({ reporterErrors: [{ reporter: "custom", required: false, message: "network blip" }] }),
      ),
    ).toBe(0);
  });

  it("首过即停省略的 earlyExitUnstarted 不影响退出码(不是 budget 的 unstarted)", () => {
    expect(
      computeCiExitCode(summary({ passed: 10, failed: 0, errored: 0 }), completion({ earlyExitUnstarted: 6, unstarted: 0 })),
    ).toBe(0);
  });
});

// ───────────────────────── 三类集成测试覆盖文档示例:PR / nightly --no-early-exit / budget incomplete ─────────────────────────

describe("集成测试覆盖 cli.md「CI 常见 case」的三条命令", () => {
  it("PR 快速门禁(--runs 1 --junit ...):只出 junit,首过即停省略数不计入 unstarted/退出码", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ evals: 6, configs: 1, totalRuns: 6 }));
    for (let i = 0; i < 6; i++) {
      coordinator.emit({ type: "attempt:start", at: 0, identity: ref(`memory/eval-${i}`, 0, "pr/bub"), who: "pr/bub", phase: "eval.run" });
    }
    for (let i = 0; i < 5; i++) {
      coordinator.emit({ type: "attempt:complete", at: i + 1, identity: ref(`memory/eval-${i}`, 0, "pr/bub"), who: "pr/bub", verdict: "passed" });
    }
    coordinator.emit({
      type: "failure",
      at: 6,
      locator: loc("@pr1"),
      identity: ref("memory/eval-5", 0, "pr/bub"),
      who: "pr/bub",
      verdict: "failed",
      reason: "gate: cache tool not used",
    });
    // --runs 1 结构上不可能有首过即停跳过,但即便上游意外传了非零 earlyExitUnstarted,
    // 这条防线也不能让它泄漏进 unstarted= 字段或退出码(见 plan 第 5 节的显式区分)。
    const runCompletion = completion({ earlyExitUnstarted: 0, unstarted: 0 });
    await coordinator.finish({
      summary: summary({ passed: 5, failed: 1, errored: 0, durationMs: 30_000 }),
      completion: runCompletion,
      paths: [".niceeval/pr/bub/2026"],
      junit: ".niceeval/junit.xml",
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("niceeval: junit=.niceeval/junit.xml");
    expect(text).not.toContain("niceeval: json=");
    expect(text).not.toContain("unstarted=");
    expect(computeCiExitCode(summary({ passed: 5, failed: 1, errored: 0 }), runCompletion)).toBe(1);
  });

  it("nightly --no-early-exit --runs 5:真实分母,零 early-exit 事件,json+junit 都出", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ evals: 1, configs: 1, totalRuns: 5 }));
    // --no-early-exit:整段模拟里从不 emit "attempt:early-exit"——真实分母来自 5 次都跑完,
    // 不是靠首过即停省略掉后面几次(见 cli.md「runs 与首过即停怎样展示」)。
    for (let i = 0; i < 5; i++) {
      coordinator.emit({
        type: "attempt:start",
        at: i,
        identity: ref("memory/retention", i, "nightly/bub"),
        who: "nightly/bub",
        phase: "eval.run",
      });
    }
    for (let i = 0; i < 5; i++) {
      const verdict = i < 2 ? "failed" : "passed"; // 2/5 failed,--no-early-exit 后仍跑满 5 次
      coordinator.emit({
        type: "attempt:complete",
        at: 10 + i,
        identity: ref("memory/retention", i, "nightly/bub"),
        who: "nightly/bub",
        verdict,
      });
      if (verdict === "failed") {
        coordinator.emit({
          type: "failure",
          at: 10 + i,
          locator: loc(`@night${i}`),
          identity: ref("memory/retention", i, "nightly/bub"),
          who: "nightly/bub",
          verdict: "failed",
          reason: "flaked",
        });
      }
    }
    await coordinator.finish({
      summary: summary({ passed: 3, failed: 2, errored: 0, durationMs: 300_000 }),
      completion: completion({ earlyExitUnstarted: 0, unstarted: 0 }),
      paths: [".niceeval/nightly/bub/2026"],
      json: ".niceeval/nightly.json",
      junit: ".niceeval/nightly.xml",
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("niceeval: json=.niceeval/nightly.json");
    expect(text).toContain("niceeval: junit=.niceeval/nightly.xml");
    expect(text).toContain("niceeval: result=failed passed=3 failed=2 errored=0 duration=300s");
    expect(computeCiExitCode(summary({ passed: 3, failed: 2 }), completion())).toBe(1);
  });

  it("budget incomplete(cli.md 字面例子的语义):budget_exhausted → result=incomplete,退出码非零", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ evals: 40, configs: 1, totalRuns: 40 }));
    coordinator.emit({ type: "budget-exhausted", at: 1_000, experimentId: "regression/codex", spent: 25.31, unstarted: 4 });
    await flush();
    const runCompletion = completion({ status: "incomplete", unstarted: 4 });
    await coordinator.finish({
      summary: summary({ passed: 36, failed: 0, errored: 0, durationMs: 1_082_000 }),
      completion: runCompletion,
      paths: [],
    });
    const text = fake.stdout.writes.join("");
    expect(text).toContain("niceeval: budget_exhausted experiment=regression/codex spent=25.31 unstarted=4");
    expect(text).toContain("niceeval: result=incomplete passed=36 failed=0 errored=0 unstarted=4 duration=1082s");
    expect(computeCiExitCode(summary({ passed: 36, failed: 0, errored: 0 }), runCompletion)).toBe(1);
  });
});

// ───────────────────────── 实验级钩子起止行(cases.md「实验级生命周期」) ─────────────────────────

describe("ci: 实验级钩子起止各追加一行", () => {
  it("experiment_setup / experiment_teardown 各含 experiment 与 status 字段,done/failed 带 duration", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan({ totalRuns: 2, evals: 2 }));
    coordinator.experimentHook({ experimentId: "ci/claude", hook: "setup", status: "started" });
    coordinator.experimentHook({ experimentId: "ci/claude", hook: "setup", status: "done", durationMs: 42_000 });
    coordinator.experimentHook({ experimentId: "ci/claude", hook: "teardown", status: "started" });
    coordinator.experimentHook({ experimentId: "ci/claude", hook: "teardown", status: "failed", durationMs: 3_000 });
    await flush();
    const lines = fake.stdout.writes.join("").split("\n");
    expect(lines).toContain("niceeval: experiment_setup experiment=ci/claude status=started");
    expect(lines).toContain("niceeval: experiment_setup experiment=ci/claude status=done duration=42s");
    expect(lines).toContain("niceeval: experiment_teardown experiment=ci/claude status=started");
    expect(lines).toContain("niceeval: experiment_teardown experiment=ci/claude status=failed duration=3s");
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("实验级 progress 与 activity 在 ci 下零输出(短命状态不进事件流)", async () => {
    const { fake, coordinator } = setup();
    coordinator.start(plan());
    await flush(); // 先让 start 行落盘,再取零输出基线
    const beforeOut = fake.stdout.writes.length;
    const beforeErr = fake.stderr.writes.length;
    coordinator.experimentProgress({ experimentId: "ci/claude", detail: "starting tunnel" });
    coordinator.activity("prechecking judge config...");
    await flush();
    expect(fake.stdout.writes.slice(beforeOut).join("")).toBe("");
    expect(fake.stderr.writes.slice(beforeErr).join("")).toBe("");
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});
