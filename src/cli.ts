// niceeval CLI 入口。执行 eval 必须以 experiment 为单位;位置参数只在 exp 后筛 eval id 前缀。
//   niceeval check [组|配置] [pattern]  只做发现、选择与 SandboxLayer pure link
//   niceeval exp [组|配置] [pattern]    跑实验
//   niceeval accept @<locator>...       接受多条历史结果并重锚到当前配置
//   niceeval show [pattern]          终端读结果:默认报告 / 单 eval / 证据切面 / 时间轴 / --report
//   niceeval list                    只列出发现到的 eval
//   niceeval clean                   删除 .niceeval/ 历史运行 artifact

import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs as nodeParseArgs } from "node:util";
import { Effect } from "effect";
import { discoverEvals, discoverExperiments } from "./runner/discover.ts";
import { browsableExperimentPaths, evalPrefixPredicate, matchExperimentSelector } from "./shared/aggregate.ts";
import { runEvals, type AgentRun } from "./runner/run.ts";
import { cacheKey, missingReason, planCarry, type CarryPlan, type DispatchGroup } from "./runner/fingerprint.ts";
import type { FingerprintComparison, FingerprintDelta, FingerprintDiagnostic } from "./runner/manifest.ts";
import { ATTEMPT_LOCATOR_PREFIX, decodeAttemptLocator } from "./record/locator.ts";
import { resolveExperimentEvals, selectedEvalsForRun } from "./runner/eval-selection.ts";
import { failureDetailFromResult } from "./runner/feedback/failure.ts";
import { stopAllSandboxes, liveSandboxCount } from "./sandbox/registry.ts";
import { formatSandboxLayerLinkError, SandboxLayerLinkError } from "./sandbox/link.ts";
import {
  formatSandboxPhysicalPlanningError,
  SandboxPhysicalPlanningError,
} from "./sandbox/plan.ts";
import { drainExperimentTeardowns } from "./runner/experiment-cleanup-registry.ts";
import { drainHeldCaseLocks, isCaseLockExpired, readCaseLock } from "./runner/lock.ts";
import { drainHeldGateLeases } from "./runner/gate-lease.ts";
import { CLEANUP_TIMEOUT_MS, withCleanupTimeout } from "./runner/cleanup-timeout.ts";
import { resolveRunTimeout } from "./runner/timeout.ts";
import type { ExperimentHookContext } from "./runner/types.ts";
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
  recommendedConcurrencyForPreparedPairs,
} from "./runner/sandbox-selection.ts";
import { JUnit } from "./runner/reporters/json.ts";
import { Artifacts as ArtifactsReporter } from "./runner/reporters/artifacts.ts";
import {
  resolveOutputForm,
  createFeedbackCoordinator,
  createNodeFeedbackIO,
  createInputGuard,
  createNodeInputGuardStdin,
  createHumanRenderer,
  createJsonRenderer,
  renderHumanDryPlan,
  renderJsonPlanDocument,
  computeExitCode,
  reportActivity,
  type JsonPlanRow,
  type JsonPlanDelta,
  type JsonPlanDiagnostic,
  type JsonPlanDiagnosticFact,
  type JsonPlanFingerprintComparison,
} from "./runner/feedback/index.ts";
import {
  buildView,
  startViewServer,
  incompatibleHistoryKey,
  loadCarryInputs,
  resolveViewInput,
  IncompatibleResultsError,
  ViewInputError,
} from "./view/index.ts";
// load.ts 本身没有 JSX,但它的 ReportDefinition/ReportLoadError 要和 view 报告槽实际装载
// --report 与 CLI 同属一个 canonical runtime graph。`unique symbol` 品牌与 class 的
// instanceof 必须从同一份模块实例读取，不能再混用源码与另一份预编译图。
import { ReportLoadError } from "./report/runtime/load.ts";
import { runShow } from "./show/index.ts";
import { setConfiguredLocale, t } from "./i18n/index.ts";
import type { MessageKey } from "./i18n/zh-CN.ts";
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
  RunFeedbackPlan,
  RunFeedbackState,
  Verdict,
} from "./types.ts";

/**
 * view 的可预期用户错误:版本不同的报告(npx 提示)、位置参数/组合语义错误、
 * --report 装载失败。打一句直说问题与下一步后退出,不抛堆栈。
 */
function exitOnViewUserError(e: unknown): never {
  if (e instanceof IncompatibleResultsError || e instanceof ViewInputError || e instanceof ReportLoadError) {
    process.stderr.write(e.message.endsWith("\n") ? e.message : `${e.message}\n`);
    process.exit(1);
  }
  throw e;
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
  // ── show 专属(位置参数仍是 eval id 前缀 / `@<locator>`;这些 flag 选「怎么看」)──
  source?: true | string;
  execution: boolean;
  diff: boolean;
  /** --diff=<路径>(必须 = 连写;空格形式会把路径当 eval id 前缀,按文档如此)。 */
  diffPath?: string;
  /** --grep <pattern>:只与 --execution 组合,收窄命中卡片;与 --expand 互斥。 */
  grep?: string;
  /** --expand <handle>:只与 --execution 组合,要求范围恰好一个 attempt;与 --grep 互斥。 */
  expand?: string;
  timing?: "summary" | "full";
  keepSandbox?: "failed" | "all";
  all: boolean;
  window?: string;
  sandboxPath?: string;
  leaveRunning: boolean;
  history: boolean;
  usage: boolean;
  stats: boolean;
  /** `show` / `view` 命令专用:`--exp` 可重复出现;每次出现是一个数组元素,顺序即用户输入顺序。 */
  experiment?: string[];
  /** `show` / `view` / `accept` / `sandbox enter|list|stop` 共用:记录根目录(`.niceeval` 之外的另一个根,如 `publish` 产出的发布根)。 */
  record?: string;
  run?: string;
  report?: string;
  page?: string;
  theme?: string;
  /** `sandbox list` 专用:核对强杀路径留下的无主实例。 */
  orphans: boolean;
  /** `exp` 命令专用:只对选中实验各执行一次实验级 teardown,不派发 attempt、不跑 setup。 */
  teardown: boolean;
}

// 表驱动的 flag 定义(node:util parseArgs)。--no-x 显式声明,不依赖 allowNegative(需 Node 20.14+,
// engines 是 >=18)。解析器对未知 flag 严格报错,不再静默吞掉后面的位置参数。
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
  /** `exp` 命令专用:机器面——stdout 上单一有序的 NDJSON 事件流(一行一个 JSON 对象),供 coding agent、CI annotation adapter 或脚本消费;`--dry --json` 输出单个 JSON 计划文档而不是流。省略即人读文本(TTY live 面板 / 非 TTY 追加流)。`show` 命令专用:任何切片的结构化形态——同一范围、同一切片选出的同一批实体,输出成一个 JSON 文档到 stdout;与 `--report`、`--expand` 互斥,多个证据 flag(`--source`/`--execution`/`--timing`/`--diff`)只能选一个。 */
  json: { type: "boolean" },
  /** `docker profile doctor` 专用：启动受限 DinD 容器并运行内层容器。 */
  smoke: { type: "boolean" },
  /** `view` 命令专用:把结果查看器静态导出到指定目录。 */
  out: { type: "string" },
  /** `view` 命令专用:指定本地服务器监听端口。 */
  port: { type: "string" },
  /** `view` 命令专用:指定监听地址；可裸写，此时监听全部网络地址并打印可打开的本机与局域网 URL。省略时同样监听全部网络地址。 */
  host: { type: "string" },
  // show 的证据切面 / 时间轴 / 报告装载(docs-site/zh/tutorials/viewing-results.mdx)。
  // 证据切面只认 `@<locator>`(或收窄到单个 eval 的前缀)选出的那一个 attempt——不再有
  // 数字 `--attempt`,选哪个 attempt 由 locator 精确指名,不是「先选 eval 再挑第几次」。
  /** `show` 命令专用:该 attempt 运行时保存的 Eval 源码调用树。裸写为有界默认投影；`--source=full` 展开全部调用路径；`--source=<path>` 按捕获路径后缀唯一匹配并显示该文件全文。 */
  source: { type: "boolean" },
  /** `show` 命令专用:该 attempt 的标准执行事件流(消息、thinking、Skill load、工具调用/结果);有 OTel 时同一节点补时间(证据切面)。每个内容段最多预览前 3 行,截断尾巴自带 `--expand` 展开句柄。 */
  execution: { type: "boolean" },
  /** `show` 命令专用:整个 Attempt 的统一时间树;裸 `--timing` 给有界诊断投影,`--timing=full` 逐节点展开全部 runner/已关联 OTel 节点。 */
  timing: { type: "boolean" },
  /** `show` 命令专用:只与 `--execution` 组合;JS 正则,只输出命中的执行卡片(角色文本、工具名、input、result,失败命令再加 display/stdout/stderr),末尾报跨 attempt 汇总 `N matches in M attempts`。与 `--expand` 互斥。 */
  grep: { type: "string" },
  /** `show` 命令专用:只与 `--execution` 组合,要求范围恰好命中一个 attempt;展开一张卡片的完整落盘内容(不截断)。句柄语法 `t<轮次>.c<卡片>`(agent 事件)或 `cmd<n>`(失败 Sandbox 命令),来自截断卡片自带的提示。与 `--grep` 互斥。 */
  expand: { type: "string" },
  // --diff 是布尔;--diff=<路径> 在 parseArgs 前预扫成 diffPath(路径必须 = 连写,
  // 空格形式的下一个 token 仍是位置参数 = eval id 前缀,与文档一致)。
  /** `show` 命令专用:sandbox 里的文件改动摘要;`--diff=<文件路径>` 看单个文件的完整改动(路径必须 `=` 连写)。 */
  diff: { type: "boolean" },
  /** `show` 命令专用:执行时间轴——对匹配的每个 experiment × eval 分节,逐 attempt 列时间 / verdict / 摘要 / 耗时 / 成本 / locator;与 `--report` 互斥。 */
  history: { type: "boolean" },
  /** `show` 命令专用:范围内逐 attempt 的用量表(`UsageTable` 装配)——判定、轮数、工具调用数、token 拆分与成本;多个 experiment 时逐 experiment 分节、节尾各自合计,缺失字段显示 `—` 且不计入合计。`@<locator>` 范围下退化成该 attempt 的单行表。 */
  usage: { type: "boolean" },
  /** `show` 命令专用:eval × experiment 的稳定性矩阵(`StabilityMatrix` 装配)——每格是该组合全部历史执行(跨快照去重、不设可比性门槛)的判定计数,回答「哪些题从来没通过过」;与 `@<locator>`、`--report` 互斥。 */
  stats: { type: "boolean" },
  /** `show` / `view` 命令专用:按路径段前缀收窄 experiment(与 `niceeval exp` 位置参数同一套匹配);目录路径会选中其下全部配置。可重复;出现两次以上进入对照语义——每次出现必须恰好解析到一个 experiment,顺序即对照条件顺序、首个是基准,`@<locator>` 与重复 `--exp` 互斥。`view --out` 时同一收窄决定出站内容。 */
  exp: { type: "string", multiple: true },
  /** `show` / `view` / `accept` / `sandbox enter|list|stop` 共用:记录根目录(`.niceeval` 之外的另一个根,如 `publish` 产出的发布根)。 */
  record: { type: "string" },
  /** `view` 命令专用:只打开这一份快照文件(`run.json`);文件不可读时命令失败(扫描模式只跳过)。 */
  run: { type: "string" },
  /** `show` / `view` 命令专用:用文件默认导出的 `defineReport(...)` 替换两者共用的默认报告。 */
  report: { type: "string" },
  /** `view` 命令专用:内建主题名或显式主题文件路径。 */
  theme: { type: "string" },
  /** `show` / `view` 命令专用:选择报告的初始页;`show` 渲染该页并在尾部附其余页索引,`view` 以它作初始路由。未命中的页 id 按用法错误退出并列出可用页 id。 */
  page: { type: "string" },
  /** `exp` 命令专用:补齐被强杀打断的实验级 teardown——只对选中的实验各执行一次 teardown(新进程语义),不派发 attempt、不跑 setup;没有遗留登记也照常执行。与 eval 前缀位置参数组合是用法错误。 */
  teardown: { type: "boolean" },
  /** 只打印本次会匹配到的 eval × 运行配置,不实际执行(人读文本或 `--json` 单文档,见「机器怎么读:--json」)。 */
  dry: { type: "boolean" },
  /** 忽略上次运行结果,不跳过已通过的 (experiment, eval) 组合,强制全部重跑。 */
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
  /** 打印用法说明并退出。 */
  help: { type: "boolean", short: "h" },
  /** 打印 niceeval 的版本号并退出。 */
  version: { type: "boolean", short: "v" },
} as const;

