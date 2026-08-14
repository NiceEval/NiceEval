// niceeval CLI 入口。执行 eval 必须以 experiment 为单位;位置参数只在 exp 后筛 eval id 前缀。
//   niceeval check [组|配置] [pattern]  只做发现、选择与 SandboxLayer pure link
//   niceeval exp [组|配置] [pattern]    跑实验
//   niceeval debug <配置> <eval>        只规划一个配对的 Sandbox / Plugin lifecycle
//   niceeval accept @<locator>...       接受多条历史结果并重锚到当前配置
//   niceeval show [selection]        终端渲染一次固定的 ReportExecution
//   niceeval list                    只列出发现到的 eval
//   niceeval clean [--record <root>] [--yes]    删除未完成 Run
//   niceeval migrate [--record <root>] [--yes]  显式迁移 Record

import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { parseArgs as nodeParseArgs } from "node:util";
import { Data, Effect, Either, Schema } from "effect";
import {
  parseAttemptLocator,
  type AttemptLocator,
} from "./attempt-locator.ts";
import { discoverEvals, discoverExperiments } from "./runner/discover.ts";
import { browsableExperimentPaths, evalPrefixPredicate, matchExperimentSelector } from "./shared/aggregate.ts";
import type { JsonValue } from "./shared/types.ts";
import { runEvals, type AgentRun } from "./runner/run.ts";
import { planProjectTarget, type ProjectTargetPlan } from "./runner/fingerprint.ts";
import { loadProjectCurrent } from "./runner/project-current.ts";
import {
  makeRecordRoot,
  RunIdSchema,
  type RecordRoot,
} from "./record/index.ts";
import {
  ExperimentIdSchema,
  type AnalysisSelectionRequest,
  type ExperimentId,
  type RunId,
} from "./analysis/index.ts";
import { defaultAttemptOverviewReport } from "./report/built-in/attempt-overview.ts";
import { defaultOverviewReport } from "./report/built-in/overview.ts";
import { defaultRunMembershipOverviewReport } from "./report/built-in/run-membership-overview.ts";
import {
  executionEvidenceReport,
  timingEvidenceReport,
} from "./report/built-in/execution.ts";
import { sourceEvidenceReport } from "./report/built-in/source.ts";
import { reportRoute, type ReportRoute } from "./report/author/identity.ts";
import type { Report } from "./report/author/model.ts";
import type { ReportExecution } from "./report/execution/model.ts";
import {
  executeReportForAttemptFromRecord,
  executeReportFromRecord,
  exportStaticReport,
  openReportViewSession,
  ReportConsole,
  ReportFileSystem,
  showReport,
} from "./report/host/index.ts";
import {
  basalt,
  chalk,
  loadTrustedReportConfig,
  loadTrustedReportModule,
  loadTrustedThemeModule,
  makeNodeReportFileSystem,
  ReportModuleLoadError,
  resolveTrustedModulePath,
  type ThemeDefinition,
} from "./report/host/node.ts";
import { openViewServer } from "./view/server.ts";
import { runRecordCliCommand } from "./cli/record.ts";
import { resolveExperimentEvals, selectedEvalsForRun } from "./runner/eval-selection.ts";
import { stopAllSandboxes } from "./sandbox/registry.ts";
import {
  keptSandboxReminderEffect,
  orphanReminderEffect,
  runSandboxCommandEffect,
} from "./sandbox/cli-commands.ts";
import { formatSandboxLayerLinkError, SandboxLayerLinkError } from "./sandbox/link.ts";
import {
  formatSandboxPhysicalPlanningError,
  SandboxPhysicalPlanningError,
} from "./sandbox/plan.ts";
import { drainExperimentTeardowns } from "./runner/experiment-cleanup-registry.ts";
import {
  drainHeldCaseLocksEffect,
  isCaseLockExpired,
  readCaseLockEffect,
} from "./runner/lock.ts";
import { drainHeldGateLeasesEffect } from "./runner/gate-lease.ts";
import { cleanupCallback } from "./runner/cleanup-timeout.ts";
import { resolveRunTimeout } from "./runner/timeout.ts";
import {
  prepareRunnerRecordReuse,
  withRunnerCurrentReusePreview,
} from "./runner/record.ts";
import {
  projectCurrentReuseReadback,
  type CurrentReuseReadbackSnapshot,
} from "./runner/reuse-readback.ts";
import type { ExecutionReusePlanSlot } from "./runner/reuse-plan.ts";
import {
  isOrphanedTeardownRegistration,
  orphanedTeardownReminderEffect,
  readTeardownRegistrationsEffect,
  removeTeardownRegistrationIfPresentEffect,
} from "./runner/teardown-registry.ts";
import type { DiscoveredExperiment, ExperimentHookContext } from "./runner/types.ts";
import type {
  ExperimentRenameBlocked,
  ExperimentRenamePlan,
  ExperimentRenameReason,
  ExperimentRenameRejected,
  RenamedExperiment,
} from "./runner/rename-experiment.ts";
import { ExperimentRenameError } from "./runner/rename-experiment.ts";
import { evalLevelStats } from "./shared/verdict.ts";
import { recordFact } from "./shared/facts.ts";
import {
  linkRunSandboxes,
  prepareRunSandboxes,
  preparedPairsByKey,
  recommendedConcurrencyForPreparedPairs,
} from "./runner/sandbox-selection.ts";
import { liveSandboxPlanningServices } from "./sandbox/plan.ts";
import { JUnit } from "./runner/reporters/json.ts";
import {
  resolveOutputForm,
  createFeedbackCoordinator,
  createNodeFeedbackIO,
  createInputGuard,
  createNodeInputGuardStdin,
  createHumanRenderer,
  createJsonRenderer,
  assembleCommandPlan,
  renderHumanCommandPlan,
  computeExitCode,
} from "./runner/feedback/index.ts";
import { t, type MessageKey } from "./i18n/index.ts";
import { formatThrown, upsertManagedBlock } from "./util.ts";
import {
  SessionTracker,
  listSessions,
  renderSessionListText,
  renderSessionShowText,
  showSession,
} from "./runner/session.ts";
import type {
  CompletionStatus,
  Config,
  DiscoveredEval,
  InvocationCompletion,
  InvocationSummary,
  ReporterError,
  ReporterRegistration,
  RunFeedbackState,
  Verdict,
} from "./types.ts";

/** A recoverable command-line usage error. Defects deliberately do not enter this channel. */
export class CliUsageError extends Data.TaggedError("CliUsageError")<{
  readonly message: string;
  readonly exitCode: number;
}> {}

/** A recoverable failure from a concrete CLI-owned boundary (file, process, or dynamic module). */
export class CliOperationError extends Data.TaggedError("CliOperationError")<{
  readonly operation: string;
  readonly cause: unknown;
  readonly exitCode: number;
}> {}

export type CliFailure =
  | CliUsageError
  | CliOperationError;

/**
 * Bootstrap owns process signals until an Eval has reached actual dispatch.
 * The CLI claims the Invocation signal synchronously immediately before
 * `runEvals`; it never infers this from argv outside the command dispatcher.
 */
export interface CliInterruptionOwnership {
  readonly invocationSignal: AbortSignal;
  /** False means bootstrap already accepted a root-owned first signal. */
  readonly enterGracefulDispatch: () => boolean;
}

function usageError(message: string, exitCode = 1): CliUsageError {
  return new CliUsageError({ message, exitCode });
}

function cliFailure(operation: string, cause: unknown, exitCode = 1): CliFailure {
  return cause instanceof CliUsageError || cause instanceof CliOperationError
    ? cause
    : new CliOperationError({ operation, cause, exitCode });
}

/**
 * Lift one actual Promise boundary into the application Effect. It is never a
 * private runtime: CLI owns the sole runtime in `cli/bootstrap.ts`.
 */
function cliPromise<A>(operation: string, promise: (signal: AbortSignal) => PromiseLike<A>): Effect.Effect<A, CliFailure> {
  return Effect.tryPromise({
    try: promise,
    catch: (cause) => cliFailure(operation, cause),
  });
}

/** Preserve library effects without running a nested runtime. */
function cliEffect<A, E, R>(operation: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, CliFailure, R> {
  return effect.pipe(Effect.mapError((cause) => cliFailure(operation, cause)));
}

/** Bootstrap owns presentation of typed failures; defects and interruption stay in Cause. */
export function renderCliFailure(failure: CliFailure): string {
  if (failure._tag === "CliUsageError") return failure.message;
  if (failure.cause instanceof SandboxLayerLinkError) return `${formatSandboxLayerLinkError(failure.cause)}\n`;
  if (failure.cause instanceof SandboxPhysicalPlanningError) return `${formatSandboxPhysicalPlanningError(failure.cause)}\n`;
  if (isReportCliOperation(failure.operation)) {
    const code = failureCode(failure.cause);
    if (code !== undefined) {
      const reason = failure.cause instanceof ReportModuleLoadError ? `: ${failure.cause.reason}` : "";
      return `${code}${reason}\n`;
    }
  }
  return t("cli.error", { error: formatThrown(failure.cause) });
}

function isReportCliOperation(operation: string): boolean {
  return operation === "execute report from Record" ||
    operation === "render Report show output" ||
    operation === "open report view session" ||
    operation === "open report view" ||
    operation === "export static Report";
}

function failureCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const code = Reflect.get(value, "code");
  return typeof code === "string" ? code : undefined;
}

export interface Flags {
  agent?: string;
  model?: string;
  attempts?: number;
  maxConcurrency?: number;
  maxBuildConcurrency?: number;
  timeout?: number;
  earlyExit?: boolean;
  dry: boolean;
  force: boolean;
  rerun?: "failed" | "all";
  budget?: number;
  tag?: string;
  junit?: string;
  /** `exp` 命令专用:机器面(NDJSON 事件流)。省略即人读文本(见 `resolveOutputForm`)。 */
  json: boolean;
  /** `docker profile doctor` 专用：运行一次真实嵌套 Docker 冒烟。 */
  smoke: boolean;
  open?: boolean;
  out?: string;
  port?: number;
  host?: string;
  help: boolean;
  version: boolean;
  /** `clean` / `migrate` 专用：确认删除未完成 Run 或没有 Git restore point 的 migration。 */
  yes: boolean;
  // ── show 专属(位置参数仍是 eval id 前缀 / `@<locator>`;这些 flag 选「怎么看」)──
  source?: true | string;
  execution: boolean;
  diff: boolean;
  /** --diff=<路径>(必须 = 连写;空格形式会把路径当 eval id 前缀,按文档如此)。 */
  diffPath?: string;
  /** `show @<AttemptId> --execution` 专用：JS 正则，只显示命中的 transcript / tool / command evidence。 */
  grep?: string;
  timing?: "summary" | "full";
  keepSandbox?: "failed" | "all";
  all: boolean;
  window?: string;
  sandboxPath?: string;
  leaveRunning: boolean;
  history: boolean;
  usage: boolean;
  stats: boolean;
  /** `show` / `view` 命令专用：默认读取当前项目结果时，按完整 ExperimentId 收窄目标。 */
  experiment?: string[];
  /** `show` / `view` / `accept` / `sandbox enter|list|stop` 共用:记录根目录(`.niceeval` 之外的另一个根,如 `publish` 产出的发布根)。 */
  record?: string;
  /** `show` / `view` 命令专用：`--run` 可重复；按完整 RunId 去重。 */
  run?: string[];
  report?: string;
  page?: string;
  theme?: string;
  /** `sandbox list` 专用:核对强杀路径留下的无主实例。 */
  orphans: boolean;
  /** `exp` 命令专用:只对选中实验各执行一次实验级 teardown,不派发 attempt、不跑 setup。 */
  teardown: boolean;
}

