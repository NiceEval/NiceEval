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
import { judgeProbePlan, judgeProbeTargets, runEvals } from "./run.ts";
import { experimentRunInfo } from "./attempt.ts";
import { defineEval, defineSandbox, defineSandboxAgent as defineSandboxAgentBase } from "../define.ts";
import { defineSandboxCase } from "../sandbox/layer.ts";
import { Artifacts } from "./reporters/artifacts.ts";
import { openRecord } from "../record/open.ts";
import { createWriter } from "../record/writer.ts";
import { encodeAttemptLocator, LocatorCollisionError } from "../record/locator.ts";
import { equals } from "../expect/index.ts";
import { createFeedbackCoordinator, type FeedbackCoordinator } from "./feedback/coordinator.ts";
import { createFakeFeedbackIO } from "./feedback/testing.ts";
import {
  activateFeedbackSink,
  activeFeedbackSinkCount,
  type ExperimentHookInput,
  type ExperimentProgressInput,
  type FailureInput,
  type PrecheckInput,
} from "./feedback/sink.ts";
import { drainExperimentTeardowns, pendingExperimentTeardownCount } from "./experiment-cleanup-registry.ts";
import { computeConfigHash, computeFingerprint, fingerprintWithManifest } from "./fingerprint.ts";
import type { EvalManifest } from "./manifest.ts";
import { locksDirOf, pendingHeldCaseLockCount, type CaseLockRecord } from "./lock.ts";
import { pendingHeldGateLeaseCount } from "./gate-lease.ts";
import { slugHashEntryId } from "../shared/entry-file-store.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import type { CarryPlan as CoreCarryPlan } from "./fingerprint.ts";
import { ExperimentFatalError, EvalFatalError } from "../shared/failure-class.ts";
import { normalizeExternalCause } from "../shared/external-cause.ts";
import { makeSendFailure } from "../context/send-failures.ts";
import { defineSandboxCommand } from "../sandbox/commands.ts";
import {
  CustomSandboxMaterializationError,
  defineSandboxTemplate,
  sandboxLayer,
  sandboxProviderPlan,
  type SandboxLayer,
  type SandboxProviderBuildPlan,
  type SandboxProviderModule,
} from "../sandbox/layer.ts";
import {
  noSandboxBackendCapabilities,
  supportedBackendCapability,
  type SandboxProviderBackend,
} from "../sandbox/backend.ts";
import { normalizeSandboxPaths } from "../sandbox/paths.ts";
import { Effect, Option } from "effect";
import { discoverEval, type AgentRun as CoreAgentRun } from "./types.ts";
import type { DiagnosticRecord, FingerprintMigration, RunFeedbackPlan, RunFeedbackState, RunOptions } from "./types.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { prepareRunSandboxes, preparedPairsByKey, runPairKey, type PreparedRunPair } from "./sandbox-selection.ts";
import type {
  Agent,
  CommandResult,
  Config,
  DiscoveredEval,
  EvalResult as CoreEvalResult,
  InvocationShape,
  InvocationSummary,
  JudgeConfig,
  Reporter,
  ReporterRegistration,
  Sandbox,
  SandboxAgentDef,
  TestContext,
  Turn,
} from "../types.ts";

function defineSandboxAgent(
  def: Omit<SandboxAgentDef, "ensure" | "installers" | "evidenceCoverage">,
) {
  const ensure = {
    identity: { agent: def.name, version: "0.0.0-test", revision: "1" },
    probe: defineSandboxCommand(
      { id: "test.agent.probe", revision: "1", inputs: { agent: def.name, version: "0.0.0-test" } },
      async () => {},
    ),
  };
  return defineSandboxAgentBase({ ...def, evidenceCoverage: completeEvidenceCoverage, ensure, installers: [] });
}

/** 旧场景只描述可观察调度差异；run() 在边界补齐已发现 Experiment 的完成态。 */
type AgentRun = Omit<CoreAgentRun, "experimentId" | "experimentBaseDir" | "experimentSourcePath"> &
  Partial<Pick<CoreAgentRun, "experimentId" | "experimentBaseDir" | "experimentSourcePath">>;
type EvalResult = Omit<CoreEvalResult, "evidenceCoverage"> & Partial<Pick<CoreEvalResult, "evidenceCoverage">>;
type CarryPlan = Omit<CoreCarryPlan, "preparedPairsByKey" | "plannedConfigHashes" | "carriedAcceptingByResult" | "carriedResults" | "migratedFromByResult"> &
  Partial<Pick<CoreCarryPlan, "preparedPairsByKey" | "plannedConfigHashes" | "carriedAcceptingByResult">> & {
    carriedResults: EvalResult[];
    migratedFromByResult?: ReadonlyMap<EvalResult, FingerprintMigration>;
  };

function completeAgentRun(run: AgentRun): CoreAgentRun {
  return {
    ...run,
    experimentId: run.experimentId ?? "test/experiment",
    experimentBaseDir: run.experimentBaseDir ?? "/project",
    experimentSourcePath: run.experimentSourcePath ?? "/project/fake.experiment.ts",
  };
}