function numberFlag(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    process.stderr.write(t("cli.flag.invalidNumber", { flag: name, value: raw }));
    process.exit(1);
  }
  return n;
}

const CLI_COMMANDS = ["check", "exp", "accept", "show", "list", "view", "clean", "init", "run", "sandbox", "session", "docker"] as const;
type CliCommand = (typeof CLI_COMMANDS)[number];

function isCliCommand(candidate: string): candidate is CliCommand {
  return CLI_COMMANDS.some((command) => command === candidate);
}

function parseArgs(argv: string[]): { command: CliCommand; positionals: string[]; flags: Flags } {
  if (argv[0] === "--") argv = argv.slice(1);
  if (argv.some((arg) => arg === "--strict" || arg.startsWith("--strict="))) {
    process.stderr.write(t("cli.flag.strictRemoved"));
    process.exit(1);
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
        process.stderr.write("--host=<address> requires a non-empty address, or use bare --host.\n");
        process.exit(1);
      }
    }
    if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length);
      if (value.length === 0) {
        process.stderr.write("--source=<path> requires a non-empty captured source path, or use bare --source.\n");
        process.exit(1);
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
        process.stderr.write(`--keep-sandbox only accepts "failed" (default) or "all", got "${tier}".\n`);
        process.exit(1);
      }
      keepSandboxTier = tier;
      return "--keep-sandbox";
    }
    if (arg.startsWith("--timing=")) {
      const mode = arg.slice("--timing=".length);
      if (mode !== "summary" && mode !== "full") {
        process.stderr.write(`--timing only accepts "summary" (default) or "full", got "${mode}".\n`);
        process.exit(1);
      }
      timingMode = mode;
      return "--timing";
    }
    if (arg.startsWith("--rerun=")) {
      const mode = arg.slice("--rerun=".length);
      if (mode !== "failed" && mode !== "all") {
        process.stderr.write(`--rerun only accepts "failed" (default) or "all", got "${mode}".\n`);
        process.exit(1);
      }
      rerunMode = mode;
      return "--rerun";
    }
    // `--output` 整个删除(见 docs/feature/experiments/cli.md 与 memory/exp-output-two-forms-ruling.md):
    // beta 不留别名,任何取值(裸 flag 或 `--output=value`)都按用法错误拒绝,不静默吞掉、也不
    // 落到 node:util parseArgs 的通用「unknown option」文案——给出专门的 error:/fix: 两行,
    // 指向唯一还存在的两条路径:不加 flag 跑人读文本,机器面用 `--json`。
    if (arg === "--output" || arg.startsWith("--output=")) {
      process.stderr.write(t("cli.flag.outputRemoved"));
      process.exit(1);
    }
    return arg;
  });

  let values: globalThis.Record<string, string | boolean | undefined>;
  let rawPositionals: string[];
  try {
    const parsed = nodeParseArgs({ args: argv, options: FLAG_OPTIONS, allowPositionals: true, strict: true });
    values = parsed.values as globalThis.Record<string, string | boolean | undefined>;
    rawPositionals = parsed.positionals;
  } catch (e) {
    process.stderr.write(t("cli.flag.parseError", { message: e instanceof Error ? e.message : String(e) }));
    process.exit(1);
  }

  // 第一个位置参数必须是已知命令;其余是 eval id 前缀 / view 输入。
  // 裸 eval id 早已不再是运行入口,所以不识别的首 token 应当就地报用法错误,
  // 不应先装载项目 config / eval 再偶然以其它错误退出。
  let command: CliCommand = "run";
  let positionals = rawPositionals;
  if (rawPositionals.length > 0) {
    const candidate = rawPositionals[0];
    if (!isCliCommand(candidate)) {
      process.stderr.write(t("cli.command.unknown", { command: candidate }));
      process.exit(1);
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
    source: values.source === true ? (sourceValue ?? true) : undefined,
    execution: values.execution === true,
    diff: values.diff === true && diffPath === undefined,
    diffPath,
    timing: values.timing === true ? (timingMode ?? "summary") : undefined,
    grep: values.grep as string | undefined,
    expand: values.expand as string | undefined,
    keepSandbox: values["keep-sandbox"] === true ? (keepSandboxTier ?? "failed") : undefined,
    all: values.all === true,
    window: values.window as string | undefined,
    sandboxPath: values.path as string | undefined,
    leaveRunning: values["leave-running"] === true,
    history: values.history === true,
    usage: values.usage === true,
    stats: values.stats === true,
    experiment: values.exp as string[] | undefined,
    record: values.record as string | undefined,
    run: values.run as string | undefined,
    report: values.report as string | undefined,
    page: values.page as string | undefined,
    theme: values.theme as string | undefined,
    orphans: values.orphans === true,
    teardown: values.teardown === true,
  };
  return { command, positionals, flags };
}

/**
 * exp 只接受两类输入:位置参数选「跑哪些 eval」+ 调度/输出/机器出口 flag 选「对着哪个 agent、
 * 怎么跑」。show / view 专属的证据切面(`--source`/`--execution`/`--diff`)、时间轴(`--history`)、
 * Sample 收窄(`--exp`/`--record`)、报告装载(`--report`/`--page`)、查看器
 * (`--run`/`--out`/`--port`/`--open`)不能被 exp 静默忽略(见 docs/feature/experiments/
 * cli.md「用法错误」)。返回第一个被误用的 flag 及其归属命令(用于报错),没有误用返回 undefined。
 */
/**
 * 计划矩阵的行原料:(experimentId, evalId) 逐行,携带预测与未携带原因分组各一份。
 * `--dry` 的两种形态共用同一份计划矩阵，避免人读与机器面各自重算出不同的携带结论。
 */
