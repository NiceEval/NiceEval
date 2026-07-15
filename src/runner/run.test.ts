import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeProbeTargets, runEvals } from "./run.ts";
import { defineSandbox, defineSandboxAgent } from "../define.ts";
import { Artifacts } from "./reporters/artifacts.ts";
import { openResults } from "../results/open.ts";
import { encodeAttemptLocator } from "../results/locator.ts";
import { equals } from "../expect/index.ts";
import { createFeedbackCoordinator, type FeedbackCoordinator } from "./feedback/coordinator.ts";
import { createFakeFeedbackIO } from "./feedback/testing.ts";
import { activeFeedbackSinkCount } from "./feedback/sink.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import type { CarryPlan } from "./fingerprint.ts";
import type { AgentRun, RunFeedbackPlan, RunOptions } from "./types.ts";
import type {
  Agent,
  CommandResult,
  Config,
  DiscoveredEval,
  EvalResult,
  JudgeConfig,
  Reporter,
  ReporterRegistration,
  Sandbox,
  SandboxFile,
} from "../types.ts";

// judge 预检的目标收敛:只探测「实际要跑、且源码里出现 judge 字样」的 eval 的生效配置。
// 这是对 memory/judge-config-precheck-hard-fails-without-key 的修复守护——
// 全局配了 judge 但选中的 eval 都不用时,不能再因 judge key / 端点问题拦下整次运行。
describe("judgeProbeTargets", () => {
  const configJudge: JudgeConfig = { model: "gpt-5.4" };

  it("skips probing when no selected eval mentions judge", () => {
    const evals = [
      { source: `t.check(t.reply, includes("2"));`, judge: undefined },
      { source: `await t.sandbox.exec("pnpm test");`, judge: undefined },
    ];
    expect(judgeProbeTargets(evals, configJudge)).toEqual([]);
  });

  it("probes config-level judge when a selected eval mentions judge", () => {
    const evals = [
      { source: `t.judge.autoevals.closedQA("did it summarize?");`, judge: undefined },
      { source: `t.check(t.reply, includes("ok"));`, judge: undefined },
    ];
    expect(judgeProbeTargets(evals, configJudge)).toEqual([configJudge]);
  });

  it("resolves eval-level judge over config-level, like attempt resolution", () => {
    const evalJudge: JudgeConfig = { model: "deepseek-v4", baseUrl: "http://localhost:8787/v1" };
    const evals = [{ source: `t.judge.autoevals.factuality("2")`, judge: evalJudge }];
    expect(judgeProbeTargets(evals, configJudge)).toEqual([evalJudge]);
  });

  it("dedupes identical effective configs across evals", () => {
    const evals = [
      { source: `t.judge.autoevals.closedQA("a")`, judge: undefined },
      { source: `t.judge.autoevals.closedQA("b")`, judge: undefined },
    ];
    expect(judgeProbeTargets(evals, configJudge)).toEqual([configJudge]);
  });

  it("returns nothing when judge is used but no config exists (runtime env fallback)", () => {
    const evals = [{ source: `t.judge.autoevals.closedQA("a")`, judge: undefined }];
    expect(judgeProbeTargets(evals, undefined)).toEqual([]);
  });

  it("does not match judge as part of a longer identifier", () => {
    const evals = [{ source: `const prejudged = true;`, judge: undefined }];
    expect(judgeProbeTargets(evals, configJudge)).toEqual([]);
  });
});

// ───────────────────────── locator identity 集成测试的 fixture ─────────────────────────
// 沙箱是内存 fake(记文件,不起容器/不联网)——与 attempt.test.ts 同一种 recipe,这里额外
// 驱动完整 runEvals() 调度(而不是单个 runAttemptEffect),覆盖 locator 在 reporter 回调 /
// 事件与落盘 result.json 之间必须完全一致的不变量(见 docs/feature/experiments/cli.md
// 「Locator 必须在 result 发布前确定」)。

