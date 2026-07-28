// cases: docs/engineering/testing/unit/experiments-runner.md
import { afterEach, describe, expect, it, vi } from "vitest";

// 「取锁后重查携带」的读取面计数探针:两个 wrapper 都原样委派给真实实现,只在中间记一笔,
// 因此对其余用例完全透明。工厂是惰性的——没有任何模块导入被 mock 的模块时它根本不执行,
// 于是「派发路径上一次全树扫描都不做」这条断言的成本恒为零。
const readSurfaceCalls = vi.hoisted(() => ({ forCase: 0, perEval: 0 }));
vi.mock("../record/open.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../record/open.ts")>();
  return {
    ...actual,
    loadLatestResultsForCase: (...args: Parameters<typeof actual.loadLatestResultsForCase>) => {
      readSurfaceCalls.forCase += 1;
      return actual.loadLatestResultsForCase(...args);
    },
  };
});
vi.mock("../view/data.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../view/data.ts")>();
  return {
    ...actual,
    loadLatestResultsPerEval: (...args: Parameters<typeof actual.loadLatestResultsPerEval>) => {
      readSurfaceCalls.perEval += 1;
      return actual.loadLatestResultsPerEval(...args);
    },
  };
});
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeProbeTargets, runEvals } from "./run.ts";
import { defineSandbox, defineSandboxAgent } from "../define.ts";
import { Artifacts } from "./reporters/artifacts.ts";
import { openRecord } from "../record/open.ts";
import { encodeAttemptLocator } from "../record/locator.ts";
import { equals } from "../expect/index.ts";
import { createFeedbackCoordinator, type FeedbackCoordinator } from "./feedback/coordinator.ts";
import { createFakeFeedbackIO } from "./feedback/testing.ts";
import {
  activateFeedbackSink,
  activeFeedbackSinkCount,
  type ExperimentHookInput,
  type ExperimentProgressInput,
} from "./feedback/sink.ts";
import { drainExperimentTeardowns, pendingExperimentTeardownCount } from "./experiment-cleanup-registry.ts";
import { computeFingerprint } from "./fingerprint.ts";
import { locksDirOf, pendingHeldCaseLockCount, type CaseLockRecord } from "./lock.ts";
import { pendingHeldGateLeaseCount } from "./gate-lease.ts";
import { slugHashEntryId } from "../shared/entry-file-store.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import type { CarryPlan } from "./fingerprint.ts";
import { ExperimentFatalError, EvalFatalError } from "../shared/failure-class.ts";
import type { AgentRun, DiagnosticRecord, RunFeedbackPlan, RunFeedbackState, RunOptions } from "./types.ts";
import type {
  Agent,
  CommandResult,
  Config,
  DiscoveredEval,
  EvalResult,
  InvocationShape,
  InvocationSummary,
  JudgeConfig,
  Reporter,
  ReporterRegistration,
  Sandbox,
  SandboxFile,
  Turn,
} from "../types.ts";

// judge 预检的目标收敛:只探测「实际要跑、且源码里出现 judge 字样」的 eval 的生效配置。
// 这是对 memory/judge-config-precheck-hard-fails-without-key 的修复守护——
// 全局配了 judge 但选中的 eval 都不用时,不能再因 judge key / 端点问题拦下整次运行。
// bug: memory/judge-config-precheck-hard-fails-without-key.md
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
  async writeFiles(files: globalThis.Record<string, string>, targetDir?: string): Promise<void> {
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
  async downloadDirectory(): Promise<void> {}
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
 * (落盘到临时目录,供事后用 openRecord() 核对与 reporter 观察到的值是否一致)。
 */
async function run(
  evals: DiscoveredEval[],
  agentRuns: AgentRun[],
  opts: {
    extraReporters?: ReporterRegistration[];
    carryPlan?: CarryPlan;
    maxConcurrency?: number;
    signal?: AbortSignal;
    /** 预先建好、需要在调用前写入固定文件(如伪造的收尾登记)的根;省略则自建一个临时目录。 */
    root?: string;
  } = {},
): Promise<{
  summary: Awaited<ReturnType<typeof runEvals>>;
  root: string;
  onEvalComplete: Map<string, string | undefined>;
  onEventComplete: Map<string, string | undefined>;
}> {
  const root = opts.root ?? (await makeRoot());
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
    // 与 Artifacts(root) 同一个根:未显式传入时 run.ts 会退回 cwd/.niceeval(与 attempt.ts 同一
    // 兜底口径),测试进程的 cwd 是仓库根——不隔离到这里传的临时目录,会在真实仓库根写出
    // .niceeval/teardowns/ 之类的测试副作用(见 memory 的 test-must-isolate-niceeval-root)。
    niceevalRoot: root,
    ...(opts.carryPlan ? { carryPlan: opts.carryPlan } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  const summary = await runEvals(runOpts);
  return { summary, root, onEvalComplete, onEventComplete };
}

async function diskSnapshotStartedAt(root: string, experimentId: string): Promise<string> {
  const results = await openRecord(root);
  const exp = results.experiments.find((e) => e.id === experimentId);
  if (!exp) throw new Error(`no run written for experiment ${experimentId}`);
  return exp.latestRun.startedAt;
}

async function diskLocator(
  root: string,
  experimentId: string,
  evalId: string,
  attempt: number,
): Promise<string | undefined> {
  const results = await openRecord(root);
  const exp = results.experiments.find((e) => e.id === experimentId);
  const ev = exp?.latestRun.evals.find((e) => e.id === evalId);
  return ev?.attempts.find((a) => a.result.attempt === attempt)?.locator;
}

// cases: docs/engineering/testing/unit/experiments-runner.md「Invocation 公共回调面」
// 类型重命名不能只靠 tsc 认可——真实跑一次最小 Invocation,证明 onInvocationStart /
// onInvocationComplete 两个回调按文档承诺各触发恰好一次,onEvalComplete 按 attempt 数逐条
// 触发,且顶层 InvocationSummary 不携带一个必然对多配置撒谎的 agent/model 单值。
describe("runEvals · Reporter 的 Invocation 回调面(onInvocationStart / onInvocationComplete)", () => {
  it("onInvocationStart 与 onInvocationComplete 各触发恰好一次;顶层摘要不带 agent/model", async () => {
    const evalA = makeEval("a", () => {});
    const evalB = makeEval("b", () => {});
    const agentRun: AgentRun = {
      agent: makeAgent("agent-a"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["a", "b"],
    };

    let startCalls = 0;
    let completeCalls = 0;
    let evalCompleteCalls = 0;
    let startShape: InvocationShape | undefined;
    let completeSummary: InvocationSummary | undefined;
    const probe: Reporter = {
      onInvocationStart(evals, shape) {
        startCalls += 1;
        startShape = shape;
        expect(evals.map((e) => e.id).sort()).toEqual(["a", "b"]);
      },
      onEvalComplete() {
        evalCompleteCalls += 1;
      },
      onInvocationComplete(summary) {
        completeCalls += 1;
        completeSummary = summary;
      },
    };

    await run([evalA, evalB], [agentRun], {
      extraReporters: [{ reporter: probe, name: "probe", required: false }],
    });

    expect(startCalls).toBe(1);
    expect(completeCalls).toBe(1);
    expect(evalCompleteCalls).toBe(2);
    expect(startShape?.totalAttempts).toBe(2);
    expect(completeSummary).not.toHaveProperty("agent");
    expect(completeSummary).not.toHaveProperty("model");
    expect(completeSummary?.results.map((r) => r.agent)).toEqual(["agent-a", "agent-a"]);
  });
});

// runner 只是「展开、调度、串行化 reporter 回调」——locator 的确定性完全来自
// encodeAttemptLocator 自己(已有 src/record/locator.test.ts 与
// src/record/results.test.ts 的 AttemptLocator 套件覆盖)。这里要守的不变量是编排层的:
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
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["ok", "boom"],
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
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["algebra/q1"],
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
      attempts: 2,
      earlyExit: false, // 两次都要真的跑,不能被首过即停吞掉其中一次
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["flaky"],
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
      artifactBase: `${experimentId}/some-old-run/${evalId}/a0`,
    };
    // eval 的 test() 会抛错——如果携带 / 首过即停判断漏了这条、真的调度了一次新 attempt,
    // 这里会产出一条 errored 的重复结果,而不是静默漏测。
    const evalDef = makeEval(evalId, () => {
      throw new Error("carried result should have unreadable scheduling a fresh attempt");
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-carried"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };

    const { summary, root } = await run([evalDef], [agentRun], {
      carryPlan: {
        plannedFingerprints: new Map(),
        acceptableFingerprints: new Map(),
        carriedAttemptsByKey: new Map([[`${experimentId}|${evalId}`, new Set([0])]]),
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

    // Artifacts.onInvocationComplete 把携带条目落盘时,同样原样保留 locator。
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
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["c-slow", "c-mid", "c-fast"],
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
  const coordinator = createFeedbackCoordinator({ profile: "json", renderer: { appendDurable() {} }, io: fakeIO.io });
  coordinator.start(plan);
  try {
    return await fn(coordinator);
  } finally {
    await coordinator.finish({
      summary: { startedAt: "", completedAt: "", passed: 0, failed: 0, unreadable: 0, errored: 0, durationMs: 0, results: [] },
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
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["ok", "boom", "gate-fail"],
      experimentId,
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalAttempts: 3, maxConcurrency: 3 },
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
      attempts: 1,
      earlyExit: false,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["a", "b", "c"],
      experimentId,
      budget: 0, // 花费从 0 起算,>= budget 恒成立——每个 attempt 在 preflight 就被跳过。
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalAttempts: 3, maxConcurrency: 3 },
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

      // reducer 不变量:每条 budget-exhausted 把一个 attempt 从 queued 挪进 unreadable —— 没派发就
      // 没有 verdict,不冒充 passed/failed(与 assembleInvocationCompletion() 读取 count 折算
      // InvocationCompletion.unstarted 的口径一致)。
      expect(coordinator.state).toMatchObject({ total: 3, reused: 0, running: 0, queued: 0, passed: 0, failed: 0, errored: 0, unreadable: 3 });
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
      attempts: 1,
      earlyExit: false,
      sandbox: missingTemplate,
      timeoutMs: 5_000,
      selectedEvalIds: ["a", "b", "c"],
      experimentId,
      budget: 10,
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalAttempts: 3, maxConcurrency: 3 },
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
      attempts: 1,
      earlyExit: false,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["a", "b", "c"],
      experimentId,
      budget: 10,
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalAttempts: 3, maxConcurrency: 3 },
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

// 携入数量不足以覆盖本次请求的 runs(典型触发:上次 attempts: 1 落了 1 条终态结果,这次把 runs
// 调大到 3、没有 --force)时,差额必须真正计入调度,不能因为这个组合"有过携入"就把没有实际
// 携入的序号也整段跳过——那会让 pass@N 的 N 被携入悄悄砍短,运行还照样报 PASSED/exit 0(见
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
      artifactBase: `${experimentId}/some-old-run/${evalId}/a0`,
    };
    // 差额 attempt 如果真的被调度执行,这里会抛错——用它检测「有没有因为回填而多花一次 agent
    // 成本」。earlyExit 下携入的 passed 应该让回填直接早退,不应该走到这里。
    const evalDef = makeEval(evalId, () => {
      throw new Error("backfilled attempt should have been early-exited, not actually run");
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-grow"),
      flags: {},
      attempts: 3, // 上次只留 1 条(attempts: 1 时代的携入),这次调大
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 1, configs: 1, totalAttempts: 3, maxConcurrency: 3 },
      reused: 1,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary } = await run([evalDef], [agentRun], {
        carryPlan: {
          plannedFingerprints: new Map(),
          acceptableFingerprints: new Map(),
          carriedAttemptsByKey: new Map([[`${experimentId}|${evalId}`, new Set([0])]]),
          carriedResults: [carried],
        },
      });

      const matches = summary.results.filter((r) => r.id === evalId);
      expect(matches).toHaveLength(1); // 没有因为回填而多出真实结果
      expect(matches[0]!.verdict).toBe("passed");
      expect(matches[0]!.locator).toBe(staleLocator); // 携入结果原样透传

      // 不变量:携入 1 + early-exit 回填 2 == 本次请求的 attempts: 3,不留没有解释的差额
      // (queued 必须真正归零,不能停在「还差 2 个不知道去哪」)。回填的两轮没真跑,进 unreadable。
      expect(coordinator.state).toMatchObject({ total: 3, reused: 1, running: 0, queued: 0, passed: 0, failed: 0, errored: 0, unreadable: 2 });
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
      artifactBase: `${experimentId}/some-old-run/${evalId}/a0`,
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
      attempts: 3,
      earlyExit: true, // failed 不触发 earlyExit(只有 passed/errored 会),回填的两次应该真的跑
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 1, configs: 1, totalAttempts: 3, maxConcurrency: 3 },
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
          acceptableFingerprints: new Map(),
          carriedAttemptsByKey: new Map([[`${experimentId}|${evalId}`, new Set([0])]]),
          carriedResults: [carried],
        },
      });

      expect(calls).toBe(2); // 差额的两次真的执行了 agent,不是被携入悄悄吞掉
      const matches = summary.results.filter((r) => r.id === evalId);
      expect(matches).toHaveLength(3); // 1 携入 + 2 新跑,凑满本次请求的 attempts: 3
      expect(matches.map((r) => r.attempt).sort()).toEqual([0, 1, 2]);
      expect(matches.every((r) => r.verdict === "failed")).toBe(true);

      // 差额两次真的跑了,各自落进 failed —— 携入那条的 verdict 留在 reused,不摊进结局项。
      expect(coordinator.state).toMatchObject({ total: 3, reused: 1, running: 0, queued: 0, passed: 0, failed: 2, errored: 0, unreadable: 0 });
      // InvocationSummary 的三条 failed（1 carry + 2 fresh）与终局 handoff 的 FailureNotice 清单同口径。
      // carry 不能只进 summary 计数而从 FAILURES / agent handoff 消失。
      expect(coordinator.state.failures).toHaveLength(3);
      expect(coordinator.state.failures.map((failure) => failure.locator)).toContain(staleLocator);
    });
  });

  it("携带的具体序号不连续(carry 序号 1,不是序号 0)时,只补跑真正缺失的 0 和 2,不是无脑跳过前 N 个", async () => {
    // 受控模拟"attempts: 3 且中间那次(序号 1)恰好是上一轮唯一的终态结果、序号 0/2 从未落盘"这个
    // 非连续场景——直接验证 run.ts 的调度是按 carriedAttemptsByKey 里的具体序号跳过,不是按
    // "这个组合携带过 N 条就跳过前 N 个"这种旧的、错误的计数式跳过。
    const experimentId = "carry-noncontig-exp";
    const evalId = "noncontig-eval";
    const evalDef = makeEval(evalId, () => {});
    const staleLocator = encodeAttemptLocator({
      experimentId,
      snapshotStartedAt: "2020-01-01T00:00:00.000Z",
      evalId,
      attempt: 1,
    });
    const carried: EvalResult = {
      id: evalId,
      experimentId,
      agent: "agent-noncontig",
      verdict: "passed",
      attempt: 1, // 只有序号 1 落过终态结果
      startedAt: "2020-01-01T00:00:00.000Z",
      durationMs: 1,
      assertions: [],
      locator: staleLocator,
      artifactBase: `${experimentId}/some-old-run/${evalId}/a1`,
    };
    const agentRun: AgentRun = {
      agent: makeAgent("agent-noncontig"),
      flags: {},
      attempts: 3,
      earlyExit: false, // 关掉 earlyExit:避免序号 0 先跑出 passed 把序号 2 提前吞掉,专注验证"跑了哪些序号"
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };

    const { summary } = await run([evalDef], [agentRun], {
      carryPlan: {
        plannedFingerprints: new Map(),
        acceptableFingerprints: new Map(),
        carriedAttemptsByKey: new Map([[`${experimentId}|${evalId}`, new Set([1])]]),
        carriedResults: [carried],
      },
    });

    const matches = summary.results.filter((r) => r.id === evalId).sort((a, b) => a.attempt - b.attempt);
    expect(matches.map((r) => r.attempt)).toEqual([0, 1, 2]); // 携带的 1 + 真正派发的 0、2,凑满 attempts: 3
    expect(matches[0]!.locator).not.toBe(staleLocator); // 序号 0 是真跑的新 attempt,不是携带
    expect(matches[1]!.locator).toBe(staleLocator); // 序号 1 原样透传携带条目(原封不动的旧 locator)
    expect(matches[2]!.locator).not.toBe(staleLocator); // 序号 2 同样是真跑的新 attempt
  });
});

// ───────────────────────── 实验级生命周期(ExperimentDef.setup / .teardown) ─────────────────────────
// 契约见 docs/feature/experiments/architecture.md「实验级生命周期」与 docs/runner.md「环境预置不进
// 运行器,但按顺序调它」:成对 setup/teardown,setup 不返回值——teardown 是独立字段,当且仅当
// 同层 setup 时点走到过才触发(setup 抛错不豁免、未声明 setup 不影响触发、时点没走到则跳过);
// setup 抛错 → 本实验所有 attempt 逐条合成 errored;teardown 抛错只作运行级诊断。