function planRowInputs(
  agentRuns: AgentRun[],
  matchedByRun: DiscoveredEval[][],
  carryPlan: CarryPlan | undefined,
  incompatibleKeys: ReadonlySet<string>,
  priorResults: readonly { experimentId?: string; id: string; attempt: number; locator?: string; verdict: Verdict }[] = [],
  evidenceStatesByAttempt: ReadonlyMap<string, "local" | "borrowed" | "dangling"> = new Map(),
): {
  experimentId: string;
  evalId: string;
  attempts: number;
  reused: boolean;
  carried: readonly { attempt: number; verdict: "passed" | "failed" }[];
  dispatch: readonly DispatchGroup[];
  prior?: readonly { attempt: number; locator: string; verdict: Verdict; acceptance: "available" | "legacy-locator"; evidenceState: "local" | "borrowed" | "dangling"; comparison?: FingerprintComparison }[];
}[] {
  const priorByKeyAttempt = new Map<string, { attempt: number; locator: string; verdict: Verdict; acceptance: "available" | "legacy-locator"; evidenceState: "local" | "borrowed" | "dangling" }>();
  for (const prior of priorResults) {
    if (prior.locator === undefined) continue;
    priorByKeyAttempt.set(`${prior.experimentId ?? ""}|${prior.id}|${prior.attempt}`, {
      attempt: prior.attempt,
      locator: prior.locator,
      verdict: prior.verdict,
      acceptance: decodeAttemptLocator(prior.locator).valid ? "available" : "legacy-locator",
      evidenceState: evidenceStatesByAttempt.get(`${prior.experimentId ?? ""}|${prior.id}|${prior.attempt}`) ?? "dangling",
    });
  }
  const rows: {
    experimentId: string;
    evalId: string;
    attempts: number;
    reused: boolean;
    carried: readonly { attempt: number; verdict: "passed" | "failed" }[];
    dispatch: readonly DispatchGroup[];
    prior?: readonly { attempt: number; locator: string; verdict: Verdict; acceptance: "available" | "legacy-locator"; evidenceState: "local" | "borrowed" | "dangling"; comparison?: FingerprintComparison }[];
  }[] = [];
  const carriedByPair = new Map<string, { attempt: number; verdict: "passed" | "failed" }[]>();
  for (const result of carryPlan?.carriedResults ?? []) {
    if (result.experimentId === undefined || (result.verdict !== "passed" && result.verdict !== "failed")) continue;
    const key = JSON.stringify([result.experimentId, result.id]);
    const carried = carriedByPair.get(key) ?? [];
    carried.push({ attempt: result.attempt, verdict: result.verdict });
    carriedByPair.set(key, carried);
  }
  for (let i = 0; i < agentRuns.length; i++) {
    const run = agentRuns[i]!;
    for (const e of matchedByRun[i]!) {
      const carried = carriedByPair.get(JSON.stringify([run.experimentId ?? "", e.id])) ?? [];
      const carriedCount = carryPlan?.carriedAttemptsByKey.get(cacheKey(run, e.id))?.size ?? carried.length;
      // 没有任何可读历史时不必先跑一趟携带规划:计划内每个序号都缺条目,逐条报缺历史门的原因词。
      const dispatch: readonly DispatchGroup[] = carryPlan?.dispatchByKey.get(cacheKey(run, e.id))
        ?? (carriedCount >= run.attempts
          ? []
          : [{ ...missingReason(cacheKey(run, e.id), { incompatibleKeys }), attempts: [...Array(run.attempts).keys()] }]);
      const previousResults = dispatch.flatMap((group) => group.reason === "previous-result"
        ? group.attempts.flatMap((attempt) => {
            const prior = priorByKeyAttempt.get(`${run.experimentId ?? ""}|${e.id}|${attempt}`);
            return prior === undefined ? [] : [{ ...prior, ...(group.comparison !== undefined ? { comparison: group.comparison } : {}) }];
          })
        : []);
      rows.push({
        experimentId: run.experimentId ?? "",
        evalId: e.id,
        attempts: run.attempts,
        reused: carriedCount >= run.attempts,
        carried,
        dispatch,
        ...(previousResults.length > 0 ? { prior: previousResults } : {}),
      });
    }
  }
  return rows;
}

/** 内部 ADT tag 不属于 `ExpPlanDelta` 的公开 JSON 契约；边界显式投影，禁止对象展开泄漏。 */
function jsonPlanDelta(delta: FingerprintDelta): JsonPlanDelta {
  switch (delta._tag) {
    case "Added": return { selector: delta.selector, kind: "added", to: delta.to };
    case "Removed": return { selector: delta.selector, kind: "removed", from: delta.from };
    case "Changed": return { selector: delta.selector, kind: "changed", from: delta.from, to: delta.to };
    case "Unknown": return { selector: delta.selector, kind: "unknown" };
  }
}

function jsonPlanDiagnostic(diagnostic: FingerprintDiagnostic): JsonPlanDiagnostic {
  const facts = diagnostic.facts?.map((fact): JsonPlanDiagnosticFact =>
    "value" in fact
      ? { label: fact.label, value: fact.value }
      : { label: fact.label, from: fact.from, to: fact.to },
  );
  return {
    code: diagnostic.code,
    summary: diagnostic.summary,
    ...(facts === undefined ? {} : { facts }),
    ...(diagnostic.observedDeltas === undefined
      ? {}
      : { observedDeltas: diagnostic.observedDeltas.map(jsonPlanDelta) }),
    ...(diagnostic.limitations === undefined ? {} : { limitations: [...diagnostic.limitations] }),
    ...(diagnostic.causes === undefined ? {} : { causes: diagnostic.causes.map(jsonPlanDiagnostic) }),
  };
}

function jsonPlanComparison(comparison: FingerprintComparison): JsonPlanFingerprintComparison {
  if (comparison.kind === "match") {
    throw new Error("A matching fingerprint has no plan comparison projection.");
  }
  if (comparison.kind === "changed") {
    const deltas = comparison.deltas.map(jsonPlanDelta);
    const [first, ...rest] = deltas;
    if (first === undefined) throw new Error("A changed fingerprint comparison requires at least one delta.");
    return { kind: "changed", deltas: [first, ...rest] };
  }
  return {
    kind: "unexplained",
    diagnostic: jsonPlanDiagnostic(comparison.diagnostic),
  };
}