class FakeSandbox implements Partial<Sandbox> {
  readonly workdir = "/workspace";
  readonly sandboxId = "fake";
  readonly otlpHost = null;
  readonly files = new Map<string, string>();

  async runShell(): Promise<CommandResult> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async runCommand(): Promise<CommandResult> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async writeFiles(files: Record<string, string>, targetDir?: string): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(targetDir ? `${targetDir}/${path}` : path, content);
    }
  }
  async uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void> {
    for (const f of files) {
      this.files.set(targetDir ? `${targetDir}/${f.path}` : f.path, f.content.toString());
    }
  }
  async uploadFile(path: string, content: Buffer): Promise<void> {
    this.files.set(path, content.toString());
  }
  async uploadDirectory(): Promise<void> {}
  async downloadFile(path: string): Promise<Buffer> {
    return Buffer.from(this.files.get(path) ?? "");
  }
  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async readFile(path: string): Promise<string> {
    const hit = this.files.get(path);
    if (hit === undefined) throw new Error(`no such file: ${path}`);
    return hit;
  }
  async readSourceFiles(): Promise<never> {
    throw new Error("not implemented");
  }
  async stop(): Promise<void> {}
}

const asSandbox = (box: FakeSandbox): Sandbox => box as unknown as Sandbox;

// judge 预检需要一个真实可读的文件(runEvals 无条件 readFile(evalDef.sourcePath));
// 内容无所谓(这些测试都不配置 judge),直接指向本测试文件自己,永远存在。
const sourcePath = fileURLToPath(import.meta.url);
const source: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };

function makeAgent(name: string): Agent {
  return defineSandboxAgent({ name, send: async () => ({ events: [], status: "completed" }) });
}

function fakeSandboxSpec() {
  // 自定义 provider:create() 直接返回内存 fake,绕开真实沙箱 provider;每次调用给一个
  // 全新实例,并发 attempt 之间不共享可变文件状态。
  return defineSandbox({ name: "fake-provider", create: async () => asSandbox(new FakeSandbox()) });
}

function makeEval(id: string, test: DiscoveredEval["test"]): DiscoveredEval {
  return { id, baseDir: "/project", sourcePath, source, test };
}

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-run-locator-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function resultKey(r: { experimentId?: string; id: string; attempt: number }): string {
  return `${r.experimentId ?? ""}|${r.id}|${r.attempt}`;
}

/**
 * 跑一次完整 runEvals():自带一个捕获 reporter(记录 onEvalComplete / eval:complete 事件
 * 观察到的 locator,按 `experimentId|evalId|attempt` 建索引)与真实 Artifacts reporter
 * (落盘到临时目录,供事后用 openResults() 核对与 reporter 观察到的值是否一致)。
 */