describe("runEvals · 实验级 setup/teardown", () => {
  function runWithHooks(
    experimentId: string,
    setup: AgentRun["setup"],
    teardown: AgentRun["teardown"],
    overrides: Partial<AgentRun> = {},
  ): AgentRun {
    return {
      agent: makeAgent(`agent-${experimentId}`),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [],
      experimentId,
      setup,
      teardown,
      ...overrides,
    };
  }

  it("setup 整场恰好一次:并发 attempt 共享 memoized 结果,teardown 在全部 attempt 收尾后恰好一次", async () => {
    let setupCalls = 0;
    let teardownCalls = 0;
    let completedAtTeardown = -1;
    let completed = 0;
    const evals = ["a", "b", "c"].map((id) =>
      makeEval(id, () => {
        completed += 1;
      }),
    );
    const agentRun = runWithHooks(
      "lifecycle-exp",
      async () => {
        setupCalls += 1;
        // 给并发的其它 attempt 一个真实的等待窗口,验证它们不各自重跑 setup
        await new Promise((r) => setTimeout(r, 20));
      },
      () => {
        teardownCalls += 1;
        completedAtTeardown = completed;
      },
      { attempts: 2, selectedEvalIds: ["a", "b", "c"] },
    );

    const { summary } = await run(evals, [agentRun], { maxConcurrency: 4 });

    expect(setupCalls).toBe(1);
    expect(teardownCalls).toBe(1);
    expect(summary.results).toHaveLength(6);
    expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
    // teardown 必须晚于本实验全部 attempt 的执行(attempts: 2 但 earlyExit 会省略第二轮,
    // 至少 3 条 eval 各完成一次)
    expect(completedAtTeardown).toBeGreaterThanOrEqual(3);
  });

  it("两个实验各自的 setup/teardown 各跑一次,互不共享", async () => {
    const calls: string[] = [];
    const evals = [makeEval("shared", () => {})];
    const mk = (id: string) =>
      runWithHooks(
        id,
        () => {
          calls.push(`setup:${id}`);
        },
        () => {
          calls.push(`teardown:${id}`);
        },
        { selectedEvalIds: ["shared"] },
      );

    await run(evals, [mk("exp-a"), mk("exp-b")]);

    expect(calls.filter((c) => c === "setup:exp-a")).toHaveLength(1);
    expect(calls.filter((c) => c === "setup:exp-b")).toHaveLength(1);
    expect(calls.filter((c) => c === "teardown:exp-a")).toHaveLength(1);
    expect(calls.filter((c) => c === "teardown:exp-b")).toHaveLength(1);
  });

  it("全部结果被 carry 携入、无 attempt 派发时 setup 与 teardown 都不执行", async () => {
    let setupCalls = 0;
    let teardownCalls = 0;
    const experimentId = "carry-exp";
    const evalDef = makeEval("done", () => {});
    const agentRun = runWithHooks(
      experimentId,
      () => {
        setupCalls += 1;
      },
      () => {
        teardownCalls += 1;
      },
      { selectedEvalIds: ["done"] },
    );
    const carried: EvalResult = {
      id: "done",
      experimentId,
      agent: agentRun.agent.name,
      verdict: "passed",
      attempt: 0,
      durationMs: 1,
      assertions: [],
    };

    const { summary } = await run([evalDef], [agentRun], {
      carryPlan: {
        plannedFingerprints: new Map(),
        acceptableFingerprints: new Map(),
        carriedAttemptsByKey: new Map([[`${experimentId}|done`, new Set([0])]]),
        carriedResults: [carried],
      },
    });

    expect(setupCalls).toBe(0);
    expect(teardownCalls).toBe(0);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]!.verdict).toBe("passed");
  });

  it("setup 抛错:本实验所有 attempt 合成 errored(code/phase 结构化),同批其它实验不受影响", async () => {
    const evals = [makeEval("m1", () => {}), makeEval("m2", () => {})];
    const broken = runWithHooks(
      "broken-exp",
      () => {
        throw new Error("tunnel refused to start");
      },
      undefined,
      { attempts: 2, earlyExit: false, selectedEvalIds: ["m1", "m2"] },
    );
    const healthy = runWithHooks("healthy-exp", () => {}, undefined, { selectedEvalIds: ["m1", "m2"] });

    const { summary } = await run(evals, [broken, healthy], { maxConcurrency: 4 });

    const brokenResults = summary.results.filter((r) => r.experimentId === "broken-exp");
    // 2 eval × runs 2 全部逐条 errored——setup 失败不派发 agent、零成本,不被 fail-fast 截短
    expect(brokenResults).toHaveLength(4);
    for (const r of brokenResults) {
      expect(r.verdict).toBe("errored");
      expect(r.error).toMatchObject({ code: "experiment-setup-failed", phase: "experiment.setup" });
      expect(r.error?.message).toContain("tunnel refused to start");
      expect(r.locator).toBeDefined();
    }
    const healthyResults = summary.results.filter((r) => r.experimentId === "healthy-exp");
    expect(healthyResults).toHaveLength(2);
    expect(healthyResults.every((r) => r.verdict === "passed")).toBe(true);
  });

  it("setup 抛错后 teardown 仍执行:半初始化现场同样要扫尾,setup 抛错不豁免", async () => {
    let teardownCalls = 0;
    const evals = [makeEval("m1", () => {}), makeEval("m2", () => {})];
    const broken = runWithHooks(
      "broken-with-teardown-exp",
      () => {
        throw new Error("tunnel refused to start");
      },
      () => {
        teardownCalls += 1;
      },
      { attempts: 2, earlyExit: false, selectedEvalIds: ["m1", "m2"] },
    );

    const { summary } = await run(evals, [broken], { maxConcurrency: 4 });

    expect(teardownCalls).toBe(1);
    expect(summary.results).toHaveLength(4);
    expect(summary.results.every((r) => r.verdict === "errored")).toBe(true);
  });

  it("运行被中断(signal abort)时 teardown 仍执行", async () => {
    let teardownCalls = 0;
    const controller = new AbortController();
    const evalDef = makeEval("abort-me", async () => {
      controller.abort();
      await new Promise((r) => setTimeout(r, 100));
    });
    const agentRun = runWithHooks(
      "interrupted-exp",
      () => {},
      () => {
        teardownCalls += 1;
      },
      { selectedEvalIds: ["abort-me"] },
    );

    await run([evalDef], [agentRun], { signal: controller.signal });

    expect(teardownCalls).toBe(1);
  });

  it("ctx 携带 experimentId / selectedEvalIds / signal;未声明 teardown 时无收尾动作、也不产生诊断", async () => {
    let seen: { experimentId: string; selectedEvalIds: readonly string[]; hasSignal: boolean } | undefined;
    const controller = new AbortController();
    const evals = [makeEval("ctx-a", () => {}), makeEval("ctx-b", () => {})];
    const experimentId = "ctx-exp";
    const agentRun = runWithHooks(
      experimentId,
      (ctx) => {
        seen = {
          experimentId: ctx.experimentId,
          selectedEvalIds: ctx.selectedEvalIds,
          hasSignal: ctx.signal !== undefined,
        };
        ctx.progress({ message: "warming" });
      },
      undefined,
      { selectedEvalIds: ["ctx-a", "ctx-b"] },
    );
    const plan: RunFeedbackPlan = {
      shape: { evals: 2, configs: 1, totalAttempts: 2, maxConcurrency: 3 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary } = await run(evals, [agentRun], { signal: controller.signal });

      expect(seen).toEqual({ experimentId: "ctx-exp", selectedEvalIds: ["ctx-a", "ctx-b"], hasSignal: true });
      expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
      expect(coordinator.state.diagnostics.find((d) => d.key === `experiment-teardown-failed:${experimentId}`)).toBeUndefined();
    });
  });

  it("钩子起止经 feedback sink 发布:成功 started+done、抛错 started+failed(done/failed 带耗时),progress 压成运行级 detail", async () => {
    const hookEvents: ExperimentHookInput[] = [];
    const progressEvents: ExperimentProgressInput[] = [];
    const deactivate = activateFeedbackSink({
      activity() {},
      diagnostic() {},
      interrupted() {},
      reporterError() {},
      failure() {},
      budgetExhausted() {},
      kept() {},
      experimentHook(input) {
        hookEvents.push(input);
      },
      experimentProgress(input) {
        progressEvents.push(input);
      },
      precheck() {},
      lockWait() {},
      lifecycle() {},
    });
    try {
      const evals = [makeEval("ok", () => {})];
      const good = runWithHooks(
        "good-exp",
        (ctx) => {
          ctx.progress({ message: "starting tunnel", current: 2, total: 5 });
        },
        () => {},
        { selectedEvalIds: ["ok"] },
      );
      const bad = runWithHooks(
        "bad-exp",
        () => {
          throw new Error("boom");
        },
        undefined,
        { selectedEvalIds: ["ok"] },
      );
      await run(evals, [good, bad], { maxConcurrency: 2 });
    } finally {
      deactivate();
    }

    const good = hookEvents.filter((e) => e.experimentId === "good-exp");
    expect(good.map((e) => `${e.hook}:${e.status}`)).toEqual([
      "setup:started",
      "setup:done",
      "teardown:started",
      "teardown:done",
    ]);
    expect(good[0]!.durationMs).toBeUndefined();
    expect(good[1]!.durationMs).toBeGreaterThanOrEqual(0);
    const bad = hookEvents.filter((e) => e.experimentId === "bad-exp").map((e) => `${e.hook}:${e.status}`);
    expect(bad).toEqual(["setup:started", "setup:failed"]);
    expect(progressEvents).toContainEqual({ experimentId: "good-exp", detail: "starting tunnel (2/5)" });
  });
});