function completeEvalResult(result: EvalResult): CoreEvalResult {
  return { ...result, evidenceCoverage: result.evidenceCoverage ?? completeEvidenceCoverage };
}

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

  it("resolves Experiment fields before Eval and Config", () => {
    const evals = [{
      id: "exp-a|judged",
      source: `t.judge.autoevals.factuality("2")`,
      judge: { model: "eval-model", baseUrl: "https://eval.example/v1" },
      experimentJudge: { model: "experiment-model", timeoutMs: 90_000 },
    }];
    const plan = judgeProbePlan(evals, { ...configJudge, apiKeyEnv: "CONFIG_KEY", timeoutMs: 180_000 });
    expect(plan.targets).toEqual([{
      key: "experiment-model|https://eval.example/v1|CONFIG_KEY",
      judge: {
        model: "experiment-model",
        baseUrl: "https://eval.example/v1",
        apiKeyEnv: "CONFIG_KEY",
        timeoutMs: 90_000,
      },
    }]);
    expect(plan.evalKeys.get("exp-a|judged")).toBe(plan.targets[0]?.key);
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

  async runShell(script?: string): Promise<CommandResult> {
    if (script?.includes("uname -s")) return { stdout: "Linux\nx86_64\nglibc\n", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async runCommand(): Promise<CommandResult> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async runCommandOrThrow(): Promise<CommandResult & { exitCode: 0 }> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async runShellOrThrow(): Promise<CommandResult & { exitCode: 0 }> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    this.files.set(path, Buffer.from(content).toString());
  }
  async pathExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async readText(path: string): Promise<string> {
    const hit = this.files.get(path);
    if (hit === undefined) throw new Error(`no such file: ${path}`);
    return hit;
  }
  async readBytes(path: string): Promise<Uint8Array> {
    return Buffer.from(this.files.get(path) ?? "");
  }
  async uploadFile(): Promise<void> {}
  async uploadDirectory(): Promise<void> {}
  async downloadFile(): Promise<void> {}
  async downloadDirectory(): Promise<void> {}
  async stop(): Promise<void> {}
}

const asSandbox = (box: FakeSandbox): Sandbox => box as unknown as Sandbox;

function materializationFailure(message: string): CustomSandboxMaterializationError {
  return new CustomSandboxMaterializationError({
    code: "test.materialization-failed",
    message,
    cause: new Error(message),
  });
}

// judge 预检需要一个真实可读的文件(runEvals 无条件 readFile(evalDef.sourcePath));
// 内容无所谓(这些测试都不配置 judge),直接指向本测试文件自己,永远存在。
const sourcePath = fileURLToPath(import.meta.url);
const source: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };

function makeAgent(name: string): Agent {
  return defineSandboxAgent({ name, send: async () => ({ events: [], status: "completed" }) });
}

function fakeSandboxLayer() {
  // 自定义 provider:create() 直接返回内存 fake,绕开真实沙箱 provider;每次调用给一个
  // 全新实例,并发 attempt 之间不共享可变文件状态。
  return defineSandbox({
    name: "fake-provider",
    targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
    create: () => Effect.succeed(asSandbox(new FakeSandbox())),
  });
}

/** 指纹等值测试需要一个可携带的模板；自定义 provider 的 opaque create 按契约每轮加入 epoch。 */
function stableFakeSandboxLayer() {
  return defineSandboxCase({
    identity: { kind: "test-stable-fake", revision: 1 },
    targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
    services: { _tag: "Unsupported" },
    materialize: () => Effect.succeed({
      sandbox: asSandbox(new FakeSandbox()),
      group: {
        primary: { sandboxId: "fake", provider: "custom-case" },
        resources: { kind: "primary-only", sandboxId: "fake" },
        async stop() {},
      },
      services: { _tag: "None" },
      facts: null,
    }),
  });
}

/**
 * 复用路径不能用 custom provider/case 冒充：它们的 provider plan 明确没有 reset contract。
 * 这份测试 ProviderModule 声明了 reuse 和 ensureLifetime，让 runEvals 真正进入复用池。
 */
function reusableFakeSandboxLayer(
  onCreate: () => void,
  build: SandboxProviderBuildPlan = { _tag: "None", caseKey: "test-reusable-case", buildKeys: [] },
) {
  const provider = "test-reusable-provider";
  const module: SandboxProviderModule<undefined> = {
    id: provider,
    capabilities: {
      retention: { _tag: "DestroyOnly" },
      reuse: { _tag: "Supported" },
      sessionLimit: { _tag: "Unlimited" },
    },
    materialize: (_plan, context) => Effect.sync(() => {
      onCreate();
      const box = new FakeSandbox();
      const backend: SandboxProviderBackend = {
        workdir: box.workdir,
        sandboxId: `reusable-${box.sandboxId}`,
        otlpHost: box.otlpHost,
        capabilities: {
          ...noSandboxBackendCapabilities,
          ensureLifetime: supportedBackendCapability(async () => ({ ready: true as const })),
        },
        runCommand: () => box.runCommand(),
        runShell: (script) => box.runShell(script),
        readText: (path) => box.readText(path),
        writeText: (path, content) => box.writeText(path, content),
        readBytes: (path) => box.readBytes(path),
        writeBytes: (path, content) => box.writeBytes(path, content),
        pathExists: (path) => box.pathExists(path),
        uploadFile: () => box.uploadFile(),
        uploadDirectory: () => box.uploadDirectory(),
        downloadFile: () => box.downloadFile(),
        downloadDirectory: () => box.downloadDirectory(),
        stop: () => box.stop(),
      };
      const sandbox = normalizeSandboxPaths(backend, provider);
      return {
        sandbox,
        group: {
          primary: { sandboxId: sandbox.sandboxId, provider },
          resources: { kind: "primary-only", sandboxId: sandbox.sandboxId },
          stop: () => sandbox.stop(),
        },
        caseKind: "custom" as const,
        caseKey: context.plan.providerPlan.build.caseKey,
        buildKeys: context.plan.providerPlan.build.buildKeys,
        identity: { provider },
        facts: null,
      };
    }),
    collectBuildPreparation: () => Effect.succeed(Option.none()),
  };
  return defineSandboxTemplate({
    provider,
    kind: "test-reusable",
    publishableIdentity: { provider },
    privateFingerprintIdentity: { provider, revision: 1 },
    leakGate: { _tag: "None" },
    plan: () => Effect.succeed(sandboxProviderPlan({
      provider,
      plannerRevision: "1",
      caseKind: "custom",
      target: {
        platform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
        source: "provider-defined",
      },
      scheduling: {
        recommendedConcurrency: 1,
        lane: { key: provider, limit: 1 },
        admission: { _tag: "Shared" },
      },
      module,
      runtimePlan: undefined,
      build,
      publishableIdentity: { provider },
      privateFingerprintIdentity: { provider, revision: 1 },
    })),
  });
}

function makeEval(id: string, test: DiscoveredEval["test"], sandbox?: SandboxLayer): DiscoveredEval {
  return discoverEval(defineEval({ test, ...(sandbox === undefined ? {} : { sandbox }) }), {
    id,
    baseDir: "/project",
    sourcePath,
    loaderDataPaths: Object.freeze([]),
    criteriaPaths: Object.freeze([]),
    privatePaths: Object.freeze([]),
    source,
  });
}

async function preparedPair(evalDef: DiscoveredEval, run: AgentRun): Promise<PreparedRunPair> {
  const [pair] = await Effect.runPromise(prepareRunSandboxes([evalDef], [completeAgentRun(run)]));
  if (pair === undefined) throw new Error("test fixture did not produce a PreparedRunPair");
  return pair;
}

/** 手写携带场景仍须携带完整 pair-owned planning；只允许覆盖其可观察的 carry 结论。 */
async function completeCarryPlan(
  evals: readonly DiscoveredEval[],
  runs: readonly CoreAgentRun[],
  partial: CarryPlan,
): Promise<CoreCarryPlan> {
  const pairs = await Effect.runPromise(prepareRunSandboxes(evals, runs));
  const plannedConfigHashes = new Map<string, string>();
  const plannedFingerprints = new Map<string, string>();
  const acceptableFingerprints = new Map<string, Set<string>>();
  const manifestsByKey = new Map<string, EvalManifest>();
  for (const pair of pairs) {
    const hash = computeConfigHash(pair);
    const { fingerprint, manifest } = await fingerprintWithManifest(pair);
    plannedConfigHashes.set(pair.key, hash);
    plannedFingerprints.set(pair.key, fingerprint);
    acceptableFingerprints.set(pair.key, new Set([fingerprint]));
    manifestsByKey.set(pair.key, manifest);
  }
  const defaults: CoreCarryPlan = {
    preparedPairsByKey: preparedPairsByKey(pairs),
    plannedConfigHashes,
    plannedFingerprints,
    acceptableFingerprints,
    carriedAttemptsByKey: new Map(),
    carriedResults: [],
    carriedAcceptingByResult: new Map(),
    migratedFromByResult: new Map(),
    dispatchByKey: new Map(),
    manifestsByKey,
    availableDeltas: [],
  };
  const carriedResults = partial.carriedResults.map(completeEvalResult);
  const migratedFromByResult = new Map(
    [...(partial.migratedFromByResult ?? [])].flatMap(([source, migration]) => {
      const target = carriedResults.find((candidate) =>
        candidate.experimentId === source.experimentId && candidate.id === source.id && candidate.attempt === source.attempt,
      );
      return target === undefined ? [] : [[target, migration] as const];
    }),
  );
  return Object.assign(defaults, partial, {
    preparedPairsByKey: new Map([...defaults.preparedPairsByKey, ...(partial.preparedPairsByKey ?? [])]),
    plannedConfigHashes: new Map([...defaults.plannedConfigHashes, ...(partial.plannedConfigHashes ?? [])]),
    plannedFingerprints: new Map([...defaults.plannedFingerprints, ...partial.plannedFingerprints]),
    acceptableFingerprints: new Map([...defaults.acceptableFingerprints, ...partial.acceptableFingerprints]),
    carriedAcceptingByResult: new Map([
      ...defaults.carriedAcceptingByResult,
      ...(partial.carriedAcceptingByResult ?? []),
    ]),
    migratedFromByResult,
    manifestsByKey: new Map([...defaults.manifestsByKey, ...partial.manifestsByKey]),
    carriedResults,
  });
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
    maxBuildConcurrency?: number;
    signal?: AbortSignal;
    /** 预先建好、需要在调用前写入固定文件(如伪造的收尾登记)的根;省略则自建一个临时目录。 */
    root?: string;
    /** 项目级配置(判分预检要读 `config.judge`);省略则用空配置。 */
    config?: Config;
    buildPreparation?: RunOptions["buildPreparation"];
    keepSandbox?: NonNullable<RunOptions["keepSandbox"]>;
    runIds?: ReadonlyMap<string, string>;
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
  const config: Config = opts.config ?? {};
  const completedRuns = agentRuns.map(completeAgentRun);
  const runOpts: RunOptions = {
    config,
    evals,
    agentRuns: completedRuns,
    reporters: [
      { reporter: capture, name: "capture", required: false },
      { reporter: Artifacts(root), name: "artifacts", required: false },
      ...(opts.extraReporters ?? []),
    ],
    maxConcurrency: opts.maxConcurrency ?? 3,
    ...(opts.maxBuildConcurrency !== undefined ? { maxBuildConcurrency: opts.maxBuildConcurrency } : {}),
    // 与 Artifacts(root) 同一个根:未显式传入时 run.ts 会退回 cwd/.niceeval(与 attempt.ts 同一
    // 兜底口径),测试进程的 cwd 是仓库根——不隔离到这里传的临时目录,会在真实仓库根写出
    // .niceeval/teardowns/ 之类的测试副作用(见 memory 的 test-must-isolate-niceeval-root)。
    niceevalRoot: root,
    ...(opts.runIds ? { runIds: opts.runIds } : {}),
    ...(opts.carryPlan ? { carryPlan: await completeCarryPlan(evals, completedRuns, opts.carryPlan) } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.buildPreparation ? { buildPreparation: opts.buildPreparation } : {}),
    ...(opts.keepSandbox ? { keepSandbox: opts.keepSandbox } : {}),
  };
  const summary = await runEvals(runOpts);
  return { summary, root, onEvalComplete, onEventComplete };
}

describe("runEvals · --keep-sandbox 与 sandboxReuse ownership 互斥", () => {
  it("在 carry planning 与 Sandbox 创建前拒绝冲突组合", async () => {
    const evalDef = makeEval("keep-reuse-conflict", () => {});
    const agentRun: AgentRun = {
      agent: makeAgent("agent-keep-reuse"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: fakeSandboxLayer(),
      sandboxReuse: true,
      timeoutMs: 5_000,
      selectedEvalIds: [evalDef.id],
      experimentId: "keep/reuse",
    };

    await expect(run([evalDef], [agentRun], { keepSandbox: "all" })).rejects.toMatchObject({
      _tag: "RunModeConflictError",
      keepSandbox: "all",
      conflictingExperimentIds: ["keep/reuse"],
    });
  });
});

describe("runEvals · sandboxReuse 按物理 Sandbox identity 分池", () => {
  it("不同 Eval prepare 共用同一物理 Sandbox，并逐 Attempt 各自重放", async () => {
    let sandboxCreates = 0;
    const prepared: string[] = [];
    const template = reusableFakeSandboxLayer(() => { sandboxCreates += 1; })
      .setup((_sandbox, ctx) => { ctx.fact("sandbox.lifecycle", "setup"); })
      .teardown((_sandbox, ctx) => {
        ctx.fact("sandbox.lifecycle", "teardown");
        ctx.diagnostic({
          code: "sandbox-lifecycle-test",
          level: "warning",
          message: "physical sandbox teardown completed",
        });
      });
    const evalWithPrepare = (id: string, commandId: string): DiscoveredEval =>
      discoverEval(defineEval({
        sandbox: sandboxLayer().prepare(defineSandboxCommand(
          { id: commandId, revision: "1", inputs: {} },
          async () => { prepared.push(commandId); },
        )),
        test() {},
      }), {
        id,
        baseDir: "/project",
        sourcePath,
        loaderDataPaths: Object.freeze([]),
        criteriaPaths: Object.freeze([]),
        privatePaths: Object.freeze([]),
        source,
      });
    const evals = [
      evalWithPrepare("reuse-a", "test.reuse.prepare-a"),
      evalWithPrepare("reuse-b", "test.reuse.prepare-b"),
    ];
    const agentRun: AgentRun = {
      agent: makeAgent("agent-reuse-layer-identity"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: template,
      sandboxReuse: true,
      maxConcurrency: 1,
      timeoutMs: 5_000,
      selectedEvalIds: evals.map((evalDef) => evalDef.id),
      experimentId: "reuse-layer-identity-exp",
    };

    const { summary, root } = await run(evals, [agentRun], { maxConcurrency: 1 });

    expect(summary.results).toHaveLength(2);
    expect(summary.results.every((result) => result.verdict === "passed")).toBe(true);
    expect(sandboxCreates).toBe(1);
    expect(prepared).toEqual(["test.reuse.prepare-a", "test.reuse.prepare-b"]);

    const record = await openRecord(root);
    const latestRun = record.experiments.find((entry) => entry.id === agentRun.experimentId)?.latestRun;
    expect(latestRun?.facts).toMatchObject({ "sandbox.lifecycle": "teardown" });
    expect(latestRun?.diagnostics).toContainEqual(expect.objectContaining({ code: "sandbox-lifecycle-test" }));
  });
});

async function diskSnapshotStartedAt(root: string, experimentId: string): Promise<string> {
  const results = await openRecord(root);
  const exp = results.experiments.find((e) => e.id === experimentId);
  if (!exp) throw new Error(`no run written for experiment ${experimentId}`);
  return exp.latestRun.startedAt;
}

async function diskRunId(root: string, experimentId: string): Promise<string> {
  const results = await openRecord(root);
  const exp = results.experiments.find((entry) => entry.id === experimentId);
  if (!exp) throw new Error(`no run written for experiment ${experimentId}`);
  return exp.latestRun.runId;
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
      sandbox: fakeSandboxLayer(),
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
  it("调度前检查整个记录根；异身份占用计划 locator 时中止且不执行 eval", async () => {
    const root = await makeRoot();
    const experimentId = "locator-collision-exp";
    const plannedRunId = "planned-run-id";
    const targetLocator = encodeAttemptLocator({ runId: plannedRunId, evalId: "fresh", attempt: 0 });

    const historicalWriter = createWriter(root, { producer: { name: "fixture", version: "1" } });
    const historicalRun = await historicalWriter.run({
      runId: "historical-run-id",
      experimentId,
      agent: "fixture",
      startedAt: "2026-07-01T00:00:00.000Z",
    });
    await historicalRun.writeAttempt({
      id: "other",
      verdict: "passed",
      attempt: 0,
      durationMs: 1,
      assertions: [],
      evidenceCoverage: completeEvidenceCoverage,
      locator: targetLocator,
    });
    await historicalRun.finish();

    let executed = false;
    const evalDef = makeEval("fresh", () => {
      executed = true;
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-a"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxLayer(),
      timeoutMs: 5_000,
      selectedEvalIds: ["fresh"],
      experimentId,
    };

    await expect(
      run([evalDef], [agentRun], { root, runIds: new Map([[experimentId, plannedRunId]]) }),
    ).rejects.toThrow(LocatorCollisionError);
    expect(executed).toBe(false);
  });

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
      sandbox: fakeSandboxLayer(),
      timeoutMs: 5_000,
      selectedEvalIds: ["ok", "boom"],
      experimentId,
    };

    const { summary, root, onEvalComplete, onEventComplete } = await run([evalOk, evalBoom], [agentRun]);

    expect(summary.results).toHaveLength(2);
    expect(summary.results.find((r) => r.id === "ok")!.verdict).toBe("passed");
    expect(summary.results.find((r) => r.id === "boom")!.verdict).toBe("errored");

    const runId = await diskRunId(root, experimentId);
    for (const evalId of ["ok", "boom"]) {
      const key = `${experimentId}|${evalId}|0`;
      const expected = encodeAttemptLocator({ runId, evalId, attempt: 0 });
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
      sandbox: fakeSandboxLayer(),
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
      sandbox: fakeSandboxLayer(),
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

  it("carry 结果的 locator 原样透传,不按本次 invocation 的 runId 重算", async () => {
    const experimentId = "carry-exp";
    const evalId = "carried-eval";
    const staleLocator = encodeAttemptLocator({
      runId: "carried-origin-run",
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
      acceptedFrom: {
        locator: staleLocator,
        fingerprint: "legacy-opaque-fingerprint",
        acceptedFingerprint: "old-current-fingerprint",
        differences: [],
      },
    };
    // eval 的 test() 会抛错——如果携带 / 首过即停判断漏了这条、真的调度了一次新 attempt,
    // 这里会产出一条 errored 的重复结果,而不是静默漏测。
    const evalDef = makeEval(evalId, () => {
      throw new Error("carried result should have skipped scheduling a fresh attempt");
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-carried"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxLayer(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };

    const { summary, root } = await run([evalDef], [agentRun], {
      carryPlan: {
        plannedFingerprints: new Map([[runPairKey(experimentId, evalId), "current-deterministic-fingerprint"]]),
        acceptableFingerprints: new Map(),
        manifestsByKey: new Map(),
        dispatchByKey: new Map(),
        availableDeltas: [],
        carriedAttemptsByKey: new Map([[runPairKey(experimentId, evalId), new Set([0])]]),
        carriedResults: [carried],
        migratedFromByResult: new Map([[carried, {
          kind: "opaque-carry-epoch",
          fingerprint: "legacy-opaque-fingerprint",
          algorithmVersion: 0,
          coverageVersion: 0,
        }]]),
      },
    });

    const matches = summary.results.filter((r) => r.id === evalId);
    expect(matches).toHaveLength(1); // 没有额外调度出一条新 attempt
    expect(matches[0]!.verdict).toBe("passed"); // 是携带的那份,不是抛错的新跑
    expect(matches[0]!.locator).toBe(staleLocator); // 原样透传,run.ts 没有碰过它
    expect(matches[0]!.fingerprint).toBe("current-deterministic-fingerprint");
    expect(matches[0]!.migratedFrom).toEqual({
      kind: "opaque-carry-epoch",
      fingerprint: "legacy-opaque-fingerprint",
      algorithmVersion: 0,
      coverageVersion: 0,
    });
    expect(matches[0]!.acceptedFrom).toBeUndefined();

    // 反证:如果按本次 invocation 的 snapshotStartedAt 重算,会得到不同的字符串——
    // 证明确实是原样透传,不是巧合相等。
    const runId = await diskRunId(root, experimentId);
    const wronglyRecomputed = encodeAttemptLocator({
      runId,
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
      sandbox: fakeSandboxLayer(),
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

    const runId = await diskRunId(root, experimentId);
    for (const evalId of ["c-slow", "c-mid", "c-fast"]) {
      const key = `${experimentId}|${evalId}|0`;
      const expected = encodeAttemptLocator({ runId, evalId, attempt: 0 });
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
      summary: { startedAt: "", completedAt: "", passed: 0, failed: 0, skipped: 0, errored: 0, durationMs: 0, results: [] },
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
    const evalFailed = makeEval("gate-fail", (t: TestContext) => {
      t.check("actual", equals("expected"));
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-a"),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxLayer(),
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
        // evalDef.test() 抛的是普通 Error；即使 attempt 随后仍进入 diff/assertions.evaluate，永久错误通知
        // 也必须使用结构化 error.phase，报告错误真正发生的 eval.run，而不是最后经过的阶段。
        origin: { scope: "attempt" as const, phase: "eval.run" },
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
      // failed 是断言 outcome，不是 lifecycle error；即使 verdict 在 assertions.evaluate 阶段算出，也不应
      // 把 assertions.evaluate（更不能把随后可能发生的 telemetry.collect）冒充成「失败发生阶段」。
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
      sandbox: fakeSandboxLayer(),
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

      // reducer 不变量:每条 budget-exhausted 把一个 attempt 从 queued 挪进 skipped —— 没派发就
      // 没有 verdict,不冒充 passed/failed(与 assembleInvocationCompletion() 读取 count 折算
      // InvocationCompletion.unstarted 的口径一致)。
      expect(coordinator.state).toMatchObject({ total: 3, reused: 0, running: 0, queued: 0, passed: 0, failed: 0, errored: 0, skipped: 3 });
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
      targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
      create: () => Effect.fail(materializationFailure("404: template 'memory-evals-claude-mempal-deadbeef-0-9-0' not found")),
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
      expect(summary.results.every((result) => (result.error?.origin.scope === "attempt" ? result.error.origin.phase : undefined) === "sandbox.create")).toBe(true);
      expect(summary.results.every((result) => result.error?.message.includes("template") === true)).toBe(true);
      expect(coordinator.state.failures).toHaveLength(3);
      expect(coordinator.state.diagnostics.some((d) => d.key === `budget-unenforceable:${experimentId}`)).toBe(false);
    });
  });

  it("三个 agent turn 都没有成本数据时仍只报一次 budget-unenforceable", async () => {
    const experimentId = "missing-cost-exp";
    const evals = ["a", "b", "c"].map((id) => makeEval(id, async (t: TestContext) => {
      await t.send("hello");
    }));
    const agentRun: AgentRun = {
      agent: makeAgent("agent-budget"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: fakeSandboxLayer(),
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
        (phase) => phase.children?.some((child) => child.key === "agent.turn"),
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
      runId: "carry-grow-passed-origin",
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
      sandbox: fakeSandboxLayer(),
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
          manifestsByKey: new Map(),
        dispatchByKey: new Map(),
        availableDeltas: [],
          carriedAttemptsByKey: new Map([[runPairKey(experimentId, evalId), new Set([0])]]),
          carriedResults: [carried],
        },
      });

      const matches = summary.results.filter((r) => r.id === evalId);
      expect(matches).toHaveLength(1); // 没有因为回填而多出真实结果
      expect(matches[0]!.verdict).toBe("passed");
      expect(matches[0]!.locator).toBe(staleLocator); // 携入结果原样透传

      // 不变量:携入 1 + early-exit 回填 2 == 本次请求的 attempts: 3,不留没有解释的差额
      // (queued 必须真正归零,不能停在「还差 2 个不知道去哪」)。回填的两轮没真跑,进 skipped。
      expect(coordinator.state).toMatchObject({ total: 3, reused: 1, running: 0, queued: 0, passed: 0, failed: 0, errored: 0, skipped: 2 });
    });
  });

  it("携入 1 条 failed、runs 从 1 调到 3:failed 不触发 earlyExit,差额两次必须真的重新调度", async () => {
    const experimentId = "carry-grow-failed-exp";
    const evalId = "grown-failed-eval";
    const staleLocator = encodeAttemptLocator({
      runId: "carry-grow-failed-origin",
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
    const evalDef = makeEval(evalId, (t: TestContext) => {
      calls += 1;
      t.check("actual", equals("expected"));
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-grow-failed"),
      flags: {},
      attempts: 3,
      earlyExit: true, // failed 不触发 earlyExit(只有 passed/errored 会),回填的两次应该真的跑
      sandbox: fakeSandboxLayer(),
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
          manifestsByKey: new Map(),
        dispatchByKey: new Map(),
        availableDeltas: [],
          carriedAttemptsByKey: new Map([[runPairKey(experimentId, evalId), new Set([0])]]),
          carriedResults: [carried],
        },
      });

      expect(calls).toBe(2); // 差额的两次真的执行了 agent,不是被携入悄悄吞掉
      const matches = summary.results.filter((r) => r.id === evalId);
      expect(matches).toHaveLength(3); // 1 携入 + 2 新跑,凑满本次请求的 attempts: 3
      expect(matches.map((r) => r.attempt).sort()).toEqual([0, 1, 2]);
      expect(matches.every((r) => r.verdict === "failed")).toBe(true);

      // 差额两次真的跑了,各自落进 failed —— 携入那条的 verdict 留在 reused,不摊进结局项。
      expect(coordinator.state).toMatchObject({ total: 3, reused: 1, running: 0, queued: 0, passed: 0, failed: 2, errored: 0, skipped: 0 });
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
      runId: "carry-noncontiguous-origin",
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
      sandbox: fakeSandboxLayer(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };

    const { summary } = await run([evalDef], [agentRun], {
      carryPlan: {
        plannedFingerprints: new Map(),
        acceptableFingerprints: new Map(),
        manifestsByKey: new Map(),
        dispatchByKey: new Map(),
        availableDeltas: [],
        carriedAttemptsByKey: new Map([[runPairKey(experimentId, evalId), new Set([1])]]),
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
      sandbox: fakeSandboxLayer(),
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
    let releaseSetup!: () => void;
    const setupBarrier = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    const evals = ["a", "b", "c"].map((id) =>
      makeEval(id, () => {
        completed += 1;
      }),
    );
    const agentRun = runWithHooks(
      "lifecycle-exp",
      async () => {
        setupCalls += 1;
        // 受控 barrier 把状态钉在 setup 进行中，验证其它并发 attempt 只等同一个 memo。
        await setupBarrier;
      },
      () => {
        teardownCalls += 1;
        completedAtTeardown = completed;
      },
      { attempts: 2, selectedEvalIds: ["a", "b", "c"] },
    );

    const running = run(evals, [agentRun], { maxConcurrency: 4 });
    await vi.waitFor(() => expect(setupCalls).toBe(1));
    expect(completed).toBe(0);
    releaseSetup();
    const { summary } = await running;

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
        manifestsByKey: new Map(),
        dispatchByKey: new Map(),
        availableDeltas: [],
        carriedAttemptsByKey: new Map([[runPairKey(experimentId, "done"), new Set([0])]]),
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
      expect(r.error).toMatchObject({ code: "experiment-setup-failed", origin: { scope: "attempt" as const, phase: "experiment.setup" } });
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

  it("setup 进行中被中断并由强清注册表接管时，等待 setup settle 后 teardown 仍恰好一次", async () => {
    let setupCalls = 0;
    let teardownCalls = 0;
    let releaseSetup!: () => void;
    const setupBarrier = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    const controller = new AbortController();
    const evalDef = makeEval("abort-during-setup", () => {});
    const agentRun = runWithHooks(
      "interrupt-drain-exp",
      async () => {
        setupCalls += 1;
        await setupBarrier;
      },
      () => {
        teardownCalls += 1;
      },
      { selectedEvalIds: ["abort-during-setup"] },
    );

    const running = run([evalDef], [agentRun], { signal: controller.signal });
    await vi.waitFor(() => expect(setupCalls).toBe(1));
    expect(pendingExperimentTeardownCount()).toBe(1);

    controller.abort();
    const draining = drainExperimentTeardowns();
    await Promise.resolve();
    expect(teardownCalls).toBe(0);
    releaseSetup();

    const [, drained] = await Promise.all([running, draining]);
    expect(drained).toBe(1);
    expect(teardownCalls).toBe(1);
    expect(pendingExperimentTeardownCount()).toBe(0);
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
      runActivity() {},
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
      sandbox: fakeSandboxLayer(),
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
      sandbox: fakeSandboxLayer(),
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
      sandbox: fakeSandboxLayer(),
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
      sandbox: fakeSandboxLayer(),
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
      sandbox: fakeSandboxLayer(),
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
      sandbox: fakeSandboxLayer(),
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
      runActivity() {},
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
      sandbox: fakeSandboxLayer(),
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
      runActivity() {},
      lifecycle() {},
    });

    let teardownCalls = 0;
    const evalDef = makeEval("fresh-eval", () => {});
    const agentRun: AgentRun = {
      agent: makeAgent(`agent-${experimentId}`),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxLayer(),
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
      runActivity() {},
      lifecycle() {},
    });

    let teardownCalls = 0;
    const evalDef = makeEval("fresh-eval", () => {});
    const agentRun: AgentRun = {
      agent: makeAgent(`agent-${experimentId}`),
      flags: {},
      attempts: 1,
      earlyExit: true,
      sandbox: fakeSandboxLayer(),
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
      sandbox: stableFakeSandboxLayer(),
      timeoutMs: 5_000,
      selectedEvalIds: ["fp"],
      experimentId: "fp-exp",
    };
    const withHook: AgentRun = { ...base, setup: () => {}, teardown: () => {} };

    const { computeFingerprint } = await import("./fingerprint.ts");
    expect(await computeFingerprint(await preparedPair(evalDef, withHook))).toBe(
      await computeFingerprint(await preparedPair(evalDef, base)),
    );
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
      targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
      exclusive: true,
      create: () => Effect.promise(async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await sleep(20);
        concurrent -= 1;
        return asSandbox(new FakeSandbox());
      }),
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
      targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
      exclusive: true,
      create: () => Effect.promise(async () => {
        exclusiveConcurrent += 1;
        exclusivePeak = Math.max(exclusivePeak, exclusiveConcurrent);
        await sleep(20);
        exclusiveConcurrent -= 1;
        return asSandbox(new FakeSandbox());
      }),
    });
    let normalConcurrent = 0;
    let normalPeak = 0;
    const normalSpec = defineSandbox({
      name: "normal-fake",
      targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
      create: () => Effect.promise(async () => {
        normalConcurrent += 1;
        normalPeak = Math.max(normalPeak, normalConcurrent);
        await sleep(20);
        normalConcurrent -= 1;
        return asSandbox(new FakeSandbox());
      }),
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

// send 重试退避期间只应释放全局并发位,实验级闸(runSem)必须全程持有——两级闸按持有期
// 分工的语义单点见 docs/runner.md「调度:有界并发」。失败必须是协议证明未受理的
// SendFailure；可信 failed Turn 是领域结果，不进入重试。
function retryableSendFailure(message: string) {
  return makeSendFailure({ acceptance: "rejected", message, cause: normalizeExternalCause({ status: 429 }) });
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
          if (sendCalls === 1) throw retryableSendFailure("rate limited, please retry later");
          return okTurn();
        },
      });
      let sandboxCreates = 0;
      const sandboxSpec = defineSandbox({
        name: "fake-retry-serial-sandbox",
        targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
        create: () => Effect.sync(() => {
          sandboxCreates += 1;
          return asSandbox(new FakeSandbox());
        }),
      });
      const evalA = makeEval("a", async (t: TestContext) => {
        await t.send("go");
      });
      const evalB = makeEval("b", async (t: TestContext) => {
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
  it("maxConcurrency: 1 下,上一个 attempt 的 Agent teardown 未完成时,下一个 attempt 的沙箱不会创建", async () => {
    let releaseTeardown!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseTeardown = resolve;
    });
    let teardownEntered = false;
    let sandboxCreates = 0;
    const sandboxSpec = defineSandbox({
      name: "fake-teardown-barrier-sandbox",
      targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
      create: () => Effect.sync(() => {
        sandboxCreates += 1;
        return asSandbox(new FakeSandbox());
      }),
    });
    const agent = defineSandboxAgent({
      name: "agent-teardown-barrier",
      send: async () => ({ events: [], status: "completed" }),
      teardown: async () => {
        teardownEntered = true;
        await barrier;
      },
    });

    const evalA = makeEval("a", () => {});
    const evalB = makeEval("b", () => {});
    const agentRun: AgentRun = {
      agent,
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

    // a 的 Agent teardown 挂在 barrier 上:runSem 名额要到整条 attempt 收尾完成才归还,
    // 所以 b 的沙箱这段时间不该被创建。
    await vi.waitFor(() => expect(teardownEntered).toBe(true));
    expect(sandboxCreates).toBe(1);

    releaseTeardown();
    const { summary } = await runPromise;
    expect(summary.results).toHaveLength(2);
    expect(summary.results.every((r) => r.verdict === "passed")).toBe(true);
    expect(sandboxCreates).toBe(2); // Agent teardown 放行、a 收尾完成后 b 的沙箱才创建
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
            throw retryableSendFailure("rate limited, please retry later");
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

      const evalR = makeEval("r1", async (t: TestContext) => {
        await t.send("go");
      });
      const evalW1 = makeEval("w1", async (t: TestContext) => {
        await t.send("go");
      });
      const evalW2 = makeEval("w2", async (t: TestContext) => {
        await t.send("go");
      });

      const runR: AgentRun = {
        agent: agentR,
        flags: {},
        attempts: 1,
        earlyExit: false,
        sandbox: fakeSandboxLayer(),
        timeoutMs: 30_000,
        selectedEvalIds: ["r1"],
        experimentId: "guard-r",
      };
      const runW: AgentRun = {
        agent: agentW,
        flags: {},
        attempts: 1,
        earlyExit: false,
        sandbox: fakeSandboxLayer(),
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
    accept?: string[];
    priorManifests?: ReadonlyMap<string, EvalManifest>;
  } = {},
): Promise<{ summary: InvocationSummary; root: string }> {
  const root = opts.root ?? (await makeRoot());
  const config: Config = {};
  const runOpts: RunOptions = {
    config,
    evals,
    agentRuns: agentRuns.map(completeAgentRun),
    reporters: [{ reporter: Artifacts(root), name: "artifacts", required: false }],
    maxConcurrency: opts.maxConcurrency ?? 3,
    niceevalRoot: root,
    ...(opts.priorResults !== undefined ? { priorResults: opts.priorResults.map(completeEvalResult) } : {}),
    ...(opts.accept !== undefined ? { accept: opts.accept } : {}),
    ...(opts.priorManifests !== undefined ? { priorManifests: opts.priorManifests } : {}),
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
      sandbox: stableFakeSandboxLayer(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };
    // 指纹依赖 evalDef.sourcePath 的文件内容(makeEval 统一指向本测试文件)与 run 的配置字段,
    // 不依赖 test() 闭包本身 —— 用真实的 computeFingerprint 算,而不是随便编一个字符串,
    // 才能真的驱动到"指纹匹配"这条携带路径。
    const pair = await preparedPair(evalDef, agentRun);
    const fingerprint = await computeFingerprint(pair);
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

  it("--accept 授权携入:按本次规划重打指纹、条目留 carriedAccepting、Run 记一条 accept 诊断", async () => {
    const evalId = "carry-restamp-eval";
    const experimentId = "carry-restamp-exp";
    const evalDef = makeEval(evalId, async () => {
      throw new Error("carried attempt must not be dispatched");
    });
    const sandbox = stableFakeSandboxLayer();
    const base = {
      agent: makeAgent("agent-carry-restamp"),
      attempts: 1,
      earlyExit: true,
      sandbox,
      timeoutMs: 5_000,
      selectedEvalIds: [evalId],
      experimentId,
    };
    // 上一轮的 endpoint 已从本轮 flags 移走(键从 flags 移除也是一条 config:flags.<key> 差异);
    // 它落盘的指纹是**整袋 flags**(含旧 endpoint)算的,与本轮规划的那个不相等。
    const oldFlags = { endpoint: "https://old.example" };
    const agentRun: AgentRun = { ...base, flags: {} };
    const oldRun: AgentRun = { ...base, flags: oldFlags };
    const oldPair = await preparedPair(evalDef, oldRun);
    const plannedPair = await preparedPair(evalDef, agentRun);
    const old = await fingerprintWithManifest(oldPair);
    const oldFingerprint = old.fingerprint;
    const plannedFingerprint = await computeFingerprint(plannedPair);
    expect(oldFingerprint).not.toBe(plannedFingerprint);
    const oldExperiment = experimentRunInfo(
      completeAgentRun(oldRun),
      oldPair.plan,
      { [evalId]: oldPair.identity },
    );
    if (oldExperiment === undefined) throw new Error("test fixture did not produce experiment run info");

    const prior: EvalResult = {
      id: evalId,
      experimentId,
      agent: agentRun.agent.name,
      verdict: "passed",
      attempt: 0,
      fingerprint: oldFingerprint,
      configHash: computeConfigHash(oldPair),
      experiment: oldExperiment,
      startedAt: new Date().toISOString(),
      durationMs: 1,
      assertions: [],
      // 携带条目回指产出它那一轮的 artifact 目录;Artifacts 据此补写、进而封口本次 Run。
      artifactBase: "carry-restamp-exp/earlier-run/carry-restamp-eval/a1",
    };

    const { summary, root } = await runWithPriorResults([evalDef], [agentRun], {
      priorResults: [prior],
      accept: ["config:flags.endpoint"],
      // 差异解释读产出那一轮写下的清单(那一份 Run 的 manifests.json)。
      priorManifests: new Map([[runPairKey(experimentId, evalId), old.manifest]]),
    });

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]!.verdict).toBe("passed");
    // 重锚:下一次跑同一条命令不带 --accept 也自然命中。
    expect(summary.results[0]!.fingerprint).toBe(plannedFingerprint);
    // 留痕跟着结果走,写下跨过的那条差异。
    expect(summary.results[0]!.carriedAccepting).toEqual([
      { _tag: "Removed", selector: "config:flags.endpoint", from: "https://old.example" },
    ]);
    // Run 侧另记一条 diagnostic,code 是可按值分支的稳定词。
    const record = await openRecord(root);
    const diagnostics = record.experiments.find((e) => e.id === experimentId)?.latestRun.diagnostics ?? [];
    expect(diagnostics.map((d) => d.code)).toContain("accept");
    expect(diagnostics.find((d) => d.code === "accept")?.context?.selectors).toEqual(["config:flags.endpoint"]);
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
        sandbox: fakeSandboxLayer(),
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
        sandbox: fakeSandboxLayer(),
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
      sandbox: stableFakeSandboxLayer(),
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
      sandbox: fakeSandboxLayer(),
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
      sandbox: stableFakeSandboxLayer(),
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
      sandbox: fakeSandboxLayer(),
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
      sandbox: fakeSandboxLayer(),
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
    sandbox: fakeSandboxLayer(),
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
      const sandbox = stableFakeSandboxLayer();

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
    const sandbox = stableFakeSandboxLayer();
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
    const sandbox = fakeSandboxLayer();
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
      const sandbox = fakeSandboxLayer();
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
    const sandbox = stableFakeSandboxLayer();

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
    const sandbox = stableFakeSandboxLayer();
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
    const sandbox = fakeSandboxLayer();

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
      state.skipped,
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
      expect(halted[0]!.error?.origin.scope === "attempt" ? halted[0]!.error.origin.phase : undefined).toBe(plainThrow.error?.origin.scope === "attempt" ? plainThrow.error.origin.phase : undefined);

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

  it("已登记敏感值的终局失败在 onFailureClass 前封口，反馈、result.json 与 dispatch-halted 均不泄漏", async () => {
    const experimentId = "halt-sensitive-exp";
    const sensitive = "synthetic-sensitive-value-for-halt-test";
    const started: string[] = [];
    const fatal = makeEval("s-fatal", async (t: TestContext) => {
      started.push("s-fatal");
      // 成功命令本身不生成 commands artifact，但 sensitiveValues 已登记进当前 Attempt。
      await t.sandbox.runCommand("register-sensitive-value", [], { sensitiveValues: [sensitive] });
      throw new ExperimentFatalError(`shared credential ${sensitive} was rejected`);
    });
    const blocked = makeEval("s-blocked", () => {
      started.push("s-blocked");
    });
    const agentRun = probeRun(makeAgent("agent-halt-sensitive"), experimentId, ["s-fatal", "s-blocked"]);
    const plan: RunFeedbackPlan = {
      shape: { evals: 2, configs: 1, totalAttempts: 2, maxConcurrency: 1 },
      reused: 0,
      reusedFailures: [],
    };

    await withCoordinator(plan, async (coordinator) => {
      const { summary, root } = await runWithPriorResults([fatal, blocked], [agentRun], {
        priorResults: [],
        maxConcurrency: 1,
      });

      expect(started).toEqual(["s-fatal"]);
      expect(summary.results).toHaveLength(1);
      const notice = coordinator.state.diagnostics.find((d) => d.key === experimentHaltKey(experimentId));
      expect(notice).toBeDefined();
      const persistedHalt = await snapshotHaltDiagnostics(root, experimentId);
      expect(persistedHalt).toHaveLength(1);
      const record = await openRecord(root);
      const persistedAttempt = record.experiments
        .find((entry) => entry.id === experimentId)
        ?.latestRun.evals.find((entry) => entry.id === "s-fatal")
        ?.attempts[0]?.result;
      expect(persistedAttempt).toBeDefined();

      const everySurface = JSON.stringify({
        summaryResult: summary.results[0],
        feedback: notice,
        runDiagnostic: persistedHalt,
        resultJson: persistedAttempt,
      });
      expect(everySurface).not.toContain(sensitive);
      expect(everySurface).toContain("<redacted>");
      expect(summary.results[0]!.error?.message).toBe("shared credential <redacted> was rejected");
      expect(notice!.message).toContain("shared credential <redacted> was rejected");
      expect(persistedHalt[0]!.detail).toContain("shared credential <redacted> was rejected");
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
        origin: { scope: "attempt" as const, phase: "eval.run" },
        context: { scope: "eval", evalId: "f-fatal" },
      });
      expect(persisted[0]!.detail).toContain(message);
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
          // 只有第一次 send 撞 admission 限流:退避一次后成功。
          if (sendCalls === 1) throw retryableSendFailure("rate limited, please retry later");
          return okTurn();
        },
      });
      const started: string[] = [];
      const evals = ["c-1", "c-2"].map((id) =>
        makeEval(id, async (t: TestContext) => {
          started.push(id);
          await t.send("go");
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
        expect(summary.results.find((r) => r.id === "c-1")?.retryAttempts).toHaveLength(1);
        expect(summary.results.find((r) => r.id === "c-1")?.retryAttempts?.[0]).toMatchObject({
          sendAttempt: 0,
          failure: { type: "agent-send-failed", acceptance: "rejected" },
          classification: { retryable: true, scope: "experiment", reason: "rate_limit" },
        });
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
          throw retryableSendFailure("rate limited, please retry later"); // 永远撞限流,重试必耗尽
        },
      });
      const started: string[] = [];
      const evals = ["d-1", "d-2"].map((id) =>
        makeEval(id, async (t: TestContext) => {
          started.push(id);
          await t.send("go");
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
        expect(summary.results[0]!.error).toMatchObject({ code: "agent-send-failed" });
        expect(summary.results[0]!.retryAttempts).toHaveLength(3); // 最终失败在 error，不重复进 retryAttempts
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
      expect(persisted[0]!.context).toMatchObject({ scope: "experiment" });
      expect(persisted[0]!.context?.evalId).toBeUndefined(); // 实验闸没有 evalId
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

  it("Agent teardown 抛声明:照常落闸(剩余两条计 unstarted),但 verdict 仍是 passed", async () => {
    const experimentId = "halt-attempt-teardown";
    const started: string[] = [];
    const ids = ["k-1", "k-2", "k-3"];
    const evals = ids.map((id) =>
      makeEval(id, () => {
        started.push(id);
      }),
    );
    const agent = defineSandboxAgent({
      name: "agent-halt-attempt-teardown",
      send: async () => ({ events: [], status: "completed" }),
      teardown: () => {
        throw new ExperimentFatalError("shared db handle leaked; restart the stack");
      },
    });
    const agentRun = probeRun(agent, experimentId, ids);
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
      expect(summary.results[0]!.diagnostics?.some((d) => d.origin?.scope === "attempt" && d.origin.phase === "agent.teardown")).toBe(true);

      const notice = coordinator.state.diagnostics.find((d) => d.key === experimentHaltKey(experimentId));
      expect(notice).toBeDefined();
      expect(notice!.data?.unstarted).toBe(2);
      expect(notice!.data?.phase).toBe("agent.teardown");
      const persisted = await snapshotHaltDiagnostics(root, experimentId);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.origin?.scope === "attempt" ? persisted[0]!.origin.phase : undefined).toBe("agent.teardown");
      expectCountIdentity(coordinator.state);
    });
  }, SCHEDULING_TEST_TIMEOUT_MS);
});

// ════════════ linked prepare 失败的归一化与止损闸 ═════════════
// bug: memory/experiment-fatal-presented-as-user-interrupt.md

describe("runEvals · linked prepare 失败", () => {
  afterEach(() => {
    expect(activeFeedbackSinkCount()).toBe(0);
    expect(pendingHeldCaseLockCount()).toBe(0);
  });

  // Experiment prepare 失败是本条 attempt 的终局失败(errored + 空间轴回执),不是调度缺陷。
  it("Experiment SandboxLayer prepare 抛 ExperimentFatalError:本条 errored 且正文可见、落实验闸、同批其它实验照跑、不冒充中断", async () => {
    const haltedExp = "lease-fatal-exp";
    const bystanderExp = "lease-bystander-exp";
    const message = "shared tunnel is down; run `make tunnel` and retry";
    const startedHalted: string[] = [];
    const startedBystander: string[] = [];
    const haltedIds = ["r-1", "r-2", "r-3"];
    const haltedEvals = haltedIds.map((id) =>
      makeEval(id, () => {
        startedHalted.push(id);
      }),
    );
    const bystanderEvals = ["b-1", "b-2"].map((id) =>
      makeEval(id, () => {
        startedBystander.push(id);
      }),
    );
    const reusableSandbox = defineSandbox({
      name: "fake-linked-prepare",
      targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
      create: () => Effect.succeed(asSandbox(new FakeSandbox())),
    });
    const haltedRun: AgentRun = {
      ...probeRun(makeAgent("agent-lease-fatal"), haltedExp, haltedIds, {
      sandbox: reusableSandbox,
      }),
      sandbox: reusableSandbox.prepare(() => {
        throw new ExperimentFatalError(message);
      }),
    };
    const bystanderRun = probeRun(makeAgent("agent-lease-bystander"), bystanderExp, ["b-1", "b-2"]);
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

      // prepare 失败发生在 test() 之前:被撞死的那条一次都没进过 test(),但照常落一条 errored。
      expect(startedHalted).toEqual([]);
      const halted = summary.results.filter((r) => r.experimentId === haltedExp);
      expect(halted).toHaveLength(1);
      expect(halted[0]!.verdict).toBe("errored");
      // 正文走完全程:作者的修复提示既在结果里,也在两条诊断通路里。
      expect(halted[0]!.error?.message).toContain(message);
      expect(halted[0]!.error?.origin.scope === "attempt" ? halted[0]!.error.origin.phase : undefined).toBe("sandbox.prepare.experiment");

      // 不连坐:同批另一个实验的两条全跑完。
      expect([...startedBystander].sort()).toEqual(["b-1", "b-2"]);
      expect(summary.results.filter((r) => r.experimentId === bystanderExp)).toHaveLength(2);

      // 落实验闸:剩下两条计 unstarted;两条通路同源。
      const notice = coordinator.state.diagnostics.find((d) => d.key === experimentHaltKey(haltedExp));
      expect(notice).toBeDefined();
      expect(notice!.message).toContain(message);
      expect(notice!.data?.unstarted).toBe(2);
      const persisted = await snapshotHaltDiagnostics(root, haltedExp);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.detail).toContain(message);

      // 不冒充用户中断:整次运行照常收尾,反馈流里没有 interrupted 诊断。
      expect(coordinator.state.diagnostics.some((d) => d.key === "interrupted")).toBe(false);
      expectCountIdentity(coordinator.state);
      expect(await lockFilesRemaining(root)).toEqual([]);
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
    const sandbox = fakeSandboxLayer();

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
    const sandbox = stableFakeSandboxLayer();

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

// cases: docs/engineering/testing/unit/experiments-runner.md「Judge 预检失败的降级」
// 契约见 docs/feature/judge/library.md「派发前预检」:预检失败只作废需要 judge 的 eval,
// 不拦整次运行。同一批里含 judge 与不含 judge 的 eval 都要有,才有区分力——只有一条 eval 时
// 「作废这条」与「中止整次运行」在任何断言下都长得一样。
describe("runEvals · 判分预检失败只作废含 judge 的 eval", () => {
  const judge = { model: "probe-model", baseUrl: "http://judge.fixture.internal/v1" };

  /** 预检的目标集合按 `evalDef.sourcePath` 的真实文件内容判定(`/\bjudge\b/` 启发式,见
   *  run.ts 的 judgeProbePlan)。这批用例要精确控制「哪条 eval 会执行 judge 断言」,所以逐条
   *  写一个临时源文件——共用的 `makeEval` 指向本测试文件,而它自己满篇是 judge。 */
  async function evalWithSource(id: string, sourceText: string, test: DiscoveredEval["test"]): Promise<DiscoveredEval> {
    const dir = await makeRoot();
    const path = join(dir, `${id}.eval.ts`);
    await writeFile(path, sourceText, "utf-8");
    return discoverEval(defineEval({ test }), {
      id,
      baseDir: "/project",
      sourcePath: path,
      loaderDataPaths: Object.freeze([]),
      criteriaPaths: Object.freeze([]),
      privatePaths: Object.freeze([]),
      source,
    });
  }

  const JUDGE_SOURCE = 'test("judged", async (t) => { t.judge.closedQA("是否说清了原因?"); });';
  const PLAIN_SOURCE = 'test("plain", async (t) => { t.check("ok", equals("ok")); });';

  /** 只收本用例关心的两类输入,其余成员 no-op(与 sink 接口保持编译期同步)。 */
  function captureSink(): {
    precheck: PrecheckInput[];
    failures: FailureInput[];
    deactivate: () => void;
  } {
    const precheck: PrecheckInput[] = [];
    const failures: FailureInput[] = [];
    const deactivate = activateFeedbackSink({
      activity() {},
      diagnostic() {},
      interrupted() {},
      reporterError() {},
      failure(input) {
        failures.push(input);
      },
      budgetExhausted() {},
      kept() {},
      experimentHook() {},
      experimentProgress() {},
      precheck(input) {
        precheck.push(input);
      },
      lockWait() {},
      runActivity() {},
      lifecycle() {},
    });
    return { precheck, failures, deactivate };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("同一 Eval 的 Experiment Judge A/B 按 pair 隔离预检失败", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      return url.includes("bad-judge")
        ? new Response("denied", { status: 401 })
        : new Response(JSON.stringify({ data: [] }), { status: 200 });
    }));

    let ran = 0;
    let created = 0;
    const judged = await evalWithSource("shared-judged", JUDGE_SOURCE, () => {
      ran += 1;
    });
    const countingSandbox = defineSandbox({
      name: "pair-counting-provider",
      targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
      create: () => Effect.sync(() => {
        created += 1;
        return asSandbox(new FakeSandbox());
      }),
    });
    const base: Omit<AgentRun, "experimentId" | "judge"> = {
      agent: makeAgent("agent-a"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: countingSandbox,
      timeoutMs: 5_000,
      selectedEvalIds: ["shared-judged"],
    };
    const bad: AgentRun = {
      ...base,
      experimentId: "judge-bad",
      judge: { model: "bad", baseUrl: "http://bad-judge.fixture/v1" },
    };
    const good: AgentRun = {
      ...base,
      experimentId: "judge-good",
      judge: { model: "good", baseUrl: "http://good-judge.fixture/v1" },
    };

    const { summary } = await run([judged], [bad, good]);
    const byExperiment = new Map(summary.results.map((result) => [result.experimentId, result]));
    expect(byExperiment.get("judge-bad")).toMatchObject({
      verdict: "errored",
      error: { code: "judge-precheck-failed" },
      experiment: { judge: { model: "bad", baseUrl: "http://bad-judge.fixture/v1" } },
    });
    expect(byExperiment.get("judge-good")).toMatchObject({
      verdict: "passed",
      experiment: { judge: { model: "good", baseUrl: "http://good-judge.fixture/v1" } },
    });
    expect(ran).toBe(1);
    expect(created).toBe(1);
  });

  it("含 judge 的 eval 全部 attempt 不派发、不建沙箱、逐条 errored 落盘;不含 judge 的照常跑出 verdict", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    // 探测两次都超时(fake fetch 立即抛,不真等 20s):预检判失败。
    const probe = vi.fn(async (): Promise<Response> => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    vi.stubGlobal("fetch", probe);

    let judgedRan = 0;
    let plainRan = 0;
    const judged = await evalWithSource("judged", JUDGE_SOURCE, () => {
      judgedRan += 1;
    });
    const plain = await evalWithSource("plain", PLAIN_SOURCE, () => {
      plainRan += 1;
    });
    // 「不创建沙箱」只有真数一遍 create() 才算证明:被作废的 attempt 连沙箱都不该起。
    let created = 0;
    const countingSandbox = defineSandbox({
      name: "counting-provider",
      targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
      create: () => Effect.sync(() => {
        created += 1;
        return asSandbox(new FakeSandbox());
      }),
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-a"),
      flags: {},
      attempts: 2,
      earlyExit: false,
      sandbox: countingSandbox,
      timeoutMs: 5_000,
      selectedEvalIds: ["judged", "plain"],
      experimentId: "precheck-exp",
    };

    const sink = captureSink();
    let summary: Awaited<ReturnType<typeof runEvals>>;
    let root: string;
    try {
      ({ summary, root } = await run([judged, plain], [agentRun], { config: { judge }, maxConcurrency: 2 }));
    } finally {
      sink.deactivate();
    }

    // 受影响的 eval:计划里的两条 attempt 逐条 errored,错误形状是派发前确定性失败。
    const judgedResults = summary.results.filter((r) => r.id === "judged");
    expect(judgedResults).toHaveLength(2);
    expect(judgedResults.map((r) => r.attempt).sort()).toEqual([0, 1]);
    for (const result of judgedResults) {
      expect(result.verdict).toBe("errored");
      expect(result.error?.code).toBe("judge-precheck-failed");
      expect((result.error?.origin.scope === "attempt" ? result.error.origin.phase : undefined)).toBe("judge.precheck");
      // message 带实际探测端点与失败原因(超时秒数),不是一句无处下手的 "judge failed"。
      expect(result.error?.message).toContain("http://judge.fixture.internal/v1");
      expect(result.error?.message).toContain("20s");
    }
    expect(judgedRan).toBe(0); // 一条 attempt 都没真派发

    // 其余 eval 照常派发:一条 judge 配置问题不没收整批与它无关的结果。
    const plainResults = summary.results.filter((r) => r.id === "plain");
    expect(plainResults).toHaveLength(2);
    expect(plainResults.every((r) => r.verdict === "passed")).toBe(true);
    expect(plainRan).toBe(2);
    expect(created).toBe(2); // 只有 plain 的两条 attempt 起了沙箱

    // verdict 计数进 errored,不被折叠成一句运行级错误。
    expect(summary.errored).toBe(2);
    expect(summary.passed).toBe(2);

    // 预检本身的结局是一对运行级事件(started + failed 带耗时),不是一条抛出的错误。
    expect(sink.precheck.map((p) => p.status)).toEqual(["started", "failed"]);
    expect(sink.precheck[1]?.durationMs).toBeTypeOf("number");

    // 受影响 attempt 的 errored 仍逐条走既有 failure 通道(与实验级 setup 失败同构)。
    const precheckFailures = sink.failures.filter((f) => f.identity.evalId === "judged");
    expect(precheckFailures).toHaveLength(2);
    for (const failure of precheckFailures) {
      expect(failure.verdict).toBe("errored");
      expect(failure.phase).toBe("judge.precheck");
      expect(failure.reason).toContain("http://judge.fixture.internal/v1");
    }

    // 落盘与真实结果同构:result.json 逐条可读,不是只留在内存摘要里。
    const record = await openRecord(root);
    const exp = record.experiments.find((e) => e.id === "precheck-exp");
    const written = exp?.latestRun.evals.find((e) => e.id === "judged")?.attempts ?? [];
    expect(written).toHaveLength(2);
    for (const attempt of written) {
      expect(attempt.result.verdict).toBe("errored");
      expect(attempt.result.error?.code).toBe("judge-precheck-failed");
      expect(attempt.result.error?.origin.scope === "attempt" ? attempt.result.error.origin.phase : undefined).toBe("judge.precheck");
    }
  });

  it("未配置 judge 时不探测:含 judge 字样的 eval 照常派发(运行期才按 judge-model-unresolved 记录)", async () => {
    const probe = vi.fn(async (): Promise<Response> => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", probe);

    let ran = 0;
    const judged = await evalWithSource("judged", JUDGE_SOURCE, () => {
      ran += 1;
    });
    const agentRun: AgentRun = {
      agent: makeAgent("agent-a"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: fakeSandboxLayer(),
      timeoutMs: 5_000,
      selectedEvalIds: ["judged"],
      experimentId: "no-judge-exp",
    };

    const sink = captureSink();
    let summary: Awaited<ReturnType<typeof runEvals>>;
    try {
      ({ summary } = await run([judged], [agentRun], { config: {} }));
    } finally {
      sink.deactivate();
    }

    expect(probe).not.toHaveBeenCalled();
    expect(sink.precheck).toEqual([]);
    expect(ran).toBe(1);
    expect(summary.results[0]?.verdict).toBe("passed");
  });

  it("含 judge 的 eval 全部命中携带时不探测:没有要派发的 attempt,没有可省的 agent 成本", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    const probe = vi.fn(async (): Promise<Response> => {
      throw new Error("端点不通:全部携带时根本不该探测");
    });
    vi.stubGlobal("fetch", probe);

    const experimentId = "carried-judge-exp";
    const judged = await evalWithSource("judged", JUDGE_SOURCE, () => {
      throw new Error("全部携带的 eval 不该被重新派发");
    });
    let plainRan = 0;
    const plain = await evalWithSource("plain", PLAIN_SOURCE, () => {
      plainRan += 1;
    });
    const carried: EvalResult = {
      id: "judged",
      experimentId,
      agent: "agent-a",
      verdict: "passed",
      attempt: 0,
      startedAt: "2020-01-01T00:00:00.000Z",
      durationMs: 1,
      assertions: [],
      locator: encodeAttemptLocator({
        runId: "judge-carried-origin",
        evalId: "judged",
        attempt: 0,
      }),
      artifactBase: `${experimentId}/old-run/judged/a0`,
    };
    const agentRun: AgentRun = {
      agent: makeAgent("agent-a"),
      flags: {},
      attempts: 1,
      earlyExit: false,
      sandbox: fakeSandboxLayer(),
      timeoutMs: 5_000,
      selectedEvalIds: ["judged", "plain"],
      experimentId,
    };

    const sink = captureSink();
    let summary: Awaited<ReturnType<typeof runEvals>>;
    try {
      ({ summary } = await run([judged, plain], [agentRun], {
        config: { judge },
        carryPlan: {
          plannedFingerprints: new Map(),
          acceptableFingerprints: new Map(),
          manifestsByKey: new Map(),
        dispatchByKey: new Map(),
        availableDeltas: [],
          carriedAttemptsByKey: new Map([[runPairKey(experimentId, "judged"), new Set([0])]]),
          carriedResults: [carried],
        },
      }));
    } finally {
      sink.deactivate();
    }

    expect(probe).not.toHaveBeenCalled();
    expect(sink.precheck).toEqual([]);
    expect(plainRan).toBe(1);
    expect(summary.results.filter((r) => r.id === "judged").map((r) => r.verdict)).toEqual(["passed"]);
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md
// - 共享 Run activity 不占 attempt 位
// - build failure 的 Run origin
describe("runEvals · Run 级共享构建协调", () => {
  it("maxBuildConcurrency 独立放宽 Run 级 BuildKey 构建并发", async () => {
    let running = 0;
    let peak = 0;
    const buildKeys = ["bk-a", "bk-b", "bk-c"] as const;
    const evalDef = makeEval(
      "build-width",
      async () => {},
      reusableFakeSandboxLayer(() => {}, {
        _tag: "Required",
        caseKey: "case-build-width",
        buildKeys,
      }),
    );
    const agentRun: AgentRun = {
      agent: makeAgent("agent-build-width"),
      experimentId: "exp-build-width",
      flags: {},
      attempts: 1,
      earlyExit: false,
      selectedEvalIds: ["build-width"],
    };

    await run([evalDef], [agentRun], {
      maxConcurrency: 1,
      maxBuildConcurrency: 3,
      buildPreparation: {
        works: buildKeys.map((buildKey) => ({ buildKey, provider: "docker", inputs: { buildKey } })),
        pairBuildKeys: { [runPairKey("exp-build-width", "build-width")]: buildKeys },
        provider: {
          async lookup() {
            return undefined;
          },
          async build(work) {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 20));
            running -= 1;
            return `sha256:${work.buildKey}`;
          },
        },
      },
    });

    expect(peak).toBe(3);
  });

  it("逐 BuildKey 放行:依赖者等自己的 key,不依赖的同批开跑;timings/sandboxBuilds 落盘", async () => {
    let buildRunning = false;
    let depStartedDuringBuild = false;
    let otherStartedDuringBuild = false;
    // 不依赖任何 BuildKey 的 eval:构建还在跑它就该开始,全局 barrier 在这一格必红。
    let markOtherStarted!: () => void;
    const otherStarted = new Promise<void>((resolve) => {
      markOtherStarted = resolve;
    });
    const evalDep = makeEval(
      "dep",
      async () => {
        if (buildRunning) depStartedDuringBuild = true;
      },
      reusableFakeSandboxLayer(() => {}, {
        _tag: "Required",
        caseKey: "case-bk-shared",
        buildKeys: ["bk-shared"],
      }),
    );
    const evalOther = makeEval(
      "other",
      async () => {
        if (buildRunning) otherStartedDuringBuild = true;
        markOtherStarted();
      },
      fakeSandboxLayer(),
    );
    const agentRun: AgentRun = {
      agent: makeAgent("agent-a"),
      experimentId: "exp-build",
      flags: {},
      attempts: 1,
      earlyExit: false,
      timeoutMs: 5_000,
      selectedEvalIds: ["dep", "other"],
    };
    const { root } = await run([evalDep, evalOther], [agentRun], {
      maxConcurrency: 2,
      buildPreparation: {
        works: [{ buildKey: "bk-shared", provider: "docker", inputs: { tag: "a" }, label: "shared image" }],
        pairBuildKeys: { [runPairKey("exp-build", "dep")]: ["bk-shared"] },
        provider: {
          async lookup() {
            return undefined;
          },
          async build() {
            buildRunning = true;
            // 等到不依赖这个 key 的 eval 真的跑起来,再让构建返回。
            await otherStarted;
            await new Promise((r) => setTimeout(r, 40));
            buildRunning = false;
            return "sha256:shared";
          },
        },
        maxConcurrency: 1,
      },
    });
    expect(otherStartedDuringBuild).toBe(true);
    expect(depStartedDuringBuild).toBe(false);

    const record = await openRecord(root);
    const runMeta = record.experiments.find((e) => e.id === "exp-build")!.latestRun;
    expect(runMeta.timings?.some((t) => t.key === "sandbox.build" && t.durationMs >= 40)).toBe(true);
    expect(runMeta.sandboxBuilds?.[0]).toMatchObject({ buildKey: "bk-shared", status: "built" });
    expect(runMeta.sandboxBuilds?.[0] && !("durationMs" in runMeta.sandboxBuilds[0])).toBe(true);
  });

  it("确定性构建失败:依赖 eval 全部 errored 且共用同一 run origin;不伪造 attempt 锚点", async () => {
    const evalDep = makeEval(
      "needs-build",
      async () => {
        throw new Error("should not run");
      },
      reusableFakeSandboxLayer(() => {}, {
        _tag: "Required",
        caseKey: "case-bk-bad",
        buildKeys: ["bk-bad"],
      }),
    );
    const evalOk = makeEval("independent", async () => {}, fakeSandboxLayer());
    const agentRun: AgentRun = {
      agent: makeAgent("agent-a"),
      experimentId: "exp-fail",
      flags: {},
      attempts: 2,
      earlyExit: false,
      timeoutMs: 5_000,
      selectedEvalIds: ["needs-build", "independent"],
    };
    const { summary, root } = await run([evalDep, evalOk], [agentRun], {
      buildPreparation: {
        works: [{ buildKey: "bk-bad", provider: "docker", inputs: { tag: "bad" } }],
        pairBuildKeys: { [runPairKey("exp-fail", "needs-build")]: ["bk-bad"] },
        provider: {
          async lookup() {
            return undefined;
          },
          async build() {
            throw new Error("compose build failed");
          },
        },
      },
    });

    const deps = summary.results.filter((r) => r.id === "needs-build");
    expect(deps).toHaveLength(2);
    expect(deps.every((r) => r.verdict === "errored")).toBe(true);
    const timingNodeId = deps[0]!.error?.origin.scope === "run" ? deps[0]!.error.origin.timingNodeId : undefined;
    expect(timingNodeId).toBeTruthy();
    expect(
      deps.every(
        (r) => r.error?.origin.scope === "run" && r.error.origin.timingNodeId === timingNodeId,
      ),
    ).toBe(true);
    expect(deps.every((r) => r.error?.code === "sandbox-build-failed")).toBe(true);
    // 不伪造 sandbox.create 或其它 attempt 锚点。
    expect(deps.every((r) => r.error?.origin.scope === "run")).toBe(true);
    // 不依赖该 key 的 attempt 不被 build failure 扇出(可能因其它并发 WIP 失败,但不是 build origin)。
    const independent = summary.results.filter((r) => r.id === "independent");
    expect(independent).toHaveLength(2);
    expect(
      independent.every(
        (r) => !(r.error?.origin.scope === "run" && r.error.code === "sandbox-build-failed"),
      ),
    ).toBe(true);

    const runMeta = (await openRecord(root)).experiments.find((e) => e.id === "exp-fail")!.latestRun;
    expect(runMeta.sandboxBuilds?.[0]?.timingNodeId).toBe(timingNodeId);
    expect(runMeta.timings?.some((t) => t.id === timingNodeId && t.key === "sandbox.build" && t.failed)).toBe(true);
  });
});