async function run(
  evals: DiscoveredEval[],
  agentRuns: AgentRun[],
  opts: {
    extraReporters?: ReporterRegistration[];
    carryPlan?: CarryPlan;
    maxConcurrency?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{
  summary: Awaited<ReturnType<typeof runEvals>>;
  root: string;
  onEvalComplete: Map<string, string | undefined>;
  onEventComplete: Map<string, string | undefined>;
}> {
  const root = await makeRoot();
  const onEvalComplete = new Map<string, string | undefined>();
  const onEventComplete = new Map<string, string | undefined>();
  const capture: Reporter = {
    onEvalComplete(result) {
      onEvalComplete.set(resultKey(result), result.locator);
    },
    onEvent(event) {
      if (event.type === "eval:complete") {
        onEventComplete.set(resultKey(event.result), event.result.locator);
      }
    },
  };
  const config: Config = {};
  const runOpts: RunOptions = {
    config,
    evals,
    agentRuns,
    reporters: [
      { reporter: capture, name: "capture", required: false },
      { reporter: Artifacts(root), name: "artifacts", required: false },
      ...(opts.extraReporters ?? []),
    ],
    maxConcurrency: opts.maxConcurrency ?? 3,
    ...(opts.carryPlan ? { carryPlan: opts.carryPlan } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  const summary = await runEvals(runOpts);
  return { summary, root, onEvalComplete, onEventComplete };
}

async function diskSnapshotStartedAt(root: string, experimentId: string): Promise<string> {
  const results = await openResults(root);
  const exp = results.experiments.find((e) => e.id === experimentId);
  if (!exp) throw new Error(`no snapshot written for experiment ${experimentId}`);
  return exp.latest.startedAt;
}

async function diskLocator(
  root: string,
  experimentId: string,
  evalId: string,
  attempt: number,
): Promise<string | undefined> {
  const results = await openResults(root);
  const exp = results.experiments.find((e) => e.id === experimentId);
  const ev = exp?.latest.evals.find((e) => e.id === evalId);
  return ev?.attempts.find((a) => a.result.attempt === attempt)?.locator;
}

// runner 只是「展开、调度、串行化 reporter 回调」——locator 的确定性完全来自
// encodeAttemptLocator 自己(已有 src/results/locator.test.ts 与
// src/results/results.test.ts 的 AttemptLocator 套件覆盖)。这里要守的不变量是编排层的:
// fresh result 的 locator 必须在任何 reporter 看到它之前就已经"是最终值",且与落盘
// result.json 完全相同;carry result 必须原样透传,不能被本次 invocation 的
// snapshotStartedAt 悄悄重算成另一个身份。
describe("runEvals · fresh EvalResult.locator 在 reporter 观察到之前已经确定", () => {
  it("onEvalComplete / eval:complete 观察到的 locator 与落盘 result.json 完全相同(passed 与 errored 各一次)", async () => {
    const experimentId = "locator-exp";
    const evalOk = makeEval("ok", () => {});
    const evalBoom = makeEval("boom", () => {
      throw new Error("boom");
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-a"),
      flags: {},
      runs: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      evalFilter: () => true,
      experimentId,
    };

    const { summary, root, onEvalComplete, onEventComplete } = await run([evalOk, evalBoom], [agentRun]);

    expect(summary.results).toHaveLength(2);
    expect(summary.results.find((r) => r.id === "ok")!.verdict).toBe("passed");
    expect(summary.results.find((r) => r.id === "boom")!.verdict).toBe("errored");

    const snapStartedAt = await diskSnapshotStartedAt(root, experimentId);
    for (const evalId of ["ok", "boom"]) {
      const key = `${experimentId}|${evalId}|0`;
      const expected = encodeAttemptLocator({ experimentId, snapshotStartedAt: snapStartedAt, evalId, attempt: 0 });
      expect(onEvalComplete.get(key)).toBe(expected);
      expect(onEventComplete.get(key)).toBe(expected);
      expect(await diskLocator(root, experimentId, evalId, 0)).toBe(expected);
      expect(summary.results.find((r) => r.id === evalId)!.locator).toBe(expected);
    }
  });

  it("多 experiment 共享同一次 invocation 的 snapshotStartedAt,不因此碰撞", async () => {
    const eval1 = makeEval("algebra/q1", () => {});
    const runFor = (experimentId: string): AgentRun => ({
      agent: makeAgent(experimentId),
      flags: {},
      runs: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      evalFilter: () => true,
      experimentId,
    });

    const { root, onEvalComplete } = await run([eval1], [runFor("exp/a"), runFor("exp/b")]);

    const startedA = await diskSnapshotStartedAt(root, "exp/a");
    const startedB = await diskSnapshotStartedAt(root, "exp/b");
    expect(startedA).toBe(startedB); // 共享同一个 invocation 锚点(Artifacts writer 与 runner 用同一个值)

    const locatorA = onEvalComplete.get("exp/a|algebra/q1|0");
    const locatorB = onEvalComplete.get("exp/b|algebra/q1|0");
    expect(locatorA).toBeDefined();
    expect(locatorB).toBeDefined();
    expect(locatorA).not.toBe(locatorB); // experimentId 参与身份元组,不因共享锚点而碰撞
    expect(await diskLocator(root, "exp/a", "algebra/q1", 0)).toBe(locatorA);
    expect(await diskLocator(root, "exp/b", "algebra/q1", 0)).toBe(locatorB);
  });

  it("同一 eval 的多次 attempt(runs > 1)各自拿到不同且稳定的 locator", async () => {
    const experimentId = "retry-exp";
    const evalDef = makeEval("flaky", () => {});
    const agentRun: AgentRun = {
      agent: makeAgent("agent-retry"),
      flags: {},
      runs: 2,
      earlyExit: false, // 两次都要真的跑,不能被首过即停吞掉其中一次
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      evalFilter: () => true,
      experimentId,
    };

    const { root, onEvalComplete } = await run([evalDef], [agentRun]);

    const locator0 = onEvalComplete.get(`${experimentId}|flaky|0`);
    const locator1 = onEvalComplete.get(`${experimentId}|flaky|1`);
    expect(locator0).toBeDefined();
    expect(locator1).toBeDefined();
    expect(locator0).not.toBe(locator1);
    expect(await diskLocator(root, experimentId, "flaky", 0)).toBe(locator0);
    expect(await diskLocator(root, experimentId, "flaky", 1)).toBe(locator1);
  });

  it("carry 结果的 locator 原样透传,不按本次 invocation 的 snapshotStartedAt 重算", async () => {
    const experimentId = "carry-exp";
    const evalId = "carried-eval";
    const staleLocator = encodeAttemptLocator({
      experimentId,
      snapshotStartedAt: "2020-01-01T00:00:00.000Z", // 明确不同于本次 invocation 的锚点
      evalId,
      attempt: 0,
    });
    const carried: EvalResult = {
      id: evalId,
      experimentId,
      agent: "agent-carried",
      verdict: "passed",
      attempt: 0,
      startedAt: "2020-01-01T00:00:00.000Z",
      durationMs: 1,
      assertions: [],
      locator: staleLocator,
      artifactBase: `${experimentId}/some-old-snapshot/${evalId}/a0`,
    };
    // eval 的 test() 会抛错——如果携带 / 首过即停判断漏了这条、真的调度了一次新 attempt,
    // 这里会产出一条 errored 的重复结果,而不是静默漏测。
    const evalDef = makeEval(evalId, () => {
      throw new Error("carried result should have skipped scheduling a fresh attempt");
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-carried"),
      flags: {},
      runs: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      evalFilter: () => true,
      experimentId,
    };

    const { summary, root } = await run([evalDef], [agentRun], {
      carryPlan: {
        plannedFingerprints: new Map(),
        priorRunKeys: new Set([`${experimentId}|${evalId}`]),
        carriedResults: [carried],
      },
    });

    const matches = summary.results.filter((r) => r.id === evalId);
    expect(matches).toHaveLength(1); // 没有额外调度出一条新 attempt
    expect(matches[0]!.verdict).toBe("passed"); // 是携带的那份,不是抛错的新跑
    expect(matches[0]!.locator).toBe(staleLocator); // 原样透传,run.ts 没有碰过它

    // 反证:如果按本次 invocation 的 snapshotStartedAt 重算,会得到不同的字符串——
    // 证明确实是原样透传,不是巧合相等。
    const snapStartedAt = await diskSnapshotStartedAt(root, experimentId);
    const wronglyRecomputed = encodeAttemptLocator({
      experimentId,
      snapshotStartedAt: snapStartedAt,
      evalId,
      attempt: 0,
    });
    expect(staleLocator).not.toBe(wronglyRecomputed);

    // Artifacts.onRunComplete 把携带条目落盘时,同样原样保留 locator。
    expect(await diskLocator(root, experimentId, evalId, 0)).toBe(staleLocator);
  });

  it("并发完成顺序打乱不影响各自 attempt 的 locator 与身份的对应关系", async () => {
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const experimentId = "concurrent-exp";
    // 刻意让"先派发"的反而"最后完成",验证完成顺序打乱不影响身份对应关系。
    const evalSlow = makeEval("c-slow", async () => {
      await sleep(60);
    });
    const evalMid = makeEval("c-mid", async () => {
      await sleep(30);
    });
    const evalFast = makeEval("c-fast", async () => {
      await sleep(5);
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-concurrent"),
      flags: {},
      runs: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      evalFilter: () => true,
      experimentId,
    };
    const completionOrder: string[] = [];
    const orderReporter: Reporter = {
      onEvalComplete(result) {
        completionOrder.push(result.id);
      },
    };

    const { summary, root, onEvalComplete, onEventComplete } = await run(
      [evalSlow, evalMid, evalFast],
      [agentRun],
      { extraReporters: [{ reporter: orderReporter, name: "order", required: false }], maxConcurrency: 3 },
    );

    expect(summary.results).toHaveLength(3);
    // sanity:确实是并发乱序完成,不是退化成串行(否则这条测试没有真正测到并发路径)。
    expect(completionOrder.indexOf("c-fast")).toBeLessThan(completionOrder.indexOf("c-slow"));

    const snapStartedAt = await diskSnapshotStartedAt(root, experimentId);
    for (const evalId of ["c-slow", "c-mid", "c-fast"]) {
      const key = `${experimentId}|${evalId}|0`;
      const expected = encodeAttemptLocator({ experimentId, snapshotStartedAt: snapStartedAt, evalId, attempt: 0 });
      expect(onEvalComplete.get(key)).toBe(expected);
      expect(onEventComplete.get(key)).toBe(expected);
      expect(await diskLocator(root, experimentId, evalId, 0)).toBe(expected);
    }
  });
});

// ───────────────────────── 反馈层永久事件集成测试 ─────────────────────────
// 驱动一个真实 FeedbackCoordinator(而不是手写的假 sink),覆盖 run.ts 是否真的把 failure /
// budget-exhausted 这两类永久事件送进去——而不是只在 renderer 单测里喂合成事件(见
// docs/feature/experiments/cli.md「什么动态更新,什么逐条追加」表的对应行)。

/** 建一个真实 coordinator,跑完 fn 后无条件 finish() 收尾——保证测试之间不会因为忘记退出
 *  而互相污染 sink.ts 的活跃栈(与 report.test.ts 的 withFakeSink 同一个目的)。 */
async function withCoordinator<T>(
  plan: RunFeedbackPlan,
  fn: (coordinator: FeedbackCoordinator) => Promise<T>,
): Promise<T> {
  const fakeIO = createFakeFeedbackIO();
  const coordinator = createFeedbackCoordinator({ profile: "ci", renderer: { appendDurable() {} }, io: fakeIO.io });
  coordinator.start(plan);
  try {
    return await fn(coordinator);
  } finally {
    await coordinator.finish({
      summary: { agent: "", startedAt: "", completedAt: "", passed: 0, failed: 0, skipped: 0, errored: 0, durationMs: 0, results: [] },
      completion: { status: "complete", unstarted: 0, earlyExitUnstarted: 0, reporterErrors: [] },
      paths: [],
    });
  }
}

describe("runEvals · failure 永久事件在真实失败/errored attempt 上被发出", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
  });

  it("errored 与 failed 各触发一次、locator 与落盘结果一致,passed 不触发", async () => {
    const experimentId = "failure-exp";
    const evalOk = makeEval("ok", () => {});
    const evalErrored = makeEval("boom", () => {
      throw new Error("boom");
    });
    const evalFailed = makeEval("gate-fail", (t) => {
      t.check("actual", equals("expected"));
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-a"),
      flags: {},
      runs: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      evalFilter: () => true,
      experimentId,
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalRuns: 3, maxConcurrency: 3 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary } = await run([evalOk, evalErrored, evalFailed], [agentRun]);

      expect(summary.results).toHaveLength(3);
      expect(summary.results.find((r) => r.id === "ok")!.verdict).toBe("passed");

      // passed 不产出 failure 通知:只有 errored + failed 两条。
      expect(coordinator.state.failures).toHaveLength(2);
      const byLocator = new Map(coordinator.state.failures.map((f) => [String(f.locator), f]));

      const erroredResult = summary.results.find((r) => r.id === "boom")!;
      const erroredNotice = byLocator.get(String(erroredResult.locator));
      expect(erroredNotice).toBeDefined();
      expect(erroredNotice).toMatchObject({
        verdict: "errored",
        who: experimentId, // runWho():有 experimentId 时用它的最后一段(这里没有 "/",就是整段)
        identity: { experimentId, evalId: "boom", attempt: 0 },
        // evalDef.test() 抛的是普通 Error；即使 attempt 随后仍进入 diff/scoring，永久错误通知
        // 也必须使用结构化 error.phase，报告错误真正发生的 eval.run，而不是最后经过的阶段。
        phase: "eval.run",
      });
      expect(erroredNotice?.reason).toContain("boom");

      const failedResult = summary.results.find((r) => r.id === "gate-fail")!;
      const failedNotice = byLocator.get(String(failedResult.locator));
      expect(failedNotice).toBeDefined();
      expect(failedNotice).toMatchObject({
        verdict: "failed",
        identity: { experimentId, evalId: "gate-fail", attempt: 0 },
        assertion: {
          severity: "gate",
          assertion: 'equals("expected")',
          expected: '"expected"',
          received: "actual",
          additionalFailures: 0,
        },
      });
      // failed 是断言 outcome，不是 lifecycle error；即使 verdict 在 scoring 阶段算出，也不应
      // 把 scoring（更不能把随后可能发生的 telemetry.collect）冒充成「失败发生阶段」。
      expect(failedNotice).not.toHaveProperty("phase");
    });
  });
});

describe("runEvals · budget-exhausted 永久事件按每个被跳过的 attempt 逐条发出", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
  });

  it("budget=0 时三个 attempt 全部因预算到顶未派发,queued/completed 与去重诊断 count 都正确折算", async () => {
    const experimentId = "budget-exp";
    const evals = ["a", "b", "c"].map((id) => makeEval(id, () => {}));
    const agentRun: AgentRun = {
      agent: makeAgent("agent-budget"),
      flags: {},
      runs: 1,
      earlyExit: false,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      evalFilter: () => true,
      experimentId,
      budget: 0, // 花费从 0 起算,>= budget 恒成立——每个 attempt 在 preflight 就被跳过。
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalRuns: 3, maxConcurrency: 3 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary } = await run(evals, [agentRun]);

      expect(summary.results).toHaveLength(0); // 全部未派发,没有一条真正跑过

      const diag = coordinator.state.diagnostics.find((d) => d.key === `budget-exhausted:${experimentId}`);
      expect(diag).toBeDefined();
      expect(diag?.count).toBe(3); // 三个 attempt 各发一次,去重折成同一个 key、count 累加到 3
      expect(diag?.data).toMatchObject({ experimentId, spent: 0, unstarted: 3 });

      // reducer 不变量:每条 budget-exhausted 把一个 attempt 从 queued 挪进 completed
      // (与 assembleRunCompletion() 读取 count 折算 RunCompletion.unstarted 的口径一致)。
      expect(coordinator.state).toMatchObject({ total: 3, reused: 0, running: 0, queued: 0, completed: 3 });
    });
  });
});