// 表驱动的 flag 定义(node:util parseArgs)。--no-x 显式声明，不依赖 Node 20.14+
// 才支持的 allowNegative，也避免每个 boolean flag 都隐式获得未设计的负向别名。
// 未知 flag 由 strict 模式报清晰错误，不会静默吞掉后面的位置参数。
//
// 每个 flag 的 JSDoc 就是它在 docs-site/zh/reference/cli.mdx flag 表里的说明,由
// scripts/generate-reference.ts 提取渲染——改 flag 语义时改这里的注释即可,不用碰生成脚本。
// 负向 flag(no-x)与正向 flag 合并成一行展示,不需要单独写 JSDoc。
const FLAG_OPTIONS = {
  /** experiment 运行不支持该 flag。要换 agent,请在 `experiments/` 下新增或复制一个配置文件。 */
  agent: { type: "string" },
  /** experiment 运行不支持该 flag。要换模型,请新增或复制一个 experiment 文件并修改 `model`。 */
  model: { type: "string" },
  /** 每个 eval 运行多少次,常用于 pass@N。 */
  attempts: { type: "string" },
  /** 设置同时运行的 eval 数量。 */
  "max-concurrency": { type: "string" },
  /** 设置同时进行的 Sandbox 镜像 lookup/build 数量；与 eval 并发独立，默认 2。 */
  "max-build-concurrency": { type: "string" },
  /** 单个 attempt 的超时时间,单位毫秒。解析链:`--timeout` > experiment > eval(`defineEval({ timeoutMs })`)> `niceeval.config.ts`,默认无上限(四层都没声明就不设 deadline);config 是缺省底而不是覆盖层,写了 config 不会让 eval 自己声明的上限失效。 */
  timeout: { type: "string" },
  /** 整次运行的预算上限(美元)。 */
  budget: { type: "string" },
  /** `exp` 命令专用:跑完留下 failed/errored attempt 的 Sandbox 现场(= `--keep-sandbox=failed`);`--keep-sandbox=all` 连 passed 也留。事后用 `niceeval sandbox list/enter/stop` 查看与销毁。 */
  "keep-sandbox": { type: "boolean" },
  /** `sandbox stop` 专用:销毁全部留存 Sandbox。 */
  all: { type: "boolean" },
  /** `sandbox diff` 专用:只看某个 send 窗口(如 `--window turn2` 或 `--window session2/turn1`);省略输出全部窗口的串联视图。 */
  window: { type: "string" },
  /** `sandbox diff` 专用:只看某个文件的 patch;省略输出该窗口的全部文件。 */
  path: { type: "string" },
  /** `sandbox enter` 专用:shell 退出后让现场保持运行,不送回休眠。 */
  "leave-running": { type: "boolean" },
  /** `sandbox list` 专用:核对强杀(`SIGKILL` / 断电)路径留下的无主沙箱实例(docker + e2b;vercel 无按元数据检索实例的通道,不参与)。只读,不清理;销毁走 `niceeval sandbox prune`。 */
  orphans: { type: "boolean" },
  /** 只运行带有该 tag 的 eval(见 `defineEval` 的 `tags`)。 */
  tag: { type: "string" },
  /** 额外写一份 JUnit XML 报告到指定路径,供 CI 消费。 */
  junit: { type: "string" },
  /** `exp` 运行在 stdout 输出单一有序的 NDJSON 事件流；`exp --dry` 与 `debug` 输出各自的单个 JSON 计划文档。`show` 输出同一 ReportExecution 的宿主数据与状态，不打开第二条取数路径。 */
  json: { type: "boolean" },
  /** `docker profile doctor` 专用：启动受限 DinD 容器并运行内层容器。 */
  smoke: { type: "boolean" },
  /** `view` 命令专用:把结果查看器静态导出到指定目录。 */
  out: { type: "string" },
  /** `view` 命令专用:指定本地服务器监听端口。 */
  port: { type: "string" },
  /** `view` 命令专用:指定监听地址；省略时为 127.0.0.1，只写 `--host` 时为 0.0.0.0。非 loopback 监听无认证或 TLS，会向所有可达客户端暴露报告数据。 */
  host: { type: "string" },
  // 以下旧 show 切片只为实现收敛期间保留解析位置，不属于目标公开 CLI，也不进入参考页。
  /** `show` 专用：按一个 exact Attempt locator 展示已记录的 source snapshot。 */
  source: { type: "boolean" },
  /** `show @<AttemptLocator> --execution`：从公开 Record projection 呈现该 Attempt 的 transcript、tool 与 command evidence。 */
  execution: { type: "boolean" },
  /** `show @<AttemptLocator> --timing[=summary|full]` 专用：从内建 timing Report 读取该 Attempt 的 runner 阶段树。 */
  timing: { type: "boolean" },
  /** `show @<AttemptId> --execution` 专用：JS 正则过滤 retained transcript、tool 与 command evidence。 */
  grep: { type: "string" },
  // --diff 是布尔;--diff=<路径> 在 parseArgs 前预扫成 diffPath(路径必须 = 连写,
  // 空格形式的下一个 token 仍是位置参数 = eval id 前缀,与文档一致)。
  /** 实现收敛占位；目标公开 CLI 通过 Report page 读取 diff 通道。 */
  diff: { type: "boolean" },
  /** 实现收敛占位；目标公开 CLI 不提供跨 Run history。 */
  history: { type: "boolean" },
  /** 实现收敛占位；目标公开 CLI 通过 Report Calculation 呈现用量。 */
  usage: { type: "boolean" },
  /** 实现收敛占位；目标公开 CLI 不提供隐式跨 Run 统计。 */
  stats: { type: "boolean" },
  /** `show` / `view` 命令专用：按完整 ExperimentId 收窄当前项目结果；可重复，不接受前缀或逗号列表。 */
  experiment: { type: "string", multiple: true },
  /** `show` / `view` / `accept` / `sandbox enter|list|stop` 共用:指定实际 Record root;CLI 不补接 `.niceeval/record` 或其它后缀。 */
  record: { type: "string" },
  /** `show` / `view` 可重复传入 `--run`;每次按完整 RunId 增加一个显式 Run,重复 identity 去重。 */
  run: { type: "string", multiple: true },
  /** `show` / `view` 命令专用：内建 `overview` 或受信任的 Report module 路径。 */
  report: { type: "string" },
  /** `show` / `view` 命令专用：内建 Theme 或受信任的闭合 Theme module 路径。 */
  theme: { type: "string" },
  /** `show` / `view` 命令专用:选择报告的初始页;`show` 渲染该页并在尾部附其余页索引,`view` 以它作初始路由。未命中的页 id 按用法错误退出并列出可用页 id。 */
  page: { type: "string" },
  /** `exp` 命令专用:补齐被强杀打断的实验级 teardown——只对选中的实验各执行一次 teardown(新进程语义),不派发 attempt、不跑 setup;没有遗留登记也照常执行。与 eval 前缀位置参数组合是用法错误。 */
  teardown: { type: "boolean" },
  /** 只打印本次会匹配到的 eval × 运行配置,不实际执行(人读文本或 `--json` 单文档,见「机器怎么读:--json」)。 */
  dry: { type: "boolean" },
  /** `sandbox prune` 专用:除 orphan 外也销毁 unverified 实例;`exp` 明确拒绝此 flag,重跑失败项或全部项请用 `--rerun` / `--rerun all`。 */
  force: { type: "boolean" },
  /** `exp` 命令专用:重新运行失败项(裸写/failed)或全部项(all),不改变长期指纹。 */
  rerun: { type: "boolean" },
  /** 某个 eval 的一次 attempt 通过后,停止该 eval 剩余的 attempts;省略默认关(`attempts` 默认跑满、测完整通过率)。 */
  "early-exit": { type: "boolean" },
  /** 强制关闭首过即停,即使实验文件里写了 `earlyExit: true`。 */
  "no-early-exit": { type: "boolean" },
  /** `view` 命令专用:启动后自动打开浏览器(默认行为)。 */
  open: { type: "boolean" },
  "no-open": { type: "boolean" },
  /** `clean` / `migrate` 专用：确认不可逆 maintenance 动作或没有 Git restore point 的 migration。 */
  yes: { type: "boolean" },
  /** 打印用法说明并退出。 */
  help: { type: "boolean", short: "h" },
  /** 打印 niceeval 的版本号并退出。 */
  version: { type: "boolean", short: "v" },
} as const;

function numberFlag(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw usageError(t("cli.flag.invalidNumber", { flag: name, value: raw }));
  }
  return n;
}

const CLI_COMMANDS = ["check", "exp", "debug", "accept", "show", "list", "view", "clean", "migrate", "init", "run", "sandbox", "session", "docker"] as const;
type CliCommand = (typeof CLI_COMMANDS)[number];

interface ParsedCliArgs {
  readonly command: CliCommand;
  readonly positionals: string[];
  readonly flags: Flags;
  /** Canonical option names in argv order, after boolean|string normalization. */
  readonly providedOptions: readonly string[];
}

function isCliCommand(candidate: string): candidate is CliCommand {
  return CLI_COMMANDS.some((command) => command === candidate);
}