describe("runEvals · 实验级 teardown 失败只作运行级诊断", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
  });

  // bug: memory/force-exit-skips-experiment-teardown.md
  it("正常完整跑完后强清兜底注册表为空:teardown 已被运行路径消费恰好一次,drain 无动作", async () => {
    let teardownCalls = 0;
    const evalDef = makeEval("tidy", () => {});
    const agentRun: AgentRun = {
      agent: makeAgent("agent-registry"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["tidy"],
      experimentId: "registry-exp",
      setup: () => {},
      teardown: () => {
        teardownCalls += 1;
      },
    };

    await run([evalDef], [agentRun]);

    expect(teardownCalls).toBe(1);
    expect(pendingExperimentTeardownCount()).toBe(0);
    expect(await drainExperimentTeardowns()).toBe(0);
    expect(teardownCalls).toBe(1);
  });

  it("teardown 抛错:verdict 不变,产生 experiment-teardown-failed 诊断", async () => {
    const experimentId = "leaky-exp";
    const evalDef = makeEval("ok", () => {});
    const agentRun: AgentRun = {
      agent: makeAgent("agent-leaky"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["ok"],
      experimentId,
      setup: () => {},
      teardown: () => {
        throw new Error("port already released");
      },
    };
    const plan: RunFeedbackPlan = {
      shape: { evals: 1, configs: 1, totalAttempts: 1, maxConcurrency: 3 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary } = await run([evalDef], [agentRun]);

      expect(summary.results).toHaveLength(1);
      expect(summary.results[0]!.verdict).toBe("passed");
      const diag = coordinator.state.diagnostics.find((d) => d.key === `experiment-teardown-failed:${experimentId}`);
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe("warning");
      expect(diag!.message).toContain("port already released");
    });
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「实验域诊断持久化」
// docs/runner.md「实验域诊断持久化」的折叠不变量:相同 dedupeKey 只在同一个 Run(即同一个
// experimentId)内折叠 count;不同 Experiment 各自独立累计,不跨来源合并。live 反馈流(coordinator)
// 已有覆盖(见上面 budget-unenforceable / teardown-failed 两个 describe),这里单独守持久化
// 到 run.json 的那份累积器——它是独立状态,不能只测 live 反馈就当作两条通路都验证过了。
describe("runEvals · 实验域诊断持久化到 Run", () => {
  it("相同 dedupeKey 在同一 Experiment 内折叠 count,不同 Experiment 各自独立、不跨来源合并", async () => {
    const evalA = makeEval("a", () => {});
    const evalB = makeEval("b", () => {});
    const agentA: AgentRun = {
      agent: makeAgent("agent-diag-a"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["a"],
      experimentId: "diag-exp-a",
      setup: (ctx) => {
        ctx.diagnostic({ code: "tunnel-flaky", level: "warning", message: "retry 1", dedupeKey: "tunnel" });
        ctx.diagnostic({ code: "tunnel-flaky", level: "warning", message: "retry 2", dedupeKey: "tunnel" });
      },
    };
    const agentB: AgentRun = {
      agent: makeAgent("agent-diag-b"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["b"],
      experimentId: "diag-exp-b",
      setup: (ctx) => {
        ctx.diagnostic({ code: "tunnel-flaky", level: "warning", message: "retry 1", dedupeKey: "tunnel" });
      },
    };

    const { root } = await run([evalA, evalB], [agentA, agentB], { maxConcurrency: 4 });

    const results = await openRecord(root);
    const expA = results.experiments.find((e) => e.id === "diag-exp-a");
    const expB = results.experiments.find((e) => e.id === "diag-exp-b");
    expect(expA).toBeDefined();
    expect(expB).toBeDefined();

    // 同一个 Experiment 内两次相同 dedupeKey 折叠成一条,count 累计到 2。
    expect(expA!.latestRun.diagnostics).toHaveLength(1);
    expect(expA!.latestRun.diagnostics![0]).toMatchObject({ code: "tunnel-flaky", count: 2 });

    // 另一个 Experiment 独立计数:同样的 dedupeKey/code 只出现过一次,不从 exp-a 借位、
    // 也不把两边加总。
    expect(expB!.latestRun.diagnostics).toHaveLength(1);
    expect(expB!.latestRun.diagnostics![0]).toMatchObject({ code: "tunnel-flaky" });
    expect(expB!.latestRun.diagnostics![0]!.count).toBeUndefined();
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「ctx.fact() 的作用域归属」
describe("runEvals · experiment.setup/.teardown 的 ctx.fact() 累积进 Run.facts", () => {
  it("同一 Experiment 内 setup 与 teardown 上报的 fact 合并,同 key 后写覆盖先写;不同 Experiment 各自独立、不串桶", async () => {
    const evalA = makeEval("a", () => {});
    const evalB = makeEval("b", () => {});
    const agentA: AgentRun = {
      agent: makeAgent("agent-fact-a"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["a"],
      experimentId: "fact-exp-a",
      setup: (ctx) => {
        ctx.fact?.("service.version", "2026.7.0");
        ctx.fact?.("shared.key", "from-setup");
      },
      teardown: (ctx) => {
        ctx.fact?.("shared.key", "from-teardown"); // 后写覆盖先写
      },
    };
    const agentB: AgentRun = {
      agent: makeAgent("agent-fact-b"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["b"],
      experimentId: "fact-exp-b",
      // 没有任何 ctx.fact() 调用——facts 字段整个不出现,不是空对象。
    };

    const { root } = await run([evalA, evalB], [agentA, agentB], { maxConcurrency: 4 });

    const results = await openRecord(root);
    const expA = results.experiments.find((e) => e.id === "fact-exp-a");
    const expB = results.experiments.find((e) => e.id === "fact-exp-b");

    expect(expA!.latestRun.facts).toEqual({ "service.version": "2026.7.0", "shared.key": "from-teardown" });
    expect(expB!.latestRun.facts).toBeUndefined();
  });
});

// 强杀后的收尾兜底(docs/feature/experiments/architecture.md「强杀后的收尾兜底」):受控模拟
// 代替真实 kill -9——直接在临时目录构造一份 .niceeval/teardowns/<entry>.json 登记文件(模拟"上
// 一次进程被强杀,来不及删登记"的状态),手工填入确定不存在的 pid / 当前宿主机名 / 一组
// selectedEvalIds,再调用真实 runEvals() 触发该实验的 setup,断言启动自愈的完整链路。
describe("runEvals · 强杀后的启动自愈(收尾登记的补执行)", () => {
  it("同宿主 pid 已死:先补执行遗留 teardown(ctx.selectedEvalIds 取自登记、反馈标注 recovery)再照常走本次 setup,登记文件被删除", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir, hostname } = await import("node:os");
    const { join } = await import("node:path");
    const { writeTeardownRegistration, readTeardownRegistrations } = await import("./teardown-registry.ts");

    const root = await mkdtemp(join(tmpdir(), "niceeval-teardown-recovery-"));
    roots.push(root);
    const experimentId = "recovery-exp";
    await writeTeardownRegistration(root, {
      experimentId,
      selectedEvalIds: ["stale-a", "stale-b"],
      pid: 999_999_999, // 几乎确定不存在的 pid:同宿主 + 不存活 = 遗留义务
      host: hostname(),
      startedAt: "2026-07-21T10:00:00.000Z",
    });

    const hookEvents: ExperimentHookInput[] = [];
    const deactivate = activateFeedbackSink({
      activity() {},
      diagnostic() {},
      interrupted() {},
      reporterError() {},
      failure() {},
      budgetExhausted() {},
      kept() {},
      experimentHook(input) {
        hookEvents.push(input);
      },
      experimentProgress() {},
      precheck() {},
      lockWait() {},
      lifecycle() {},
    });

    let recoveryCtxSeen: readonly string[] | undefined;
    let setupCalls = 0;
    let teardownCalls = 0;
    const evalDef = makeEval("fresh-eval", () => {});
    const agentRun: AgentRun = {
      agent: makeAgent(`agent-${experimentId}`),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["fresh-eval"],
      experimentId,
      setup: () => {
        setupCalls += 1;
      },
      teardown: (ctx) => {
        teardownCalls += 1;
        // 遗留义务补执行时 ctx.selectedEvalIds 取自登记(stale-a/b),不是这次真实 run 的
        // selectedEvalIds(fresh-eval)——这次真实 run 自己收尾时会再调一次、带上真实值。
        if (teardownCalls === 1) recoveryCtxSeen = ctx.selectedEvalIds;
      },
    };

    try {
      const { summary } = await run([evalDef], [agentRun], { root });
      expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
    } finally {
      deactivate();
    }

    // 补执行是新进程语义:selectedEvalIds 从登记恢复,不是这次 run 自己的选择。
    expect(recoveryCtxSeen).toEqual(["stale-a", "stale-b"]);
    // 补执行 → 照常走本次 setup → 本次 teardown:恰好两次 teardown(补执行 1 次 + 本次 1 次)。
    expect(teardownCalls).toBe(2);
    expect(setupCalls).toBe(1);

    const experimentHooks = hookEvents.filter((e) => e.experimentId === experimentId);
    // 顺序:补执行的 teardown 先跑完,再是本次的 setup,最后是本次真实的 teardown——
    // recovery 补执行必须先于本次 setup(docs 原文「先补执行一次它的 teardown……再照常走 setup」)。
    expect(experimentHooks.map((e) => `${e.hook}:${e.status}${e.recovery ? ":recovery" : ""}`)).toEqual([
      "teardown:started:recovery",
      "teardown:done:recovery",
      "setup:started",
      "setup:done",
      "teardown:started",
      "teardown:done",
    ]);

    // 登记文件被删除:补执行的遗留登记与本次 run 自己 settle 后的登记都不再残留。
    const remaining = await readTeardownRegistrations(root);
    expect(remaining).toEqual([]);
  });

  it("全部 attempt 被携带而零派发时，选中实验仍在调度前补执行遗留 teardown", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir, hostname } = await import("node:os");
    const { join } = await import("node:path");
    const { writeTeardownRegistration, readTeardownRegistrations } = await import("./teardown-registry.ts");
    const root = await mkdtemp(join(tmpdir(), "niceeval-teardown-carry-recovery-"));
    roots.push(root);
    const experimentId = "recovery-all-carried";
    await writeTeardownRegistration(root, {
      experimentId,
      selectedEvalIds: ["carried-eval"],
      pid: 999_999_999,
      host: hostname(),
      startedAt: "2026-07-21T10:00:00.000Z",
    });

    let teardownCalls = 0;
    await run([], [
      {
        agent: makeAgent(`agent-${experimentId}`),
        flags: {},
        attempts: 1,
        earlyExit: true,
        timeoutMs: 5_000,
        selectedEvalIds: ["carried-eval"],
        experimentId,
        teardown: () => {
          teardownCalls += 1;
        },
      },
    ], { root });

    expect(teardownCalls).toBe(1);
    expect(await readTeardownRegistrations(root)).toEqual([]);
  });

  it("pid 仍存活:不触碰遗留登记,不补执行 teardown(可能是并发 run)", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir, hostname } = await import("node:os");
    const { join } = await import("node:path");
    const { writeTeardownRegistration } = await import("./teardown-registry.ts");

    const root = await mkdtemp(join(tmpdir(), "niceeval-teardown-recovery-alive-"));
    roots.push(root);
    const experimentId = "recovery-alive-exp";
    await writeTeardownRegistration(root, {
      experimentId,
      selectedEvalIds: ["stale-a"],
      pid: process.pid, // 存活:可能是并发 run,不触碰
      host: hostname(),
      startedAt: "2026-07-21T10:00:00.000Z",
    });

    const hookEvents: ExperimentHookInput[] = [];
    const deactivate = activateFeedbackSink({
      activity() {},
      diagnostic() {},
      interrupted() {},
      reporterError() {},
      failure() {},
      budgetExhausted() {},
      kept() {},
      experimentHook(input) {
        hookEvents.push(input);
      },
      experimentProgress() {},
      precheck() {},
      lockWait() {},
      lifecycle() {},
    });

    let teardownCalls = 0;
    const evalDef = makeEval("fresh-eval", () => {});
    const agentRun: AgentRun = {
      agent: makeAgent(`agent-${experimentId}`),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["fresh-eval"],
      experimentId,
      teardown: () => {
        teardownCalls += 1;
      },
    };

    try {
      await run([evalDef], [agentRun], { root });
    } finally {
      deactivate();
    }

    // 只有本次 run 自己收尾的那一次,没有补执行——recovery 标注一次都不该出现。
    expect(teardownCalls).toBe(1);
    expect(hookEvents.some((e) => e.recovery)).toBe(false);
  });

  it("异宿主:不触碰遗留登记,不补执行 teardown(标识来自另一台机器,无法安全核对)", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { writeTeardownRegistration } = await import("./teardown-registry.ts");

    const root = await mkdtemp(join(tmpdir(), "niceeval-teardown-recovery-otherhost-"));
    roots.push(root);
    const experimentId = "recovery-otherhost-exp";
    await writeTeardownRegistration(root, {
      experimentId,
      selectedEvalIds: ["stale-a"],
      pid: 999_999_999, // pid 数值上确实不存在于本机,但 host 不匹配时不能据此判定死亡
      host: "some-other-host",
      startedAt: "2026-07-21T10:00:00.000Z",
    });

    const hookEvents: ExperimentHookInput[] = [];
    const deactivate = activateFeedbackSink({
      activity() {},
      diagnostic() {},
      interrupted() {},
      reporterError() {},
      failure() {},
      budgetExhausted() {},
      kept() {},
      experimentHook(input) {
        hookEvents.push(input);
      },
      experimentProgress() {},
      precheck() {},
      lockWait() {},
      lifecycle() {},
    });

    let teardownCalls = 0;
    const evalDef = makeEval("fresh-eval", () => {});
    const agentRun: AgentRun = {
      agent: makeAgent(`agent-${experimentId}`),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: ["fresh-eval"],
      experimentId,
      teardown: () => {
        teardownCalls += 1;
      },
    };

    try {
      await run([evalDef], [agentRun], { root });
    } finally {
      deactivate();
    }

    expect(teardownCalls).toBe(1);
    expect(hookEvents.some((e) => e.recovery)).toBe(false);
  });
});

describe("computeFingerprint · 实验级钩子不进 fingerprint", () => {
  it("只改 setup / teardown 函数体不改变 fingerprint(改钩子要重跑用 --force,与 sandbox 钩子同规则)", async () => {
    const evalDef = makeEval("fp", () => {});
    const base: AgentRun = {
      agent: makeAgent("agent-fp"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      timeoutMs: 5_000,
      selectedEvalIds: ["fp"],
      experimentId: "fp-exp",
    };
    const withHook: AgentRun = { ...base, setup: () => {}, teardown: () => {} };

    const { computeFingerprint } = await import("./fingerprint.ts");
    expect(await computeFingerprint(evalDef, withHook)).toBe(await computeFingerprint(evalDef, base));
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

// provider 级独占串行闸(见 docs/runner.md「调度:有界并发」/ docs/feature/sandbox/local.md):
// 声明 exclusive: true 的 provider(内置 local 即是,这里用一个同样声明的自定义 provider 代表它,
// 不需要真起本地沙箱)必须让同 provider 的 attempt 一次只跑一个,即便全局 maxConcurrency 开得
// 比 attempt 总数还宽;同批其它(未声明 exclusive)provider 的 attempt 不受这道闸影响。观察面是
// 在飞峰值(create() 里自增/自减的计数器),不是断言内部信号量被调用几次。
describe("runEvals · exclusive provider 强制串行", () => {
  it("同一 exclusive provider 的 attempt 一次只跑一个,不管全局 maxConcurrency 开多宽", async () => {
    let concurrent = 0;
    let peak = 0;
    const exclusiveSpec = defineSandbox({
      name: "exclusive-fake",
      exclusive: true,
      create: async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await sleep(20);
        concurrent -= 1;
        return asSandbox(new FakeSandbox());
      },
    });
    const evals = ["a", "b", "c", "d"].map((id) => makeEval(id, () => {}));
    const agentRun: AgentRun = {
      agent: makeAgent("agent-exclusive"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: exclusiveSpec,
      timeoutMs: 5_000,
      selectedEvalIds: evals.map((e) => e.id),
      experimentId: "exclusive-exp",
    };

    const { summary } = await run(evals, [agentRun], { maxConcurrency: 4 });

    expect(summary.results).toHaveLength(4);
    expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
    expect(peak).toBe(1);
  });

  it("同批其它(非 exclusive)provider 的 attempt 不受影响,照常并发", async () => {
    let exclusiveConcurrent = 0;
    let exclusivePeak = 0;
    const exclusiveSpec = defineSandbox({
      name: "exclusive-fake-2",
      exclusive: true,
      create: async () => {
        exclusiveConcurrent += 1;
        exclusivePeak = Math.max(exclusivePeak, exclusiveConcurrent);
        await sleep(20);
        exclusiveConcurrent -= 1;
        return asSandbox(new FakeSandbox());
      },
    });
    let normalConcurrent = 0;
    let normalPeak = 0;
    const normalSpec = defineSandbox({
      name: "normal-fake",
      create: async () => {
        normalConcurrent += 1;
        normalPeak = Math.max(normalPeak, normalConcurrent);
        await sleep(20);
        normalConcurrent -= 1;
        return asSandbox(new FakeSandbox());
      },
    });

    const exclusiveEvals = ["e1", "e2", "e3"].map((id) => makeEval(id, () => {}));
    const normalEvals = ["n1", "n2", "n3"].map((id) => makeEval(id, () => {}));
    const exclusiveRun: AgentRun = {
      agent: makeAgent("agent-excl"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: exclusiveSpec,
      timeoutMs: 5_000,
      selectedEvalIds: exclusiveEvals.map((e) => e.id),
      experimentId: "excl-exp",
    };
    const normalRun: AgentRun = {
      agent: makeAgent("agent-normal"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: normalSpec,
      timeoutMs: 5_000,
      selectedEvalIds: normalEvals.map((e) => e.id),
      experimentId: "normal-exp",
    };

    const { summary } = await run([...exclusiveEvals, ...normalEvals], [exclusiveRun, normalRun], {
      maxConcurrency: 6,
    });

    expect(summary.results).toHaveLength(6);
    expect(exclusivePeak).toBe(1);
    expect(normalPeak).toBeGreaterThan(1);
  });
});

// turn 级重试退避期间只应释放全局并发位,实验级闸(runSem)必须全程持有——两级闸按持有期
// 分工的语义单点见 docs/runner.md「调度:有界并发」。下面两个 Turn 工厂复用
// src/context/send-retry.test.ts 已验证过的最小形状:失败 Turn 只带一条 error 事件(没有
// message/thinking/action 事件,受理证据门不会把它强降为不可重试),成功 Turn 是一条
// assistant message,消息文案匹配保守兜底分类器的限流关键字。
function retryableFailureTurn(message: string): Turn {
  return { status: "failed", events: [{ type: "error", message }] };
}
function okTurn(): Turn {
  return { status: "completed", events: [{ type: "message", role: "assistant", text: "ok" }] };
}

// bug: memory/turn-retry-backoff-releases-experiment-serial-lock.md
describe("runEvals · 退避的槽位持有期差:实验级闸全程持有,全局位在退避期间让位", () => {
  it("maxConcurrency: 1 下,一个 attempt 进入退避窗口时同实验下一个 attempt 不启动;退避结束、首个 attempt 收尾后才放行", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.9); // 固定退避延迟为 4.5s,远大于 vi.waitFor 轮询期间可能顺带推进的虚拟时间
    try {
      let sendCalls = 0;
      const agent = defineSandboxAgent({
        name: "agent-retry-serial",
        send: async () => {
          sendCalls += 1;
          return sendCalls === 1
            ? retryableFailureTurn("rate limited, please retry later")
            : okTurn();
        },
      });
      let sandboxCreates = 0;
      const sandboxSpec = defineSandbox({
        name: "fake-retry-serial-sandbox",
        create: async () => {
          sandboxCreates += 1;
          return asSandbox(new FakeSandbox());
        },
      });
      const evalA = makeEval("a", async (t) => {
        await t.send("go");
      });
      const evalB = makeEval("b", async (t) => {
        await t.send("go");
      });
      const agentRun: AgentRun = {
        agent,
        flags: {},
        attempts: 1,
        earlyExit: false,
        sandbox: sandboxSpec,
        maxConcurrency: 1,
        timeoutMs: 30_000,
        selectedEvalIds: ["a", "b"],
        experimentId: "retry-serial-exp",
      };

      const runPromise = run([evalA, evalB], [agentRun], { maxConcurrency: 4 });

      // a 撞到可重试错误、进入退避:此时它已经释放了全局位,但必须仍握着实验级闸(runSem)。
      await vi.waitFor(() => expect(sendCalls).toBe(1));
      await vi.advanceTimersByTimeAsync(0); // 只放行已经就绪的微任务,不推进真实退避时长
      expect(sandboxCreates).toBe(1); // b 排在 a 后面:拿不到 runSem,沙箱不会创建

      // 只推进到刚好越过退避延迟(mock 后固定 4.5s),不用 runAllTimersAsync——它会一路清空
      // 定时器队列,连每个 attempt 30s 外层超时的 AbortSignal.timeout 都会被提前触发。
      await vi.advanceTimersByTimeAsync(10_000);
      const { summary } = await runPromise;

      expect(summary.results).toHaveLength(2);
      expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
      expect(sandboxCreates).toBe(2); // b 的沙箱现在才创建
      expect(sendCalls).toBe(3); // a: 失败 1 次 + 重试成功 1 次;b: 成功 1 次
    } finally {
      vi.useRealTimers();
      randomSpy.mockRestore();
    }
  });
});

// bug: memory/turn-retry-backoff-releases-experiment-serial-lock.md
describe("runEvals · 实验级闸覆盖沙箱收尾", () => {
  it("maxConcurrency: 1 下,上一个 attempt 的 sandbox.teardown 钩子未完成时,下一个 attempt 的沙箱不会创建", async () => {
    let releaseTeardown!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseTeardown = resolve;
    });
    let teardownEntered = false;
    let sandboxCreates = 0;
    const sandboxSpec = defineSandbox({
      name: "fake-teardown-barrier-sandbox",
      create: async () => {
        sandboxCreates += 1;
        return asSandbox(new FakeSandbox());
      },
    }).teardown(async () => {
      teardownEntered = true;
      await barrier;
    });

    const evalA = makeEval("a", () => {});
    const evalB = makeEval("b", () => {});
    const agentRun: AgentRun = {
      agent: makeAgent("agent-teardown-barrier"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: sandboxSpec,
      maxConcurrency: 1,
      timeoutMs: 10_000,
      selectedEvalIds: ["a", "b"],
      experimentId: "teardown-barrier-exp",
    };

    const runPromise = run([evalA, evalB], [agentRun], { maxConcurrency: 4 });

    // a 的 sandbox.teardown 钩子挂在 barrier 上:runSem 名额要到沙箱销毁完成才归还,
    // 所以 b 的沙箱这段时间不该被创建。
    await vi.waitFor(() => expect(teardownEntered).toBe(true));
    expect(sandboxCreates).toBe(1);

    releaseTeardown();
    const { summary } = await runPromise;
    expect(summary.results).toHaveLength(2);
    expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
    expect(sandboxCreates).toBe(2); // teardown 放行、a 收尾完成后 b 的沙箱才创建
  });
});

// 护住 A1 修复不被顺手改坏:退避期间真正让出的是全局并发位,不是「两个都不放」。全局并发 2、
// 两个互不相关的实验(都没有声明各自的 maxConcurrency,单纯受全局位约束)——R 与 W 各占一个
// 初始名额,W 的第二个 attempt 排队;R 撞到可重试错误进入退避、释放全局位后,排队中的
// W 第二个 attempt 应立刻拿到这个位开跑,不需要等 R 的退避结束。
// bug: memory/turn-retry-backoff-releases-experiment-serial-lock.md
describe("runEvals · 全局并发位在退避期间确实让给别的实验", () => {
  it("全局并发 2:一个实验的 attempt 退避释放全局位后,另一个无关实验排队中的 attempt 立刻拿到位开跑", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.9);
    try {
      // r1 的第一次 send 卡在 rBarrier 上不立刻失败——这样可以先确认 r1、w1 都已经稳稳占住
      // 两个初始全局位(而不是在一次 vi.waitFor 里赛跑:release→w2 抢位这条链路全是微任务,
      // 没有真实/虚拟延时,跑得比逐条断言还快,会把「w2 还没拿到位」这个中间态直接跳过)。
      let rSendCalls = 0;
      let releaseR!: () => void;
      const rBarrier = new Promise<void>((resolve) => {
        releaseR = resolve;
      });
      const agentR = defineSandboxAgent({
        name: "agent-guard-r",
        send: async () => {
          rSendCalls += 1;
          if (rSendCalls === 1) {
            await rBarrier;
            return retryableFailureTurn("rate limited, please retry later");
          }
          return okTurn();
        },
      });

      let wSendCalls = 0;
      let releaseW!: () => void;
      const wBarrier = new Promise<void>((resolve) => {
        releaseW = resolve;
      });
      const agentW = defineSandboxAgent({
        name: "agent-guard-w",
        send: async () => {
          wSendCalls += 1;
          await wBarrier; // w1、w2 都卡在这里:两者都不会「自己跑完腾位置」,腾位置只能来自 r1 退避
          return okTurn();
        },
      });

      const evalR = makeEval("r1", async (t) => {
        await t.send("go");
      });
      const evalW1 = makeEval("w1", async (t) => {
        await t.send("go");
      });
      const evalW2 = makeEval("w2", async (t) => {
        await t.send("go");
      });

      const runR: AgentRun = {
        agent: agentR,
        flags: {},
        attempts: 1,
        earlyExit: false,
        sandbox: fakeSandboxSpec(),
        timeoutMs: 30_000,
        selectedEvalIds: ["r1"],
        experimentId: "guard-r",
      };
      const runW: AgentRun = {
        agent: agentW,
        flags: {},
        attempts: 1,
        earlyExit: false,
        sandbox: fakeSandboxSpec(),
        timeoutMs: 30_000,
        selectedEvalIds: ["w1", "w2"],
        experimentId: "guard-w",
      };

      const runPromise = run([evalR, evalW1, evalW2], [runR, runW], { maxConcurrency: 2 });

      // 初始两个全局位分别被 r1、w1 占住(两者的 send 都已调用、各自卡在自己的 barrier 上);
      // w2 应该还排着队,拿不到位。
      await vi.waitFor(() => expect(rSendCalls).toBe(1));
      await vi.waitFor(() => expect(wSendCalls).toBe(1));
      expect(wSendCalls).toBe(1); // w2 还没拿到全局位

      // 放行 r1 的第一次 send:返回可重试失败,触发退避 —— 这一步才会真正释放全局位。
      releaseR();
      await vi.waitFor(() => expect(wSendCalls).toBe(2)); // 排队中的 w2 应该立刻拿到这个位
      expect(rSendCalls).toBe(1); // 此刻 r1 仍在退避睡眠中,还没有发起第二次 send(重试)

      releaseW(); // 放行 w1、w2,推进计时器让 r1 重试成功,run 完整收尾
      // 只推进到刚好越过退避延迟,不用 runAllTimersAsync——它会连每个 attempt 30s 外层超时的
      // AbortSignal.timeout 都一并触发。
      await vi.advanceTimersByTimeAsync(10_000);
      const { summary } = await runPromise;
      expect(summary.results).toHaveLength(3);
      expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
    } finally {
      vi.useRealTimers();
      randomSpy.mockRestore();
    }
  });
});

// ═══════════════════════ 用例锁与并发 Invocation ═══════════════════════
// 契约:docs/feature/experiments/architecture.md「并发 Invocation:用例锁」
// 裁决出处:memory/case-lock-wait-not-skip-ruling.md(撞锁等待而非跳过、粒度是单条用例)
// 覆盖规范:docs/engineering/testing/unit/experiments-runner.md「用例锁与并发 Invocation」
//
// 这里只覆盖 run.ts 对 lock.ts 的调度层接线:取锁时机(携带规划之后、preflight/实验级
// setup 之前)、等待语义(不占位、elsewhere 计数)、释放后重查携带(carried/dispatched/
// 部分携入)、执行模式组合(--force)、释放路径(即使合成 errored 结果也要放锁)。心跳续租 /
// 过期判据 / 接管 rename 互斥等锁原语自身的机制由 lock.test.ts 覆盖,不在这里重复。

function caseLockPath(root: string, experimentId: string, evalId: string): string {
  // 必须与 lock.ts 私有的 caseLockEntryId 用完全相同的方式构造,否则读写的不是同一个文件。
  const id = slugHashEntryId(`${experimentId}-${evalId}`, [experimentId, evalId]);
  return join(locksDirOf(root), `${id}.json`);
}

/** 直接写一条锁记录,绕开 acquireCaseLock —— 模拟"另一个进程持有/曾经持有这把锁";心跳
 *  完全由测试摆布,不会被本进程续租,陈旧与否只取决于种下的 heartbeatAt,不依赖真实时间流逝。 */
async function seedCaseLock(root: string, record: CaseLockRecord): Promise<void> {
  const dir = locksDirOf(root);
  await mkdir(dir, { recursive: true });
  await writeFile(caseLockPath(root, record.experimentId, record.evalId), JSON.stringify(record, null, 2), "utf-8");
}

function freshLockRecord(experimentId: string, evalId: string, overrides: Partial<CaseLockRecord> = {}): CaseLockRecord {
  const now = new Date().toISOString();
  return { experimentId, evalId, pid: 999_111, host: "other-host", startedAt: now, heartbeatAt: now, ...overrides };
}

function staleLockRecord(experimentId: string, evalId: string, overrides: Partial<CaseLockRecord> = {}): CaseLockRecord {
  // 落后 CASE_LOCK_STALE_MS(30_000ms)以上 —— 稳稳越过判死边界(严格 `>`,不是 `>=`)。
  const staleHeartbeat = new Date(Date.now() - 40_000).toISOString();
  return { experimentId, evalId, pid: 999_222, host: "dead-host", startedAt: staleHeartbeat, heartbeatAt: staleHeartbeat, ...overrides };
}

/** 共享的 run() helper 不透传 priorResults;用例锁"释放后重查携带"分支专门按
 *  RunOptions.priorResults 是否为 undefined 分支(force 模式整段跳过重查,见 cli.ts 的
 *  `flags.force ? undefined : ...`),需要直接控场,故另建一个不影响其它测试的 helper。 */
async function runWithPriorResults(
  evals: DiscoveredEval[],
  agentRuns: AgentRun[],
  opts: {
    priorResults?: EvalResult[];
    root?: string;
    signal?: AbortSignal;
    maxConcurrency?: number;
    carryIgnoringFlags?: string[];
  } = {},
): Promise<{ summary: InvocationSummary; root: string }> {
  const root = opts.root ?? (await makeRoot());
  const config: Config = {};
  const runOpts: RunOptions = {
    config,
    evals,
    agentRuns,
    reporters: [{ reporter: Artifacts(root), name: "artifacts", required: false }],
    maxConcurrency: opts.maxConcurrency ?? 3,
    niceevalRoot: root,
    ...(opts.priorResults !== undefined ? { priorResults: opts.priorResults } : {}),
    ...(opts.carryIgnoringFlags !== undefined ? { carryIgnoringFlags: opts.carryIgnoringFlags } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  const summary = await runEvals(runOpts);
  return { summary, root };
}

async function lockFilesRemaining(root: string): Promise<string[]> {
  try {
    return await readdir(locksDirOf(root));
  } catch {
    return [];
  }
}

/** 锁目录里此刻被哪几条用例持有(条目文件名映回 evalId,按 `candidates` 的给定顺序返回)。
 *  多开场景的分段点是「对方已经放手」,而这件事只在磁盘上可观测:对方的 attempt 跑完(探针
 *  记到 started / inFlight 归零)只说明 test() 返回了,锁要到该用例全部 attempt 收尾之后才删。 */
async function lockedEvalIds(root: string, experimentId: string, candidates: string[]): Promise<string[]> {
  const files = new Set(await lockFilesRemaining(root));
  return candidates.filter((id) => files.has(basename(caseLockPath(root, experimentId, id))));
}

/** 等一个要读磁盘的判据在假时钟上成立。推法与 `advanceOnFakeClock` 的收尾段相同(只喂真实
 *  轮次、每轮顺手推 1ms 假时钟接住收尾链上的短定时器),但把虚拟时间的消耗压到最低:等待
 *  期间本进程自己也持着锁,推过 30s 判死线会被对方当成过期锁接管,场景就变了。 */
async function awaitDiskOnFakeClock(isDone: () => Promise<boolean>, budgetRealMs = 20_000): Promise<void> {
  const until = realDateNow() + budgetRealMs;
  while (realDateNow() < until) {
    if (await isDone()) return;
    await vi.advanceTimersByTimeAsync(1);
    await new Promise<void>((resolve) => realSetTimeout(resolve, 5));
  }
}

/** 模块装载期抓住的真实 setTimeout / Date.now:`vi.useFakeTimers()` 换掉的是全局绑定,
 *  这两个函数引用仍指向原生实现,假时钟场景里用它们换真实的宏任务轮次与真实墙钟。 */
const realSetTimeout = globalThis.setTimeout;
const realDateNow = Date.now;

/** 把真实事件循环喂到 `isDone()` 成立或真实墙钟预算用完为止。 */
async function realTicksFor(isDone: () => boolean, budgetMs: number): Promise<void> {
  const until = realDateNow() + budgetMs;
  while (!isDone() && realDateNow() < until) {
    await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
  }
}

/**
 * 假时钟上跨过一段等待窗口(用例锁的 30s 判死线、锁与租约的 10s 轮询周期)的唯一可靠姿势。
 *
 * 两条都要满足,少一条就 flaky:
 * - **分步推,不一步推到底**:轮询链路每一轮都在"定时器回调恢复"和"注册下一轮定时器"之间
 *   插了真实磁盘 I/O(`readEntryFile` / `claimEntryFile` / `createLockFileExclusive`)。
 *   `advanceTimersByTimeAsync` 只推进*当前已挂起*的定时器,一次推过整个 30s 窗口会在"看不到
 *   待处理定时器"的那一刻直接返回,把稍后才补挂上的定时器永远晾着(测试挂到超时,不是变慢)。
 * - **每步之间按真实墙钟让出宏任务轮次**:`advanceTimersByTimeAsync` 只喂微任务,真实磁盘
 *   I/O 拿不到轮次就会被饿死。让出的量必须按真实墙钟算而不是固定圈数——并行跑整个测试套件
 *   时 I/O 慢一个量级,固定圈数在本机够、在负载下必然不够(本条就是这么被抓出来的)。
 *
 * 踩坑同源:memory/case-lock-gate-reorders-global-semaphore-queue.md「旁支」。
 */
async function advanceOnFakeClock(
  isDone: () => boolean,
  stepMs = 10_000,
  maxSteps = 8,
  perStepRealMs = 300,
  tailRealMs = 15_000,
): Promise<void> {
  for (let i = 0; i < maxSteps && !isDone(); i++) {
    await vi.advanceTimersByTimeAsync(stepMs);
    await realTicksFor(isDone, perStepRealMs);
  }
  // 要跨的虚拟窗口到这里都跨过了,剩下的是纯真实 I/O 的收尾进度(取锁、跑 attempt、落盘、
  // 放锁)。只喂真实轮次,每轮顺手推 1ms 假时钟接住收尾链上可能挂的短定时器——步长必须小,
  // 否则慢机器上轮数一多会把 attempt 的外层超时也推过去。
  const until = realDateNow() + tailRealMs;
  while (!isDone() && realDateNow() < until) {
    await vi.advanceTimersByTimeAsync(1);
    await realTicksFor(isDone, 20);
  }
}

describe("runEvals · 用例锁: 取锁时机", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  it("全部 attempt 都可携带的用例不取锁,不真的派发", async () => {
    const experimentId = "lock-timing-full-carry-exp";
    const evalId = "carried-eval";
    const evalDef = makeEval(evalId, () => {
      throw new Error("carried attempt must not be dispatched");
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-lock-timing-carry"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };
    // 指纹依赖 evalDef.sourcePath 的文件内容(makeEval 统一指向本测试文件)与 run 的配置字段,
    // 不依赖 test() 闭包本身 —— 用真实的 computeFingerprint 算,而不是随便编一个字符串,
    // 才能真的驱动到"指纹匹配"这条携带路径。
    const fingerprint = await computeFingerprint(evalDef, agentRun);
    const prior: EvalResult = {
      id: evalId,
      experimentId,
      agent: agentRun.agent.name,
      verdict: "passed",
      attempt: 0,
      fingerprint,
      startedAt: new Date().toISOString(),
      durationMs: 1,
      assertions: [],
    };

    const { summary, root } = await runWithPriorResults([evalDef], [agentRun], { priorResults: [prior] });

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]!.verdict).toBe("passed");
    // 被静态携带规划筛掉的 (experimentId, evalId) 组合从不出现在 attempts[] 里,天然不会
    // 走到取锁那一步 —— 磁盘上不该留下任何锁文件。
    expect(await lockFilesRemaining(root)).toEqual([]);
  });

  it("携带条目合入本次快照时指纹按本次规划重新打戳,不背着产出它那一轮的旧指纹", async () => {
    const evalId = "carry-restamp-eval";
    const experimentId = "carry-restamp-exp";
    const evalDef = makeEval(evalId, async () => {
      throw new Error("carried attempt must not be dispatched");
    });
    const base = {
      agent: makeAgent("agent-carry-restamp"),
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };
    // 上一轮的 endpoint 已从本轮 flags 移走;调用方显式声明本次携带忽略该旧 flag,
    // 而它落盘的指纹是**整袋 flags**(含旧 endpoint)算的,与本轮规划的那个不相等。
    const oldFlags = { endpoint: "https://old.example" };
    const agentRun: AgentRun = { ...base, flags: {} };
    const oldFingerprint = await computeFingerprint(evalDef, { ...base, flags: oldFlags });
    const plannedFingerprint = await computeFingerprint(evalDef, agentRun);
    expect(oldFingerprint).not.toBe(plannedFingerprint);

    const prior: EvalResult = {
      id: evalId,
      experimentId,
      agent: agentRun.agent.name,
      verdict: "passed",
      attempt: 0,
      fingerprint: oldFingerprint,
      experiment: { flags: oldFlags, attempts: 1, earlyExit: false, selectedEvalIds: [evalId] },
      startedAt: new Date().toISOString(),
      durationMs: 1,
      assertions: [],
    };

    const { summary } = await runWithPriorResults([evalDef], [agentRun], {
      priorResults: [prior],
      carryIgnoringFlags: ["endpoint"],
    });

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]!.verdict).toBe("passed");
    expect(summary.results[0]!.fingerprint).toBe(plannedFingerprint);
  });

  it("等锁用例不触发实验级 setup:等待期间 setup 计数保持 0,接管后才恰好执行一次", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const experimentId = "lock-timing-setup-exp";
      const evalId = "setup-gated-eval";
      await seedCaseLock(root, freshLockRecord(experimentId, evalId));

      let setupCalls = 0;
      let testCalls = 0;
      const evalDef = makeEval(evalId, () => {
        testCalls += 1;
      });
      const agentRun: AgentRun = {
        agent: makeAgent("agent-lock-timing-setup"),
        flags: {},
        attempts: 1,
        earlyExit: false,
        sandbox: fakeSandboxSpec(),
        timeoutMs: 30_000,
        selectedEvalIds: [evalId],
        experimentId,
        setup: () => {
          setupCalls += 1;
        },
      };

      const runPromise = runWithPriorResults([evalDef], [agentRun], { priorResults: [], root });

      // 等到轮询真的挂起下一次心跳定时器(真实磁盘 I/O 已经跑过一轮),此刻还远没到 30s
      // 判死线:setup 不该被触发,eval 也不该被派发。
      await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1));
      expect(setupCalls).toBe(0);
      expect(testCalls).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000); // 再推一个心跳周期,仍然远短于判死线
      await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1));
      expect(setupCalls).toBe(0);

      // 继续推过判死线,接管发生 —— setup 此刻才第一次执行。
      await advanceOnFakeClock(() => setupCalls === 1);
      expect(setupCalls).toBe(1);

      const { summary } = await runPromise;
      expect(summary.results).toHaveLength(1);
      expect(summary.results[0]!.verdict).toBe("passed");
      expect(setupCalls).toBe(1);
      expect(testCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runEvals · 用例锁: 等待语义", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  it("撞新鲜锁的用例不派发、不占全局并发位;elsewhere/queued 五项恒等式成立;过期后接管并真实派发(无匹配可携带)", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const experimentId = "lock-wait-exp";
      const evalIdLocked = "locked-eval";
      const evalIdFree = "free-eval";
      await seedCaseLock(root, freshLockRecord(experimentId, evalIdLocked));

      let lockedCalls = 0;
      let freeCalls = 0;
      const evalLocked = makeEval(evalIdLocked, () => {
        lockedCalls += 1;
      });
      const evalFree = makeEval(evalIdFree, () => {
        freeCalls += 1;
      });
      const agentRun: AgentRun = {
        agent: makeAgent("agent-lock-wait"),
        flags: {},
        attempts: 1,
        earlyExit: false,
        sandbox: fakeSandboxSpec(),
        timeoutMs: 30_000,
        selectedEvalIds: [evalIdLocked, evalIdFree],
        experimentId,
      };
      const plan: RunFeedbackPlan = {
        shape: { evals: 2, configs: 1, totalAttempts: 2, maxConcurrency: 1 },
        reused: 0,
        reusedFailures: [],
      };

      await withCoordinator(plan, async (coordinator) => {
        // maxConcurrency: 1(全局唯一名额)——只有在名额紧张到只有一个的情况下,free-eval
        // 仍能跑完,才证明 locked-eval 的等待确实没有占着这个唯一的全局位;宽松并发会掩盖这一点。
        const runPromise = runWithPriorResults([evalLocked, evalFree], [agentRun], {
          priorResults: [],
          root,
          maxConcurrency: 1,
        });

        await vi.waitFor(() => expect(freeCalls).toBe(1));
        expect(lockedCalls).toBe(0); // 撞锁的用例仍未派发
        expect(coordinator.state.lockWaits.get(experimentId)?.waiting.has(evalIdLocked)).toBe(true);
        expect(coordinator.state.elsewhere).toBeGreaterThanOrEqual(1);
        const mid = coordinator.state;
        expectCountIdentity(mid);

        // 推过 30s 判死线:种下的心跳没有任何进程真的在续租,过期后必须被接管。
        // 分步推 + 每步让出真实事件循环,理由见 advanceOnFakeClock 注释。
        await advanceOnFakeClock(() => lockedCalls === 1);
        expect(lockedCalls).toBe(1); // 确认真的走到了"接管后派发",不是轮询步数耗尽仍未接管

        const { summary } = await runPromise;
        expect(summary.results).toHaveLength(2);
        expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
        expect(coordinator.state.elsewhere).toBe(0);
        expect(await lockFilesRemaining(root)).toEqual([]);
        expect(
          coordinator.state.diagnostics.some((d) => d.key === `lock-taken-over:${experimentId}|${evalIdLocked}`),
        ).toBe(true);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runEvals · 用例锁: 释放后续接", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  it("指纹匹配携入(carried):产出方落盘终态后来不及释放锁就死掉,续接方接管后直接携入、不重新派发", async () => {
    const root = await makeRoot();
    const experimentId = "lock-release-carry-exp";
    const evalId = "carry-release-eval";
    const producerRun: AgentRun = {
      agent: makeAgent("agent-lock-release-carry"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };
    const producerEval = makeEval(evalId, () => {});
    // 用真实 run() 走一遍完整调度,把一条正确 fingerprint 的终态结果落到 root 上 ——
    // 比手工拼 EvalResult 更省事也更可信(fingerprint / artifactBase 这些字段很容易拼错)。
    const { summary: producerSummary } = await run([producerEval], [producerRun], { root });
    expect(producerSummary.results[0]!.verdict).toBe("passed");

    // 模拟"产出方刚写完结果、还没来得及释放锁就被强杀":种一把过期锁,而不是等它自然释放。
    await seedCaseLock(root, staleLockRecord(experimentId, evalId));

    const subjectEval = makeEval(evalId, () => {
      throw new Error("carried attempt must not be redispatched");
    });
    const plan: RunFeedbackPlan = {
      shape: { evals: 1, configs: 1, totalAttempts: 1, maxConcurrency: 3 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary } = await runWithPriorResults([subjectEval], [producerRun], {
        priorResults: [],
        root,
      });

      expect(summary.results).toHaveLength(1);
      expect(summary.results[0]!.verdict).toBe("passed");
      expect(coordinator.state.reused).toBe(1);
      expect(coordinator.state.elsewhere).toBe(0);
      expect(await lockFilesRemaining(root)).toEqual([]);
    });
  });

  it("不匹配转自跑(dispatched):磁盘上没有任何终态结果时,接管过期锁后真实派发", async () => {
    const root = await makeRoot();
    const experimentId = "lock-release-dispatch-exp";
    const evalId = "dispatch-release-eval";
    await seedCaseLock(root, staleLockRecord(experimentId, evalId));

    let calls = 0;
    const evalDef = makeEval(evalId, () => {
      calls += 1;
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-lock-release-dispatch"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };

    const { summary } = await runWithPriorResults([evalDef], [agentRun], { priorResults: [], root });

    expect(calls).toBe(1);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]!.verdict).toBe("passed");
    expect(await lockFilesRemaining(root)).toEqual([]);
  });

  it("runs 部分携入部分补跑:已有 1 条终态时,续接方 attempts: 2 只补差额序号,不重跑已携入的序号", async () => {
    const root = await makeRoot();
    const experimentId = "lock-release-partial-exp";
    const evalId = "partial-release-eval";
    const producerRun: AgentRun = {
      agent: makeAgent("agent-lock-release-partial"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };
    const producerEval = makeEval(evalId, () => {});
    const { summary: producerSummary } = await run([producerEval], [producerRun], { root });
    expect(producerSummary.results[0]!.verdict).toBe("passed");

    await seedCaseLock(root, staleLockRecord(experimentId, evalId));

    let calls = 0;
    const subjectEval = makeEval(evalId, () => {
      calls += 1;
    });
    // earlyExit: false —— 携入的 passed 会预置进 passedKeys(见 run.ts 对 lateCarriedResults
    // 的处理),开着 earlyExit 会让差额序号也被当成"已知会通过"提前省略,测不出"差额真的被
    // 重新派发"这件事本身。
    const subjectRun: AgentRun = { ...producerRun, attempts: 2, earlyExit: false };

    const { summary } = await runWithPriorResults([subjectEval], [subjectRun], { priorResults: [], root });

    expect(calls).toBe(1); // 只有差额(序号 1)真的跑了一次,序号 0 被携入、没有重跑
    const results = summary.results.filter((r) => r.id === evalId);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.verdict === "passed")).toBe(true);
    expect(results.map((r) => r.attempt).sort()).toEqual([0, 1]);
  });
});

describe("runEvals · 用例锁: 执行模式组合", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  it("--force(RunOptions.priorResults 为 undefined)下,等待/接管后不消费携带 —— 即使指纹匹配的终态结果确实存在,也全部自跑", async () => {
    const root = await makeRoot();
    const experimentId = "lock-force-exp";
    const evalId = "force-eval";
    const producerRun: AgentRun = {
      agent: makeAgent("agent-lock-force"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };
    const producerEval = makeEval(evalId, () => {});
    const { summary: producerSummary } = await run([producerEval], [producerRun], { root });
    expect(producerSummary.results[0]!.verdict).toBe("passed");

    await seedCaseLock(root, staleLockRecord(experimentId, evalId));

    let calls = 0;
    const subjectEval = makeEval(evalId, () => {
      calls += 1;
    });

    // force 模式:cli.ts 在 --force 时整段不传 priorResults(不是传空数组) —— 这里同样
    // 省略 priorResults 字段,而不是传 []。
    const { summary } = await runWithPriorResults([subjectEval], [producerRun], { root });

    expect(calls).toBe(1); // 真正重新派发了一次,不是悄悄吞成携入的旧结果
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]!.verdict).toBe("passed");
    expect(await lockFilesRemaining(root)).toEqual([]);
  });
});