// bug: memory/budget-warning-requires-agent-turn.md
describe("runEvals · budget-unenforceable 只统计真正发起过 agent turn 的 attempt", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
  });

  it("三个 attempt 都在 sandbox.create 失败时只保留根因,不误报 budget-unenforceable", async () => {
    const experimentId = "template-missing-exp";
    const evals = ["a", "b", "c"].map((id) => makeEval(id, () => {}));
    const missingTemplate = defineSandbox({
      name: "missing-template",
      create: async () => {
        throw new Error("404: template 'memory-evals-claude-mempal-deadbeef-0-9-0' not found");
      },
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-budget"),
      flags: {},
      runs: 1,
      earlyExit: false,
      sandbox: missingTemplate,
      timeoutMs: 5_000,
      evalFilter: () => true,
      experimentId,
      budget: 10,
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalRuns: 3, maxConcurrency: 3 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary } = await run(evals, [agentRun]);

      expect(summary.results).toHaveLength(3);
      expect(summary.results.every((result) => result.error?.phase === "sandbox.create")).toBe(true);
      expect(summary.results.every((result) => result.error?.message.includes("template") === true)).toBe(true);
      expect(coordinator.state.failures).toHaveLength(3);
      expect(coordinator.state.diagnostics.some((d) => d.key === `budget-unenforceable:${experimentId}`)).toBe(false);
    });
  });

  it("三个 agent turn 都没有成本数据时仍只报一次 budget-unenforceable", async () => {
    const experimentId = "missing-cost-exp";
    const evals = ["a", "b", "c"].map((id) => makeEval(id, async (t) => {
      await t.send("hello");
    }));
    const agentRun: AgentRun = {
      agent: makeAgent("agent-budget"),
      flags: {},
      runs: 1,
      earlyExit: false,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      evalFilter: () => true,
      experimentId,
      budget: 10,
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalRuns: 3, maxConcurrency: 3 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary } = await run(evals, [agentRun]);

      expect(summary.results).toHaveLength(3);
      expect(summary.results.every((result) => result.phases?.some(
        (phase) => phase.children?.some((child) => child.kind === "turn"),
      ) === true)).toBe(true);
      const diagnostics = coordinator.state.diagnostics.filter((d) => d.key === `budget-unenforceable:${experimentId}`);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.count).toBe(1);
    });
  });
});