function parseArgs(argv: string[]): ParsedCliArgs {
  if (argv[0] === "--") argv = argv.slice(1);
  if (argv.some((arg) => arg === "--strict" || arg.startsWith("--strict="))) {
    throw usageError(t("cli.flag.strictRemoved"));
  }

  // --diff=<路径> 预扫:diff 本体是布尔(裸 --diff = 文件级摘要),路径只接受 = 连写。
  let diffPath: string | undefined;
  // --keep-sandbox[=failed|all] 预扫:本体是布尔(裸 = failed 档),档位只接受 = 连写。
  let keepSandboxTier: "failed" | "all" | undefined;
  // --timing[=summary|full] 预扫:node:util 的单个 option 不支持 boolean|string 联合，
  // 所以 mode 在严格 parseArgs 前提取，再把两种形式统一成布尔 --timing。
  let timingMode: "summary" | "full" | undefined;
  // --source[=full|<path>] 预扫:本体是布尔，值只接受 = 连写，避免吞掉 eval 前缀位置参数。
  let sourceValue: string | undefined;
  let rerunMode: "failed" | "all" | undefined;
  // boolean|string 联合 flag 的空格写法先归一：--rerun all → --rerun=all；
  // --host 的裸写则补成默认地址，保持 `--host <地址>` 的普通 string flag 形态。
  {
    const normalized: string[] = [];
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index]!;
      const next = argv[index + 1];
      if (arg === "--rerun" && (next === "failed" || next === "all")) {
        normalized.push(`--rerun=${next}`);
        index += 1;
      } else if (arg === "--host" && (next === undefined || next.startsWith("-"))) {
        normalized.push("--host=0.0.0.0");
      } else {
        normalized.push(arg);
      }
    }
    argv = normalized;
  }
  argv = argv.map((arg) => {
    if (arg.startsWith("--host=")) {
      const value = arg.slice("--host=".length);
      if (value.length === 0) {
        throw usageError("--host=<address> requires a non-empty address, or use bare --host.\n");
      }
    }
    if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length);
      if (value.length === 0) {
        throw usageError("--source=<path> requires a non-empty captured source path, or use bare --source.\n");
      }
      sourceValue = value;
      return "--source";
    }
    if (arg.startsWith("--diff=")) {
      const path = arg.slice("--diff=".length);
      if (path) diffPath = path;
      return "--diff";
    }
    if (arg.startsWith("--keep-sandbox=")) {
      const tier = arg.slice("--keep-sandbox=".length);
      if (tier !== "failed" && tier !== "all") {
        throw usageError(`--keep-sandbox only accepts "failed" (default) or "all", got "${tier}".\n`);
      }
      keepSandboxTier = tier;
      return "--keep-sandbox";
    }
    if (arg.startsWith("--timing=")) {
      const mode = arg.slice("--timing=".length);
      if (mode !== "summary" && mode !== "full") {
        throw usageError(`--timing only accepts "summary" (default) or "full", got "${mode}".\n`);
      }
      timingMode = mode;
      return "--timing";
    }
    if (arg.startsWith("--rerun=")) {
      const mode = arg.slice("--rerun=".length);
      if (mode !== "failed" && mode !== "all") {
        throw usageError(`--rerun only accepts "failed" (default) or "all", got "${mode}".\n`);
      }
      rerunMode = mode;
      return "--rerun";
    }
    // `--output` 整个删除(见 docs/feature/experiments/cli.md 与 memory/exp-output-two-forms-ruling.md):
    // beta 不留别名,任何取值(裸 flag 或 `--output=value`)都按用法错误拒绝,不静默吞掉、也不
    // 落到 node:util parseArgs 的通用「unknown option」文案——给出专门的 error:/fix: 两行,
    // 指向唯一还存在的两条路径:不加 flag 跑人读文本,机器面用 `--json`。
    if (arg === "--output" || arg.startsWith("--output=")) {
      throw usageError(t("cli.flag.outputRemoved"));
    }
    return arg;
  });

  let values: globalThis.Record<string, string | boolean | undefined>;
  let rawPositionals: string[];
  let providedOptions: string[];
  try {
    const parsed = nodeParseArgs({
      args: argv,
      options: FLAG_OPTIONS,
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
    values = parsed.values as globalThis.Record<string, string | boolean | undefined>;
    rawPositionals = parsed.positionals;
    providedOptions = parsed.tokens
      .filter((token): token is Extract<(typeof parsed.tokens)[number], { kind: "option" }> => token.kind === "option")
      .map((token) => token.name);
  } catch (e) {
    if (e instanceof CliUsageError) throw e;
    throw usageError(t("cli.flag.parseError", { message: e instanceof Error ? e.message : String(e) }));
  }

  // 第一个位置参数必须是已知命令;其余是 eval id 前缀 / view 输入。
  // 裸 eval id 早已不再是运行入口,所以不识别的首 token 应当就地报用法错误,
  // 不应先装载项目 config / eval 再偶然以其它错误退出。
  let command: CliCommand = "run";
  let positionals = rawPositionals;
  if (rawPositionals.length > 0) {
    const candidate = rawPositionals[0];
    if (!isCliCommand(candidate)) {
      throw usageError(t("cli.command.unknown", { command: candidate }));
    }
    command = candidate;
    positionals = rawPositionals.slice(1);
  }

  const flags: Flags = {
    agent: values.agent as string | undefined,
    model: values.model as string | undefined,
    attempts: numberFlag("attempts", values.attempts as string | undefined),
    maxConcurrency: numberFlag("max-concurrency", values["max-concurrency"] as string | undefined),
    maxBuildConcurrency: numberFlag("max-build-concurrency", values["max-build-concurrency"] as string | undefined),
    timeout: numberFlag("timeout", values.timeout as string | undefined),
    budget: numberFlag("budget", values.budget as string | undefined),
    tag: values.tag as string | undefined,
    junit: values.junit as string | undefined,
    json: values.json === true,
    smoke: values.smoke === true,
    out: values.out as string | undefined,
    port: numberFlag("port", values.port as string | undefined),
    host: values.host as string | undefined,
    dry: values.dry === true,
    force: values.force === true,
    rerun: values.rerun === true ? (rerunMode ?? "failed") : undefined,
    earlyExit: values["no-early-exit"] === true ? false : values["early-exit"] === true ? true : undefined,
    open: values["no-open"] === true ? false : values.open === true ? true : undefined,
    help: values.help === true,
    version: values.version === true,
    yes: values.yes === true,
    source: values.source === true ? (sourceValue ?? true) : undefined,
    execution: values.execution === true,
    diff: values.diff === true && diffPath === undefined,
    diffPath,
    timing: values.timing === true ? (timingMode ?? "summary") : undefined,
    grep: values.grep as string | undefined,
    keepSandbox: values["keep-sandbox"] === true ? (keepSandboxTier ?? "failed") : undefined,
    all: values.all === true,
    window: values.window as string | undefined,
    sandboxPath: values.path as string | undefined,
    leaveRunning: values["leave-running"] === true,
    history: values.history === true,
    usage: values.usage === true,
    stats: values.stats === true,
    experiment: values.experiment as string[] | undefined,
    record: values.record as string | undefined,
    run: values.run as string[] | undefined,
    report: values.report as string | undefined,
    page: values.page as string | undefined,
    theme: values.theme as string | undefined,
    orphans: values.orphans === true,
    teardown: values.teardown === true,
  };
  return { command, positionals, flags, providedOptions };
}

/**
 * exp 只接受两类输入:位置参数选「跑哪些 eval」+ 调度/输出/机器出口 flag 选「对着哪个 agent、
 * 怎么跑」。show / view 专属的证据切面(`--source`/`--execution`/`--diff`)、时间轴(`--history`)、
 * Sample 收窄(`--experiment`/`--record`)、报告装载(`--report`/`--page`)、查看器
 * (`--run`/`--out`/`--port`/`--open`)不能被 exp 静默忽略(见 docs/feature/experiments/
 * cli.md「用法错误」)。返回第一个被误用的 flag 及其归属命令(用于报错),没有误用返回 undefined。
 */
/** A dry plan never retains scoped Record capabilities or result-shaped legacy data. */
interface CurrentDryPlan {
  readonly slots: readonly CurrentDryPlanSlot[];
  readonly readbacks: readonly CurrentReuseReadbackSnapshot[];
}

interface CurrentDryPlanSlot {
  readonly runId: string;
  readonly slotId: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly state: "reused" | "gap";
  readonly comparisons: readonly {
    readonly attachment: string;
    readonly recordedClaim: string;
    readonly sourceState: string;
    readonly result: string;
    readonly reason: string;
  }[];
  readonly reason?: string;
  readonly scope?: string;
}

interface CurrentDryPlanRow {
  readonly experimentId: string;
  readonly evalId: string;
  readonly evalGroupId?: string;
  readonly evalGroupIndex?: number;
  readonly slots: readonly CurrentDryPlanSlot[];
  readonly readbacks: readonly CurrentReuseReadbackSnapshot[];
  readonly locked?: boolean;
}

function projectCurrentDryPlan(input: {
  readonly slots: readonly ExecutionReusePlanSlot[];
  readonly readbacks: readonly import("./runner/reuse-readback.ts").CurrentReuseReadback[];
}): CurrentDryPlan {
  return Object.freeze({
    slots: Object.freeze(input.slots.map(projectCurrentDryPlanSlot)),
    readbacks: Object.freeze(input.readbacks.map(projectCurrentReuseReadback)),
  });
}

function projectCurrentDryPlanSlot(slot: ExecutionReusePlanSlot): CurrentDryPlanSlot {
  return Object.freeze({
    runId: String(slot.runId),
    slotId: String(slot.slotId),
    experimentId: slot.experimentId,
    evalId: slot.evalId,
    attempt: slot.attempt,
    state: slot.state === "reuse" ? "reused" : "gap",
    comparisons: Object.freeze(slot.comparisons.map((comparison) => Object.freeze({
      attachment: comparison.attachment,
      recordedClaim: comparison.recordedClaim,
      sourceState: comparison.sourceState,
      result: comparison.result,
      reason: comparison.reason,
    }))),
    ...(slot.state === "gap" ? { reason: slot.reason, scope: slot.scope } : {}),
  });
}

function currentDryPlanRows(plan: CurrentDryPlan): readonly CurrentDryPlanRow[] {
  const rows = new Map<string, {
    experimentId: string;
    evalId: string;
    slots: CurrentDryPlanSlot[];
    readbacks: CurrentReuseReadbackSnapshot[];
  }>();
  const rowFor = (experimentId: string, evalId: string) => {
    const key = JSON.stringify([experimentId, evalId]);
    const existing = rows.get(key);
    if (existing !== undefined) return existing;
    const created = { experimentId, evalId, slots: [], readbacks: [] };
    rows.set(key, created);
    return created;
  };
  for (const slot of plan.slots) rowFor(slot.experimentId, slot.evalId).slots.push(slot);
  for (const readback of plan.readbacks) {
    rowFor(readback.target.experimentId, readback.target.evalId).readbacks.push(readback);
  }
  return Object.freeze([...rows.values()].map((row) => Object.freeze({
    experimentId: row.experimentId,
    evalId: row.evalId,
    slots: Object.freeze([...row.slots].sort((left, right) => left.attempt - right.attempt)),
    readbacks: Object.freeze([...row.readbacks].sort((left, right) => left.target.attempt - right.target.attempt)),
  })).sort((left, right) =>
    left.experimentId.localeCompare(right.experimentId) || left.evalId.localeCompare(right.evalId),
  ));
}

function renderCurrentDryPlan(input: {
  readonly totalAttempts: number;
  readonly evals: number;
  readonly configs: number;
  readonly attempts: number;
  readonly rows: readonly CurrentDryPlanRow[];
  readonly pluginAudit: CurrentDryPluginAudit;
}): string {
  const reused = input.rows.reduce((total, row) =>
    total + row.slots.filter((slot) => slot.state === "reused").length, 0);
  const lines = [
    `plan: ${input.totalAttempts} attempts · ${input.evals} evals × ${input.configs} configs · runs ${input.attempts}`,
    ...(reused === 0 ? [] : [`reuse: ${reused}/${input.totalAttempts} exact current Record attempts`]),
    `plugins: ${input.pluginAudit.occurrences.length} lifecycle occurrences`,
  ];
  for (const row of input.rows) {
    const reusedAttempts = row.slots.filter((slot) => slot.state === "reused").map((slot) => slot.attempt);
    const gaps = row.slots.filter((slot) => slot.state === "gap");
    const hasIdentityGap = gaps.some((slot) => slot.reason === "identity-mismatch");
    const parts = [
      ...(row.locked ? ["locked"] : []),
      ...(reusedAttempts.length === 0 ? [] : [`reused ${reusedAttempts.join(",")}`]),
      ...gaps.map((slot) => `gap ${slot.attempt}:${slot.reason ?? "unknown"}`),
    ];
    lines.push(`${row.experimentId}  ${row.evalId}  ${parts.join(" · ") || "no slots"}`);
    for (const readback of row.readbacks) {
      const verdict = readback.state === "reused"
        ? readback.verdict
        : readback.verdict.state === "available"
          ? readback.verdict.value
          : readback.verdict.state;
      const locator = readback.source.locator;
      lines.push(`  source ${locator} · ${readback.state} · verdict ${verdict}`);
      if (hasIdentityGap && readback.state === "prior") {
        lines.push(`  accept: niceeval accept ${locator}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

interface CurrentDryPluginAudit {
  readonly occurrences: readonly JsonValue[];
}

function renderCurrentDryPlanJson(input: {
  readonly totalAttempts: number;
  readonly evals: number;
  readonly configs: number;
  readonly attempts: number;
  readonly rows: readonly CurrentDryPlanRow[];
  readonly pluginAudit: CurrentDryPluginAudit;
}): string {
  const reused = input.rows.reduce((total, row) =>
    total + row.slots.filter((slot) => slot.state === "reused").length, 0);
  return `${JSON.stringify({
    format: "niceeval.current-reuse-plan/v1",
    schemaVersion: 1,
    total: input.totalAttempts,
    evals: input.evals,
    configs: input.configs,
    attempts: input.attempts,
    reused,
    matrix: input.rows,
    plugins: input.pluginAudit.occurrences,
  })}\n`;
}

/**
 * Fold the invocation's real fresh results and current Record readbacks at the
 * same eval identity. This intentionally projects only identity + terminal
 * verdict; a reused readback is never recreated as an EvalResult.
 */
export function foldInvocationEvalStats(
  summary: Pick<InvocationSummary, "results" | "reusedAttempts">,
) {
  const terminals = [
    ...summary.results.map((result) => Object.freeze({
      identity: `${result.experimentId ?? ""}|${result.id}`,
      verdict: result.verdict,
    })),
    ...summary.reusedAttempts.map((readback) => Object.freeze({
      identity: `${readback.target.experimentId}|${readback.target.evalId}`,
      verdict: readback.source.evaluationKind !== "score"
        ? readback.verdict
        : readback.score.state === "applicable"
            && readback.score.attachment.state === "available"
            && readback.score.attachment.value.state === "complete"
          ? "passed" as const
          : "errored" as const,
    })),
  ];
  return evalLevelStats(terminals, (terminal) => terminal.identity);
}

function firstViewerOnlyFlag(flags: Flags): { flag: string; command: string } | undefined {
  const SHOW = "show";
  const BOTH = "show / view";
  const VIEW = "view";
  if (flags.source) return { flag: "--source", command: SHOW };
  if (flags.execution) return { flag: "--execution", command: SHOW };
  if (flags.timing !== undefined) return { flag: "--timing", command: SHOW };
  if (flags.grep !== undefined) return { flag: "--grep", command: SHOW };
  if (flags.diff || flags.diffPath !== undefined) return { flag: "--diff", command: SHOW };
  if (flags.history) return { flag: "--history", command: SHOW };
  if (flags.usage) return { flag: "--usage", command: SHOW };
  if (flags.stats) return { flag: "--stats", command: SHOW };
  if (flags.experiment !== undefined) return { flag: "--experiment", command: BOTH };
  if (flags.record !== undefined) return { flag: "--record", command: BOTH };
  if (flags.report !== undefined) return { flag: "--report", command: BOTH };
  if (flags.theme !== undefined) return { flag: "--theme", command: VIEW };
  if (flags.page !== undefined) return { flag: "--page", command: BOTH };
  if (flags.run !== undefined) return { flag: "--run", command: VIEW };
  if (flags.out !== undefined) return { flag: "--out", command: VIEW };
  if (flags.port !== undefined) return { flag: "--port", command: VIEW };
  if (flags.open !== undefined) return { flag: "--open", command: VIEW };
  return undefined;
}

/** `clean` and `migrate` operate on a current Record root with explicit confirmation. */
function firstRecordMaintenanceUnsupportedFlag(flags: Flags): string | undefined {
  const unsupported: Array<[string, unknown]> = [
    ["--agent", flags.agent],
    ["--model", flags.model],
    ["--attempts", flags.attempts],
    ["--max-concurrency", flags.maxConcurrency],
    ["--max-build-concurrency", flags.maxBuildConcurrency],
    ["--timeout", flags.timeout],
    ["--budget", flags.budget],
    ["--tag", flags.tag],
    ["--junit", flags.junit],
    ["--json", flags.json],
    ["--smoke", flags.smoke],
    ["--dry", flags.dry],
    ["--force", flags.force],
    ["--rerun", flags.rerun],
    ["--early-exit/--no-early-exit", flags.earlyExit],
    ["--open/--no-open", flags.open],
    ["--out", flags.out],
    ["--port", flags.port],
    ["--host", flags.host],
    ["--source", flags.source],
    ["--execution", flags.execution],
    ["--diff", flags.diff || flags.diffPath !== undefined],
    ["--grep", flags.grep],
    ["--timing", flags.timing],
    ["--keep-sandbox", flags.keepSandbox],
    ["--all", flags.all],
    ["--window", flags.window],
    ["--path", flags.sandboxPath],
    ["--leave-running", flags.leaveRunning],
    ["--history", flags.history],
    ["--usage", flags.usage],
    ["--stats", flags.stats],
    ["--experiment", flags.experiment],
    ["--run", flags.run],
    ["--report", flags.report],
    ["--page", flags.page],
    ["--theme", flags.theme],
    ["--orphans", flags.orphans],
    ["--teardown", flags.teardown],
  ];
  const bad = unsupported.find(([flag, value]) => {
    if (flag === "--open/--no-open" || flag === "--early-exit/--no-early-exit") {
      return value !== undefined;
    }
    return value !== undefined && value !== false && (!Array.isArray(value) || value.length > 0);
  });
  return bad?.[0];
}

/**
 * `accept` 接受一个或多个精确 locator；它不是 `exp` 的另一种选择器，也不派发 attempt。
 * `--record` 是唯一允许的附加 flag，用来接受发布根或其它显式记录根里的结果。
 */
function parseAcceptLocators(positionals: string[], flags: Flags): string[] {
  if (positionals.length === 0 || positionals.some((locator) => !/^@[^@\s]+$/.test(locator))) {
    throw usageError(t("cli.accept.usage"));
  }
  if (new Set(positionals).size !== positionals.length) {
    throw usageError("niceeval accept rejects duplicate locators.\n");
  }

  // `parseArgs` 已经负责未知 flag；这里拒绝那些虽为全局已知、但会改变运行/查看语义的 flag。
  // `--record` 是 accept 的唯一范围输入，help/version 在 main() 更早处理。
  const unsupported: Array<[string, unknown]> = [
    ["--agent", flags.agent],
    ["--model", flags.model],
    ["--attempts", flags.attempts],
    ["--max-concurrency", flags.maxConcurrency],
    ["--max-build-concurrency", flags.maxBuildConcurrency],
    ["--timeout", flags.timeout],
    ["--budget", flags.budget],
    ["--tag", flags.tag],
    ["--junit", flags.junit],
    ["--json", flags.json],
    ["--dry", flags.dry],
    ["--force", flags.force],
    ["--rerun", flags.rerun],
    ["--early-exit/--no-early-exit", flags.earlyExit],
    ["--open/--no-open", flags.open],
    ["--source", flags.source],
    ["--execution", flags.execution],
    ["--diff", flags.diff || flags.diffPath !== undefined],
    ["--grep", flags.grep],
    ["--timing", flags.timing],
    ["--keep-sandbox", flags.keepSandbox],
    ["--all", flags.all],
    ["--window", flags.window],
    ["--path", flags.sandboxPath],
    ["--leave-running", flags.leaveRunning],
    ["--history", flags.history],
    ["--usage", flags.usage],
    ["--stats", flags.stats],
    ["--experiment", flags.experiment],
    ["--run", flags.run],
    ["--report", flags.report],
    ["--page", flags.page],
    ["--theme", flags.theme],
    ["--orphans", flags.orphans],
    ["--teardown", flags.teardown],
  ];
  const bad = unsupported.find(([flag, value]) => {
    // `--no-open` / `--no-early-exit` are represented as false, but are still
    // explicit flags and therefore invalid on this command.
    if (flag === "--open/--no-open" || flag === "--early-exit/--no-early-exit") return value !== undefined;
    return value !== undefined && value !== false && (!Array.isArray(value) || value.length > 0);
  });
  if (bad) {
    throw usageError(t("cli.accept.flagUnsupported", { flag: bad[0] }));
  }
  return [...positionals];
}

interface AcceptLocatorResult {
  runId: string;
  locator: string;
  sourceLocator: string;
  fingerprint?: string;
}

/** 调用 acceptance core；CLI 只负责 cwd/记录根边界、输出与退出码，不重建结果或启动 runner。 */
function runAcceptCommand(cwd: string, locators: readonly string[], recordRoot: string | undefined): Effect.Effect<void, CliFailure> {
  return Effect.gen(function* () {
    const mod = (yield* cliPromise("load acceptance command", () => import("./runner/accept.ts"))) as unknown as {
      acceptLocators(input: { cwd: string; locators: readonly string[]; recordRoot?: string }): Effect.Effect<
        readonly AcceptLocatorResult[],
        unknown,
        never
    >;
  };
    const results = yield* cliEffect("accept locators", mod.acceptLocators({
      cwd,
      locators,
      ...(recordRoot !== undefined ? { recordRoot } : {}),
    }));
    yield* Effect.sync(() => {
      for (const result of results) {
        process.stdout.write(t("cli.accept.done", {
          runId: result.runId,
          sourceLocator: result.sourceLocator,
          locator: result.locator,
          fingerprint: result.fingerprint ?? "—",
        }));
      }
    });
  });
}

// ── exp rename:CLI 契约与纯解析/格式化 ──────────────────────────────────────
// 核心在 src/runner/rename-experiment.ts(planExperimentRename / renameExperiment,
// 资格门与写入都在那里,见 docs/source-map.md 与 docs/feature/experiments/rename.md);
// CLI 只做:解析 `exp rename <oldId> <newId>`、递选项进核心、把核心返回的计划/结果按
// 形态渲染。稳定 reason、计划与结果文档都是核心导出的契约,CLI 不在渲染层重建资格算法。

export const EXPERIMENT_RENAME_FORMAT = "niceeval.experimentRename" as const;
export const EXPERIMENT_RENAME_SCHEMA_VERSION = 1 as const;

/**
 * exp rename 的机器文档:单份 JSON,按 status 判别。
 * - `plan`(核心计划,可含 `blocked` 阻断原因);
 * - `rejected`(核心 `renameExperiment` 抛 `ExperimentRenameError` 时的整批拒绝);
 * - `done`(核心 `RenamedExperiment` = 成功文档)。
 */
export type ExperimentRenameJsonDocument = ExperimentRenamePlan | ExperimentRenameRejected | RenamedExperiment;

const EXPERIMENT_RENAME_REASON_MESSAGE: Record<ExperimentRenameReason, MessageKey> = {
  "source-empty": "cli.rename.error.sourceEmpty",
  "target-not-found": "cli.rename.error.targetNotFound",
  "target-has-results": "cli.rename.error.targetHasResults",
  "source-unreadable": "cli.rename.error.sourceUnreadable",
  "artifact-unavailable": "cli.rename.error.artifactUnavailable",
  "nothing-to-migrate": "cli.rename.error.nothingToMigrate",
};

/**
 * 解析 exp rename 的位置参数:必须恰好两个(一个旧 id、一个新 id)。
 * 纯函数,CLI 与测试共用。
 */
export function parseExperimentRenamePositionals(
  args: readonly string[],
): { ok: true; oldId: string; newId: string } | { ok: false; kind: "usage" } {
  if (args.length !== 2 || args[0] === undefined || args[1] === undefined) {
    return { ok: false, kind: "usage" };
  }
  return { ok: true, oldId: args[0], newId: args[1] };
}

/**
 * exp rename 只允许 --dry / --json;返回第一个被误用的 flag,没有误用返回 undefined。
 * 与 accept 同一套纪律:node:util parseArgs 已经报未知 flag,这里拒绝那些全局已知、
 * 但会改变运行/查看语义的 flag。
 */
export function firstExperimentRenameUnsupportedFlag(flags: Flags): string | undefined {
  const unsupported: Array<[string, unknown]> = [
    ["--agent", flags.agent],
    ["--model", flags.model],
    ["--attempts", flags.attempts],
    ["--max-concurrency", flags.maxConcurrency],
    ["--max-build-concurrency", flags.maxBuildConcurrency],
    ["--timeout", flags.timeout],
    ["--budget", flags.budget],
    ["--tag", flags.tag],
    ["--junit", flags.junit],
    ["--force", flags.force],
    ["--rerun", flags.rerun],
    ["--early-exit/--no-early-exit", flags.earlyExit],
    ["--open/--no-open", flags.open],
    ["--source", flags.source],
    ["--execution", flags.execution],
    ["--diff", flags.diff || flags.diffPath !== undefined],
    ["--grep", flags.grep],
    ["--timing", flags.timing],
    ["--keep-sandbox", flags.keepSandbox],
    ["--all", flags.all],
    ["--window", flags.window],
    ["--path", flags.sandboxPath],
    ["--leave-running", flags.leaveRunning],
    ["--history", flags.history],
    ["--usage", flags.usage],
    ["--stats", flags.stats],
    ["--experiment", flags.experiment],
    ["--record", flags.record],
    ["--run", flags.run],
    ["--report", flags.report],
    ["--page", flags.page],
    ["--theme", flags.theme],
    ["--orphans", flags.orphans],
    ["--teardown", flags.teardown],
    ["--out", flags.out],
    ["--port", flags.port],
    ["--host", flags.host],
  ];
  const bad = unsupported.find(([flag, value]) => {
    // `--no-open` / `--no-early-exit` 表现为 false,但仍是显式 flag,在 rename 上同样非法。
    if (flag === "--open/--no-open" || flag === "--early-exit/--no-early-exit") return value !== undefined;
    return value !== undefined && value !== false && (!Array.isArray(value) || value.length > 0);
  });
  return bad?.[0];
}

/** 人读面:核心计划 → 预览文本。逐条列出迁移与排除;有 `blocked` 时点名阻断原因。 */
export function renderExperimentRenamePlanHuman(plan: ExperimentRenamePlan): string {
  const lines = [t("cli.rename.previewHeader", { oldId: plan.oldId, newId: plan.newId })];
  if (plan.blocked !== undefined) {
    lines.push(t("cli.rename.blocked", { reason: plan.blocked.reason }));
    lines.push(...renderExperimentRenameBlockedDetail(plan.blocked));
  }
  if (plan.migrations.length > 0) {
    lines.push(t("cli.rename.migratingHeader", { count: plan.migrations.length }));
    for (const entry of plan.migrations) {
      lines.push(t("cli.rename.migratingRow", {
        evalId: entry.evalId,
        sourceLocator: entry.sourceLocator,
        newId: plan.newId,
      }));
    }
  }
  if (plan.excluded.length > 0) {
    lines.push(t("cli.rename.excludedHeader", { count: plan.excluded.length }));
    for (const entry of plan.excluded) {
      lines.push(t("cli.rename.excludedRow", { evalId: entry.evalId, reason: entry.reason }));
    }
  }
  return `${lines.join("\n")}\n`;
}

/** 拒绝的人读面:先给 reason 专属文案(点名旧 id、新 id、受影响 eval 与下一步),再补冲突清单。 */
export function renderExperimentRenameRejectedHuman(rejected: ExperimentRenameRejected): string {
  const lines = [
    t(EXPERIMENT_RENAME_REASON_MESSAGE[rejected.reason], {
      oldId: rejected.oldId,
      newId: rejected.newId,
      evalId: rejected.evalId ?? "",
    }),
  ];
  lines.push(...renderExperimentRenameRejectedDetail(rejected));
  return `${lines.join("\n")}\n`;
}

/** 成功的人读面:新 snapshot 路径 + 逐条新 locator。 */
export function renderExperimentRenameDoneHuman(done: RenamedExperiment): string {
  const lines = [
    t("cli.rename.doneHeader", { oldId: done.oldId, newId: done.newId, count: done.migrated.length }),
    t("cli.rename.snapshotPath", { path: done.snapshotPath }),
  ];
  for (const entry of done.migrated) {
    lines.push(t("cli.rename.doneRow", {
      evalId: entry.evalId,
      sourceLocator: entry.sourceLocator,
      locator: entry.locator,
    }));
  }
  return `${lines.join("\n")}\n`;
}

/** 阻断的逐条事实:冲突 eval 逐行列出，并保留底层读取详情。 */
function renderExperimentRenameBlockedDetail(blocked: ExperimentRenameBlocked): string[] {
  const lines: string[] = [];
  for (const evalId of blocked.conflictingEvals ?? []) {
    lines.push(`  ${evalId}`);
  }
  if (blocked.detail !== undefined) lines.push(`  ${blocked.detail}`);
  return lines;
}

function renderExperimentRenameRejectedDetail(rejected: ExperimentRenameRejected): string[] {
  const lines: string[] = [];
  const conflicting = rejected.conflictingEvals ?? [];
  if (conflicting.length > 0) {
    lines.push(t("cli.rename.conflicting", { evals: conflicting.join(", ") }));
  }
  return lines;
}

/** 机器面:单份 JSON 文档,不混入人读文本(见 rename.md「命令」)。 */
export function renderExperimentRenameJson(document: ExperimentRenameJsonDocument): string {
  return `${JSON.stringify({
    format: EXPERIMENT_RENAME_FORMAT,
    schemaVersion: EXPERIMENT_RENAME_SCHEMA_VERSION,
    ...document,
  })}\n`;
}

/** 把 renameExperiment 抛出的资格错误投影成 rejected 文档(JSON 与拒绝人读共用)。 */
export function experimentRenameRejectedFromError(error: ExperimentRenameError): ExperimentRenameRejected {
  const plan = error.plan;
  const blocked = plan?.blocked;
  return {
    status: "rejected",
    oldId: plan?.oldId ?? "",
    newId: plan?.newId ?? "",
    reason: error.reason,
    ...(blocked?.evalId === undefined ? {} : { evalId: blocked.evalId }),
    ...(blocked?.conflictingEvals === undefined ? {} : { conflictingEvals: blocked.conflictingEvals }),
    ...(blocked?.detail === undefined ? {} : { detail: blocked.detail }),
  };
}

/** 退出码:可迁移预览与成功执行为 0;blocked 预览 / rejected 整批零写入按失败退出。 */
export function experimentRenameExitCode(document: ExperimentRenameJsonDocument): number {
  if (document.status === "done") return 0;
  if (document.status === "plan") return document.blocked === undefined ? 0 : 1;
  return 1;
}

/**
 * exp rename 的 CLI 执行:解析 → 核心 → 渲染 → 退出码。核心契约见
 * src/runner/rename-experiment.ts(planExperimentRename / renameExperiment)。
 * renameExperiment 对资格失败抛 ExperimentRenameError,CLI 把它投影成 rejected 文档。
 */
function runExperimentRenameCommand(cwd: string, args: readonly string[], flags: Flags): Effect.Effect<number, CliFailure> {
  return Effect.gen(function* () {
    const parsed = parseExperimentRenamePositionals(args);
    if (!parsed.ok) {
      yield* Effect.sync(() => process.stderr.write(t("cli.rename.usage")));
      return 1;
    }
    const unsupported = firstExperimentRenameUnsupportedFlag(flags);
    if (unsupported !== undefined) {
      yield* Effect.sync(() => process.stderr.write(t("cli.rename.flagUnsupported", { flag: unsupported })));
      return 1;
    }
    const { oldId, newId } = parsed;
    const mod = (yield* cliPromise("load experiment rename command", () => import("./runner/rename-experiment.ts"))) as unknown as {
      planExperimentRename(options: { cwd: string; oldId: string; newId: string }): Effect.Effect<ExperimentRenamePlan, unknown, never>;
      renameExperiment(options: { cwd: string; oldId: string; newId: string }): Effect.Effect<RenamedExperiment, unknown, never>;
    };
    if (flags.dry) {
      const plan = yield* cliEffect("plan experiment rename", mod.planExperimentRename({ cwd, oldId, newId }));
      yield* Effect.sync(() => {
        if (flags.json) process.stdout.write(renderExperimentRenameJson(plan));
        else process.stdout.write(renderExperimentRenamePlanHuman(plan));
      });
      return experimentRenameExitCode(plan);
    }
    const outcome = yield* Effect.either(cliEffect("rename experiment", mod.renameExperiment({ cwd, oldId, newId })));
    if (Either.isRight(outcome)) {
      yield* Effect.sync(() => {
        if (flags.json) process.stdout.write(renderExperimentRenameJson(outcome.right));
        else process.stdout.write(renderExperimentRenameDoneHuman(outcome.right));
      });
      return 0;
    }
    // ExperimentRenameError 携带稳定 reason 与 rejected plan;其它异常按通用失败兜底。
    const error = outcome.left.cause;
    yield* Effect.sync(() => {
      if (error instanceof ExperimentRenameError) {
        const rejected = experimentRenameRejectedFromError(error);
        if (flags.json) process.stdout.write(renderExperimentRenameJson(rejected));
        else process.stdout.write(renderExperimentRenameRejectedHuman(rejected));
      } else {
        process.stderr.write(t("cli.rename.failed", { error: error instanceof Error ? error.message : String(error) }));
      }
    });
    return 1;
  });
}

/** 加载 cwd/.env(不覆盖已有环境变量)。 */
function loadDotenv(cwd: string): Effect.Effect<void, CliFailure> {
  const path = join(cwd, ".env");
  if (!existsSync(path)) return Effect.void;
  return cliPromise("read .env", () => readFile(path, "utf-8")).pipe(
    Effect.tap((raw) => Effect.sync(() => {
      for (const line of raw.split("\n")) {
        const entry = line.trim();
        if (!entry || entry.startsWith("#")) continue;
        const eq = entry.indexOf("=");
        if (eq === -1) continue;
        const key = entry.slice(0, eq).trim();
        let value = entry.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
    })),
    Effect.asVoid,
  );
}

function loadConfig(cwd: string): Effect.Effect<Config, CliFailure> {
  return Effect.gen(function* () {
    const { loadConfigFile } = (yield* cliPromise("load config module", () => import("./load-config.ts"))) as {
      loadConfigFile(cwd: string): Promise<Config>;
    };
    return yield* cliPromise("load NiceEval config", () => loadConfigFile(cwd));
  });
}

// AGENTS.md/CLAUDE.md 托管区块:告诉在这个项目里干活的 coding agent「niceeval 不在你的训练数据里,
// 先读随包文档,跑完只经公开 show 面诊断」。随包只发中文准绳版文档(英文站是手工同步、可能滞后,
// 不进包,见 package.json 的 files);init 时写入/刷新;标记之外的用户内容永不触碰。
const AGENT_RULES_BEGIN = "<!-- BEGIN:niceeval-agent-rules -->";
const AGENT_RULES_END = "<!-- END:niceeval-agent-rules -->";
const AGENT_RULES_CONTENT = [
  "# niceeval is NOT in your training data",
  "",
  "Its APIs and conventions may differ from anything you have seen. Start with",
  "`node_modules/niceeval/INDEX.md`, then read the task-specific bundled guides it points",
  "to before writing any eval, experiment, adapter, or niceeval config. That index and",
  "the bundled Chinese docs are the authoritative version matching this installation.",
  "After a run, use this repository's package-manager invocation of `niceeval show` for",
  "diagnosis (`pnpm --silent exec niceeval show` in a pnpm project). Pick an `@<locator>`",
  "from the compact index, then show that locator for an overview, or add",
  "`--source` / `--execution` / `--timing` / `--diff` / `--json` for evidence.",
  "When diagnosing an existing run, do not inspect raw `.niceeval` files or treat the current",
  "`evals/` or `agents/` source as evidence of what happened in that run. If `niceeval show`",
  "cannot expose the evidence you need, report that product gap. Reading source remains",
  "appropriate when the task is to author or modify that source.",
].join("\n");

// 优先复用已有的 AGENTS.md;项目只有 CLAUDE.md(没有 AGENTS.md)时改写 CLAUDE.md 本身,
// 不再另建一份重复文件;两者都没有则新建 AGENTS.md。CLAUDE.md 是指向 AGENTS.md 的符号链接时,
// existsSync 会 follow 链接——目标存在则直接算作「AGENTS.md 已存在」,写入的还是同一份内容,
// 不会产生分裂;目标不存在(悬空链接)则落回新建 AGENTS.md,写入后链接自然生效。
function resolveAgentDocPath(cwd: string): string {
  const agentsPath = join(cwd, "AGENTS.md");
  if (existsSync(agentsPath)) return agentsPath;
  const claudePath = join(cwd, "CLAUDE.md");
  if (existsSync(claudePath)) return claudePath;
  return agentsPath;
}

// init 提示用:从 cwd 向上找最近的 package.json,判断宿主是否 ESM 形态。装载本身不挑形态
// (bin 注册了 tsx 的 ESM+CJS 双 hook,exports 全出口带 require 条件,见 docs/cli.md
// 「装载用户 .ts」),但 CJS 编译面下 config / eval 文件用不了顶层 await,ESM 仍是推荐形态;
// 找不到 package.json 或解析失败按非 ESM 处理(tsx/Node 的缺省语义就是 CJS)。只提示,
// 不改用户的 package.json。
function hostPrefersEsm(cwd: string): boolean {
  let dir = resolvePath(cwd);
  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { type?: unknown };
        return pkg.type === "module";
      } catch {
        return false;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function initProject(cwd: string): Effect.Effect<void, CliFailure> {
  return Effect.gen(function* () {
    yield* cliPromise("create eval directory", () => mkdir(join(cwd, "evals"), { recursive: true }));
    const configPath = join(cwd, "niceeval.config.ts");
    if (!existsSync(configPath)) {
      yield* cliPromise("write initial config", () => writeFile(
        configPath,
        [
          'import { defineConfig } from "niceeval";',
          "",
          "export default defineConfig({",
          "  // Add experiments/ with defineExperiment(...) to run evals.",
          "  //",
          "  // Judge Facts require an Eval declaration: judge: true. Configure the model here or",
          "  // on an Experiment. A consumed Fact without a model or key becomes unavailable and",
          "  // makes that Attempt errored. Any OpenAI-compatible /chat/completions service works;",
          "  // the key is read from OPENAI_API_KEY unless apiKeyEnv says otherwise.",
          '  // judge: { model: "gpt-5.4-mini" },',
          "});",
          "",
        ].join("\n"),
        "utf-8",
      ));
    }
    const agentDocPath = resolveAgentDocPath(cwd);
    const existing = existsSync(agentDocPath)
      ? yield* cliPromise("read agent instructions", () => readFile(agentDocPath, "utf-8"))
      : "";
    const next = upsertManagedBlock(existing, AGENT_RULES_BEGIN, AGENT_RULES_END, AGENT_RULES_CONTENT);
    if (next !== existing) yield* cliPromise("write agent instructions", () => writeFile(agentDocPath, next, "utf-8"));
  });
}

function openBrowser(url: string): Effect.Effect<boolean, CliFailure> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  return cliPromise("open browser", () => new Promise((resolveOpen: (opened: boolean) => void) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolveOpen(ok);
    };

    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    const timer = setTimeout(() => finish(true), 1500);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
    child.unref();
  }));
}

/**
 * run 结束后把 coordinator 累计的诊断折成 `InvocationCompletion`(见 docs/feature/experiments/cli.md
 * 「运行完成状态不只看 verdict 计数」)。只读已经真实发生过的诊断,不额外发明信号:
 * - `"interrupted"` 诊断只在 run.ts 判定为真·中断(Effect exit 真实标记中断,不是「signal 被
 *   abort 过」这种更弱的信号)时才会出现,见 `runner/run.ts` 的 `reportInterrupted()` 调用点。
 * - `"budget-exhausted:<experimentId>"` 诊断的 `count` 就是该 experiment 因预算耗尽未派发的
 *   attempt 数(见 `runner/feedback/reducer.ts` 对 `budget-exhausted` 事件的注释),跨
 *   experiment 求和得到 `unstarted`。
 * - `"reporter-error:<reporter>"` 诊断转成 `ReporterError[]`;`required` 字段来自事件自带的
 *   `data.required`,直接反映这个 reporter 注册时的真实 required/best-effort 分类(见上面
 *   构造 `reporters: ReporterRegistration[]` 的地方——`--junit` 为 `required: true`,
 *   `config.reporters` 恒 `false`),不是一个统一写死的占位值。
 * - `earlyExitUnstarted` 从反馈状态的 attempt:early-exit 计数派生(减去 fail-fast 的那部分——
 *   那是「未完整覆盖」,进 unstarted,不是「省下的重复验证」)。
 */
function assembleInvocationCompletion(state: RunFeedbackState): InvocationCompletion {
  let unstarted = 0;
  let failFastSkipped = 0;
  let haltedSkipped = 0;
  let interrupted = false;
  const reporterErrors: ReporterError[] = [];
  for (const d of state.diagnostics) {
    // 归类按**稳定词法** `code`,不按 `key`:`key` 里编着折叠身份(experimentId / evalId /
    // reporter 名),拿它做前缀匹配会在「把身份从 key 里摘出去」时静默失配——记账悄悄归零,
    // 没有任何测试或类型会报警。`code` 省略时回落到 key 的首段:缺省 key 恒是
    // `${code}:${identity}`(见 sink.ts 的 DiagnosticInput),首段即 code。
    const code = d.code ?? d.key.split(":", 1)[0];
    if (code === "interrupted") {
      interrupted = true;
    } else if (code === "budget-exhausted") {
      unstarted += d.count;
    } else if (code === "fail-fast") {
      // run 级 fail-fast 造成的未派发同样计入 unstarted(结论落 incomplete,见
      // docs/feature/experiments/architecture.md「Completion 与退出」)。
      unstarted += d.count;
      failFastSkipped += d.count;
    } else if (code === "dispatch-halted") {
      // 止损闸停派发造成的未派发(见 docs/feature/error-classification/architecture.md
      // 「记账」)。这条诊断的 count 是「同一死因被声明了几次」(重复声明折叠),不是未派发数——
      // 未派发数由 emitter 累计后写在 data.unstarted 里(与 budget-exhausted 同一口径)。
      const halted = typeof d.data?.unstarted === "number" ? d.data.unstarted : 0;
      unstarted += halted;
      haltedSkipped += halted;
    } else if (code === "reporter-error") {
      // required 决定这条错误是否写进 InvocationCompletion.reporterErrors 并让 completion 非 complete
      // (见 docs/cli.md「required reporter」);best-effort reporter 的失败只保留为 diagnostic。
      if (d.data?.required !== true) continue;
      reporterErrors.push({
        reporter: typeof d.data?.reporter === "string" ? d.data.reporter : d.key.slice("reporter-error:".length),
        required: true,
        message: d.message,
      });
    }
  }
  // 中断造成的未派发(仍在 queued 的 attempt)同样计入 unstarted(见 docs/feature/experiments/
  // architecture.md「Completion 与退出」:budget 耗尽、fail-fast 或中断造成的未派发都不伪装成全绿)。
  if (interrupted) unstarted += state.queued;
  // attempt:early-exit 计数含 fail-fast 与止损闸的未派发(反馈层同一事件驱动计数守恒);
  // 「省下的重复验证」= 总数减去那两部分。
  const earlyExitUnstarted = Math.max(0, state.earlyExitSkipped - failFastSkipped - haltedSkipped);
  const status: CompletionStatus = interrupted
    ? "interrupted"
    : unstarted > 0 || reporterErrors.length > 0
      ? "incomplete"
      : "complete";
  return { status, unstarted, earlyExitUnstarted, reporterErrors };
}

/** package.json 的 version 字段;-v/--version 直接回显这个号。 */
function packageVersion(): Effect.Effect<string, CliFailure> {
  return cliPromise("read package version", () => readFile(new URL("../package.json", import.meta.url), "utf-8")).pipe(
    Effect.flatMap((raw) => Effect.try({
      try: () => (JSON.parse(raw) as { version: string }).version,
      catch: (cause) => cliFailure("decode package version", cause),
    })),
  );
}

function writeStdout(text: string): Effect.Effect<void> {
  return Effect.sync(() => {
    process.stdout.write(text);
  });
}

function writeStderr(text: string): Effect.Effect<void> {
  return Effect.sync(() => {
    process.stderr.write(text);
  });
}

/** Idempotent application-level sweep for resources owned by this invocation. */
function releaseCliResources(): Effect.Effect<void> {
  return Effect.all([
    cliPromise("stop remaining sandboxes", () => stopAllSandboxes()).pipe(Effect.ignore),
    drainExperimentTeardowns().pipe(Effect.ignore),
    drainHeldCaseLocksEffect().pipe(Effect.ignore),
    drainHeldGateLeasesEffect().pipe(Effect.ignore),
  ], { concurrency: "unbounded" }).pipe(Effect.asVoid);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function runDockerCommand(
  positionals: readonly string[],
  flags: Flags,
): Effect.Effect<number, CliFailure> {
  return Effect.gen(function* () {
    const { runDockerProfileCommand } = (yield* cliPromise(
      "load Docker profile command",
      () => import("./sandbox/docker-profile/cli.ts"),
    )) as {
      runDockerProfileCommand(
        positionals: readonly string[],
        options: { readonly json: boolean; readonly smoke: boolean },
      ): Promise<number>;
    };
    return yield* cliPromise(
      "run Docker profile command",
      () => runDockerProfileCommand(positionals, { json: flags.json, smoke: flags.smoke }),
    );
  });
}

function runSandboxCliCommand(
  cwd: string,
  positionals: readonly string[],
  flags: Flags,
): Effect.Effect<number, CliFailure> {
  return cliEffect("run sandbox command", runSandboxCommandEffect(
    cwd,
    [...positionals],
    {
      all: flags.all,
      window: flags.window,
      path: flags.sandboxPath,
      leaveRunning: flags.leaveRunning,
      run: flags.record,
      orphans: flags.orphans,
      force: flags.force,
    },
  ));
}

function runSessionCommand(
  cwd: string,
  positionals: readonly string[],
  flags: Flags,
): Effect.Effect<number, never> {
  return Effect.gen(function* () {
    const niceevalRoot = resolvePath(cwd, ".niceeval");
    const subcommand = positionals[0] ?? "list";
    if (subcommand === "list") {
      if (positionals.length > 2) {
        yield* writeStderr("niceeval session list accepts at most one experiment prefix.\n");
        return 1;
      }
      const outcome = yield* Effect.either(cliEffect("list sessions", listSessions(niceevalRoot, {
        all: flags.all,
        ...(positionals[1] === undefined ? {} : { selector: positionals[1] }),
      })));
      if (Either.isLeft(outcome)) {
        yield* writeStderr(`${errorMessage(outcome.left.cause)}\n`);
        return 1;
      }
      yield* writeStdout(flags.json
        ? `${JSON.stringify(outcome.right)}\n`
        : renderSessionListText(outcome.right, Date.now(), flags.all));
      return 0;
    }
    if (subcommand === "show") {
      if (positionals.length !== 2 || flags.all) {
        yield* writeStderr("Usage: niceeval session show <sessionId> [--json]\n");
        return 1;
      }
      const outcome = yield* Effect.either(cliEffect("show session", showSession(niceevalRoot, positionals[1]!)));
      if (Either.isLeft(outcome)) {
        yield* writeStderr(`${errorMessage(outcome.left.cause)}\n`);
        return 1;
      }
      yield* writeStdout(flags.json
        ? `${JSON.stringify(outcome.right)}\n`
        : renderSessionShowText(outcome.right));
      return 0;
    }
    yield* writeStderr("Usage: niceeval session list [--all] [<experiment-prefix>] [--json]\n" +
      "       niceeval session show <sessionId> [--json]\n");
    return 1;
  });
}

function runRecordMaintenanceCommand(
  cwd: string,
  command: "clean" | "migrate",
  positionals: readonly string[],
  flags: Flags,
): Effect.Effect<number, CliFailure> {
  return Effect.gen(function* () {
    if (positionals.length > 0) {
      yield* writeStderr(`niceeval ${command} does not accept positional arguments.\n`);
      return 1;
    }
    const unsupported = firstRecordMaintenanceUnsupportedFlag(flags);
    if (unsupported !== undefined) {
      yield* writeStderr(`niceeval ${command} does not accept ${unsupported}.\n`);
      return 1;
    }
    const result = yield* cliEffect("run Record maintenance", runRecordCliCommand({
      command,
      cwd,
      ...(flags.record === undefined ? {} : { record: flags.record }),
      yes: flags.yes,
    }));
    if (result.stdout !== "") yield* writeStdout(result.stdout);
    if (result.stderr !== "") yield* writeStderr(result.stderr);
    return result.exitCode;
  });
}

function agentRunFromExperiment(
  experiment: DiscoveredExperiment,
  selectedEvalIds: readonly string[],
  overrides: Pick<Flags, "attempts" | "earlyExit" | "timeout" | "budget"> = {},
): AgentRun {
  return {
    agent: experiment.agent,
    model: experiment.model,
    reasoningEffort: experiment.reasoningEffort,
    flags: experiment.flags ?? {},
    plugins: experiment.plugins,
    attempts: overrides.attempts ?? experiment.attempts ?? 1,
    earlyExit: overrides.earlyExit ?? experiment.earlyExit ?? false,
    sandbox: experiment.sandbox,
    sandboxReuse: experiment.sandboxReuse,
    judge: experiment.judge,
    ...resolveRunTimeout(overrides.timeout, experiment.timeoutMs),
    budget: overrides.budget ?? experiment.budget,
    selectedEvalIds,
    experimentId: experiment.id,
    experimentBaseDir: experiment.baseDir,
    experimentSourcePath: experiment.sourcePath,
    description: experiment.description,
    labels: experiment.labels,
    maxConcurrency: experiment.maxConcurrency,
    setup: experiment.setup,
    teardown: experiment.teardown,
    classifyFailure: experiment.classifyFailure,
  };
}

function uniqueExactOrPrefix<T extends { readonly id: string }>(
  candidates: readonly T[],
  selector: string,
): readonly T[] {
  const exact = candidates.find((candidate) => candidate.id === selector);
  return exact === undefined
    ? candidates.filter((candidate) => candidate.id.startsWith(selector))
    : [exact];
}

function renderDebugPlanJson(input: {
  readonly experimentId: string;
  readonly evalId: string;
  readonly commandPlan: ReturnType<typeof assembleCommandPlan>;
}): string {
  return `${JSON.stringify({
    format: "niceeval.debug-plan/v1",
    schemaVersion: 1,
    experimentId: input.experimentId,
    evalId: input.evalId,
    commandPlan: input.commandPlan,
  })}\n`;
}

function runDebugCommand(
  cwd: string,
  positionals: readonly string[],
  flags: Flags,
): Effect.Effect<number, CliFailure> {
  return Effect.gen(function* () {
    if (positionals.length !== 2) {
      yield* writeStderr(t("cli.debug.usage"));
      return 1;
    }

    const [experimentSelector, evalSelector] = positionals as readonly [string, string];
    const config = yield* loadConfig(cwd);
    const evals = yield* cliEffect("discover evals for lifecycle debug", discoverEvals(cwd));
    const experiments = yield* cliEffect("discover experiments for lifecycle debug", discoverExperiments(cwd));
    const experimentIds = experiments.map((experiment) => experiment.id);
    const matchedExperiments = uniqueExactOrPrefix(experiments, experimentSelector)
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id));
    if (matchedExperiments.length === 0) {
      yield* writeStderr(t("cli.debug.experimentNoMatch", {
        selector: experimentSelector,
        candidates: [...experimentIds].sort().join(", ") || t("cli.none"),
      }));
      return 1;
    }
    if (matchedExperiments.length > 1) {
      yield* writeStderr(t("cli.debug.experimentAmbiguous", {
        selector: experimentSelector,
        candidates: matchedExperiments.map((experiment) => experiment.id).join(", "),
      }));
      return 1;
    }

    const experiment = matchedExperiments[0]!;
    const { selectorEvals } = resolveExperimentEvals({
      experimentId: experiment.id,
      selector: experiment.evals,
      cliPatterns: [],
      evals,
    });
    const matchedEvals = uniqueExactOrPrefix(selectorEvals, evalSelector)
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id));
    if (matchedEvals.length === 0) {
      yield* writeStderr(t("cli.debug.evalNoMatch", {
        selector: evalSelector,
        experimentId: experiment.id,
        candidates: selectorEvals.map((evalDef) => evalDef.id).sort().join(", ") || t("cli.none"),
      }));
      return 1;
    }
    if (matchedEvals.length > 1) {
      yield* writeStderr(t("cli.debug.evalAmbiguous", {
        selector: evalSelector,
        experimentId: experiment.id,
        candidates: matchedEvals.map((evalDef) => evalDef.id).join(", "),
      }));
      return 1;
    }

    const evalDef = matchedEvals[0]!;
    const run = agentRunFromExperiment(experiment, [evalDef.id]);
    const prepared = yield* cliEffect(
      "plan sandbox lifecycle debug",
      prepareRunSandboxes(evals, [run], liveSandboxPlanningServices(), {
        ...(config.timeoutMs === undefined ? {} : { configTimeoutMs: config.timeoutMs }),
      }),
    );
    const commandPlan = assembleCommandPlan({
      rows: [{
        experimentId: experiment.id,
        evalId: evalDef.id,
        ...(evalDef.evalGroup === undefined ? {} : { evalGroupId: evalDef.evalGroup.id }),
        attempts: run.attempts,
        dispatch: [{ attempts: Array.from({ length: run.attempts }, (_, attempt) => attempt) }],
      }],
      preparedPairsByKey: preparedPairsByKey(prepared),
    });
    yield* writeStdout(flags.json
      ? renderDebugPlanJson({ experimentId: experiment.id, evalId: evalDef.id, commandPlan })
      : renderHumanCommandPlan(commandPlan, {
          isTTY: process.stdout.isTTY,
          noColor: process.env.NO_COLOR,
          width: process.stdout.columns,
        }));
    return 0;
  });
}

function runEvaluationCommand(
  cwd: string,
  command: CliCommand,
  positionals: readonly string[],
  flags: Flags,
  interruption?: CliInterruptionOwnership,
) {
  return Effect.gen(function* () {
    const config = yield* loadConfig(cwd);
    const maxBuildConcurrency = flags.maxBuildConcurrency ?? config.maxBuildConcurrency ?? 2;
    if (!Number.isInteger(maxBuildConcurrency) || maxBuildConcurrency <= 0) {
      yield* writeStderr(`maxBuildConcurrency must be a positive integer, got ${maxBuildConcurrency}.\n`);
      return 1;
    }
    const allEvals = yield* cliEffect("discover evals", discoverEvals(cwd));
    const evals = flags.tag ? allEvals.filter((evalDefinition) => evalDefinition.tags?.includes(flags.tag as string)) : allEvals;

    if (command === "list") {
      yield* writeStdout(t("cli.list.header", { count: evals.length }));
      for (const evalDefinition of evals) {
        yield* writeStdout(`  ${evalDefinition.id}${evalDefinition.description ? `  — ${evalDefinition.description}` : ""}\n`);
      }
      return 0;
    }

    const agentRuns: AgentRun[] = [];
    let experimentSelection = t("cli.all");
    let availableExperimentPaths = t("cli.none");

    if (command === "exp" || command === "check") {
      if (flags.agent || flags.model) {
        yield* writeStderr(t("cli.exp.agentModelFlagUnsupported"));
        return 1;
      }
      if (flags.force) {
        yield* writeStderr(t("cli.exp.forceUnsupported"));
        return 1;
      }
      const viewerFlag = firstViewerOnlyFlag(flags);
      if (viewerFlag) {
        yield* writeStderr(t("cli.exp.viewerFlagUnsupported", { flag: viewerFlag.flag, command: viewerFlag.command }));
        return 1;
      }
      const experiments = yield* cliEffect("discover experiments", discoverExperiments(cwd));
      if (command === "exp" && positionals[0] === "list") {
        if (positionals.length > 2) {
          yield* writeStderr("niceeval exp list accepts at most one experiment prefix.\n");
          return 1;
        }
        const selector = positionals[1];
        const ids = experiments.map((experiment) => experiment.id);
        const selectedIds = selector === undefined ? new Set(ids) : new Set(matchExperimentSelector(ids, selector));
        const selected = experiments.filter((experiment) => selectedIds.has(experiment.id));
        if (selected.length === 0 && selector !== undefined) {
          yield* writeStderr(t("cli.experiment.noMatch", {
            arg: selector,
            experiments: browsableExperimentPaths(ids).join(", ") || t("cli.none"),
          }));
          return 1;
        }
        const rows = selected.map((experiment) => {
          const { selectedEvalIds } = resolveExperimentEvals({
            experimentId: experiment.id,
            selector: experiment.evals,
            cliPatterns: [],
            evals,
          });
          return {
            experimentId: experiment.id,
            ...(experiment.description !== undefined ? { description: experiment.description } : {}),
            agent: experiment.agent.name,
            ...(experiment.model !== undefined ? { model: experiment.model } : {}),
            attempts: experiment.attempts,
            evalCount: selectedEvalIds.length,
            labels: { ...experiment.labels },
            selectedEvalIds,
          };
        });
        if (flags.json) {
          yield* writeStdout(`${JSON.stringify({ format: "niceeval.experiments", schemaVersion: 1, experiments: rows })}\n`);
        } else {
          for (const row of rows) {
            yield* writeStdout([
              row.experimentId,
              row.description ?? "—",
              row.agent,
              row.model ?? "—",
              `attempts=${row.attempts}`,
              `evals=${row.evalCount}`,
              `labels=${JSON.stringify(row.labels)}`,
            ].join("\t") + "\n");
          }
        }
        return 0;
      }

      const expArg = positionals[0];
      const extraPatterns = positionals.slice(1);
      experimentSelection = positionals.join(" ") || t("cli.all");
      availableExperimentPaths = browsableExperimentPaths(experiments.map((experiment) => experiment.id)).join(", ") || t("cli.none");
      const selectedIds = expArg === undefined ? undefined : new Set(matchExperimentSelector(experiments.map((experiment) => experiment.id), expArg));
      const selected = selectedIds === undefined ? experiments : experiments.filter((experiment) => selectedIds.has(experiment.id));
      if (selected.length === 0) {
        yield* writeStderr(t("cli.experiment.noMatch", {
          arg: expArg ?? t("cli.all"),
          experiments: availableExperimentPaths,
        }));
        if (expArg === "show" || expArg === "view") {
          yield* writeStderr(t("cli.experiment.viewerCommandHint", {
            command: expArg,
            args: extraPatterns.length > 0 ? ` ${extraPatterns.join(" ")}` : "",
          }));
        }
        return 1;
      }

      const reminder = yield* keptSandboxReminderEffect(cwd).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
      );
      if (reminder) yield* writeStderr(reminder);
      const orphans = yield* orphanReminderEffect(cwd).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
      );
      if (orphans) yield* writeStderr(orphans);
      const teardownReminder = yield* orphanedTeardownReminderEffect(
        resolvePath(cwd, ".niceeval"),
        new Set(selected.filter((experiment) => experiment.teardown).map((experiment) => experiment.id)),
        hostname(),
      ).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      if (teardownReminder) yield* writeStderr(teardownReminder);

      if (flags.teardown) {
        if (extraPatterns.length > 0) {
          yield* writeStderr(t("cli.exp.teardownNoEvalPatterns"));
          return 1;
        }
        const niceevalRootForTeardown = resolvePath(cwd, ".niceeval");
        let anyFailed = false;
        for (const experiment of selected) {
          if (!experiment.teardown) continue;
          const { selectedEvalIds } = resolveExperimentEvals({
            experimentId: experiment.id,
            selector: experiment.evals,
            cliPatterns: [],
            evals,
          });
          const ctx: ExperimentHookContext = {
            experimentId: experiment.id,
            selectedEvalIds,
            signal: new AbortController().signal,
            progress: () => {},
            diagnostic: (input) => process.stderr.write(`${input.message}\n`),
            fact: (key, value) => recordFact({}, key, value),
          };
          const registrations = yield* readTeardownRegistrationsEffect(niceevalRootForTeardown).pipe(
            Effect.catchAll(() => Effect.succeed([] as const)),
          );
          const matching = registrations.filter(({ entry }) => entry.experimentId === experiment.id);
          const claimed = yield* Effect.all(
            matching
              .filter(({ entry }) => isOrphanedTeardownRegistration(entry, hostname()))
              .map(({ id }) => removeTeardownRegistrationIfPresentEffect(niceevalRootForTeardown, id).pipe(
                Effect.catchAll(() => Effect.succeed(false)),
                Effect.map((claimed) => claimed ? id : undefined),
              )),
            { concurrency: "unbounded" },
          );
          const executions = matching.length === 0 ? [undefined] : claimed.filter((id): id is string => id !== undefined);
          for (const _ of executions) {
            const outcome = yield* Effect.either(cliEffect(
              "run experiment teardown",
              cleanupCallback(() => experiment.teardown!(ctx)),
            ));
            if (Either.isRight(outcome)) {
              yield* writeStderr(t("cli.exp.teardownDone", { experimentId: experiment.id }));
            } else {
              anyFailed = true;
              const error = outcome.left.cause;
              yield* writeStderr(t("cli.exp.teardownFailed", {
                experimentId: experiment.id,
                message: error instanceof Error ? error.message : String(error),
              }));
            }
          }
        }
        return anyFailed ? 1 : 0;
      }

      const experimentScopeIds = new Set<string>();
      for (const experiment of selected) {
        const { selectedEvalIds, selectorEvals } = resolveExperimentEvals({
          experimentId: experiment.id,
          selector: experiment.evals,
          cliPatterns: extraPatterns,
          evals,
        });
        for (const evalDefinition of selectorEvals) experimentScopeIds.add(evalDefinition.id);
        agentRuns.push(agentRunFromExperiment(experiment, selectedEvalIds, flags));
      }
      for (const pattern of extraPatterns) {
        const matches = evalPrefixPredicate([pattern]);
        if ([...experimentScopeIds].some((id) => matches(id))) continue;
        yield* writeStderr(t("cli.experiment.noEvalPrefixMatch", {
          pattern,
          selection: expArg ?? t("cli.all"),
        }));
        return 1;
      }
    } else {
      const experiments = yield* cliEffect("discover experiments", discoverExperiments(cwd));
      const ids = experiments.map((experiment) => experiment.id);
      const matchedIds = new Set(positionals.flatMap((pattern) => matchExperimentSelector(ids, pattern)));
      const asExp = experiments.filter((experiment) => matchedIds.has(experiment.id));
      yield* writeStderr(t("cli.run.experimentRequired"));
      if (asExp.length > 0) {
        yield* writeStderr(t("cli.run.experimentRequiredHint", {
          pattern: positionals[0] ?? "",
          kind: asExp.length > 1 ? t("cli.experimentGroup") : "",
        }));
      } else {
        yield* writeStderr(t("cli.run.experimentRequiredKnown", {
          experiments: experiments.map((experiment) => experiment.id).join(", ") || t("cli.none"),
        }));
      }
      return 1;
    }

    const outputForm = resolveOutputForm({ json: flags.json, isTTY: process.stderr.isTTY === true });
    const matchedByRun = agentRuns.map((run) => selectedEvalsForRun(evals, run));
    const totalAttempts = agentRuns.reduce((sum, run, index) => sum + matchedByRun[index]!.length * run.attempts, 0);
    const uniqueEvalIds = new Set(matchedByRun.flat().map((evalDefinition) => evalDefinition.id));
    if (totalAttempts === 0) {
      yield* writeStderr(t("cli.experiment.noEvalsSelected", {
        selection: experimentSelection,
        experiments: availableExperimentPaths,
      }));
      return 1;
    }

    if (command === "check") {
      yield* cliEffect("link run sandboxes", linkRunSandboxes(evals, agentRuns));
      const pairCount = matchedByRun.reduce((sum, selected) => sum + selected.length, 0);
      yield* writeStdout(`Sandbox layers linked: ${pairCount} pair${pairCount === 1 ? "" : "s"}.\n`);
      return 0;
    }

    const targetPlan: ProjectTargetPlan = yield* cliEffect(
      "plan current ProjectTarget",
      planProjectTarget(evals, agentRuns, config.timeoutMs, {
        configJudge: config.judge,
        keepSandbox: flags.keepSandbox,
      }),
    );

    if (flags.dry) {
      const reuse = yield* cliEffect("prepare current Record reuse", prepareRunnerRecordReuse({
        evals,
        runs: agentRuns,
        config: { timeoutMs: config.timeoutMs },
        plannedFingerprints: targetPlan.plannedFingerprints,
        plannedConfigHashes: targetPlan.plannedConfigHashes,
        rerun: flags.rerun,
        keepSandbox: flags.keepSandbox,
      }));
      const currentPlan = yield* cliEffect("preview current Record reuse", withRunnerCurrentReusePreview({
        niceevalRoot: resolvePath(cwd, ".niceeval"),
        startedAt: Date.now(),
        evals,
        runs: agentRuns,
        reuse,
        // `readReadbacks` is deliberately consumed and projected before this
        // callback returns, while the exact frozen Record capability is live.
        use: ({ reusePlan, readReadbacks }) => readReadbacks().pipe(
          Effect.map((readbacks) => projectCurrentDryPlan({ slots: reusePlan.slots, readbacks })),
        ),
      }));
      const rows = currentDryPlanRows(currentPlan);
      const now = Date.now();
      const lockedFlags = yield* Effect.all(rows.map((row) =>
        readCaseLockEffect(resolvePath(cwd, ".niceeval"), row.experimentId, row.evalId).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
          Effect.map((lock) => lock !== undefined && !isCaseLockExpired(lock, now)),
        ),
      ), { concurrency: "unbounded" });
      const evalGroupsByEvalId = new Map(evals.flatMap((evalDef) =>
        evalDef.evalGroup === undefined ? [] : [[evalDef.id, {
          ...evalDef.evalGroup,
          index: evalDef.evalGroup.evalIds.indexOf(evalDef.id),
        }] as const]
      ));
      const rowsWithLocks = Object.freeze(rows.map((row, index) => {
        const evalGroup = evalGroupsByEvalId.get(row.evalId);
        return Object.freeze({
          ...row,
          ...(evalGroup === undefined ? {} : {
            evalGroupId: evalGroup.id,
            evalGroupIndex: evalGroup.index,
          }),
          ...(lockedFlags[index] ? { locked: true } : {}),
        });
      }));
      const occurrenceAudits = new Map<string, JsonValue>();
      for (const pair of targetPlan.preparedPairsByKey.values()) {
        for (const occurrence of pair.plugin.occurrences) {
          occurrenceAudits.set(JSON.stringify(occurrence.audit), occurrence.audit);
        }
      }
      const pluginAudit: CurrentDryPluginAudit = Object.freeze({
        occurrences: Object.freeze([...occurrenceAudits.values()]),
      });
      const input = {
        totalAttempts,
        evals: uniqueEvalIds.size,
        configs: agentRuns.length,
        attempts: Math.max(1, ...agentRuns.map((run) => run.attempts)),
        rows: rowsWithLocks,
        pluginAudit,
      };
      if (outputForm === "json") {
        yield* writeStdout(renderCurrentDryPlanJson(input));
      } else {
        yield* writeStdout(renderCurrentDryPlan(input));
      }
      return 0;
    }

    const maxConcurrency = flags.maxConcurrency ?? config.maxConcurrency ?? recommendedConcurrencyForPreparedPairs(
      [...targetPlan.preparedPairsByKey.values()],
    );
    const experimentConcurrency: globalThis.Record<string, number> = {};
    for (const run of agentRuns) {
      if (run.experimentId !== undefined && run.maxConcurrency !== undefined) experimentConcurrency[run.experimentId] = run.maxConcurrency;
    }
    const plan = {
      shape: { evals: uniqueEvalIds.size, configs: agentRuns.length, totalAttempts, maxConcurrency },
      ...(Object.keys(experimentConcurrency).length === 0 ? {} : { experimentConcurrency }),
    };

    const io = createNodeFeedbackIO();
    const commandLabel = ["niceeval", command, ...positionals].join(" ").trim();
    const renderer = outputForm === "human"
      ? createHumanRenderer({ io, command: commandLabel })
      : createJsonRenderer({ io });
    const sessionTracker = new SessionTracker(resolvePath(cwd, ".niceeval"));
    const coordinator = createFeedbackCoordinator({
      profile: outputForm,
      renderer,
      io,
      onEvent: (event, state) => sessionTracker.onFeedback(event, state),
    });

    let resourcesReleased = false;
    const releaseResources = Effect.suspend(() => {
      if (resourcesReleased) return Effect.void;
      resourcesReleased = true;
      return releaseCliResources();
    });
    let sessionClosed = false;
    const closeSession = (input: Parameters<SessionTracker["close"]>[0]) => sessionTracker.close(input).pipe(
      Effect.tap(() => Effect.sync(() => { sessionClosed = true; })),
    );
    yield* Effect.addFinalizer(() => releaseResources);
    yield* Effect.addFinalizer(() => sessionClosed
      ? Effect.void
      : closeSession({ status: "incomplete" }).pipe(Effect.ignore));
    yield* Effect.addFinalizer(() => cliPromise("stop dynamic feedback", () => coordinator.stopDynamic()).pipe(Effect.ignore));
    yield* Effect.acquireRelease(
      Effect.sync(() => createInputGuard({
        stdin: createNodeInputGuardStdin(),
        stderrIsTTY: io.stderr.isTTY,
        coordinator,
        onInterrupt: () => process.emit("SIGINT"),
      })),
      (inputGuard) => Effect.sync(() => inputGuard.stop()),
    );

    let invocationSummary: InvocationSummary | undefined;
    const reporters: ReporterRegistration[] = [];
    if (flags.junit) reporters.push({ reporter: JUnit(flags.junit), name: "junit", required: true, target: flags.junit });
    (config.reporters ?? []).forEach((reporter, index) => {
      reporters.push({ reporter, name: `config-reporter-${index}`, required: false });
    });
    reporters.push({
      name: "cli-summary",
      required: false,
      reporter: {
        onInvocationComplete(summary) {
          invocationSummary = summary;
        },
      },
    });
    // This synchronous hand-off and the following `runEvals` yield have no
    // asynchronous gap. A first signal therefore either interrupts the root
    // before dispatch begins, or aborts this Invocation so it can close its
    // durable interrupted receipt before the CLI returns.
    const ownsGracefulDispatch = yield* Effect.sync(() => interruption?.enterGracefulDispatch() ?? true);
    if (!ownsGracefulDispatch) yield* Effect.interrupt;

    // Runner remains Effect-native. During graceful dispatch the application
    // edge translates SIGINT into this Invocation signal, letting dispatch
    // settle and the receipt close before the process exits with 130.
    const receipt = yield* cliEffect("run evaluations", runEvals<never, never>({
      config,
      evals,
      agentRuns,
      reporters,
      maxConcurrency,
      maxBuildConcurrency,
      keepSandbox: flags.keepSandbox,
      rerun: flags.rerun,
      niceevalRoot: resolvePath(cwd, ".niceeval"),
      session: sessionTracker,
      onCurrentRecordReusePlan: (current) => Effect.sync(() => coordinator.start({
        ...plan,
        reused: current.reused,
        ...(current.reusedFailures.length === 0 ? {} : { reusedFailures: current.reusedFailures }),
      })),
      ...(interruption === undefined ? {} : { signal: interruption.invocationSignal }),
    }));
    yield* releaseResources;

    const summary = invocationSummary;
    if (summary === undefined) {
      return yield* Effect.fail(cliFailure("collect invocation summary", new Error("Runner completed without an invocation summary.")));
    }

    const completion = assembleInvocationCompletion(coordinator.state);
    yield* closeSession({ status: completion.status, completion, receipt, completedAt: receipt.completedAt });
    yield* cliPromise("finish feedback", () => coordinator.finish({ summary, completion, receipt }));

    const foldedStats = foldInvocationEvalStats(summary);
    return computeExitCode({ ...summary, failed: foldedStats.failed, errored: foldedStats.errored }, completion);
  });
}

type ReportCliCommand = "show" | "view";

type ReportSelection =
  | { readonly kind: "fixed"; readonly report: Report }
  | { readonly kind: "config" }
  | { readonly kind: "built-in"; readonly name: "overview" }
  | { readonly kind: "module"; readonly path: string };

type ThemeSelection =
  | { readonly kind: "config" }
  | { readonly kind: "built-in"; readonly name: "basalt" | "chalk" }
  | { readonly kind: "module"; readonly path: string };

interface ReportCliRequest {
  readonly command: ReportCliCommand;
  readonly cwd: string;
  readonly root: RecordRoot;
  readonly rootPath: string;
  readonly target:
    | {
      readonly kind: "selection";
      readonly selection: AnalysisSelectionRequest;
    }
    | {
      readonly kind: "project-current";
      readonly experimentIds?: readonly ExperimentId[];
    }
    | {
      readonly kind: "attempt";
      readonly locator: AttemptLocator;
    };
  readonly reportSelection: ReportSelection;
  readonly themeSelection: ThemeSelection;
  readonly page?: ReportRoute;
}

/**
 * The CLI validates selection identity before Record I/O. It never turns a
 * prefix, a path, or a directory entry into a Run / Experiment selection.
 */
function parseReportCliRequest(input: {
  readonly command: ReportCliCommand;
  readonly cwd: string;
  readonly positionals: readonly string[];
  readonly flags: Flags;
}): ReportCliRequest {
  const unsupported = reportUnsupportedFlag(input.command, input.flags);
  if (unsupported !== undefined) {
    throw usageError(`niceeval ${input.command} does not accept ${unsupported}.\n`);
  }
  const runs = input.flags.run ?? [];

  const rootText = input.flags.record;
  if (rootText !== undefined && rootText.trim() === "") {
    throw usageError("--record requires an actual Record root directory.\n");
  }
  const rootPath = resolvePath(input.cwd, rootText ?? ".niceeval/record");
  const root = makeRecordRoot(rootPath);
  if (Either.isLeft(root)) {
    throw usageError(`Invalid --record root: ${root.left.code}.\n`);
  }

  const page = parseReportRoute(input.flags.page);
  const evidenceReports = [
    input.flags.source !== undefined ? "--source" : undefined,
    input.flags.execution ? "--execution" : undefined,
    input.flags.timing !== undefined ? "--timing" : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  if (evidenceReports.length > 1) {
    throw usageError(`niceeval show chooses one evidence Report at a time; remove all but one of ${evidenceReports.join(", ")}.\n`);
  }
  if (!input.flags.execution && input.flags.grep !== undefined) {
    throw usageError("niceeval show --grep only combines with --execution.\n");
  }
  if (input.flags.execution) {
    const report = executionEvidenceReport(executionEvidenceOptions(input.flags));
    if (input.positionals.length !== 1) {
      throw usageError("niceeval show --execution requires exactly one current Record Attempt locator.\n");
    }
    if (runs.length > 0 || input.flags.experiment !== undefined) {
      throw usageError("niceeval show --execution uses its Attempt locator as the only selection; remove --run and --experiment.\n");
    }
    if (input.flags.report !== undefined) {
      throw usageError("niceeval show --execution selects its built-in execution Report; remove --report.\n");
    }
    const locator = input.positionals[0];
    if (locator === undefined) {
      throw usageError("niceeval show --execution requires one current Record Attempt locator.\n");
    }
    const parsedLocator = parseCurrentAttemptLocator(locator);
    return Object.freeze({
      command: input.command,
      cwd: input.cwd,
      root: root.right,
      rootPath,
      target: Object.freeze({ kind: "attempt" as const, locator: parsedLocator }),
      reportSelection: Object.freeze({ kind: "fixed" as const, report }),
      themeSelection: themeSelection(input.cwd, input.flags.theme),
      ...(page === undefined ? {} : { page }),
    });
  }

  if (input.flags.timing !== undefined) {
    if (input.positionals.length !== 1) {
      throw usageError("niceeval show --timing requires exactly one current Record Attempt locator.\n");
    }
    if (runs.length > 0 || input.flags.experiment !== undefined) {
      throw usageError("niceeval show --timing uses its Attempt locator as the only selection; remove --run and --experiment.\n");
    }
    if (input.flags.report !== undefined) {
      throw usageError("niceeval show --timing selects its built-in timing Report; remove --report.\n");
    }
    const locator = input.positionals[0];
    if (locator === undefined) {
      throw usageError("niceeval show --timing requires one current Record Attempt locator.\n");
    }
    const parsedLocator = parseCurrentAttemptLocator(locator);
    return Object.freeze({
      command: input.command,
      cwd: input.cwd,
      root: root.right,
      rootPath,
      target: Object.freeze({ kind: "attempt" as const, locator: parsedLocator }),
      reportSelection: Object.freeze({
        kind: "fixed" as const,
        report: timingEvidenceReport({ mode: input.flags.timing }),
      }),
      themeSelection: themeSelection(input.cwd, input.flags.theme),
      ...(page === undefined ? {} : { page }),
    });
  }

  if (input.flags.source !== undefined) {
    if (input.positionals.length !== 1) {
      throw usageError("niceeval show --source requires exactly one current Record Attempt locator.\n");
    }
    if (runs.length > 0 || input.flags.experiment !== undefined) {
      throw usageError("niceeval show --source uses its Attempt locator as the only selection; remove --run and --experiment.\n");
    }
    if (input.flags.report !== undefined) {
      throw usageError("niceeval show --source selects its built-in source Report; remove --report.\n");
    }
    const locator = input.positionals[0];
    if (locator === undefined) {
      throw usageError("niceeval show --source requires one current Record Attempt locator.\n");
    }
    const parsedLocator = parseCurrentAttemptLocator(locator);
    const report = sourceEvidenceReport();
    return Object.freeze({
      command: input.command,
      cwd: input.cwd,
      root: root.right,
      rootPath,
      target: Object.freeze({ kind: "attempt" as const, locator: parsedLocator }),
      reportSelection: Object.freeze({ kind: "fixed" as const, report }),
      themeSelection: themeSelection(input.cwd, input.flags.theme),
      ...(page === undefined ? {} : { page }),
    });
  }

  if (input.positionals.length > 0) {
    if (input.positionals.length !== 1) {
      throw usageError(
        `niceeval ${input.command} accepts one exact Attempt locator, the default current-project selection, or --run.\n`,
      );
    }
    if (runs.length > 0 || input.flags.experiment !== undefined) {
      throw usageError(
        `niceeval ${input.command} uses its Attempt locator as the only selection; remove --run and --experiment.\n`,
      );
    }
    const locator = input.positionals[0];
    if (locator === undefined || !locator.startsWith("@")) {
      throw usageError(
        `niceeval ${input.command} selects Record data only with a canonical @1<12-character-body> locator, --run, or no selector for current-project results.\n`,
      );
    }
    const parsedLocator = parseCurrentAttemptLocator(locator);
    return Object.freeze({
      command: input.command,
      cwd: input.cwd,
      root: root.right,
      rootPath,
      target: Object.freeze({ kind: "attempt" as const, locator: parsedLocator }),
      reportSelection: input.flags.report === undefined
        ? Object.freeze({ kind: "fixed" as const, report: defaultAttemptOverviewReport })
        : reportSelection(input.cwd, input.flags.report),
      themeSelection: themeSelection(input.cwd, input.flags.theme),
      ...(page === undefined ? {} : { page }),
    });
  }

  if (runs.length > 0 && input.flags.experiment !== undefined) {
    throw usageError("--experiment narrows the default current-project selection; it cannot combine with explicit --run.\n");
  }

  const report = runs.length > 0 && input.flags.report === undefined
    ? Object.freeze({ kind: "fixed" as const, report: defaultRunMembershipOverviewReport })
    : reportSelection(input.cwd, input.flags.report);
  const theme = themeSelection(input.cwd, input.flags.theme);
  const target = runs.length > 0
    ? Object.freeze({ kind: "selection" as const, selection: explicitSelection(runs) })
    : Object.freeze({
        kind: "project-current" as const,
        ...(input.flags.experiment === undefined
          ? {}
          : { experimentIds: uniqueExactExperimentIds(input.flags.experiment) }),
      });

  return Object.freeze({
    command: input.command,
    cwd: input.cwd,
    root: root.right,
    rootPath,
    target,
    reportSelection: report,
    themeSelection: theme,
    ...(page === undefined ? {} : { page }),
  });
}

function executionEvidenceOptions(flags: Flags): { readonly grep?: string } {
  if (flags.grep === undefined) return Object.freeze({});
  try {
    new RegExp(flags.grep);
    return Object.freeze({ grep: flags.grep });
  } catch {
    throw usageError(`--grep "${flags.grep}" is not a valid JavaScript regular expression.\n`);
  }
}

function reportUnsupportedFlag(command: ReportCliCommand, flags: Flags): string | undefined {
  const unsupported: Array<[string, unknown]> = [
    ["--agent", flags.agent],
    ["--model", flags.model],
    ["--attempts", flags.attempts],
    ["--max-concurrency", flags.maxConcurrency],
    ["--max-build-concurrency", flags.maxBuildConcurrency],
    ["--timeout", flags.timeout],
    ["--budget", flags.budget],
    ["--tag", flags.tag],
    ["--junit", flags.junit],
    ["--json", command === "view" && flags.json],
    ["--smoke", flags.smoke],
    ["--dry", flags.dry],
    ["--force", flags.force],
    ["--rerun", flags.rerun],
    ["--early-exit/--no-early-exit", flags.earlyExit],
    ["--open/--no-open", command === "show" ? flags.open : undefined],
    ["--out", command === "show" ? flags.out : undefined],
    ["--port", command === "show" ? flags.port : undefined],
    ["--host", command === "show" ? flags.host : undefined],
    ["--source", command === "show" ? undefined : flags.source],
    ["--execution", command === "show" ? undefined : flags.execution],
    ["--diff", flags.diff || flags.diffPath !== undefined],
    ["--grep", command === "show" ? undefined : flags.grep],
    ["--timing", command === "show" ? undefined : flags.timing],
    ["--keep-sandbox", flags.keepSandbox],
    ["--all", flags.all],
    ["--window", flags.window],
    ["--path", flags.sandboxPath],
    ["--leave-running", flags.leaveRunning],
    ["--history", flags.history],
    ["--usage", flags.usage],
    ["--stats", flags.stats],
    ["--orphans", flags.orphans],
    ["--teardown", flags.teardown],
    ["--yes", flags.yes],
  ];
  const found = unsupported.find(([, value]) =>
    value !== undefined && value !== false && (!Array.isArray(value) || value.length > 0)
  );
  return found?.[0];
}

function parseReportRoute(value: string | undefined): ReportRoute | undefined {
  if (value === undefined) return undefined;
  const parsed = reportRoute(value);
  if (Either.isLeft(parsed)) {
    throw usageError(`Invalid --page route "${value}": ${parsed.left.reason}.\n`);
  }
  return parsed.right;
}

function reportSelection(cwd: string, value: string | undefined): ReportSelection {
  if (value === undefined) return Object.freeze({ kind: "config" as const });
  if (value === "overview") return Object.freeze({ kind: "built-in" as const, name: "overview" as const });
  if (isTrustedModulePath(value)) {
    return Object.freeze({ kind: "module" as const, path: resolveTrustedModulePath(cwd, value) });
  }
  throw usageError("--report accepts built-in overview or an explicit trusted module path.\n");
}

function themeSelection(cwd: string, value: string | undefined): ThemeSelection {
  if (value === undefined) return Object.freeze({ kind: "config" as const });
  if (value === "basalt" || value === "chalk") {
    return Object.freeze({ kind: "built-in" as const, name: value });
  }
  if (isTrustedModulePath(value)) {
    return Object.freeze({ kind: "module" as const, path: resolveTrustedModulePath(cwd, value) });
  }
  throw usageError("--theme accepts built-in basalt/chalk or an explicit trusted module path.\n");
}

function isTrustedModulePath(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || isAbsolute(value);
}

function explicitSelection(values: readonly string[]): AnalysisSelectionRequest {
  const runIds = uniqueExactRunIds(values);
  const [first, ...rest] = runIds;
  if (first === undefined) {
    throw usageError("niceeval show/view requires one or more --run <run-id> values.\n");
  }
  const nonEmptyRunIds: readonly [RunId, ...RunId[]] = [first, ...rest];
  return Object.freeze({
    policy: "explicit-runs",
    input: Object.freeze({ runIds: nonEmptyRunIds }),
  });
}

function uniqueExactRunIds(values: readonly string[]): readonly RunId[] {
  const result: RunId[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const decoded = Schema.decodeUnknownEither(RunIdSchema)(value);
    if (Either.isLeft(decoded)) {
      throw usageError(`Invalid --run value "${value}": expected one exact portable RunId.\n`);
    }
    if (!seen.has(decoded.right)) {
      seen.add(decoded.right);
      result.push(decoded.right);
    }
  }
  return Object.freeze(result);
}

function uniqueExactExperimentIds(values: readonly string[]): readonly ExperimentId[] {
  const result: ExperimentId[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const decoded = Schema.decodeUnknownEither(ExperimentIdSchema)(value);
    if (Either.isLeft(decoded)) {
      throw usageError(`Invalid --experiment value "${value}": expected one exact ExperimentId.\n`);
    }
    if (!seen.has(decoded.right)) {
      seen.add(decoded.right);
      result.push(decoded.right);
    }
  }
  return Object.freeze(result);
}

/** Current Record locators use the strict scheme-1 short alias. */
function parseCurrentAttemptLocator(value: string): AttemptLocator {
  const parsed = parseAttemptLocator(value);
  if (!parsed.valid) {
    throw usageError(
      `Invalid Attempt locator "${value}": expected @1 followed by 12 canonical uppercase Crockford characters.\n`,
    );
  }
  return parsed.locator;
}

interface LoadedCliReportInputs {
  readonly report: Report;
  readonly theme: ThemeDefinition;
  readonly projectCurrentSelection?: AnalysisSelectionRequest;
  /** Record, config, and every statically discovered author module input. */
  readonly watchInputs: readonly string[];
}

/**
 * Config is deliberately fresh-read for every view rebuild even when CLI flags
 * override its current Report or Theme. It is both a trusted boundary and a
 * live input: an invalid config must not leave a stale hidden module graph.
 */
function loadCliReportInputs(request: ReportCliRequest): Effect.Effect<LoadedCliReportInputs, CliFailure> {
  return Effect.gen(function* () {
    const projectCurrent = request.target.kind === "project-current"
      ? yield* cliEffect("load current project target", loadProjectCurrent(request.cwd, {
          ...(request.target.experimentIds === undefined
            ? {}
            : { experiments: request.target.experimentIds }),
          freshImport: true,
        }))
      : undefined;
    const configured = yield* cliEffect(
      "load trusted Report config",
      loadTrustedReportConfig(request.cwd),
    );
    const selectedReport = yield* reportFromSelection(request.reportSelection, configured.report);
    const selectedTheme = yield* themeFromSelection(request.themeSelection, configured.theme);
    const projectCurrentSelection = projectCurrent === undefined
      ? undefined
      : Object.freeze({
          policy: "project-current" as const,
          input: Object.freeze({
            target: projectCurrent.target,
          }),
        });
    return Object.freeze({
      report: selectedReport.value,
      theme: selectedTheme.value,
      ...(projectCurrentSelection === undefined ? {} : { projectCurrentSelection }),
      watchInputs: uniqueWatchInputs([
        request.rootPath,
        ...(projectCurrent?.watchInputs ?? []),
        ...configured.watchInputs,
        ...selectedReport.watchInputs,
        ...selectedTheme.watchInputs,
      ]),
    });
  });
}

function reportFromSelection(
  selection: ReportSelection,
  configured: Report | undefined,
): Effect.Effect<{ readonly value: Report; readonly watchInputs: readonly string[] }, CliFailure> {
  switch (selection.kind) {
    case "fixed":
      return Effect.succeed(Object.freeze({ value: selection.report, watchInputs: Object.freeze([]) }));
    case "config":
      return Effect.succeed(Object.freeze({
        value: configured ?? defaultOverviewReport,
        watchInputs: Object.freeze([]),
      }));
    case "built-in":
      return Effect.succeed(Object.freeze({ value: defaultOverviewReport, watchInputs: Object.freeze([]) }));
    case "module":
      return cliEffect("load trusted Report module", loadTrustedReportModule(selection.path)).pipe(
        Effect.map((loaded) => Object.freeze({ value: loaded.report, watchInputs: loaded.watchInputs })),
      );
  }
}

function themeFromSelection(
  selection: ThemeSelection,
  configured: ThemeDefinition | undefined,
): Effect.Effect<{ readonly value: ThemeDefinition; readonly watchInputs: readonly string[] }, CliFailure> {
  switch (selection.kind) {
    case "config":
      return Effect.succeed(Object.freeze({ value: configured ?? basalt, watchInputs: Object.freeze([]) }));
    case "built-in":
      return Effect.succeed(Object.freeze({
        value: selection.name === "chalk" ? chalk : basalt,
        watchInputs: Object.freeze([]),
      }));
    case "module":
      return cliEffect("load trusted Theme module", loadTrustedThemeModule(selection.path)).pipe(
        Effect.map((loaded) => Object.freeze({ value: loaded.theme, watchInputs: loaded.watchInputs })),
      );
  }
}

function uniqueWatchInputs(paths: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(paths.map((path) => resolvePath(path)))].sort());
}

function executeCliReport(request: ReportCliRequest, inputs: LoadedCliReportInputs) {
  const execution = request.target.kind === "attempt"
    ? executeReportForAttemptFromRecord({
      root: request.root,
      locator: request.target.locator,
      report: inputs.report,
    })
    : executeReportFromRecord({
      root: request.root,
      selection: request.target.kind === "selection"
        ? request.target.selection
        : inputs.projectCurrentSelection!,
      report: inputs.report,
    });
  return execution.pipe(Effect.mapError(reportExecutionFailure));
}

function reportExecutionFailure(error: unknown): CliFailure {
  switch (failureCode(error)) {
    case "sample-run-not-found":
      return usageError(`Run "${stringProperty(error, "runId") ?? "unknown"}" was not found in the selected Record.\n`);
    case "sample-run-invalid":
      return usageError(`Run "${stringProperty(error, "runId") ?? "unknown"}" is not a valid published Record Run.\n`);
    case "sample-selection-invalid":
      return usageError(`Invalid Record analysis selection: ${stringProperty(error, "field") ?? "selection"}.\n`);
    case "sample-attempt-not-found":
      return usageError(`Attempt "${stringProperty(error, "attemptId") ?? "unknown"}" was not found in the selected Record.\n`);
    case "sample-attempt-ambiguous":
      return usageError(`Attempt "${stringProperty(error, "attemptId") ?? "unknown"}" is ambiguous in the selected Record.\n`);
    case "sample-attempt-locator-not-found":
      return usageError(`Attempt locator "${stringProperty(error, "locator") ?? "unknown"}" was not found in the selected Record.\n`);
    case "sample-attempt-locator-ambiguous":
      return usageError(`Attempt locator "${stringProperty(error, "locator") ?? "unknown"}" is ambiguous in the selected Record.\n`);
    case "record-migration-required":
      return usageError("record-migration-required\nRun: niceeval migrate\n");
    case "record-bootstrap-invalid":
      return usageError("record-bootstrap-invalid\nPass --record <actual-record-root> or create a current NiceEval Record.\n");
    case "record-format-unsupported":
      return usageError("record-format-unsupported\nUse a NiceEval version that supports this Record format.\n");
    case "record-migration-interrupted":
      return usageError("record-migration-interrupted\nRestore the Record from Git or a backup before retrying.\n");
    default:
      return cliFailure("execute report from Record", error);
  }
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = Reflect.get(value, key);
  return typeof candidate === "string" ? candidate : undefined;
}

function requireKnownReportPage(
  execution: ReportExecution,
  page: ReportRoute | undefined,
): Effect.Effect<void, CliUsageError> {
  if (page === undefined || execution.pages.some((candidate) => candidate.route === page)) {
    return Effect.void;
  }
  const available = execution.pages
    .flatMap((candidate) => candidate.route === undefined ? [] : [candidate.route])
    .sort()
    .join(", ");
  return Effect.fail(usageError(
    `Unknown Report route "${page}". Available routes: ${available || "none"}.\n`,
  ));
}

const cliReportConsole = Object.freeze({
  write: (text: string) => Effect.try({
    try: () => {
      process.stdout.write(text);
    },
    catch: () => Object.freeze({
      code: "report-console-write-failed" as const,
      operation: "write" as const,
    }),
  }),
});

function runShowCommand(
  cwd: string,
  positionals: readonly string[],
  flags: Flags,
) {
  return Effect.gen(function* () {
    const request = yield* Effect.try({
      try: () => parseReportCliRequest({ command: "show", cwd, positionals, flags }),
      catch: (cause) => cliFailure("parse show arguments", cause),
    });
    const inputs = yield* loadCliReportInputs(request);
    const execution = yield* executeCliReport(request, inputs);
    yield* requireKnownReportPage(execution, request.page);
    yield* showReport({
      execution,
      ...(flags.json ? { format: "json" as const } : {}),
      ...(request.page === undefined ? {} : { page: request.page }),
    }).pipe(
      Effect.provideService(ReportConsole, cliReportConsole),
      Effect.mapError((error) => cliFailure("render Report show output", error)),
    );
    return 0;
  });
}

function runViewCommand(
  cwd: string,
  positionals: readonly string[],
  flags: Flags,
) {
  return Effect.gen(function* () {
    const request = yield* Effect.try({
      try: () => parseReportCliRequest({ command: "view", cwd, positionals, flags }),
      catch: (cause) => cliFailure("parse view arguments", cause),
    });
    const initialInputs = yield* loadCliReportInputs(request);
    const initial = yield* executeCliReport(request, initialInputs);
    yield* requireKnownReportPage(initial, request.page);

    if (flags.out !== undefined) {
      if (flags.out.trim() === "") {
        return yield* Effect.fail(usageError("--out requires a target directory.\n"));
      }
      if (flags.port !== undefined || flags.host !== undefined || flags.open === true) {
        return yield* Effect.fail(usageError("view --out does not start a server; remove --port, --host, and --open.\n"));
      }
      const receipt = yield* exportStaticReport({
        execution: initial,
        out: resolvePath(cwd, flags.out),
        theme: initialInputs.theme,
      }).pipe(
        Effect.provideService(ReportFileSystem, makeNodeReportFileSystem()),
        Effect.mapError((error) => staticExportFailure(error, resolvePath(cwd, flags.out!))),
      );
      yield* writeStdout(`Exported static report site: ${receipt.out}\n`);
      return 0;
    }

    const { host, port } = yield* Effect.try({
      try: () => ({ host: viewHost(flags.host), port: viewPort(flags.port) }),
      catch: (cause) => cliFailure("parse view server arguments", cause),
    });
    const session = yield* openReportViewSession({
      url: `http://${host.includes(":") ? `[${host}]` : host}:${port}/`,
      theme: initialInputs.theme,
      watchInputs: initialInputs.watchInputs,
      initial: Effect.succeed(initial),
      rebuild: () => rebuildReportView(request),
    }).pipe(Effect.mapError((error) => cliFailure("open report view session", error)));
    // Watch set is owned by the session revision; openViewServer only transports
    // fs.watch hints and replaces them after each successful rebuild.
    const server = yield* openViewServer({
      session,
      host,
      port,
    }).pipe(Effect.mapError((error) => cliFailure("open report view", error)));
    const urls = server.urls.map((url) => request.page === undefined ? url : new URL(request.page, url).toString());
    const url = urls[0]!;
    if (!isLoopbackViewHost(host)) {
      yield* writeStderr(
        "Warning: niceeval view is listening beyond loopback without authentication or TLS; " +
        "every reachable client can read report data, execution JSON, and downloads.\n",
      );
    }
    yield* writeStdout(`niceeval view — open in a browser:\n${urls.join("\n")}\n`);
    if (flags.open !== false) {
      yield* openBrowser(url).pipe(Effect.catchAll(() => Effect.succeed(false)));
    }
    return yield* Effect.never;
  });
}

/**
 * A watcher signal is only a hint. Every refresh re-reads config plus its
 * fresh author graph and Record before one completed immutable revision is
 * published with its next recoverable watch set; a typed boundary failure is
 * logged once and leaves last-good execution and the prior watch set.
 */
function rebuildReportView(request: ReportCliRequest) {
  return Effect.gen(function* () {
    const inputs = yield* loadCliReportInputs(request);
    const execution = yield* executeCliReport(request, inputs);
    yield* requireKnownReportPage(execution, request.page);
    return Object.freeze({
      kind: "execution" as const,
      execution,
      theme: inputs.theme,
      watchInputs: inputs.watchInputs,
    });
  }).pipe(
    Effect.catchAll((failure) => {
      const problem = reportViewRebuildFailure(failure);
      return writeStderr(`view rebuild failed: ${problem.summary}\n`).pipe(
        Effect.zipRight(Effect.fail(problem)),
      );
    }),
  );
}

function staticExportFailure(error: unknown, out: string): CliFailure {
  if (failureCode(error) === "report-export-target-exists") {
    return usageError(`report-export-target-exists\nRemove ${out} before retrying.\n`);
  }
  return cliFailure("export static Report", error);
}

function viewHost(value: string | undefined): string {
  const host = (value ?? "127.0.0.1").trim();
  if (host.length === 0) throw usageError("--host requires a non-empty address.\n");
  return host;
}

function isLoopbackViewHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function viewPort(value: number | undefined): number {
  const port = value ?? 4173;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw usageError(`--port must be an integer from 0 through 65535, got ${port}.\n`);
  }
  return port;
}