describe("runEvals · 用例锁: 释放路径", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  it("实验级 setup 抛错、全部 attempt 合成 errored 结果时,锁仍必须被释放", async () => {
    const experimentId = "lock-setup-fail-exp";
    const evalId = "setup-fail-eval";
    const evalDef = makeEval(evalId, () => {});
    const agentRun: AgentRun = {
      agent: makeAgent("agent-lock-setup-fail"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxSpec(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
      setup: () => {
        throw new Error("tunnel refused to start");
      },
    };

    // 无竞争的全新取锁(没有种任何锁),证明即便本实验一个 attempt 都没有真正派发过 agent
    // (body 走的是合成 errored 的分支),外层 Effect.ensuring 挂的用例锁释放仍然会触发。
    const { summary, root } = await runWithPriorResults([evalDef], [agentRun], {});

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]!.verdict).toBe("errored");
    expect(summary.results[0]!.error?.code).toBe("experiment-setup-failed");
    expect(await lockFilesRemaining(root)).toEqual([]);
  });
});

// ─────────────────── 派发探针:「在飞峰值」与「启动集合」的统一观察面 ───────────────────
// 覆盖规范对用例锁调度的断言面是可观察的调度事实(锁目录条目数、在飞峰值、启动集合),
// 不是内部信号量的调用次数。下面这组用例统一用「eval 的 test() 里登记自己被真实派发、
// 然后挂在 barrier 上」取样:barrier 没释放前,「此刻在飞几条」「谁被派发过」在任何时刻
// 都可读,且被派发两次的用例会在 started 里出现两次(双跑当场可见)。