function firstViewerOnlyFlag(flags: Flags): { flag: string; command: string } | undefined {
  const SHOW = "show";
  const BOTH = "show / view";
  const VIEW = "view";
  if (flags.source) return { flag: "--source", command: SHOW };
  if (flags.execution) return { flag: "--execution", command: SHOW };
  if (flags.timing !== undefined) return { flag: "--timing", command: SHOW };
  if (flags.grep !== undefined) return { flag: "--grep", command: SHOW };
  if (flags.expand !== undefined) return { flag: "--expand", command: SHOW };
  if (flags.diff || flags.diffPath !== undefined) return { flag: "--diff", command: SHOW };
  if (flags.history) return { flag: "--history", command: SHOW };
  if (flags.usage) return { flag: "--usage", command: SHOW };
  if (flags.stats) return { flag: "--stats", command: SHOW };
  if (flags.experiment !== undefined) return { flag: "--exp", command: BOTH };
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

/**
 * `accept` 接受一个或多个精确 locator；它不是 `exp` 的另一种选择器，也不派发 attempt。
 * `--record` 是唯一允许的附加 flag，用来接受发布根或其它显式记录根里的结果。
 */
function parseAcceptLocators(positionals: string[], flags: Flags): string[] {
  if (positionals.length === 0 || positionals.some((locator) => !/^@[^@\s]+$/.test(locator))) {
    process.stderr.write(t("cli.accept.usage"));
    process.exit(1);
  }
  if (new Set(positionals).size !== positionals.length) {
    process.stderr.write("niceeval accept rejects duplicate locators.\n");
    process.exit(1);
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
    ["--expand", flags.expand],
    ["--timing", flags.timing],
    ["--keep-sandbox", flags.keepSandbox],
    ["--all", flags.all],
    ["--window", flags.window],
    ["--path", flags.sandboxPath],
    ["--leave-running", flags.leaveRunning],
    ["--history", flags.history],
    ["--usage", flags.usage],
    ["--stats", flags.stats],
    ["--exp", flags.experiment],
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
    process.stderr.write(t("cli.accept.flagUnsupported", { flag: bad[0] }));
    process.exit(1);
  }
  return [...positionals];
}

interface AcceptLocatorResult {
  locator: string;
  sourceLocator: string;
  fingerprint?: string;
}

/** 调用 acceptance core；CLI 只负责 cwd/记录根边界、输出与退出码，不重建结果或启动 runner。 */
async function runAcceptCommand(cwd: string, locators: readonly string[], recordRoot: string | undefined): Promise<void> {
  const mod = await import("./runner/accept.ts") as {
    acceptLocators(input: { cwd: string; locators: readonly string[]; recordRoot?: string }): Promise<readonly AcceptLocatorResult[]>;
  };
  const results = await mod.acceptLocators({
    cwd,
    locators,
    ...(recordRoot !== undefined ? { recordRoot } : {}),
  });
  for (const result of results) {
    process.stdout.write(t("cli.accept.done", {
      sourceLocator: result.sourceLocator,
      locator: result.locator,
      fingerprint: result.fingerprint ?? "—",
    }));
  }
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
    ["--expand", flags.expand],
    ["--timing", flags.timing],
    ["--keep-sandbox", flags.keepSandbox],
    ["--all", flags.all],
    ["--window", flags.window],
    ["--path", flags.sandboxPath],
    ["--leave-running", flags.leaveRunning],
    ["--history", flags.history],
    ["--usage", flags.usage],
    ["--stats", flags.stats],
    ["--exp", flags.experiment],
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
async function runExperimentRenameCommand(cwd: string, args: readonly string[], flags: Flags): Promise<number> {
  const parsed = parseExperimentRenamePositionals(args);
  if (!parsed.ok) {
    process.stderr.write(t("cli.rename.usage"));
    return 1;
  }
  const unsupported = firstExperimentRenameUnsupportedFlag(flags);
  if (unsupported !== undefined) {
    process.stderr.write(t("cli.rename.flagUnsupported", { flag: unsupported }));
    return 1;
  }
  const { oldId, newId } = parsed;
  const mod = await import("./runner/rename-experiment.ts") as unknown as {
    planExperimentRename(options: { cwd: string; oldId: string; newId: string }): Promise<ExperimentRenamePlan>;
    renameExperiment(options: { cwd: string; oldId: string; newId: string }): Promise<RenamedExperiment>;
  };
  if (flags.dry) {
    const plan = await mod.planExperimentRename({ cwd, oldId, newId });
    if (flags.json) process.stdout.write(renderExperimentRenameJson(plan));
    else process.stdout.write(renderExperimentRenamePlanHuman(plan));
    return experimentRenameExitCode(plan);
  }
  try {
    const renamed = await mod.renameExperiment({ cwd, oldId, newId });
    if (flags.json) process.stdout.write(renderExperimentRenameJson(renamed));
    else process.stdout.write(renderExperimentRenameDoneHuman(renamed));
    return 0;
  } catch (e) {
    // ExperimentRenameError 携带稳定 reason 与 rejected plan;其它异常按通用失败兜底。
    if (e instanceof ExperimentRenameError) {
      const rejected = experimentRenameRejectedFromError(e);
      if (flags.json) process.stdout.write(renderExperimentRenameJson(rejected));
      else process.stdout.write(renderExperimentRenameRejectedHuman(rejected));
      return 1;
    }
    process.stderr.write(t("cli.rename.failed", { error: e instanceof Error ? e.message : String(e) }));
    return 1;
  }
}

/** 加载 cwd/.env(不覆盖已有环境变量)。 */
async function loadDotenv(cwd: string): Promise<void> {
  const path = join(cwd, ".env");
  if (!existsSync(path)) return;
  const raw = await readFile(path, "utf-8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * 界面语言只从 `defineConfig({ locale })` 来,所以每条命令(含不依赖 config 的 show / view)
 * 都要在派发前看一眼配置。这里刻意宽容:没有配置文件、或配置本身有错时静默回到系统 locale
 * 判定——语言是装饰性设置,不该让 `niceeval show` 因为一个坏 config 打不开结果;真正需要
 * config 的命令随后走 loadConfig,由它报出完整错误(模块缓存让这次装载不重复付出代价)。
 */
async function applyConfiguredLocale(cwd: string): Promise<void> {
  const path = join(cwd, "niceeval.config.ts");
  if (!existsSync(path)) return;
  try {
    const mod = (await import(pathToFileURL(path).href)) as { default?: Config };
    setConfiguredLocale(mod.default?.locale);
  } catch {
    // 交给后续 loadConfig 报错;这里不抢在语言还没定下来时打印任何东西。
  }
}

async function loadConfig(cwd: string): Promise<Config> {
  const { loadConfigFile } = await import("./load-config.ts");
  return loadConfigFile(cwd);
}

// AGENTS.md/CLAUDE.md 托管区块:告诉在这个项目里干活的 coding agent「niceeval 不在你的训练数据里,
// 先读随包文档,跑完读结构化结果」。随包只发中文准绳版文档(英文站是手工同步、可能滞后,
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
  "After a run, drill into failures with `niceeval show` — pick an `@<locator>` from the",
  "compact index it prints, then `niceeval show @<locator>` for a compact overview, or add",
  "`--source` / `--execution` / `--diff` for evidence; the run directories the CLI prints",
  "are the structured source of truth: `run.json` holds the run's metadata and each",
  "`<evalId>/a<attempt>/result.json` holds that attempt's verdict and assertions, next to",
  "its artifact files (`events.json` / `trace.json` / `diff.json`).",
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

async function initProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "evals"), { recursive: true });
  const configPath = join(cwd, "niceeval.config.ts");
  if (!existsSync(configPath)) {
    await writeFile(
      configPath,
      [
        'import { defineConfig } from "niceeval";',
        "",
        "export default defineConfig({",
        "  // Add experiments/ with defineExperiment(...) to run evals.",
        "  //",
        "  // IMPORTANT(judge): semantic assertions (t.judge.*) are unavailable until a judge",
        "  // model is configured. A required unavailable assertion errors the attempt; only",
        "  // .optional() leaves its Verdict unchanged. Any OpenAI-compatible /chat/completions",
        "  // service works; the key is read from NICEEVAL_JUDGE_KEY unless apiKeyEnv says otherwise.",
        '  // judge: { model: "gpt-5.4-mini" },',
        "});",
        "",
      ].join("\n"),
      "utf-8",
    );
  }
  const agentDocPath = resolveAgentDocPath(cwd);
  const existing = existsSync(agentDocPath) ? await readFile(agentDocPath, "utf-8") : "";
  const next = upsertManagedBlock(existing, AGENT_RULES_BEGIN, AGENT_RULES_END, AGENT_RULES_CONTENT);
  if (next !== existing) await writeFile(agentDocPath, next, "utf-8");
}

async function openBrowser(url: string): Promise<boolean> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  return new Promise((resolveOpen) => {
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
  });
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
 *   构造 `reporters: ReporterRegistration[]` 的地方——artifacts / --json / --junit 恒
 *   `required: true`,`config.reporters` 恒 `false`),不是一个统一写死的占位值。
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
async function packageVersion(): Promise<string> {
  const raw = await readFile(new URL("../package.json", import.meta.url), "utf-8");
  return (JSON.parse(raw) as { version: string }).version;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));
  // Session / Docker profile 查询必须是纯读取路径：连 dotenv 与界面 locale 也不从项目装载，
  // 否则一个有副作用/损坏的 config 会让 `session list` 违背「不加载配置」契约。
  if (command !== "session" && command !== "docker") {
    await loadDotenv(cwd);
    await applyConfiguredLocale(cwd);
  }

  // --help / --version 不需要 config,先于一切命令处理。
  if (flags.help) {
    process.stdout.write(t("cli.help"));
    process.exit(0);
  }

  if (flags.version) {
    process.stdout.write(`${await packageVersion()}\n`);
    process.exit(0);
  }

  if (command === "docker") {
    const { runDockerProfileCommand } = await import("./sandbox/docker-profile/cli.ts");
    process.exit(await runDockerProfileCommand(positionals, { json: flags.json, smoke: flags.smoke }));
  }

  if (command === "accept") {
    const locators = parseAcceptLocators(positionals, flags);
    try {
      await runAcceptCommand(cwd, locators, flags.record);
    } catch (e) {
      // acceptance core 的资格/定位错误都是用户可修复的：不进入 runner 的崩溃路径，
      // 直接给出一行错误并以 1 退出，保证不会误报“已派发 attempt”。
      process.stderr.write(t("cli.accept.failed", {
        error: e instanceof Error ? e.message : String(e),
      }));
      process.exit(1);
    }
    process.exit(0);
  }

  if (command === "view") {
    // 位置参数只有一种含义:eval id 前缀(收窄有效根)。记录根经 --record 递入,
    // 单开一份快照经 --run 递入;--report 整槽替换报告槽(与 show --report 吃同一个文件),
    // --page 定初始页。文件与目录都不进位置参数(docs/feature/reports/view.md「打开与收窄」)。
    // --out 接受同一收窄:出站内容即收窄后的有效根(docs/feature/reports/view.md「静态导出」)。
    let viewInput: { input?: string; patterns: string[] };
    try {
      viewInput = resolveViewInput(cwd, positionals, {
        ...(flags.record !== undefined ? { record: flags.record } : {}),
        ...(flags.run !== undefined ? { run: flags.run } : {}),
      });
    } catch (e) {
      exitOnViewUserError(e);
    }
    // 配置只记 cwd:每次 rebuild 由 loadViewScan 重装 niceeval.config.ts,
    // 不把启动时那份 config.report 对象塞进 scan(否则改报告文件只刷新页面、定义仍旧)。
    const scan = {
      patterns: viewInput.patterns,
      ...(flags.experiment !== undefined ? { experiment: flags.experiment } : {}),
      ...(flags.report !== undefined ? { report: { path: flags.report, cwd } } : {}),
      ...(flags.theme !== undefined ? { theme: { value: flags.theme, cwd } } : {}),
      ...(existsSync(join(cwd, "niceeval.config.ts")) ? { config: { cwd } } : {}),
      ...(flags.page !== undefined ? { page: flags.page } : {}),
    };
    if (flags.out) {
      const out = await buildView({ input: viewInput.input, out: flags.out, scan }).catch(exitOnViewUserError);
      process.stdout.write(t("cli.view.exportedDir", { out }));
      process.exit(0);
    }
    const server = await startViewServer({
      input: viewInput.input,
      port: flags.port,
      host: flags.host,
      scan,
      watchRoot: cwd,
      onRebuild: (completedAt) => {
        const time = new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).format(completedAt);
        process.stdout.write(t("cli.view.hotReloadComplete", { time }));
      },
    }).catch(exitOnViewUserError);
    process.stdout.write(t("cli.view.urls", { urls: server.urls.map((url) => `  ${url}`).join("\n") }));
    if (flags.open !== false) {
      const opened = await openBrowser(server.url);
      if (!opened) process.stderr.write(t("cli.browserOpenFailed", { url: server.url }));
    }
    process.stdout.write(t("cli.pressCtrlC"));
    await new Promise(() => {});
  }

  if (command === "sandbox") {
    // sandbox 命令组不读 niceeval.config.ts、不发现 eval:只操作留存注册表与 provider 的
    // detached 能力(见 docs/feature/sandbox/cli.md)。
    const { runSandboxCommand } = await import("./sandbox/cli-commands.ts");
    const code = await runSandboxCommand(cwd, positionals, {
      all: flags.all,
      window: flags.window,
      path: flags.sandboxPath,
      leaveRunning: flags.leaveRunning,
      // CLI flag 是 --record(记录根);sandbox 命令组的内部选项名保持 run,值语义相同。
      run: flags.record,
      orphans: flags.orphans,
      force: flags.force,
    });
    process.exit(code);
  }

  if (command === "session") {
    // Session 查询严格只读：不加载 niceeval.config.ts、不发现 eval/experiment、不触碰
    // locks、Sandbox 或 agent。记录根固定为当前工作副本的 .niceeval。
    const niceevalRoot = resolvePath(cwd, ".niceeval");
    try {
      const subcommand = positionals[0] ?? "list";
      if (subcommand === "list") {
        if (positionals.length > 2) {
          process.stderr.write("niceeval session list accepts at most one experiment prefix.\n");
          process.exit(1);
        }
        const document = await listSessions(niceevalRoot, {
          all: flags.all,
          ...(positionals[1] !== undefined ? { selector: positionals[1] } : {}),
        });
        if (flags.json) process.stdout.write(`${JSON.stringify(document)}\n`);
        else process.stdout.write(renderSessionListText(document, Date.now(), flags.all));
        process.exit(0);
      }
      if (subcommand === "show") {
        if (positionals.length !== 2 || flags.all) {
          process.stderr.write("Usage: niceeval session show <sessionId> [--json]\n");
          process.exit(1);
        }
        const document = await showSession(niceevalRoot, positionals[1]!);
        if (flags.json) process.stdout.write(`${JSON.stringify(document)}\n`);
        else process.stdout.write(renderSessionShowText(document));
        process.exit(0);
      }
      process.stderr.write("Usage: niceeval session list [--all] [<experiment-prefix>] [--json]\n" +
        "       niceeval session show <sessionId> [--json]\n");
      process.exit(1);
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    }
  }

  if (command === "show") {
    if (flags.theme !== undefined) {
      process.stderr.write("--theme only affects the web view. Use `niceeval view --theme …` instead.\n");
      process.exit(1);
    }
    // show 中不带 --report 的 locator 是官方诊断入口,不读取项目默认报告;显式 --report 也已经替换了
    // config.report。其余报告槽路径才读取 config.report 作为默认报告。
    let configReport: Config["report"] | undefined;
    const hasAttemptLocator = positionals.some((value) => value.startsWith(ATTEMPT_LOCATOR_PREFIX));
    if (!hasAttemptLocator && flags.report === undefined && existsSync(join(cwd, "niceeval.config.ts"))) {
      try {
        configReport = (await loadConfig(cwd)).report;
      } catch (e) {
        process.stderr.write(`${formatThrown(e)}\n`);
        process.exit(1);
      }
    }
    const code = await runShow(cwd, positionals, {
      source: flags.source,
      execution: flags.execution,
      timing: flags.timing,
      diff: flags.diff,
      diffPath: flags.diffPath,
      grep: flags.grep,
      expand: flags.expand,
      history: flags.history,
      usage: flags.usage,
      stats: flags.stats,
      experiment: flags.experiment,
      record: flags.record,
      report: flags.report,
      configReport,
      page: flags.page,
      json: flags.json,
    });
    // show 的 JSON 常被管给 jq/python。直接 process.exit 会丢弃 pipe 中尚未 flush 的
    // stdout（典型截在 128 KiB）；交给事件循环自然收尾。
    process.exitCode = code;
    return;
  }

  if (command === "clean") {
    await rm(join(cwd, ".niceeval"), { recursive: true, force: true });
    process.stdout.write(t("cli.clean.done"));
    process.exit(0);
  }

  if (command === "init") {
    await initProject(cwd);
    process.stdout.write(t("cli.init.done"));
    if (!hostPrefersEsm(cwd)) process.stdout.write(t("cli.init.esmHint"));
    process.exit(0);
  }

  // exp rename 是 exp 的保留子命令(list 同例):只读迁移坐标,不进 exp 的选择/调度路径,
  // 不装载项目 config / 发现 eval。旧 id 从 Record 读取、newId 发现与资格门都在核心。
  if (command === "exp" && positionals[0] === "rename") {
    const code = await runExperimentRenameCommand(cwd, positionals.slice(1), flags);
    process.exit(code);
  }

  const config = await loadConfig(cwd);
  const maxBuildConcurrency = flags.maxBuildConcurrency ?? config.maxBuildConcurrency ?? 2;
  if (!Number.isInteger(maxBuildConcurrency) || maxBuildConcurrency <= 0) {
    process.stderr.write(`maxBuildConcurrency must be a positive integer, got ${maxBuildConcurrency}.\n`);
    process.exit(1);
  }
  const allEvals = await discoverEvals(cwd);
  const evals = flags.tag ? allEvals.filter((e) => e.tags?.includes(flags.tag as string)) : allEvals;

  if (command === "list") {
    process.stdout.write(t("cli.list.header", { count: evals.length }));
    for (const e of evals) process.stdout.write(`  ${e.id}${e.description ? `  — ${e.description}` : ""}\n`);
    process.exit(0);
  }

  const agentRuns: AgentRun[] = [];
  let experimentSelection = t("cli.all");
  let availableExperimentPaths = t("cli.none");

  if (command === "exp" || command === "check") {
    if (flags.agent || flags.model) {
      process.stderr.write(t("cli.exp.agentModelFlagUnsupported"));
      process.exit(1);
    }
    if (flags.force) {
      process.stderr.write("experiment 运行不支持 --force；请使用 --rerun all。\n");
      process.exit(1);
    }
    const viewerFlag = firstViewerOnlyFlag(flags);
    if (viewerFlag) {
      process.stderr.write(t("cli.exp.viewerFlagUnsupported", { flag: viewerFlag.flag, command: viewerFlag.command }));
      process.exit(1);
    }
    const experiments = await discoverExperiments(cwd);
    // `list` 是 exp 的保留子命令：它只做发现与选择，不进入 link、carry、lock 或
    // runner，因此绝不会创建 Session。实验 id 含有 `list` 时需给更长的 selector。
    if (command === "exp" && positionals[0] === "list") {
      if (positionals.length > 2) {
        process.stderr.write("niceeval exp list accepts at most one experiment prefix.\n");
        process.exit(1);
      }
      const selector = positionals[1];
      const ids = experiments.map((experiment) => experiment.id);
      const selectedIds = selector === undefined
        ? new Set(ids)
        : new Set(matchExperimentSelector(ids, selector));
      const selected = experiments.filter((experiment) => selectedIds.has(experiment.id));
      if (selected.length === 0 && selector !== undefined) {
        process.stderr.write(t("cli.experiment.noMatch", {
          arg: selector ?? "list",
          experiments: browsableExperimentPaths(ids).join(", ") || t("cli.none"),
        }));
        process.exit(1);
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
        process.stdout.write(`${JSON.stringify({ format: "niceeval.experiments", schemaVersion: 1, experiments: rows })}\n`);
      } else {
        for (const row of rows) {
          process.stdout.write([
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
      process.exit(0);
    }
    const expArg = positionals[0];
    const extraPatterns = positionals.slice(1);
    experimentSelection = positionals.join(" ") || t("cli.all");
    availableExperimentPaths = browsableExperimentPaths(experiments.map((e) => e.id)).join(", ") || t("cli.none");
    const selectedIds = expArg ? new Set(matchExperimentSelector(experiments.map((e) => e.id), expArg)) : undefined;
    const selected = selectedIds ? experiments.filter((e) => selectedIds.has(e.id)) : experiments;
    if (selected.length === 0) {
      process.stderr.write(t("cli.experiment.noMatch", {
        arg: expArg ?? t("cli.all"),
        experiments: availableExperimentPaths,
      }));
      // show / view 是顶层命令。只有同名 experiment 确实不存在时才纠错，不能抢占合法 id。
      if (expArg === "show" || expArg === "view") {
        process.stderr.write(t("cli.experiment.viewerCommandHint", {
          command: expArg,
          args: extraPatterns.length > 0 ? ` ${extraPatterns.join(" ")}` : "",
        }));
      }
      process.exit(1);
    }
    // 残留提醒:注册表里还有上次留下的沙箱、强杀留下的孤儿候选、或不在本次选择里的遗留实验级
    // teardown 时各打一行(不阻塞、不清理;见 docs/feature/sandbox/cli.md「残留提醒」与
    // docs/feature/experiments/architecture.md「强杀后的收尾兜底」)。
    {
      const { keptSandboxReminder, orphanReminder } = await import("./sandbox/cli-commands.ts");
      const reminder = await keptSandboxReminder(cwd).catch(() => undefined);
      if (reminder) process.stderr.write(reminder);
      const orphans = await orphanReminder(cwd).catch(() => undefined);
      if (orphans) process.stderr.write(orphans);
      const { orphanedTeardownReminder } = await import("./runner/teardown-registry.ts");
      const teardownReminder = await orphanedTeardownReminder(
        resolvePath(cwd, ".niceeval"),
        new Set(selected.filter((e) => e.teardown).map((e) => e.id)),
        hostname(),
      ).catch(() => undefined);
      if (teardownReminder) process.stderr.write(teardownReminder);
    }

    // `--teardown`:只对选中的实验各执行一次实验级 teardown(新进程语义),不派发任何 attempt、
    // 不跑 setup;与 eval 前缀位置参数组合是用法错误(这个 flag 选择的是「只收尾」这种跑法,
    // 不参与 eval 选择)。启动自愈(选中实验里遗留登记的补执行)发生在 runEvals() 内部
    // 触发 setup 之前,不需要这里重复处理(见 run.ts 的 recoverOrphanedTeardownRegistration)。
    if (flags.teardown) {
      if (extraPatterns.length > 0) {
        process.stderr.write(t("cli.exp.teardownNoEvalPatterns"));
        process.exit(1);
      }
      const niceevalRootForTeardown = resolvePath(cwd, ".niceeval");
      const { isOrphanedTeardownRegistration, readTeardownRegistrations, removeTeardownRegistrationIfPresent } =
        await import("./runner/teardown-registry.ts");
      let anyFailed = false;
      for (const exp of selected) {
        if (!exp.teardown) continue;
        const { selectedEvalIds } = resolveExperimentEvals({
          experimentId: exp.id,
          selector: exp.evals,
          cliPatterns: [],
          evals,
        });
        const ctx: ExperimentHookContext = {
          experimentId: exp.id,
          selectedEvalIds,
          signal: new AbortController().signal,
          progress: () => {},
          diagnostic: (input) => process.stderr.write(`${input.message}\n`),
          // 独立 `--teardown` 路径不派发任何 attempt、不打开快照,没有 `RunMeta.facts`
          // 这条落盘去处可写(见 runner/types.ts 的 ExperimentHookContext.fact 注释)。仍然复用
          // 共享校验(非法 key / 非标量 value 照样抛错——诚实优于静默),校验通过后丢弃写入:
          // 这是有意的 no-op,不是遗漏。
          fact: (key, value) => recordFact({}, key, value),
        };
        const registrations = await readTeardownRegistrations(niceevalRootForTeardown).catch(() => []);
        const matching = registrations.filter(({ entry }) => entry.experimentId === exp.id);
        // 已有登记时，只有抢到某一条原子删除的路径可以执行；没有登记才保留手动兜底的一次执行。
        const claimed = await Promise.all(
          matching
            .filter(({ entry }) => isOrphanedTeardownRegistration(entry, hostname()))
            .map(async ({ id }) => (await removeTeardownRegistrationIfPresent(niceevalRootForTeardown, id).catch(() => false)) ? id : undefined),
        );
        const executions = matching.length === 0 ? [undefined] : claimed.filter((id): id is string => id !== undefined);
        for (const _ of executions) {
          try {
            await withCleanupTimeout(() => exp.teardown!(ctx));
            process.stderr.write(t("cli.exp.teardownDone", { experimentId: exp.id }));
          } catch (e) {
            anyFailed = true;
            process.stderr.write(
              t("cli.exp.teardownFailed", { experimentId: exp.id, message: e instanceof Error ? e.message : String(e) }),
            );
          }
        }
      }
      process.exit(anyFailed ? 1 : 0);
    }
    // 选中实验的发现集(各实验 `evals` 选择器选出的并集,未经尾随前缀收窄);
    // 尾随前缀逐个必须在它里面命中至少一条,见下面的零匹配用法错误。
    const experimentScopeIds = new Set<string>();
    for (const exp of selected) {
      // 一个实验 = 一个配置(单 model)。跨模型对比写多个实验文件,各钉一个 model。
      // evals 谓词在这里对本次 invocation 的候选 eval 各求值一次;下游(dry-run、sandbox 查表、
      // fingerprint/carry、attempt 展开)只消费 selectedEvalIds,不重新调用谓词
      // (见 docs/feature/experiments/library.md「evals」)。
      const { selectedEvals, selectedEvalIds, selectorEvals } = resolveExperimentEvals({
        experimentId: exp.id,
        selector: exp.evals,
        cliPatterns: extraPatterns,
        evals,
      });
      for (const e of selectorEvals) experimentScopeIds.add(e.id);
      agentRuns.push({
        agent: exp.agent,
        model: exp.model,
        reasoningEffort: exp.reasoningEffort,
        flags: exp.flags ?? {},
        attempts: flags.attempts ?? exp.attempts ?? 1,
        earlyExit: flags.earlyExit ?? exp.earlyExit ?? false,
        sandbox: exp.sandbox,
        sandboxReuse: exp.sandboxReuse,
        judge: exp.judge,
        // 解析链只求值到 experiment 这一层:eval 与 config 由 attempt 派发时的
        // resolveAttemptTimeout 接上。这里 `?? config.timeoutMs` 会把缺省底提前物化成 run 值,
        // 让 eval 自己声明的上限永久短路(见 runner/timeout.ts 与
        // memory/multi-source-field-resolution-order.md)。
        ...resolveRunTimeout(flags.timeout, exp.timeoutMs),
        budget: flags.budget ?? exp.budget,
        selectedEvalIds,
        experimentId: exp.id,
        experimentBaseDir: exp.baseDir,
        experimentSourcePath: exp.sourcePath,
        description: exp.description,
        labels: exp.labels,
        // 实验级并发上限:随 AgentRun 进调度器按实验单独限流(runner 两级信号量),
        // 不再取所有选中实验的最小值钳全局——那会让一个串行实验拖慢整批基线。
        maxConcurrency: exp.maxConcurrency,
        setup: exp.setup,
        teardown: exp.teardown,
        // 实验级失败分类器:随 AgentRun 进 attempt(turn 链与生命周期链共用同一份),
        // 产出的 scope 由止损闸消费(见 docs/feature/error-classification/architecture.md)。
        classifyFailure: exp.classifyFailure,
      });
    }
    // 尾随 eval 前缀逐个必须命中:静默丢弃会把「写了两个实验名」这类手滑变成一次悄悄膨胀或
    // 缩水的计划(见 docs/feature/experiments/cli.md「实验选择器怎样解析」第 5 条)。
    for (const pattern of extraPatterns) {
      const matches = evalPrefixPredicate([pattern]);
      if ([...experimentScopeIds].some((id) => matches(id))) continue;
      process.stderr.write(t("cli.experiment.noEvalPrefixMatch", {
        pattern,
        selection: expArg ?? t("cli.all"),
      }));
      process.exit(1);
    }
  } else {
    // 裸 run / `niceeval <eval>` 不再执行。运行配置必须来自 experiments/,
    // 这样 agent/model/flags/attempts/budget 与结果聚合都有可签入的身份。
    const experiments = await discoverExperiments(cwd);
    const ids = experiments.map((e) => e.id);
    const matchedIds = new Set(positionals.flatMap((p) => matchExperimentSelector(ids, p)));
    const asExp = experiments.filter((e) => matchedIds.has(e.id));
    process.stderr.write(t("cli.run.experimentRequired"));
    if (asExp.length > 0) {
      process.stderr.write(t("cli.run.experimentRequiredHint", {
        pattern: positionals[0] ?? "",
        kind: asExp.length > 1 ? t("cli.experimentGroup") : "",
      }));
    } else {
      process.stderr.write(t("cli.run.experimentRequiredKnown", {
        experiments: experiments.map((e) => e.id).join(", ") || t("cli.none"),
      }));
    }
    process.exit(1);
  }

  // 输出形态只改变反馈,不改变选择/调度/判定;`--json` 即机器面,否则人读文本(见
  // resolveOutputForm)。--dry 和真正开跑共用同一个已解析形态。
  const outputForm = resolveOutputForm({ json: flags.json, isTTY: process.stderr.isTTY === true });

  // matchedByRun[i] 对应 agentRuns[i] 匹配到的 eval 集合;--dry 预览与真正开跑时的
  // RunFeedbackPlan(总量、去重 eval 数)共用同一份计算,不重复过滤一遍。
  const matchedByRun = agentRuns.map((run) => selectedEvalsForRun(evals, run));
  const totalAttempts = agentRuns.reduce((sum, run, i) => sum + matchedByRun[i]!.length * run.attempts, 0);
  const uniqueEvalIds = new Set(matchedByRun.flat().map((e) => e.id));

  if (totalAttempts === 0) {
    process.stderr.write(t("cli.experiment.noEvalsSelected", {
      selection: experimentSelection,
      experiments: availableExperimentPaths,
    }));
    process.exit(1);
  }

  // check 的边界就是 pure link：不读取 provider 文件、不做网络请求、不算 fingerprint，
  // 更不会 build / create Sandbox。Effect 必须在这里执行，不能把一次失败留在惰性值里误报成功。
  if (command === "check") {
    await Effect.runPromise(linkRunSandboxes(evals, agentRuns));
    const pairCount = matchedByRun.reduce((sum, selected) => sum + selected.length, 0);
    process.stdout.write(`Sandbox layers linked: ${pairCount} pair${pairCount === 1 ? "" : "s"}.\n`);
    process.exit(0);
  }

  // 提前算好携入计划:coordinator 的 plan 事件与 runEvals 内部实际调度必须共用同一份
  // planCarry() 判断,否则两边各自算一遍,一旦不一致,dashboard/事件流展示的"携入"就会和
  // run.ts 真实调度的"携入"对不上(见 memory 的 live-carry-row-shows-waiting-forever)。
  // `--dry`(两种形态)都需要这份计算:`--dry --json` 的 `ExpPlanDocument.matrix[].reused`,
  // 人读 `--dry` 首行的携入摘要(见 docs/feature/experiments/cli.md 开头示例与「事件与计划
  // 文档的 TypeScript 形状」),口径必须与真正开跑时一致。
  const carryInputs = await loadCarryInputs(join(cwd, ".niceeval"));
  const priorResults = carryInputs?.results;
  // 本次计划里哪些坐标「有历史但那份落盘读不动」:不标出来,它们会跟从没跑过的坐标一样落在
  // `new` 上(见 docs/feature/experiments/cli.md 的门级词表)。坐标按目录名认,所以在这里从
  // 目录键换算成 cacheKey。
  const incompatibleKeys = new Set<string>();
  for (let i = 0; i < agentRuns.length; i++) {
    const run = agentRuns[i]!;
    for (const e of matchedByRun[i]!) {
      if (carryInputs.incompatibleHistory.has(incompatibleHistoryKey(run.experimentId ?? "", e.id))) {
        incompatibleKeys.add(cacheKey(run, e.id));
      }
    }
  }
  // 即使没有历史也必须规划：它是 link → physical plan → fingerprint → dispatch 的唯一完成态，
  // dry 与真实运行都消费同一组不可变 PreparedRunPair。
  const carryPlan = await Effect.runPromise(planCarry(evals, agentRuns, priorResults, config.timeoutMs, {
    rerun: flags.rerun,
    configJudge: config.judge,
    keepSandbox: flags.keepSandbox,
    incompatibleKeys,
    priorManifests: carryInputs?.manifestsByEvalKey,
  }));

  if (flags.dry) {
    // --dry 只按所选形态打印计划,不运行、不落盘——一次完成的读取,不是事件流
    // (见 docs/feature/experiments/cli.md「机器怎么读:--json」)。两种形态共用同一份摊平
    // 矩阵——(experimentId, evalId) 逐行,携带同一口径的 reused 预测——不是各自重算一遍。
    const dryRuns = Math.max(1, ...agentRuns.map((r) => r.attempts));
    // 一行一份未携带原因分组:人读面投影出门的人读词,`--json` 投影出 gate 名,同一份数据。
    const rowInputs = planRowInputs(
      agentRuns,
      matchedByRun,
      carryPlan,
      incompatibleKeys,
      priorResults ?? [],
      carryInputs.evidenceStatesByAttempt,
    );
    // 只读锁目录,不取锁、不等待(见 docs/feature/experiments/architecture.md「并发
    // Invocation:用例锁」);过期(无人续心跳)的锁不算"正被持锁运行",不标注。裸 run(没有
    // experimentId)不参与锁,恒不标注。并行读——矩阵行数可能不小,不逐行串行等磁盘。
    const niceevalRootForDry = resolvePath(cwd, ".niceeval");
    const now = Date.now();
    const lockedFlags = await Promise.all(
      rowInputs.map(async (row) => {
        if (!row.experimentId) return false;
        const lock = await readCaseLock(niceevalRootForDry, row.experimentId, row.evalId).catch(() => undefined);
        return lock !== undefined && !isCaseLockExpired(lock, now);
      }),
    );
    const matrix: JsonPlanRow[] = rowInputs.map((row, i) => ({
      experimentId: row.experimentId,
      evalId: row.evalId,
      reused: row.reused,
      ...(row.prior !== undefined
        ? { prior: row.prior.map(({ locator, verdict, acceptance, evidenceState }) => ({ locator, verdict, acceptance, evidenceState })) }
        : {}),
      ...(lockedFlags[i] ? { locked: true } : {}),
      ...(row.dispatch.length > 0
        ? {
            dispatch: row.dispatch.map((group) => ({
              gate: group.gate,
              attempts: [...group.attempts],
              ...(group.comparison !== undefined ? { comparison: jsonPlanComparison(group.comparison) } : {}),
            })),
          }
        : {}),
    }));
    if (outputForm === "json") {
      process.stdout.write(
        renderJsonPlanDocument({
          total: totalAttempts,
          evals: uniqueEvalIds.size,
          configs: agentRuns.length,
          attempts: dryRuns,
          matrix,
        }),
      );
    } else {
      process.stdout.write(
        renderHumanDryPlan({
          totalAttempts,
          evals: uniqueEvalIds.size,
          configs: agentRuns.length,
          attempts: dryRuns,
          reused: carryPlan?.carriedResults.length ?? 0,
          // previous-result 行逐条提供历史 locator；接受动作通过顶层 `niceeval accept @<locator>` 完成。
          command: ["niceeval", command, ...positionals].join(" "),
          rows: rowInputs.map((row, i) => ({
            experimentId: row.experimentId,
            evalId: row.evalId,
            attempts: row.attempts,
            ...(lockedFlags[i] ? { locked: true } : {}),
            ...(row.carried.length > 0 ? { carried: row.carried } : {}),
            ...(row.prior !== undefined ? { prior: row.prior } : {}),
            dispatch: row.dispatch.map((group) => ({
              reason: group.reason,
              attempts: [...group.attempts],
              ...(group.comparison !== undefined ? { comparison: group.comparison } : {}),
            })),
          })),
        }),
      );
    }
    process.exit(0);
  }

  const reusedFailures = (carryPlan?.carriedResults ?? [])
    .map(failureDetailFromResult)
    .filter((failure) => failure !== undefined);

  if (carryPlan.preparedPairsByKey === undefined) {
    throw new Error("Internal error: production carry planning did not return prepared Sandbox pairs.");
  }

  // 无全局默认:并发上限由 sandbox provider 的推荐值决定(多个 agentRun 各有 sandbox 时取
  // 最小值,最保守的 provider 决定上限)。同一个值既进 RunFeedbackPlan.shape,也传给 runEvals——
  // 两处必须是同一个数字,dashboard 展示的并发上限不能和真实调度的并发上限对不上。
  const sandboxDefaultConcurrency = recommendedConcurrencyForPreparedPairs(
    [...carryPlan.preparedPairsByKey.values()],
  );
  const maxConcurrency =
    flags.maxConcurrency ??
    config.maxConcurrency ??
    sandboxDefaultConcurrency;

  // 声明了实验闸的实验逐个附注上限(PLAN 行 / `start` 事件的 experimentConcurrency);
  // 未声明的不收,一个都没声明时整个字段省略(见 docs/feature/experiments/cli.md)。
  const experimentConcurrency: globalThis.Record<string, number> = {};
  for (const run of agentRuns) {
    if (run.experimentId === undefined || run.maxConcurrency === undefined) continue;
    experimentConcurrency[run.experimentId] = run.maxConcurrency;
  }

  const plan: RunFeedbackPlan = {
    shape: { evals: uniqueEvalIds.size, configs: agentRuns.length, totalAttempts, maxConcurrency },
    ...(Object.keys(experimentConcurrency).length > 0 ? { experimentConcurrency } : {}),
    reused: carryPlan?.carriedResults.length ?? 0,
    reusedFailures,
  };

  // 一个 run 内只有一个终端协调者(见 docs/feature/experiments/cli.md「输出流和落盘节奏」):
  // 两种 profile 各自的展示逻辑全部在 renderer 里,这里只按解析出的形态选一个构造好、
  // 交给 coordinator。invocation:start 前(coordinator.start(plan) 之前)的一切都还没有活跃 sink,
  // 出错走 bootstrap stderr;之后所有诊断都经它。
  const io = createNodeFeedbackIO();
  const commandLabel = ["niceeval", command, ...positionals].join(" ").trim();
  const renderer =
    outputForm === "human" ? createHumanRenderer({ io, command: commandLabel }) : createJsonRenderer({ io });
  const sessionTracker = new SessionTracker(resolvePath(cwd, ".niceeval"));
  const coordinator = createFeedbackCoordinator({
    profile: outputForm,
    renderer,
    io,
    onEvent: (event, state) => sessionTracker.onFeedback(event, state),
  });
  coordinator.start(plan);

  // Ctrl+C / kill 的三级响应,核心目标:任何情况下都不留下孤儿沙箱。
  //   1 次:abort controller → runEvals 把它喂给 Effect signal → 各 attempt 的 Sample 跑 release
  //         停容器(graceful)。同时起一个看门狗:graceful 若迟迟不收口(如 vsb.stop() 挂),
  //         到点直接走兜底强清,不干等。
  //   2 次:用户等不及 —— 立刻兜底强清(带超时)再退,而不是裸 process.exit 把进程连同
  //         在飞的 stop 一起杀掉(那正是之前漏掉孤儿的根因)。
  //   3 次:真不耐烦了,硬退(此时多半已无可清理的)。
  const ctrl = new AbortController();
  let signalCount = 0;
  // 强清 = 加速收尾,不是绕过收尾(docs/cli.md「中断:三级响应」)。顺序:先强停沙箱(卡在
  // 沙箱 I/O 上的收尾立刻失败返回),然后事件驱动收口——并发等待「在飞收尾链 settle」与
  // 「实验级 teardown 注册表排空」(drain 会启动未启动的、等待在飞的同一 memoized promise),
  // 两者都 settle 即退。兜底上限从单可调用体清理上限推导(docs 声明的不等式:provider stop 8s
  // < 看门狗 < CLEANUP_TIMEOUT_MS ≤ 本上限),不是第 2 级的语义——settle 才是——只拦
  // 「收尾可调用体绕过了自己的超时」的失守病态,到点放弃退出(职责同第 3 级硬退)。
  // 只跑一次;先停 dashboard 的 tick/动态区域(coordinator.stopDynamic()),
  // 避免硬退时终端卡在半帧 ANSI 状态。
  const FORCE_SETTLE_CAP_MS = CLEANUP_TIMEOUT_MS * 2;
  let runInFlight: Promise<InvocationSummary> | undefined;
  let forcing = false;
  const forceCleanupAndExit = (code: number) => {
    if (forcing) return;
    forcing = true;
    void (async () => {
      inputGuard.stop();
      await Promise.all([coordinator.stopDynamic(), stopAllSandboxes()]);
      const settled = Promise.allSettled([
        ...(runInFlight ? [runInFlight] : []),
        drainExperimentTeardowns(),
        drainHeldCaseLocks(),
        drainHeldGateLeases(),
      ]);
      await Promise.race([
        settled.then(() => {}),
        new Promise<void>((r) => {
          setTimeout(r, FORCE_SETTLE_CAP_MS).unref();
        }),
      ]);
      process.exit(code);
    })();
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      signalCount += 1;
      if (signalCount === 1) {
        reportActivity(t("cli.interruptCleanup").trimEnd());
        ctrl.abort();
        // 看门狗:graceful 清理迟迟没让进程自己收口,就强清兜底。取值在 docs/cli.md 声明的
        // 不等式链里:> provider stop 超时(8s,一次正常停容器超时后才升级,不误伤),
        // < CLEANUP_TIMEOUT_MS(30s)。
        const GRACEFUL_WATCHDOG_MS = 12_000;
        setTimeout(() => {
          if (liveSandboxCount() > 0) {
            reportActivity(t("cli.fallbackCleanupTimeout").trimEnd());
            forceCleanupAndExit(130);
          }
        }, GRACEFUL_WATCHDOG_MS).unref();
      } else if (signalCount === 2) {
        reportActivity(t("cli.forceCleanupExit").trimEnd());
        forceCleanupAndExit(130);
      } else {
        inputGuard.stop();
        process.exit(130); // 第三次:硬退
      }
    });
  }

  // live 面板期间的键盘接管与终端自愈(docs/feature/experiments/cli.md「键盘输入与画面自愈」):
  // 只在 stdin/stderr 都是 TTY(human dashboard 真的在画)时接线;`\x03` 合成上面刚注册的
  // SIGINT 事件,复用同一条中断路径,不在 input-guard 里重新实现一遍清理逻辑;SIGWINCH/回车
  // 都走 coordinator.forceRedraw() 整帧重绘。process "exit" 兜底一层——显式收尾路径(见下)
  // 之外的任何退出都不能把用户终端留在 raw mode。
  const inputGuard = createInputGuard({
    stdin: createNodeInputGuardStdin(),
    stderrIsTTY: io.stderr.isTTY,
    coordinator,
    onInterrupt: () => {
      process.emit("SIGINT");
    },
  });
  process.once("exit", () => inputGuard.stop());

  // reporter 只剩正交的机器/artifact 出口:human/json 的展示完全由上面的 coordinator +
  // renderer 负责,不再有 Console/Live/Quiet 这类兼职当 reporter 的展示层(见 docs 的
  // 「CLI 只负责解析形态、构造 coordinator/reporters、运行和退出」)。每个 reporter 在这里
  // 按来源分类 required/best-effort(见 `ReporterRegistration` 的字段注释):默认落盘的
  // artifacts、显式指定的 --junit 是 agent/CI 读结果的唯一入口,写失败必须让
  // completion/退出码判红;用户 `config.reporters` 只是补充观测,失败只折成一条 diagnostic,
  // 不影响 completion。`exp` 没有 `--json <path>` 聚合文件出口(`Json(path)` 仍是库 reporter,
  // 只是不再由这里接线)——JSON 聚合改走事件流本身(`--json`)或 `niceeval show --json`。
  const reporters: ReporterRegistration[] = [];
  const artifacts = ArtifactsReporter();
  reporters.push({ reporter: artifacts, name: "artifacts", required: true });
  if (flags.junit) reporters.push({ reporter: JUnit(flags.junit), name: "junit", required: true, target: flags.junit });
  (config.reporters ?? []).forEach((reporter, i) => {
    reporters.push({ reporter, name: `config-reporter-${i}`, required: false });
  });

  let summary: InvocationSummary;
  try {
    const inFlight = runEvals({
      config,
      evals,
      agentRuns,
      reporters,
      maxConcurrency,
      maxBuildConcurrency,
      signal: ctrl.signal,
      priorResults,
      carryPlan,
      keepSandbox: flags.keepSandbox,
      rerun: flags.rerun,
      niceevalRoot: resolvePath(cwd, ".niceeval"),
      session: sessionTracker,
    });
    // 交给强清路径一个可等待的收尾句柄:二次中断/看门狗强清时先有界等它收口,让在飞的
    // teardown 链跑完,而不是 process.exit 把它们连同进程一起杀掉。
    runInFlight = inFlight;
    summary = await inFlight;
  } catch (e) {
    // 真崩溃前先撤下 dashboard,不让半帧 ANSI 状态和下面 main().catch 打印的错误交织;
    // 同时释放键盘接管,不把终端留在 raw mode。
    inputGuard.stop();
    await coordinator.stopDynamic();
    await sessionTracker.close({ status: "incomplete" }).catch(() => undefined);
    throw e;
  }

  // 正常返回(含被中断后走部分汇总)后再兜一刀:Sample finalizer 没停掉的残留沙箱、没被运行
  // 路径消费的实验级 cleanup、没被 per-attempt Effect.ensuring 释放的用例锁与实验闸租约在这里
  // 强清。跑顺利时四份登记表都已空,是 no-op。
  await stopAllSandboxes();
  await drainExperimentTeardowns();
  await drainHeldCaseLocks();
  await drainHeldGateLeases();

  // completion 要先算好,--junit 是否"这次真的写出"才有依据(见下)。
  const completion = assembleInvocationCompletion(coordinator.state);

  // --junit 是正交机器出口,只在这次运行真的写出文件时才把路径交给 coordinator(它转发给
  // json renderer 打印独立的 `junit` 字段,见 docs「机器怎么读:--json」)。判据是
  // completion.reporterErrors 里有没有这次 required reporter("junit")的失败记录——不能用
  // existsSync 探测磁盘:atomicWriteFile(json.ts)失败时原地保留上一次运行遗留的旧文件,
  // existsSync 只会看到"文件存在"就误判成这次写成功,把上一轮的陈旧内容当成本次结果打印出去。
  const junitPath =
    flags.junit && !completion.reporterErrors.some((e) => e.reporter === "junit") ? flags.junit : undefined;

  // 机器反馈闭环的入口:跑完直接给出每个已创建快照的目录,agent/CI 读 run.json 与各
  // attempt 的 result.json / artifact(events/trace/diff),不必解析人类向的流式输出。相对 cwd
  // 的路径更友好;结果落在 cwd 外时(relative 路径以 .. 开头)原样打印绝对路径。打印本身由
  // renderer 的 "saved" 处理完成,这里只负责把路径交给 coordinator。
  const paths = artifacts.outputDirs().map(({ dir }) => {
    const rel = relative(cwd, dir);
    return rel && !rel.startsWith("..") ? rel : dir;
  });

  const pathsByExperiment = new Map(
    artifacts.outputDirs().map(({ experimentId, dir }) => {
      const rel = relative(cwd, dir);
      return [experimentId, rel && !rel.startsWith("..") ? rel : dir] as const;
    }),
  );
  await sessionTracker.close({ status: completion.status, completion, paths: pathsByExperiment });

  inputGuard.stop();
  await coordinator.finish({ summary, completion, paths, junit: junitPath });

  // 退出码统一走 CompletionStatus 驱动的语义(interrupted → 130、incomplete/required reporter
  // 失败 → 1),不再只看 verdict 计数;两种 profile 共用同一套退出码,不是 json 专属。failed/errored
  // 先按 (experiment, eval) 折叠再喂给 computeExitCode——它只认 InvocationSummary 原始字段,不知道
  // 「同一 eval 的重试轮不该重复计红」这条 eval 级判定规则(被 attempts+earlyExit 重试吸收的失败,
  // 先挂一次、后来过了,不该把进程判红,否则 CI 判定与 evalLevelStats 报表口径不一致;
  // 见 memory 的 cli-exit-code-attempt-level-not-eval-level)。
  const foldedStats = evalLevelStats(summary.results, (r) => `${r.experimentId ?? ""}|${r.id}`);
  const exitCode = computeExitCode({ ...summary, failed: foldedStats.failed, errored: foldedStats.errored }, completion);
  process.exit(exitCode);
}

// 只有经 bin/niceeval.js 启动时才运行 main();测试直接 import 本文件的纯函数(exp rename 的
// 解析与格式化)时不能让 main() 运行——单元层不起 CLI 进程,进程行为归 E2E。入口判断基于
// argv,不读环境变量:src/ 的环境变量白名单守护不允许新增测试专用变量
// (见 test/unit/config-env-boundary.test.ts),而 vitest 的 argv[1] 永远不会是 bin/niceeval.js。
if (
  process.argv[1]?.endsWith(`${sep}bin${sep}niceeval.js`) ||
  process.argv[1]?.endsWith(`${sep}.bin${sep}niceeval`)
) {
  main().catch(async (e) => {
    process.stderr.write(
      e instanceof SandboxLayerLinkError
        ? `${formatSandboxLayerLinkError(e)}\n`
        : e instanceof SandboxPhysicalPlanningError
          ? `${formatSandboxPhysicalPlanningError(e)}\n`
        : t("cli.error", { error: formatThrown(e) }),
    );
    // 真·崩溃路径也别留孤儿:强清还活着的沙箱(带超时)、排空实验级 cleanup 注册表、用例锁与
    // 实验闸租约,再退。
    await stopAllSandboxes();
    await drainExperimentTeardowns();
    await drainHeldCaseLocks();
    await drainHeldGateLeases();
    process.exit(2);
  });
}