function reportViewRebuildFailure(failure: CliFailure): { readonly summary: string } {
  const summary = failure._tag === "CliUsageError"
    ? failure.message
    : failure.cause instanceof ReportModuleLoadError
      ? `${failure.cause.code}: ${failure.cause.reason}`
      : failureCode(failure.cause) ?? "Report rebuild failed";
  return Object.freeze({ summary });
}

export const cliProgram = (interruption?: CliInterruptionOwnership) => Effect.gen(function* () {
  const cwd = process.cwd();
  const { command, positionals, flags, providedOptions } = yield* Effect.try({
    try: () => parseArgs(process.argv.slice(2)),
    catch: (cause) => cliFailure("parse CLI arguments", cause),
  });

  // Session / Docker profile queries must remain config-free read paths.
  if (command !== "session" && command !== "docker") {
    yield* loadDotenv(cwd);
  }

  if (flags.help) {
    yield* writeStdout(t("cli.help"));
    return 0;
  }
  if (flags.version) {
    yield* writeStdout((yield* packageVersion()) + "\n");
    return 0;
  }

  if (command === "debug") {
    const unsupported = providedOptions.find((name) =>
      name !== "json" && name !== "help" && name !== "version"
    );
    if (unsupported !== undefined) {
      yield* writeStderr(t("cli.debug.flagUnsupported", { flag: `--${unsupported}` }));
      return 1;
    }
    return yield* runDebugCommand(cwd, positionals, flags);
  }

  if (command === "docker") return yield* runDockerCommand(positionals, flags);

  if (command === "accept") {
    const locators = yield* Effect.try({
      try: () => parseAcceptLocators(positionals, flags),
      catch: (cause) => cliFailure("parse acceptance locators", cause),
    });
    const outcome = yield* Effect.either(runAcceptCommand(cwd, locators, flags.record));
    if (Either.isLeft(outcome)) {
      yield* writeStderr(t("cli.accept.failed", { error: errorMessage(outcome.left.cause) }));
      return 1;
    }
    return 0;
  }

  if (command === "view") return yield* runViewCommand(cwd, positionals, flags);
  if (command === "sandbox") return yield* runSandboxCliCommand(cwd, positionals, flags);
  if (command === "session") return yield* runSessionCommand(cwd, positionals, flags);
  if (command === "show") return yield* runShowCommand(cwd, positionals, flags);
  if (command === "clean" || command === "migrate") {
    return yield* runRecordMaintenanceCommand(cwd, command, positionals, flags);
  }
  if (command === "init") {
    yield* initProject(cwd);
    yield* writeStdout(t("cli.init.done"));
    if (!hostPrefersEsm(cwd)) yield* writeStdout(t("cli.init.esmHint"));
    return 0;
  }
  if (command === "exp" && positionals[0] === "rename") {
    return yield* runExperimentRenameCommand(cwd, positionals.slice(1), flags);
  }

  return yield* runEvaluationCommand(cwd, command, positionals, flags, interruption);
}).pipe(
  // Every command boundary reports a typed CLI failure; defects and
  // interruption remain in the Cause channel for bootstrap to own.
  Effect.mapError((cause) => cliFailure("run CLI command", cause)),
);