interface DispatchProbe {
  /** 真实执行过 test() 的 evalId,按进入顺序;同一个 id 出现两次 = 这条用例被双跑了。 */
  started: string[];
  inFlight: number;
  peak: number;
}

function newDispatchProbe(): DispatchProbe {
  return { started: [], inFlight: 0, peak: 0 };
}

/** 一条挂在 `barrier` 上的 eval:进入 test() 即计入 `probes` 里的每个探针(多开场景要同时
 *  记进「本侧」与「全局」两个探针),barrier 释放后立刻返回。 */
function gatedEval(id: string, barrier: Promise<void>, ...probes: DispatchProbe[]): DiscoveredEval {
  return makeEval(id, async () => {
    for (const p of probes) {
      p.started.push(id);
      p.inFlight += 1;
      p.peak = Math.max(p.peak, p.inFlight);
    }
    await barrier;
    for (const p of probes) p.inFlight -= 1;
  });
}

function makeBarrier(): { barrier: Promise<void>; release: () => void } {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { barrier, release };
}

/** 派发探针场景统一用的 AgentRun 骨架:timeoutMs 开得远大于测试里推进的假时钟总量,
 *  免得「推过锁的 30s 判死线」顺带把在飞 attempt 推成外层超时。 */
function probeRun(
  agent: Agent,
  experimentId: string,
  selectedEvalIds: string[],
  extra: Partial<AgentRun> = {},
): AgentRun {
  return {
    agent,
    flags: {},
    attempts: 1,
    earlyExit: false,
    sandbox: fakeSandboxSpec(),
    timeoutMs: 600_000,
    selectedEvalIds,
    experimentId,
    ...extra,
  };
}

/** 等一个只靠真实事件循环就会成立的条件(不需要推假时钟:撞锁挂起、attempt 起跑这些都发生
 *  在当下)。`vi.waitFor` 只让出真实轮次、**不推假时钟** —— 需要跨虚拟等待窗口的地方一律用
 *  `advanceOnFakeClock`。真实超时放宽到 30s:并行跑整个测试套件时默认 1s 不够。 */
async function waitForRealProgress(check: () => void): Promise<void> {
  await vi.waitFor(check, { timeout: 30_000, interval: 20 });
}

/** 这组调度用例的 vitest 超时:要么在假时钟上跨 30s 锁判死线 / 10s 租约轮询周期(靠真实
 *  轮次驱动),要么等两条 runEvals 真的并行推进;并行跑整个测试套件时真实墙钟开销远大于默认 5s。 */
const SCHEDULING_TEST_TIMEOUT_MS = 60_000;