// 携入数量不足以覆盖本次请求的 runs(典型触发:上次 runs:1 落了 1 条终态结果,这次把 runs
// 调大到 3、没有 --force)时,差额必须真正计入调度,不能被 priorRunKeys 的"这个组合有过携入"
// 整段跳过——那会让 pass@N 的 N 被携入悄悄砍短,运行还照样报 PASSED/exit 0(见
// docs/runner.md「不能在 CI 里伪装成全绿」)。
describe("runEvals · 携入数量少于本次请求的 runs 时,差额必须真正计入调度", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
  });

  it("携入 1 条 passed、runs 从 1 调到 3:差额通过 earlyExit 早退回填计入 completed,不真的重跑、也不被静默丢弃", async () => {
    const experimentId = "carry-grow-passed-exp";
    const evalId = "grown-eval";
    const staleLocator = encodeAttemptLocator({
      experimentId,
      snapshotStartedAt: "2020-01-01T00:00:00.000Z",
      evalId,
      attempt: 0,
    });
    const carried: EvalResult = {
      id: evalId,
      experimentId,
      agent: "agent-grow",
      verdict: "passed",
      attempt: 0,
      startedAt: "2020-01-01T00:00:00.000Z",
      durationMs: 1,
      assertions: [],
      locator: staleLocator,
      artifactBase: `${experimentId}/some-old-snapshot/${evalId}/a0`,
    };
    // 差额 attempt 如果真的被调度执行,这里会抛错——用它检测「有没有因为回填而多花一次 agent
    // 成本」。earlyExit 下携入的 passed 应该让回填直接早退,不应该走到这里。
    const evalDef = makeEval(evalId, () => {
      throw new Error("backfilled attempt should have been early-exited, not actually run");
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-grow"),
      flags: {},
      runs: 3, // 上次只留 1 条(runs:1 时代的携入),这次调大
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      evalFilter: () => true,
      experimentId,
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 1, configs: 1, totalRuns: 3, maxConcurrency: 3 },
      reused: 1,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary } = await run([evalDef], [agentRun], {
        carryPlan: {
          plannedFingerprints: new Map(),
          priorRunKeys: new Set([`${experimentId}|${evalId}`]),
          carriedResults: [carried],
        },
      });

      const matches = summary.results.filter((r) => r.id === evalId);
      expect(matches).toHaveLength(1); // 没有因为回填而多出真实结果
      expect(matches[0]!.verdict).toBe("passed");
      expect(matches[0]!.locator).toBe(staleLocator); // 携入结果原样透传

      // 不变量:携入 1 + early-exit 回填 2 == 本次请求的 runs:3,不留没有解释的差额
      // (queued 必须真正归零,不能停在「还差 2 个不知道去哪」)。
      expect(coordinator.state).toMatchObject({ total: 3, reused: 1, running: 0, queued: 0, completed: 2 });
    });
  });

  it("携入 1 条 failed、runs 从 1 调到 3:failed 不触发 earlyExit,差额两次必须真的重新调度", async () => {
    const experimentId = "carry-grow-failed-exp";
    const evalId = "grown-failed-eval";
    const staleLocator = encodeAttemptLocator({
      experimentId,
      snapshotStartedAt: "2020-01-01T00:00:00.000Z",
      evalId,
      attempt: 0,
    });
    const carried: EvalResult = {
      id: evalId,
      experimentId,
      agent: "agent-grow-failed",
      verdict: "failed",
      attempt: 0,
      startedAt: "2020-01-01T00:00:00.000Z",
      durationMs: 1,
      assertions: [],
      locator: staleLocator,
      artifactBase: `${experimentId}/some-old-snapshot/${evalId}/a0`,
    };
    let calls = 0;
    // 恒定 gate 失败(而不是恒定通过):避免回填的第一次真的跑出 passed 后,靠"这次跑出来的
    // passed"触发 earlyExit 把第二次也提前吞掉——那样测不出"差额是不是真的被调度"这件事本身。
    const evalDef = makeEval(evalId, (t) => {
      calls += 1;
      t.check("actual", equals("expected"));
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-grow-failed"),
      flags: {},
      runs: 3,
      earlyExit: true, // failed 不触发 earlyExit(只有 passed/errored 会),回填的两次应该真的跑
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      evalFilter: () => true,
      experimentId,
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 1, configs: 1, totalRuns: 3, maxConcurrency: 3 },
      reused: 1,
      reusedFailures: [{
        locator: staleLocator,
        identity: { experimentId, evalId, attempt: 0 },
        who: `${experimentId}/agent-grow-failed`,
        verdict: "failed",
        reason: "failed",
      }],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary } = await run([evalDef], [agentRun], {
        carryPlan: {
          plannedFingerprints: new Map(),
          priorRunKeys: new Set([`${experimentId}|${evalId}`]),
          carriedResults: [carried],
        },
      });

      expect(calls).toBe(2); // 差额的两次真的执行了 agent,不是被携入悄悄吞掉
      const matches = summary.results.filter((r) => r.id === evalId);
      expect(matches).toHaveLength(3); // 1 携入 + 2 新跑,凑满本次请求的 runs:3
      expect(matches.map((r) => r.attempt).sort()).toEqual([0, 1, 2]);
      expect(matches.every((r) => r.verdict === "failed")).toBe(true);

      expect(coordinator.state).toMatchObject({ total: 3, reused: 1, running: 0, queued: 0, completed: 2 });
      // RunSummary 的三条 failed（1 carry + 2 fresh）与终局 handoff 的 FailureNotice 清单同口径。
      // carry 不能只进 summary 计数而从 FAILURES / agent handoff 消失。
      expect(coordinator.state.failures).toHaveLength(3);
      expect(coordinator.state.failures.map((failure) => failure.locator)).toContain(staleLocator);
    });
  });
});