describe("runEvals · 用例锁: 排队用例不持锁", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  it("四条用例、全局并发 2:锁目录条目数等于在跑用例数(排队的两条不持锁),收尾后清空", async () => {
    const root = await makeRoot();
    const experimentId = "lock-queue-exp";
    const ids = ["q-a", "q-b", "q-c", "q-d"];
    const { barrier, release } = makeBarrier();
    const probe = newDispatchProbe();
    const evals = ids.map((id) => gatedEval(id, barrier, probe));
    const agentRun = probeRun(makeAgent("agent-lock-queue"), experimentId, ids);

    const runPromise = runWithPriorResults(evals, [agentRun], { priorResults: [], root, maxConcurrency: 2 });
    try {
      await waitForRealProgress(() => expect(probe.inFlight).toBe(2));

      // 关键断言:计划里有 4 条,此刻只有 2 条在跑 —— 锁目录也只有 2 条。取锁发生在派发时刻,
      // 排队中的两条还没摸过锁目录(旧的「计划期一次性全量取锁」在这里会是 4)。
      expect(await lockFilesRemaining(root)).toHaveLength(2);
      expect(probe.started).toHaveLength(2);
    } finally {
      release();
    }

    const { summary } = await runPromise;
    expect(summary.results).toHaveLength(4);
    expect([...probe.started].sort()).toEqual([...ids].sort());
    expect(await lockFilesRemaining(root)).toEqual([]);
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 用例锁: 撞锁转派", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  it("撞新鲜锁的用例让出全局位,位子转派给下一条没被锁的用例:在飞峰值仍等于全局上限,启动集合是未被锁的那些", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const experimentId = "lock-handoff-exp";
      const lockedId = "h-locked";
      const freeIds = ["h-free-1", "h-free-2"];
      // 被锁的那条排在数组第一位:它一定会先摸到全局位,证明「转派」不是靠运气排在后面。
      await seedCaseLock(root, freshLockRecord(experimentId, lockedId));

      const { barrier, release } = makeBarrier();
      const probe = newDispatchProbe();
      const evals = [lockedId, ...freeIds].map((id) => gatedEval(id, barrier, probe));
      const agentRun = probeRun(makeAgent("agent-lock-handoff"), experimentId, [lockedId, ...freeIds]);

      let done = false;
      const runPromise = runWithPriorResults(evals, [agentRun], {
        priorResults: [],
        root,
        maxConcurrency: 2,
      }).then((r) => {
        done = true;
        return r;
      });
      try {
        await waitForRealProgress(() => expect(probe.inFlight).toBe(2));

        // 峰值没有因为一条撞锁就塌成 1:让出来的位子当场被下一条没被锁的用例接手。
        expect(probe.peak).toBe(2);
        expect([...probe.started].sort()).toEqual([...freeIds].sort());
        expect(probe.started).not.toContain(lockedId);
      } finally {
        release();
      }

      // 种下的心跳没人续租,推过 30s 判死线后被接管,这条用例照常补跑。
      await advanceOnFakeClock(() => done, 10_000, 12);
      expect(probe.started).toContain(lockedId);

      const { summary } = await runPromise;
      expect(summary.results).toHaveLength(3);
      expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
      expect(await lockFilesRemaining(root)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 用例锁: 多开分工", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  // 两条 runEvals 共用同一个 niceevalRoot(不是各自建一个临时根 —— 那测的是"零竞争各自跑"),
  // 选择集完全相同:四条用例两边都选,各自全局上限 2,于是两边都必然剩下"第一波没抢到位"的
  // 第二波。谁跑哪些完全由锁自然分工,不靠测试摆布。
  //
  // 两段 barrier 是这条用例的关键:B 的第一波必须先真正收尾、把锁删掉,A 的第二波才会撞上
  // 一把**空**锁 —— 那正是要钉的路径(取到锁没等过、没接管过,重查携带仍必须发生)。锁的删除
  // 发生在该用例全部 attempt 收尾之后,所以分段点只能取"锁目录掉回只剩 A 手上的那两条",不能
  // 取"B 的 test() 跑过了":放早了 A 的第二波撞的是新鲜锁、走挂起窗口,而挂起窗口本来就重查,
  // 这条用例会绿得毫无意义(见 memory/multi-open-residual-window-closed-by-narrow-read.md)。
  //
  // 顺带钉住「携带来源不要求快照收尾」:A 的第二波携入 B 的结果时,B 整批还没跑完(它的两条
  // 正挂在 A 的锁上等),快照 run.json 尚无 completedAt。
  it("两条 runEvals 同 root、选择集完全相同:真实派发的用例集不相交、并集覆盖选择集、全局在飞峰值达到两边上限之和,每条用例全局只被真实派发一次", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const experimentId = "multi-open-exp";
      const firstWave = ["m-1", "m-2"];
      const secondWave = ["m-3", "m-4"];
      const ids = [...firstWave, ...secondWave];
      const agent = makeAgent("agent-multi-open");
      const sandbox = fakeSandboxSpec();

      const gateA = makeBarrier();
      const gateB = makeBarrier();
      const all = newDispatchProbe();
      const sideA = newDispatchProbe();
      const sideB = newDispatchProbe();
      const evalsA = ids.map((id) => gatedEval(id, gateA.barrier, sideA, all));
      const evalsB = ids.map((id) => gatedEval(id, gateB.barrier, sideB, all));
      // 指纹只吃 (eval 源码 + experimentId/agent/model/flags/sandbox/strict),不吃 selectedEvalIds
      // 与 runs —— 两侧指纹相同,携入对方跑出来的那半边才可能发生。
      const runA = probeRun(agent, experimentId, ids, { sandbox });
      const runB = probeRun(agent, experimentId, ids, { sandbox });

      let aDone = false;
      let bDone = false;
      const pa = runWithPriorResults(evalsA, [runA], { priorResults: [], root, maxConcurrency: 2 }).then((r) => {
        aDone = true;
        return r;
      });
      await waitForRealProgress(() => expect(sideA.inFlight).toBe(2));

      const pb = runWithPriorResults(evalsB, [runB], { priorResults: [], root, maxConcurrency: 2 }).then((r) => {
        bDone = true;
        return r;
      });
      await waitForRealProgress(() => expect(sideB.inFlight).toBe(2));

      // ① 两边真实派发的用例集不相交;② 并集覆盖选择集;③ 全局在飞峰值 = 2 + 2。
      expect([...sideA.started].sort()).toEqual([...firstWave]);
      expect([...sideB.started].sort()).toEqual([...secondWave]);
      expect(sideA.started.filter((id) => sideB.started.includes(id))).toEqual([]);
      expect(all.peak).toBe(4);
      expect(await lockedEvalIds(root, experimentId, ids)).toEqual(ids);

      // B 的第一波收尾:m-3 / m-4 落盘、锁被删掉,B 剩下的两条仍挂在 A 的锁上等。
      gateB.release();
      await awaitDiskOnFakeClock(async () => (await lockedEvalIds(root, experimentId, ids)).length === 2);
      expect(await lockedEvalIds(root, experimentId, ids)).toEqual(firstWave);

      // A 的第一波收尾 → A 的第二波拿到全局位 → 干干净净地取到 m-3 / m-4 的锁。
      gateA.release();
      await advanceOnFakeClock(() => aDone && bDone, 10_000, 12);
      const [ra, rb] = await Promise.all([pa, pb]);

      // 双跑当场可见:started 不去重(去重恰好会把双跑抹掉),长度必须正好是用例数。
      expect(all.started).toHaveLength(ids.length);
      expect([...all.started].sort()).toEqual([...ids]);
      // 两边到收尾为止都没有再多派发一条:第二波全是携入(排序只为消掉进入 test() 的先后,
      // 那是调度自由度;条数不排序,双跑会当场把长度顶上去)。
      expect([...sideA.started].sort()).toEqual([...firstWave]);
      expect([...sideB.started].sort()).toEqual([...secondWave]);
      // 两边各自结束时都拿到完整结果集,交集部分只花一份成本。
      expect(ra.summary.results).toHaveLength(4);
      expect(rb.summary.results).toHaveLength(4);
      expect(ra.summary.results.every((r) => r.verdict === "passed")).toBe(true);
      expect(rb.summary.results.every((r) => r.verdict === "passed")).toBe(true);
      expect(await lockFilesRemaining(root)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  }, SCHEDULING_TEST_TIMEOUT_MS);

  // 零竞争的最小形态:全程没有任何"碰上别人"的信号——A 起跑时锁目录还不存在,它从没撞过锁、
  // 没接管过、没等过实验闸名额。对方那条 runEvals 整体 await 到返回(跑完 c-2、落盘、删锁)
  // 之后才放 barrier,所以 A 的第二波是干干净净地取到一把空锁。任何「有没有碰上别人」的启发式
  // 在这条路径上都恒假,只有无条件重查才能让 c-2 不被重跑。
  it("对方跑完并释放锁后干净取到锁:仍必须重查携带 —— c-2 全局只被真实派发一次,携入的那条经一对瞬时 lock_wait 迁进 reused", async () => {
    const root = await makeRoot();
    const experimentId = "multi-open-clean-exp";
    const gatedId = "c-1";
    const sharedId = "c-2";
    const agent = makeAgent("agent-multi-open-clean");
    const sandbox = fakeSandboxSpec();
    const { barrier, release } = makeBarrier();
    const all = newDispatchProbe();

    // A:c-1 挂在 barrier 上占住唯一的全局位,c-2 排在队列里(还没摸过锁目录)。
    const evalsA = [gatedEval(gatedId, barrier, all), gatedEval(sharedId, barrier, all)];
    const runA = probeRun(agent, experimentId, [gatedId, sharedId], { sandbox });
    // 对方:只选 c-2,不挂 barrier。
    const evalsB = [gatedEval(sharedId, Promise.resolve(), all)];
    const runB = probeRun(agent, experimentId, [sharedId], { sandbox });

    // 反馈计数是进程级的,两条 runEvals 都报进同一个 coordinator:total 取两边之和(A 的 2 条
    // + 对方的 1 条),五项恒等式必须在这个合计口径上成立。
    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalAttempts: 3, maxConcurrency: 1 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const pa = runWithPriorResults(evalsA, [runA], { priorResults: [], root, maxConcurrency: 1 });
      let peerLocator: string | undefined;
      try {
        await waitForRealProgress(() => expect(all.inFlight).toBe(1));
        expect(all.started).toEqual([gatedId]); // c-2 还排着队,没取过锁

        const { summary: peer } = await runWithPriorResults(evalsB, [runB], {
          priorResults: [],
          root,
          maxConcurrency: 1,
        });
        expect(peer.results).toHaveLength(1);
        expect(peer.results[0]!.verdict).toBe("passed");
        peerLocator = peer.results[0]!.locator;
        expect(await lockFilesRemaining(root)).toHaveLength(1); // 只剩 A 手上的 c-1
      } finally {
        release();
      }

      const { summary } = await pa;

      expect(all.started.filter((id) => id === sharedId)).toHaveLength(1);
      expect(all.started).toEqual([gatedId, sharedId]);
      expect(summary.results).toHaveLength(2);
      expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
      // 携入的是对方那条结果本身(locator 原样透传),不是自己重跑出来的新条目。
      expect(summary.results.find((r) => r.id === sharedId)!.locator).toBe(peerLocator);

      // 没有等待窗口要关,携入的那条仍必须补一对瞬时的 started/resolved 才能从 queued 迁进
      // reused —— 少发这一对,五项恒等式当场破。
      expect(coordinator.state.reused).toBe(1);
      expect(coordinator.state.elsewhere).toBe(0);
      expectCountIdentity(coordinator.state);
      expect(await lockFilesRemaining(root)).toEqual([]);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 用例锁: 干净取锁下的执行模式组合", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  // 与「执行模式组合」那条(等待 / 接管后自跑)的区别只有取锁路径:这里是无条件重查刚接管的
  // 那条干净取锁路径。重查变成无条件之后,`--force` 这道门就是携带与否的唯一判据 —— 漏掉它
  // 就会在多开下把 force 明确要重跑的用例悄悄吞成携入。
  it("--force(RunOptions.priorResults 为 undefined)下干净取到锁:对方刚跑完的那条照常自跑,窗口计数不留悬挂", async () => {
    const root = await makeRoot();
    const experimentId = "force-clean-exp";
    const gatedId = "fc-1";
    const sharedId = "fc-2";
    const agent = makeAgent("agent-force-clean");
    const sandbox = fakeSandboxSpec();
    const { barrier, release } = makeBarrier();
    const all = newDispatchProbe();

    const evalsA = [gatedEval(gatedId, barrier, all), gatedEval(sharedId, barrier, all)];
    const runA = probeRun(agent, experimentId, [gatedId, sharedId], { sandbox });
    const evalsPeer = [gatedEval(sharedId, Promise.resolve(), all)];
    const runPeer = probeRun(agent, experimentId, [sharedId], { sandbox });

    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalAttempts: 3, maxConcurrency: 1 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      // force 模式:cli.ts 在 --force 时整段不传 priorResults(不是传空数组)——这里同样省略。
      const pa = runWithPriorResults(evalsA, [runA], { root, maxConcurrency: 1 });
      try {
        await waitForRealProgress(() => expect(all.inFlight).toBe(1));
        const { summary: peer } = await runWithPriorResults(evalsPeer, [runPeer], {
          priorResults: [],
          root,
          maxConcurrency: 1,
        });
        expect(peer.results[0]!.verdict).toBe("passed");
      } finally {
        release();
      }

      const { summary } = await pa;

      // 对方跑过一次、A 又跑了一次:这里的两次是**预期**,force 关掉的就是缓存。
      expect(all.started.filter((id) => id === sharedId)).toHaveLength(2);
      expect(summary.results).toHaveLength(2);
      expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
      expect(coordinator.state.reused).toBe(0);
      expect(coordinator.state.elsewhere).toBe(0);
      expectCountIdentity(coordinator.state);
      expect(await lockFilesRemaining(root)).toEqual([]);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 实验闸租约跨 runEvals 共享名额", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
    expect(pendingHeldGateLeaseCount()).toBe(0);
  });

  // 两条 runEvals 各自有独立的进程内信号量,唯一共享的东西是同一个 niceevalRoot 下的租约条目
  // ——所以「峰值恒为 1」只可能来自跨 runEvals 的名额域。两边故意选不相交的 eval 子集:用例锁
  // 零交集,限流的只可能是实验闸(这正是 memory/case-lock-dispatch-time-acquire-ruling 里说的
  // 「双终端选不相交子集跑同一个 maxConcurrency: 1 实验,锁零交集,状态照踩」那个洞)。
  it("maxConcurrency: 1 的实验:两条 runEvals 同 root 跑不相交用例,该实验全局在飞峰值恒为 1", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const experimentId = "gate-cross-exp";
      const agent = makeAgent("agent-gate-cross");
      const sandbox = fakeSandboxSpec();
      const idsA = ["g-a1", "g-a2"];
      const idsB = ["g-b1", "g-b2"];

      const all = newDispatchProbe();
      // 不用 barrier:名额是串行的,挂住任何一条都会把整条链堵死。改用一个假时钟上的
      // 让步点——两条 attempt 若真的同时持有名额,它们的让步窗口会重叠,峰值当场记成 2。
      const tickingEval = (id: string): DiscoveredEval =>
        makeEval(id, async () => {
          all.started.push(id);
          all.inFlight += 1;
          all.peak = Math.max(all.peak, all.inFlight);
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
          all.inFlight -= 1;
        });

      const runA = probeRun(agent, experimentId, idsA, { sandbox, maxConcurrency: 1 });
      const runB = probeRun(agent, experimentId, idsB, { sandbox, maxConcurrency: 1 });

      let aDone = false;
      let bDone = false;
      const pa = runWithPriorResults(idsA.map(tickingEval), [runA], {
        priorResults: [],
        root,
        maxConcurrency: 4,
      }).then((r) => {
        aDone = true;
        return r;
      });
      const pb = runWithPriorResults(idsB.map(tickingEval), [runB], {
        priorResults: [],
        root,
        maxConcurrency: 4,
      }).then((r) => {
        bDone = true;
        return r;
      });

      // 名额交接跨 runEvals 走租约轮询(周期 = 心跳周期),必须分步推假时钟。
      await advanceOnFakeClock(() => aDone && bDone, 5_000, 40);
      const [ra, rb] = await Promise.all([pa, pb]);

      expect(all.peak).toBe(1);
      expect([...all.started].sort()).toEqual([...idsA, ...idsB].sort());
      expect(ra.summary.results).toHaveLength(2);
      expect(rb.summary.results).toHaveLength(2);
      expect([...ra.summary.results, ...rb.summary.results].every((r) => r.verdict === "passed")).toBe(true);
      expect(await lockFilesRemaining(root)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  }, SCHEDULING_TEST_TIMEOUT_MS);

  // 撞满名额只可能是别的 Invocation 占着——本进程自己的并发早被进程内信号量挡住了。不报的话
  // 面板只剩 `0 running · N queued` 干等,看不出在等谁,更看不出生效名额被对方更小的声明夹低。
  // 这里让 B 声明 3 却撞上 A 的 declaredN: 1,断言诊断把「生效 1 / 本次声明 3」两个数都说出来。
  it("撞满名额报 gate-lease-waiting:带上生效名额与本次声明,min-N 夹低时两个数都在", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const experimentId = "gate-wait-notice-exp";
      const agent = makeAgent("agent-gate-wait");
      const { barrier, release } = makeBarrier();

      // A 先占住唯一的名额(declaredN: 1)并卡在 barrier 上,B 随后带着 declaredN: 3 进来撞满。
      const runA = probeRun(agent, experimentId, ["w-a"], { maxConcurrency: 1 });
      const runB = probeRun(agent, experimentId, ["w-b"], { maxConcurrency: 3 });
      const probeA = newDispatchProbe();

      const pa = runWithPriorResults([gatedEval("w-a", barrier, probeA)], [runA], {
        priorResults: [],
        root,
        maxConcurrency: 4,
      });
      await advanceOnFakeClock(() => probeA.started.length === 1, 5_000, 40);

      const plan: RunFeedbackPlan = {
        shape: { evals: 1, configs: 1, totalAttempts: 1, maxConcurrency: 4 },
        reused: 0,
        reusedFailures: [],
      };
      const pb = withCoordinator(plan, async (coordinator) => {
        let bDone = false;
        const inner = runWithPriorResults([makeEval("w-b", async () => {})], [runB], {
          priorResults: [],
          root,
          maxConcurrency: 4,
        }).then((r) => {
          bDone = true;
          return r;
        });

        const waited = (): (typeof coordinator.state.diagnostics)[number] | undefined =>
          coordinator.state.diagnostics.find((d) => d.code === "gate-lease-waiting");
        await advanceOnFakeClock(() => waited() !== undefined, 5_000, 40);

        const notice = waited();
        expect(notice?.severity).toBe("warning");
        expect(notice?.data).toMatchObject({ experimentId, effectiveN: 1, declaredN: 3 });
        expect(notice?.message).toContain(experimentId);

        release();
        await advanceOnFakeClock(() => bDone, 20_000, 80);
        return inner;
      });

      await Promise.all([pa, pb]);
      expect(await lockFilesRemaining(root)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 用例锁: runs > 1 的兄弟 attempt 共享同一把锁", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  it("自己已持有的直接放行:attempts: 3 三条 attempt 同时在飞,锁目录仍只有一条(锁是逐用例的,不是逐 attempt)", async () => {
    const root = await makeRoot();
    const experimentId = "lock-sibling-hold-exp";
    const evalId = "sibling-hold-eval";
    const { barrier, release } = makeBarrier();
    const probe = newDispatchProbe();
    const agentRun = probeRun(makeAgent("agent-lock-sibling-hold"), experimentId, [evalId], { attempts: 3 });

    const runPromise = runWithPriorResults([gatedEval(evalId, barrier, probe)], [agentRun], {
      priorResults: [],
      root,
      maxConcurrency: 3,
    });
    try {
      await waitForRealProgress(() => expect(probe.inFlight).toBe(3));
      expect(await lockFilesRemaining(root)).toHaveLength(1);
    } finally {
      release();
    }

    const { summary } = await runPromise;
    expect(summary.results.map((r) => r.attempt).sort()).toEqual([0, 1, 2]);
    expect(await lockFilesRemaining(root)).toEqual([]);
  }, SCHEDULING_TEST_TIMEOUT_MS);

  it("别人持有时整组挂在同一个等待窗口上:只开一条 lock_wait、elsewhere 计为 3 且与 queued 互斥,接管后三条一起派发", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const experimentId = "lock-sibling-wait-exp";
      const evalId = "sibling-wait-eval";
      await seedCaseLock(root, freshLockRecord(experimentId, evalId));

      let calls = 0;
      const evalDef = makeEval(evalId, () => {
        calls += 1;
      });
      const agentRun = probeRun(makeAgent("agent-lock-sibling-wait"), experimentId, [evalId], { attempts: 3 });
      const plan: RunFeedbackPlan = {
        shape: { evals: 1, configs: 1, totalAttempts: 3, maxConcurrency: 3 },
        reused: 0,
        reusedFailures: [],
      };

      await withCoordinator(plan, async (coordinator) => {
        let done = false;
        const runPromise = runWithPriorResults([evalDef], [agentRun], {
          priorResults: [],
          root,
          maxConcurrency: 3,
        }).then((r) => {
          done = true;
          return r;
        });

        await waitForRealProgress(() => expect(coordinator.state.elsewhere).toBe(3));
        // 三条兄弟共享一次试锁与一个等待窗口:等待条目是「一条用例」而不是「三个 attempt」,
        // 但 elsewhere 计的是 attempt 数(五项恒等式的口径)。
        expect(coordinator.state.lockWaits.get(experimentId)?.waiting.size).toBe(1);
        expect(coordinator.state.queued).toBe(0); // elsewhere 与 queued 互斥
        const mid = coordinator.state;
        expectCountIdentity(mid);
        expect(calls).toBe(0);

        await advanceOnFakeClock(() => done, 10_000, 12);
        const { summary } = await runPromise;

        expect(calls).toBe(3);
        expect(summary.results.map((r) => r.attempt).sort()).toEqual([0, 1, 2]);
        expect(coordinator.state.elsewhere).toBe(0);
        const end = coordinator.state;
        expectCountIdentity(end);
        expect(await lockFilesRemaining(root)).toEqual([]);
      });
    } finally {
      vi.useRealTimers();
    }
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 用例锁: 释放后重查携带逐 attempt 判定", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  // 与「用例锁: 释放后续接」那组的区别:那组走的是「撞上过期锁 → 接管」这条路径,重查携带
  // 顺带在取锁里发生;这里走的是真实的挂起窗口(撞新鲜锁 → elsewhere → 持有方正常释放),
  // 断言面是 elsewhere 两个方向的迁移本身:命中的序号迁 reused、没命中的序号迁 queued 自跑。
  // 判定必须逐 attempt(memory/carry-must-be-per-attempt-not-whole-eval-key:按整段 key 判会
  // 让同 eval 里一个序号的终态连带携入其它序号)。
  it("磁盘只有序号 0 的终态时:序号 0 从 elsewhere 迁 reused 不重跑,序号 1 迁 queued 自跑", async () => {
    const root = await makeRoot();
    const experimentId = "lock-recheck-exp";
    const evalId = "recheck-eval";
    const agent = makeAgent("agent-lock-recheck");
    const sandbox = fakeSandboxSpec();

    // 先用一次真实运行落下序号 0 的 passed 终态(指纹由生产路径自己算,不手工拼)。
    const producerRun = probeRun(agent, experimentId, [evalId], { sandbox });
    const { summary: produced } = await run([makeEval(evalId, () => {})], [producerRun], { root });
    expect(produced.results[0]!.verdict).toBe("passed");

    // 另一条 Invocation 此刻正持有这把锁(心跳新鲜:走等待窗口,不是过期接管)。
    await seedCaseLock(root, freshLockRecord(experimentId, evalId));

    vi.useFakeTimers();
    try {
      let calls = 0;
      const subjectEval = makeEval(evalId, () => {
        calls += 1;
      });
      const subjectRun = probeRun(agent, experimentId, [evalId], { sandbox, attempts: 2 });
      const plan: RunFeedbackPlan = {
        shape: { evals: 1, configs: 1, totalAttempts: 2, maxConcurrency: 2 },
        reused: 0,
        reusedFailures: [],
      };

      await withCoordinator(plan, async (coordinator) => {
        let done = false;
        const runPromise = runWithPriorResults([subjectEval], [subjectRun], {
          priorResults: [],
          root,
          maxConcurrency: 2,
        }).then((r) => {
          done = true;
          return r;
        });

        await waitForRealProgress(() => expect(coordinator.state.elsewhere).toBe(2));
        expect(coordinator.state.reused).toBe(0); // 静态携带规划(priorResults 为空)一条都没命中

        // 持有方正常收尾:锁文件消失 —— 等待窗口下一轮轮询就结束,并重新做一次携带规划。
        await rm(caseLockPath(root, experimentId, evalId), { force: true });
        await advanceOnFakeClock(() => done, 10_000, 12);
        const { summary } = await runPromise;

        expect(calls).toBe(1); // 只有缺的序号 1 自跑,序号 0 是携入
        expect(coordinator.state.reused).toBe(1); // elsewhere → reused
        expect(coordinator.state.elsewhere).toBe(0);
        const end = coordinator.state;
        expectCountIdentity(end);
        expect(summary.results.map((r) => r.attempt).sort()).toEqual([0, 1]);
        expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
        expect(await lockFilesRemaining(root)).toEqual([]);
      });
    } finally {
      vi.useRealTimers();
    }
  }, SCHEDULING_TEST_TIMEOUT_MS);

  // 同一条逐 attempt 判定,换到干净取锁这条路径上再验一次:两条路径放走的错误类别不同。挂起
  // 窗口那条错在「迁移数与报进 elsewhere 的条数对不上」;这条错在「补发的那对瞬时 lock_wait
  // 报了整组而不是只报真正携入的那几条」——没携入的兄弟从没离开过 queued,连它们一起报会在
  // 两条事件之间把 queued 扣穿(极端时序下兄弟已进 running,那一扣就是负数)。
  it("干净取锁后只携入对方跑出来的序号 0:序号 1 照常自跑,补发的一对瞬时 lock_wait 只报携入的那一条", async () => {
    const root = await makeRoot();
    const experimentId = "clean-recheck-partial-exp";
    const gatedId = "p-1";
    const sharedId = "p-2";
    const agent = makeAgent("agent-clean-recheck-partial");
    const sandbox = fakeSandboxSpec();
    const { barrier, release } = makeBarrier();
    const all = newDispatchProbe();
    const sideA = newDispatchProbe();

    // A 要两轮;对方只跑了 p-2 的序号 0。
    const evalsA = [gatedEval(gatedId, barrier, sideA, all), gatedEval(sharedId, barrier, sideA, all)];
    const runA = probeRun(agent, experimentId, [gatedId, sharedId], { sandbox, attempts: 2 });
    const evalsPeer = [gatedEval(sharedId, Promise.resolve(), all)];
    const runPeer = probeRun(agent, experimentId, [sharedId], { sandbox });

    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalAttempts: 5, maxConcurrency: 1 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const pa = runWithPriorResults(evalsA, [runA], { priorResults: [], root, maxConcurrency: 1 });
      try {
        await waitForRealProgress(() => expect(all.inFlight).toBe(1));
        expect(sideA.started).toEqual([gatedId]);
        const { summary: peer } = await runWithPriorResults(evalsPeer, [runPeer], {
          priorResults: [],
          root,
          maxConcurrency: 1,
        });
        expect(peer.results.map((r) => r.attempt)).toEqual([0]);
      } finally {
        release();
      }

      const { summary } = await pa;

      // p-1 两轮都自跑;p-2 只补跑缺的那一轮 —— 判定逐 attempt,不按整条用例一刀切。
      expect(sideA.started.filter((id) => id === sharedId)).toHaveLength(1);
      expect(sideA.started.filter((id) => id === gatedId)).toHaveLength(2);
      const shared = summary.results.filter((r) => r.id === sharedId);
      expect(shared.map((r) => r.attempt).sort()).toEqual([0, 1]);
      expect(summary.results).toHaveLength(4);
      expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
      expect(coordinator.state.reused).toBe(1); // 只有序号 0 迁进 reused
      expect(coordinator.state.elsewhere).toBe(0);
      expectCountIdentity(coordinator.state);
      expect(await lockFilesRemaining(root)).toEqual([]);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 用例锁: 取锁后重查携带的读取面", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  // 无条件重查的前提是这次读盘便宜:它压在「已经握着全局并发位 + 实验闸名额 + 用例锁」的关键
  // 路径上,回答的是一个 per-case 的问题(这条用例现在还缺哪些 attempt)。用全根扫描回答它会
  // 随 .niceeval 历史线性变慢且永不收敛,单开也照付——所以读取面的形状本身是契约的一部分:
  // 按用例数各读一次收窄读取面,一次全树扫描都不做(runs 的兄弟共享同一次,不是按 attempt 数)。
  it("三条用例 × runs 2:收窄读取面恰好被调用 3 次(按用例数,不按 attempt 数),全树扫描 0 次", async () => {
    const root = await makeRoot();
    const experimentId = "read-surface-exp";
    const ids = ["r-1", "r-2", "r-3"];
    const sandbox = fakeSandboxSpec();

    // 先落一批历史结果(另一个 agent ⇒ 指纹不同,不会被携入):读取面要在"结果树非空"的前提
    // 下计数,否则测不出"读了什么"与"读了多大一片"的区别。
    const historyRun = probeRun(makeAgent("agent-read-surface-history"), experimentId, ids, { sandbox });
    await run(ids.map((id) => makeEval(id, () => {})), [historyRun], { root });

    let calls = 0;
    const evals = ids.map((id) =>
      makeEval(id, () => {
        calls += 1;
      }),
    );
    const subjectRun = probeRun(makeAgent("agent-read-surface"), experimentId, ids, { sandbox, attempts: 2 });

    readSurfaceCalls.forCase = 0;
    readSurfaceCalls.perEval = 0;
    const { summary } = await runWithPriorResults(evals, [subjectRun], { priorResults: [], root });

    expect(calls).toBe(6); // 3 条用例 × 2 轮,历史结果指纹不同、一条都没被携入
    expect(summary.results).toHaveLength(6);
    expect(readSurfaceCalls.forCase).toBe(ids.length);
    expect(readSurfaceCalls.perEval).toBe(0);
    expect(await lockFilesRemaining(root)).toEqual([]);
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

// ═══════════════════════ 止损闸(空间轴消费) ═══════════════════════
// 覆盖规范:docs/engineering/testing/unit/experiments-runner.md「止损闸(空间轴消费)」
// 契约:docs/feature/error-classification/README.md「止损语义」、architecture.md「止损执行体」
//
// 断言面全部是可观察的调度事实:test() 被真实调用了几次(启动集合)、`summary.results` 有几条、
// 反馈状态的五项计数与诊断、`run.json` 的实验域诊断。闸的内部形态(latch / AbortController /
// 检查点次数)不进断言 —— 覆盖规范「观察面与边界」明确不锁内部信号量与 Promise 图。

/** 两条通路共用的折叠键(run.ts 的 haltGateKey);反馈流按 key 取,持久化侧按 code 过滤。 */
const experimentHaltKey = (experimentId: string): string => `dispatch-halted:experiment:${experimentId}`;
const evalHaltKey = (experimentId: string, evalId: string): string =>
  `dispatch-halted:eval:${experimentId}|${evalId}`;

/** 持久化通路:run.json 里该 Experiment 的 dispatch-halted 诊断(可能一条都没有)。 */
async function snapshotHaltDiagnostics(root: string, experimentId: string): Promise<DiagnosticRecord[]> {
  const results = await openRecord(root);
  const exp = results.experiments.find((e) => e.id === experimentId);
  return (exp?.latestRun.diagnostics ?? []).filter((d) => d.code === "dispatch-halted");
}

/** 八项计数恒等式(docs/feature/experiments/cli.md):任何一帧都必须成立。 */
function expectCountIdentity(state: RunFeedbackState): void {
  expect(state.total).toBe(
    state.reused +
      state.running +
      state.elsewhere +
      state.queued +
      state.passed +
      state.failed +
      state.errored +
      state.unreadable,
  );
}

describe("runEvals · 止损闸: 触发", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  // 触发(experiment 档)+ 记账 + 不连坐三面一次跑完:全局并发 1 让派发严格串行,被 halt 的
  // 实验只可能跑掉第一条;同批另一个实验的用例照常跑完,证明闸是按实验隔离的。
  it("ExperimentFatalError:同实验剩余 attempt 全停、计 unstarted,同批其它实验不连坐;errored 的 error code 不被 scope 改写", async () => {
    const haltedExp = "halt-trigger-exp";
    const bystanderExp = "halt-bystander-exp";
    const startedHalted: string[] = [];
    const startedBystander: string[] = [];
    const haltedEvals = ["a-fatal", "a-2", "a-3"].map((id) =>
      makeEval(id, () => {
        startedHalted.push(id);
        if (id === "a-fatal") throw new ExperimentFatalError("shared tunnel is down; run `make tunnel` and retry");
      }),
    );
    // 同批的对照实验:一条抛普通 Error(证明 error code 与 scope 声明无关,两边同为
    // unexpected-error),另一条照常通过 —— 普通 Error 不落任何闸,这个实验一条都不少跑。
    const bystanderEvals = ["b-plain-throw", "b-ok"].map((id) =>
      makeEval(id, () => {
        startedBystander.push(id);
        if (id === "b-plain-throw") throw new Error("just a normal failure");
      }),
    );
    const haltedRun = probeRun(makeAgent("agent-halt-trigger"), haltedExp, ["a-fatal", "a-2", "a-3"]);
    const bystanderRun = probeRun(makeAgent("agent-halt-bystander"), bystanderExp, ["b-plain-throw", "b-ok"]);
    const plan: RunFeedbackPlan = {
      shape: { evals: 5, configs: 2, totalAttempts: 5, maxConcurrency: 1 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary, root } = await runWithPriorResults([...haltedEvals, ...bystanderEvals], [haltedRun, bystanderRun], {
        priorResults: [],
        maxConcurrency: 1,
      });

      // 触发:撞死的那条照常跑完并落账,同实验剩下两条一次都没进过 test()。
      expect(startedHalted).toEqual(["a-fatal"]);
      // 不连坐:另一个实验的两条全跑了(其中一条自己也 errored,照样不影响同批第三方)。
      expect([...startedBystander].sort()).toEqual(["b-ok", "b-plain-throw"]);

      const halted = summary.results.filter((r) => r.experimentId === haltedExp);
      expect(halted).toHaveLength(1); // 不为没跑过的 attempt 制造 errored 记录
      expect(halted[0]!.verdict).toBe("errored");
      const bystander = summary.results.filter((r) => r.experimentId === bystanderExp);
      expect(bystander).toHaveLength(2);
      // error code 保持所属阶段的原有值:scope 是路由标记,不改写 AttemptError 的公开形状 ——
      // 声明了 scope 的那条与只抛普通 Error 的那条 code/phase 完全一致。
      const plainThrow = bystander.find((r) => r.id === "b-plain-throw")!;
      expect(halted[0]!.error?.code).toBe(plainThrow.error?.code);
      expect(halted[0]!.error?.code).toBe("unexpected-error");
      expect(halted[0]!.error?.phase).toBe(plainThrow.error?.phase);

      // 记账:两条未派发计 unstarted(cli.ts 的 assembleInvocationCompletion 读的就是这条诊断的
      // data.unstarted,unstarted > 0 即完成状态 incomplete),五项计数恒等式收束时仍成立。
      const notice = coordinator.state.diagnostics.find((d) => d.key === experimentHaltKey(haltedExp));
      expect(notice).toBeDefined();
      expect(notice!.severity).toBe("error");
      expect(notice!.data?.unstarted).toBe(2);
      expect(coordinator.state.diagnostics.some((d) => d.key.startsWith("dispatch-halted:eval:"))).toBe(false);
      expectCountIdentity(coordinator.state);
      expect(coordinator.state.queued).toBe(0);
      expect(coordinator.state.elsewhere).toBe(0);

      // 同批其它实验的 run 上不留任何 dispatch-halted。
      expect(await snapshotHaltDiagnostics(root, bystanderExp)).toEqual([]);
      expect(await lockFilesRemaining(root)).toEqual([]);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);

  // 触发(eval 档)+ 诊断双通路:attempts: 3 下只停本 eval 剩余的两个 attempt,同实验另一个 eval 的
  // 三个 attempt 一个不少;两条通路(反馈流通知 / run.json)各自带齐 scope、evalId 与 phase。
  it("EvalFatalError:只停本 eval 剩余 attempt(同实验另一个 eval 的 3 个 attempt 照跑);双通路的 scope/evalId/phase 同源", async () => {
    const experimentId = "halt-eval-scope-exp";
    const message = "fixture corrupted: regenerate data/fixtures";
    let fatalCalls = 0;
    let okCalls = 0;
    const evalFatal = makeEval("f-fatal", () => {
      fatalCalls += 1;
      throw new EvalFatalError(message);
    });
    const evalOk = makeEval("f-ok", () => {
      okCalls += 1;
    });
    const agentRun = probeRun(makeAgent("agent-halt-eval-scope"), experimentId, ["f-fatal", "f-ok"], { attempts: 3 });
    const plan: RunFeedbackPlan = {
      shape: { evals: 2, configs: 1, totalAttempts: 6, maxConcurrency: 1 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary, root } = await runWithPriorResults([evalFatal, evalOk], [agentRun], {
        priorResults: [],
        maxConcurrency: 1,
      });

      expect(fatalCalls).toBe(1); // 序号 1、2 被闸拦下
      expect(okCalls).toBe(3); // 同实验另一个 eval 完全不受影响
      expect(summary.results.filter((r) => r.id === "f-fatal")).toHaveLength(1);
      expect(summary.results.filter((r) => r.id === "f-ok").map((r) => r.attempt).sort()).toEqual([0, 1, 2]);

      // 通路一:运行期反馈流。
      const notice = coordinator.state.diagnostics.find((d) => d.key === evalHaltKey(experimentId, "f-fatal"));
      expect(notice).toBeDefined();
      expect(notice!.code).toBe("dispatch-halted");
      expect(notice!.message).toContain(message);
      expect(notice!.data).toMatchObject({ scope: "eval", evalId: "f-fatal", phase: "eval.run" });
      expect(notice!.data?.unstarted).toBe(2);
      // 实验闸没落下:同实验其它 eval 的派发不该被 eval 档声明连带停掉。
      expect(coordinator.state.diagnostics.some((d) => d.key === experimentHaltKey(experimentId))).toBe(false);
      expectCountIdentity(coordinator.state);

      // 通路二:run.json 的实验域诊断。同源(同一份 message/phase/scope),但各自累计 ——
      // 反馈流那条含未派发记账刷新的 count,持久化这条只按声明次数折叠(这里只声明过一次)。
      const persisted = await snapshotHaltDiagnostics(root, experimentId);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({
        code: "dispatch-halted",
        level: "error",
        phase: "eval.run",
        data: { scope: "eval", evalId: "f-fatal" },
      });
      expect(persisted[0]!.message).toContain(message);
      expect(await lockFilesRemaining(root)).toEqual([]);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 止损闸: 组合(时间轴先走,空间轴只对终局失败生效)", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  // 同一份 { retryable: true, scope: "experiment" } 声明,两个方向各一条区分力场景:被重试
  // 吸收就到不了闸(本例),重试耗尽的终局失败才读 scope(下一例)。
  it("可重试失败被重试吸收:同一份带 scope 的声明重试成功后不落闸,同实验后续用例照常派发", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.9);
    try {
      const experimentId = "halt-absorbed-exp";
      let sendCalls = 0;
      const agent = defineSandboxAgent({
        name: "agent-halt-absorbed",
        send: async () => {
          sendCalls += 1;
          // 只有第一次 send 撞限流:退避一次后成功,失败 Turn 从不外泄给 expectOk()。
          return sendCalls === 1 ? retryableFailureTurn("rate limited, please retry later") : okTurn();
        },
      });
      const started: string[] = [];
      const evals = ["c-1", "c-2"].map((id) =>
        makeEval(id, async (t) => {
          started.push(id);
          (await t.send("go")).expectOk();
        }),
      );
      const agentRun = probeRun(agent, experimentId, ["c-1", "c-2"], {
        maxConcurrency: 1,
        // 实验分类器排在 adapter / 兜底之前:同一段限流文本被认领成「可重试 + 实验级」。
        classifyFailure: (f) =>
          f.text.includes("rate limited") ? { retryable: true, reason: "rate_limit", scope: "experiment" } : undefined,
      });
      const plan: RunFeedbackPlan = {
        shape: { evals: 2, configs: 1, totalAttempts: 2, maxConcurrency: 1 },
        reused: 0,
        reusedFailures: [],
      };

      await withCoordinator(plan, async (coordinator) => {
        let done = false;
        const runPromise = runWithPriorResults(evals, [agentRun], {
          priorResults: [],
          maxConcurrency: 1,
        }).then((r) => {
          done = true;
          return r;
        });

        await advanceOnFakeClock(() => done, 10_000, 12);
        const { summary, root } = await runPromise;

        expect([...started].sort()).toEqual(["c-1", "c-2"]); // 闸没落下:第二条照常派发
        expect(summary.results).toHaveLength(2);
        expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
        expect(sendCalls).toBe(3); // c-1 失败 1 次 + 重试成功 1 次,c-2 成功 1 次
        expect(coordinator.state.diagnostics.some((d) => d.key.startsWith("dispatch-halted:"))).toBe(false);
        expect(await snapshotHaltDiagnostics(root, experimentId)).toEqual([]);
      });
    } finally {
      vi.useRealTimers();
      randomSpy.mockRestore();
    }
  }, SCHEDULING_TEST_TIMEOUT_MS);

  it("重试耗尽后的终局失败才读 scope:同一份声明在耗尽路径上照常落闸,同实验剩余用例停派发", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.9);
    try {
      const experimentId = "halt-exhausted-exp";
      let sendCalls = 0;
      const agent = defineSandboxAgent({
        name: "agent-halt-exhausted",
        send: async () => {
          sendCalls += 1;
          return retryableFailureTurn("rate limited, please retry later"); // 永远撞限流,重试必耗尽
        },
      });
      const started: string[] = [];
      const evals = ["d-1", "d-2"].map((id) =>
        makeEval(id, async (t) => {
          started.push(id);
          (await t.send("go")).expectOk();
        }),
      );
      const agentRun = probeRun(agent, experimentId, ["d-1", "d-2"], {
        maxConcurrency: 1,
        classifyFailure: (f) =>
          f.text.includes("rate limited") ? { retryable: true, reason: "rate_limit", scope: "experiment" } : undefined,
      });
      const plan: RunFeedbackPlan = {
        shape: { evals: 2, configs: 1, totalAttempts: 2, maxConcurrency: 1 },
        reused: 0,
        reusedFailures: [],
      };

      await withCoordinator(plan, async (coordinator) => {
        let done = false;
        const runPromise = runWithPriorResults(evals, [agentRun], {
          priorResults: [],
          maxConcurrency: 1,
        }).then((r) => {
          done = true;
          return r;
        });

        // send 级预算封顶 4 次尝试,退避 4.5s / 9s / 18s(Math.random 定量成 0.9)。
        await advanceOnFakeClock(() => done, 10_000, 20);
        const { summary } = await runPromise;

        expect(started).toEqual(["d-1"]); // 耗尽后的终局失败落闸:d-2 不再派发
        expect(sendCalls).toBe(4);
        expect(summary.results).toHaveLength(1);
        expect(summary.results[0]!.verdict).toBe("errored");
        const notice = coordinator.state.diagnostics.find((d) => d.key === experimentHaltKey(experimentId));
        expect(notice).toBeDefined();
        expect(notice!.data?.unstarted).toBe(1);
      });
    } finally {
      vi.useRealTimers();
      randomSpy.mockRestore();
    }
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 止损闸: 幂等与不可逆", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  it("并发三条同时声明同一死因:两条通路各折叠成一条 dispatch-halted、count 累加到 3", async () => {
    const experimentId = "halt-idempotent-exp";
    const { barrier, release } = makeBarrier();
    const probe = newDispatchProbe();
    const ids = ["i-1", "i-2", "i-3"];
    // 三条一起挂在同一个 barrier 上:释放的瞬间三条并发抛出同一个实验级声明,这正是
    // 「并发 attempt 同时声明同一死因」的常态形状。
    const evals = ids.map((id) =>
      makeEval(id, async () => {
        probe.started.push(id);
        probe.inFlight += 1;
        probe.peak = Math.max(probe.peak, probe.inFlight);
        await barrier;
        probe.inFlight -= 1;
        throw new ExperimentFatalError("shared credentials expired; refresh .env");
      }),
    );
    const agentRun = probeRun(makeAgent("agent-halt-idempotent"), experimentId, ids);
    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalAttempts: 3, maxConcurrency: 3 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const runPromise = runWithPriorResults(evals, [agentRun], { priorResults: [], maxConcurrency: 3 });
      try {
        await waitForRealProgress(() => expect(probe.inFlight).toBe(3));
      } finally {
        release();
      }
      const { summary, root } = await runPromise;

      expect(summary.results).toHaveLength(3);
      expect(summary.results.every((r) => r.verdict === "errored")).toBe(true);

      const notices = coordinator.state.diagnostics.filter((d) => d.key.startsWith("dispatch-halted:"));
      expect(notices).toHaveLength(1); // 三次声明折叠成一条(dedupeKey 相同)
      expect(notices[0]!.count).toBe(3);
      expect(notices[0]!.data?.unstarted).toBe(0); // 三条都在飞,一条都没被拦下

      const persisted = await snapshotHaltDiagnostics(root, experimentId);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.count).toBe(3);
      expect(persisted[0]!.data).toMatchObject({ scope: "experiment" });
      expect(persisted[0]!.data?.evalId).toBeUndefined(); // 实验闸没有 evalId
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);

  it("落闸后在飞 attempt 成功也不重开派发:在飞的照常跑完落账,排队的仍然全停", async () => {
    const experimentId = "halt-irreversible-exp";
    const fatal = makeBarrier();
    const survivor = makeBarrier();
    const started: string[] = [];
    const ids = ["n-fatal", "n-survivor", "n-late-1", "n-late-2"];
    const evals = ids.map((id) =>
      makeEval(id, async () => {
        started.push(id);
        if (id === "n-fatal") {
          await fatal.barrier;
          throw new ExperimentFatalError("shared service died mid-run");
        }
        if (id === "n-survivor") await survivor.barrier;
      }),
    );
    const agentRun = probeRun(makeAgent("agent-halt-irreversible"), experimentId, ids);
    const plan: RunFeedbackPlan = {
      shape: { evals: 4, configs: 1, totalAttempts: 4, maxConcurrency: 2 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const runPromise = runWithPriorResults(evals, [agentRun], { priorResults: [], maxConcurrency: 2 });
      try {
        // 全局并发 2:前两条在飞,后两条排队。
        await waitForRealProgress(() => expect(started).toHaveLength(2));
        fatal.release();
        // 等闸真的落下(诊断出现)再放行幸存者,确保它的成功发生在落闸之后。
        await waitForRealProgress(() =>
          expect(coordinator.state.diagnostics.some((d) => d.key === experimentHaltKey(experimentId))).toBe(true),
        );
      } finally {
        survivor.release();
      }
      const { summary } = await runPromise;

      // 不抢占:在飞的 n-survivor 照常跑完并如实落账(passed);它的成功不重开派发。
      expect([...started].sort()).toEqual(["n-fatal", "n-survivor"]);
      expect(summary.results).toHaveLength(2);
      expect(summary.results.find((r) => r.id === "n-survivor")!.verdict).toBe("passed");
      expect(summary.results.find((r) => r.id === "n-fatal")!.verdict).toBe("errored");
      const notice = coordinator.state.diagnostics.find((d) => d.key === experimentHaltKey(experimentId));
      expect(notice!.data?.unstarted).toBe(2);
      expectCountIdentity(coordinator.state);
      expect(coordinator.state.queued).toBe(0);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 止损闸: 不抢占(等待集经 interruption 中止)", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  // 挂在 elsewhere 上的用例等的是「别人的锁什么时候放」,轮询周期是 10s 心跳。闸落下时它必须
  // 经既有 interruption 通路当场退出等待集,而不是陪着等满一个周期 —— 所以这条用真实时钟跑,
  // 断言面是硬墙钟耗时。
  it("落闸时挂在 elsewhere 的用例立刻退出等待集(远早于 10s 轮询周期),计 unstarted 且五项恒等式不破", async () => {
    const root = await makeRoot();
    const experimentId = "halt-elsewhere-exp";
    const lockedId = "w-locked";
    await seedCaseLock(root, freshLockRecord(experimentId, lockedId));

    let lockedCalls = 0;
    const evalLocked = makeEval(lockedId, () => {
      lockedCalls += 1;
    });
    const evalFatal = makeEval("w-fatal", () => {
      throw new ExperimentFatalError("shared svc down");
    });
    const agentRun = probeRun(makeAgent("agent-halt-elsewhere"), experimentId, [lockedId, "w-fatal"]);
    const plan: RunFeedbackPlan = {
      shape: { evals: 2, configs: 1, totalAttempts: 2, maxConcurrency: 2 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const startedAt = Date.now();
      const { summary } = await runWithPriorResults([evalLocked, evalFatal], [agentRun], {
        priorResults: [],
        root,
        maxConcurrency: 2,
      });
      const elapsedMs = Date.now() - startedAt;

      // 硬时间断言:锁等待轮询周期是 10s,不走中止通路的话整段至少要拖满一个周期。
      expect(elapsedMs).toBeLessThan(8_000);
      expect(lockedCalls).toBe(0); // 等待集里的那条从没被派发
      expect(summary.results).toHaveLength(1); // 不为没跑过的 attempt 制造 errored 记录
      expect(summary.results[0]!.id).toBe("w-fatal");
      expect(summary.results[0]!.verdict).toBe("errored");

      const notice = coordinator.state.diagnostics.find((d) => d.key === experimentHaltKey(experimentId));
      expect(notice!.data?.unstarted).toBe(1);
      // elsewhere 收支平账:进过等待集的那条必须被原数报回来,恒等式不留悬空的差额。
      expect(coordinator.state.elsewhere).toBe(0);
      expect(coordinator.state.queued).toBe(0);
      expectCountIdentity(coordinator.state);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 止损闸: teardown 边界", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  it("实验级 teardown 抛声明:降级为普通 teardown 诊断,不落闸", async () => {
    const experimentId = "halt-exp-teardown";
    const started: string[] = [];
    const ids = ["t-1", "t-2"];
    const evals = ids.map((id) =>
      makeEval(id, () => {
        started.push(id);
      }),
    );
    const agentRun = probeRun(makeAgent("agent-halt-exp-teardown"), experimentId, ids, {
      maxConcurrency: 1,
      setup: () => {},
      teardown: () => {
        throw new ExperimentFatalError("shared db handle leaked; restart the stack");
      },
    });
    const plan: RunFeedbackPlan = {
      shape: { evals: 2, configs: 1, totalAttempts: 2, maxConcurrency: 1 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary, root } = await runWithPriorResults(evals, [agentRun], {
        priorResults: [],
        maxConcurrency: 1,
      });

      expect([...started].sort()).toEqual(ids);
      expect(summary.results).toHaveLength(2);
      expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
      // 降级:只留既有的 teardown 失败诊断,一条 dispatch-halted 都不产生(两条通路都不产生)。
      const teardownDiag = coordinator.state.diagnostics.find(
        (d) => d.key === `experiment-teardown-failed:${experimentId}`,
      );
      expect(teardownDiag).toBeDefined();
      expect(teardownDiag!.message).toContain("shared db handle leaked");
      expect(coordinator.state.diagnostics.some((d) => d.key.startsWith("dispatch-halted:"))).toBe(false);
      expect(await snapshotHaltDiagnostics(root, experimentId)).toEqual([]);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);

  it("per-attempt teardown 抛声明:照常落闸(剩余两条计 unstarted),但 verdict 仍是 passed", async () => {
    const experimentId = "halt-attempt-teardown";
    const started: string[] = [];
    const ids = ["k-1", "k-2", "k-3"];
    const evals = ids.map((id) =>
      makeEval(id, () => {
        started.push(id);
      }),
    );
    // eval.teardown 是 attempt 收尾链的第一段,失败只记诊断、不改判定;空间轴声明照常落闸。
    evals[0]!.teardown = () => {
      throw new ExperimentFatalError("shared db handle leaked; restart the stack");
    };
    const agentRun = probeRun(makeAgent("agent-halt-attempt-teardown"), experimentId, ids);
    const plan: RunFeedbackPlan = {
      shape: { evals: 3, configs: 1, totalAttempts: 3, maxConcurrency: 1 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary, root } = await runWithPriorResults(evals, [agentRun], {
        priorResults: [],
        maxConcurrency: 1,
      });

      expect(started).toEqual(["k-1"]);
      expect(summary.results).toHaveLength(1);
      expect(summary.results[0]!.verdict).toBe("passed"); // 落闸不改 verdict
      expect(summary.results[0]!.diagnostics?.some((d) => d.phase === "eval.teardown")).toBe(true);

      const notice = coordinator.state.diagnostics.find((d) => d.key === experimentHaltKey(experimentId));
      expect(notice).toBeDefined();
      expect(notice!.data?.unstarted).toBe(2);
      expect(notice!.data?.phase).toBe("eval.teardown"); // 触发失败所在的生命周期阶段
      const persisted = await snapshotHaltDiagnostics(root, experimentId);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.phase).toBe("eval.teardown");
      expectCountIdentity(coordinator.state);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

// ─────────────── 用例锁:elsewhere 收支平账的两条回归(五项恒等式的守护) ───────────────
// 覆盖规范:docs/engineering/testing/unit/experiments-runner.md「用例锁与并发 Invocation」的
// 「挂起用例……计入独立的 `elsewhere` 计数且与 `queued` 互斥、五项计数恒等式成立」与
// 「执行模式组合——`--force` 等待后全部自跑」两分句。
//
// 上面「执行模式组合」那组走的是过期锁接管路径,压根没进过挂起窗口;这里的三条专测窗口本身
// 的收支:报进 elsewhere 多少条,收尾就要原数报回多少条 —— 差额挂住即恒等式当场破。

describe("runEvals · 用例锁: --force 撞新鲜锁的挂起窗口", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  // bug: --force 下撞**新鲜**锁只发 started 不发 resolved,elsewhere 永久挂住、五项恒等式当场破。
  // 上面「执行模式组合」那条走的是 stale 锁接管(从没进过挂起窗口),盖不住这个窗口。
  it("--force + 新鲜锁 + 持有方释放:窗口照常收 resolved,elsewhere 归零、恒等式成立,用例全部自跑", async () => {
    const root = await makeRoot();
    const experimentId = "force-fresh-lock-exp";
    const evalId = "force-fresh-eval";
    const agent = makeAgent("agent-force-fresh");
    const sandbox = fakeSandboxSpec();

    // 先落一条指纹匹配的 passed 终态:--force 下它不该被消费,等完窗口照样自跑。
    const producerRun = probeRun(agent, experimentId, [evalId], { sandbox });
    const { summary: produced } = await run([makeEval(evalId, () => {})], [producerRun], { root });
    expect(produced.results[0]!.verdict).toBe("passed");

    // 另一条 Invocation 此刻正持有这把锁(心跳新鲜:走真实的挂起窗口,不是过期接管)。
    await seedCaseLock(root, freshLockRecord(experimentId, evalId));

    vi.useFakeTimers();
    try {
      let calls = 0;
      const subjectEval = makeEval(evalId, () => {
        calls += 1;
      });
      const plan: RunFeedbackPlan = {
        shape: { evals: 1, configs: 1, totalAttempts: 1, maxConcurrency: 2 },
        reused: 0,
        reusedFailures: [],
      };

      await withCoordinator(plan, async (coordinator) => {
        let done = false;
        // force 模式:cli.ts 在 --force 时整段不传 priorResults(不是传空数组)。
        const runPromise = runWithPriorResults([subjectEval], [producerRun], { root, maxConcurrency: 2 }).then((r) => {
          done = true;
          return r;
        });

        await waitForRealProgress(() => expect(coordinator.state.elsewhere).toBe(1));
        expect(coordinator.state.queued).toBe(0); // elsewhere 与 queued 互斥
        expectCountIdentity(coordinator.state);

        // 持有方正常收尾:锁文件消失,下一轮轮询即结束等待。
        await rm(caseLockPath(root, experimentId, evalId), { force: true });
        await advanceOnFakeClock(() => done, 10_000, 12);
        const { summary } = await runPromise;

        expect(calls).toBe(1); // --force:等完窗口后自跑,不消费磁盘上那条匹配终态
        expect(coordinator.state.reused).toBe(0);
        expect(coordinator.state.elsewhere).toBe(0); // 报进去 1 条,原数报了回来
        expectCountIdentity(coordinator.state);
        expect(summary.results).toHaveLength(1);
        expect(summary.results[0]!.verdict).toBe("passed");
        expect(await lockFilesRemaining(root)).toEqual([]);
      });
    } finally {
      vi.useRealTimers();
    }
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

describe("runEvals · 用例锁: 等待窗口的 elsewhere 收支平账", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  // 报进 elsewhere 的条数必须原数报回:等待期间被中断而提前 settle 的 attempt 会让「本组还剩
  // 几条没收尾」缩水,收尾时拿当下的剩余条数当迁移数,差额就永远挂在 elsewhere 上。
  it("挂起期间用户中断:attempts: 2 整组报进 elsewhere 的两条被原数报回,elsewhere 归零、恒等式成立", async () => {
    const root = await makeRoot();
    const experimentId = "elsewhere-interrupt-exp";
    const evalId = "elsewhere-interrupt-eval";
    await seedCaseLock(root, freshLockRecord(experimentId, evalId));

    let calls = 0;
    const evalDef = makeEval(evalId, () => {
      calls += 1;
    });
    const agentRun = probeRun(makeAgent("agent-elsewhere-interrupt"), experimentId, [evalId], { attempts: 2 });
    const plan: RunFeedbackPlan = {
      shape: { evals: 1, configs: 1, totalAttempts: 2, maxConcurrency: 2 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const ac = new AbortController();
      const runPromise = runWithPriorResults([evalDef], [agentRun], {
        priorResults: [],
        root,
        maxConcurrency: 2,
        signal: ac.signal,
      });

      await waitForRealProgress(() => expect(coordinator.state.elsewhere).toBe(2));
      ac.abort();
      await runPromise;

      // 窗口的收尾事件是被中断唤醒后才发的,可能晚于 runEvals 结算一个事件循环轮次。
      await waitForRealProgress(() => expect(coordinator.state.elsewhere).toBe(0));
      expectCountIdentity(coordinator.state);
      expect(coordinator.state.queued).toBe(2); // 两条都退回 queued(中断路径不派发)
      expect(calls).toBe(0);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);

  // 接管 / 多开下补的那对瞬时 started+resolved 只报**真正携入**的那几条:runs > 1 时没携入的
  // 兄弟从没离开 queued,把整组都报一遍会把 queued 扣穿成负数、reused 多记一条。
  it("接管后重查携带命中一条:只有那一条走 elsewhere → reused,兄弟照常自跑且 queued 不被扣穿", async () => {
    const root = await makeRoot();
    const experimentId = "recheck-partial-count-exp";
    const evalId = "recheck-partial-count-eval";
    const agent = makeAgent("agent-recheck-partial-count");
    const sandbox = fakeSandboxSpec();

    // 先落一条序号 0 的 passed 终态(指纹由生产路径自己算)。
    const producerRun = probeRun(agent, experimentId, [evalId], { sandbox });
    const { summary: produced } = await run([makeEval(evalId, () => {})], [producerRun], { root });
    expect(produced.results[0]!.verdict).toBe("passed");

    // 产出方写完结果还没释放锁就死了:留一把过期锁,续接方接管时重查携带。
    await seedCaseLock(root, staleLockRecord(experimentId, evalId));

    const { barrier, release } = makeBarrier();
    const probe = newDispatchProbe();
    const subjectRun = probeRun(agent, experimentId, [evalId], { sandbox, attempts: 2 });
    const plan: RunFeedbackPlan = {
      shape: { evals: 1, configs: 1, totalAttempts: 2, maxConcurrency: 2 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const runPromise = runWithPriorResults([gatedEval(evalId, barrier, probe)], [subjectRun], {
        priorResults: [],
        root,
        maxConcurrency: 2,
      });
      try {
        // 冻结在「序号 0 已携入、序号 1 正在跑」这一帧上取样 —— 扣穿是瞬时中间态,跑完再看
        // 计数已经自愈,只有这一帧能证明。
        await waitForRealProgress(() => {
          expect(coordinator.state.reused).toBe(1);
          expect(probe.inFlight).toBe(1);
        });
        const mid = coordinator.state;
        expect(mid.reused).toBe(1); // 只有真正携入的那一条迁进 reused
        expect(mid.running).toBe(1);
        expect(mid.queued).toBe(0); // 没携入的兄弟从没离开 queued,不被多扣一次
        expect(mid.elsewhere).toBe(0);
        expectCountIdentity(mid);
      } finally {
        release();
      }

      const { summary } = await runPromise;
      expect(probe.started).toEqual([evalId]); // 只有缺的序号 1 真的派发过
      expect(summary.results.map((r) => r.attempt).sort()).toEqual([0, 1]);
      expect(coordinator.state.elsewhere).toBe(0);
      expectCountIdentity(coordinator.state);
      expect(await lockFilesRemaining(root)).toEqual([]);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);
});
