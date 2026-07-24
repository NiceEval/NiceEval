// niceeval CLI 入口。执行 eval 必须以 experiment 为单位;位置参数只在 exp 后筛 eval id 前缀。
//   niceeval exp [组|配置] [pattern]  跑实验
//   niceeval show [pattern]          终端读结果:榜单 / 单 eval / 证据切面 / 时间轴 / --report
//   niceeval list                    只列出发现到的 eval
//   niceeval clean                   删除 .niceeval/ 历史运行 artifact

import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs as nodeParseArgs } from "node:util";
import { discoverEvals, discoverExperiments } from "./runner/discover.ts";
import { browsableExperimentPaths, matchExperimentSelector } from "./shared/aggregate.ts";
import { runEvals, type AgentRun } from "./runner/run.ts";
import { cacheKey, planCarry } from "./runner/fingerprint.ts";
import { fingerprintEvalsFilter, resolveExperimentEvals, selectedEvalsForRun, splitByScoring } from "./runner/eval-selection.ts";
import { failureDetailFromResult } from "./runner/feedback/failure.ts";
import { stopAllSandboxes, liveSandboxCount } from "./sandbox/registry.ts";
import { drainExperimentTeardowns } from "./runner/experiment-cleanup-registry.ts";
import { drainHeldCaseLocks, isCaseLockStale, readCaseLock } from "./runner/lock.ts";
import { drainHeldGateLeases } from "./runner/gate-lease.ts";
import { CLEANUP_TIMEOUT_MS, withCleanupTimeout } from "./runner/cleanup-timeout.ts";
import type { ExperimentHookContext } from "./runner/types.ts";
import { evalLevelStats } from "./shared/verdict.ts";
import { recordFact } from "./shared/facts.ts";
import { prepareRunSandboxes, resolvedSandboxRecommendedConcurrency } from "./runner/sandbox-selection.ts";
import { JUnit } from "./runner/reporters/json.ts";
import { Artifacts as ArtifactsReporter } from "./runner/reporters/artifacts.ts";
import {
  resolveOutputForm,
  createFeedbackCoordinator,
  createNodeFeedbackIO,
  createHumanRenderer,
  createJsonRenderer,
  renderHumanDryPlan,
  renderJsonPlanDocument,
  computeExitCode,
  reportActivity,
  type JsonPlanRow,
} from "./runner/feedback/index.ts";
import {
  buildView,
  startViewServer,
  loadLatestResultsPerEval,
  resolveViewInput,
  IncompatibleResultsError,
  ViewInputError,
} from "./view/index.ts";
// load.ts 本身没有 JSX,但它的 ReportDefinition/ReportLoadError 要和 view 报告槽实际装载
// --report 用的那份(dist/report/**,见 tsconfig.report-build.json)是同一个模块实例——
// `unique symbol` 品牌与 class 的 instanceof 都按声明处的模块身份判定,raw src 和编译产物
// 是两份不同源码位置,即使运行时同名同形,TS 类型与 instanceof 都不认。
import { ReportLoadError } from "../dist/report/runtime/load.js";
import { runShow } from "./show/index.ts";
import { t } from "./i18n/index.ts";
import { formatThrown, upsertManagedBlock } from "./util.ts";
import type {
  CompletionStatus,
  Config,
  InvocationCompletion,
  InvocationSummary,
  ReporterError,
  ReporterRegistration,
  RunFeedbackPlan,
  RunFeedbackState,
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

interface Flags {
  agent?: string;
  model?: string;
  runs?: number;
  maxConcurrency?: number;
  timeout?: number;
  earlyExit?: boolean;
  dry: boolean;
  force: boolean;
  strict: boolean;
  budget?: number;
  tag?: string;
  junit?: string;
  /** `exp` 命令专用:机器面(NDJSON 事件流)。省略即人读文本(见 `resolveOutputForm`)。 */
  json: boolean;
  open?: boolean;
  out?: string;
  port?: number;
  help: boolean;
  version: boolean;
  // ── show 专属(位置参数仍是 eval id 前缀 / `@<locator>`;这些 flag 选「怎么看」)──
  source: boolean;
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
  results?: string;
  snapshot?: string;
  report?: string;
  page?: string;
  fresh: boolean;
  /** `sandbox list` 专用:核对强杀路径留下的无主实例。 */
  orphans: boolean;
  /** `exp` 命令专用:只对选中实验各执行一次实验级 teardown,不派发 attempt、不跑 setup。 */
  teardown: boolean;
}

// 表驱动的 flag 定义(node:util parseArgs)。--no-x 显式声明,不依赖 allowNegative(需 Node 20.14+,
// engines 是 >=18)。未知 flag 由 strict 模式报清晰错误,不再静默吞掉后面的位置参数。
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
  runs: { type: "string" },
  /** 设置同时运行的 eval 数量。 */
  "max-concurrency": { type: "string" },
  /** 单个 attempt 的超时时间,单位毫秒。 */
  timeout: { type: "string" },
  /** 整次运行的预算上限(美元)。 */
  budget: { type: "string" },
  /** `exp` 命令专用:跑完留下 failed/errored attempt 的 Sandbox 现场(= `--keep-sandbox=failed`);`--keep-sandbox=all` 连 passed 也留。事后用 `niceeval sandbox list/enter/stop` 查看与销毁。 */
  "keep-sandbox": { type: "boolean" },
  /** `sandbox stop` 专用:销毁全部留存 Sandbox。 */
  all: { type: "boolean" },
  /** `sandbox diff` 专用:只看某个 send 窗口(如 `--window s1/t2`);省略输出全部窗口的串联视图。 */
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
  /** `view` 命令专用:把结果查看器静态导出到指定目录。 */
  out: { type: "string" },
  /** `view` 命令专用:指定本地服务器监听端口。 */
  port: { type: "string" },
  // show 的证据切面 / 时间轴 / 报告装载(docs-site/zh/tutorials/viewing-results.mdx)。
  // 证据切面只认 `@<locator>`(或收窄到单个 eval 的前缀)选出的那一个 attempt——不再有
  // 数字 `--attempt`,选哪个 attempt 由 locator 精确指名,不是「先选 eval 再挑第几次」。
  /** `show` 命令专用:该 attempt 运行时保存的 Eval 源码,gate/soft 断言标回源码行(证据切面)。 */
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
  /** `show` / `view` / `sandbox enter|list|stop` 共用:结果根目录(`.niceeval` 之外的另一个根,如 `copySnapshots` 产出的发布根)。 */
  results: { type: "string" },
  /** `view` 命令专用:只打开这一份快照文件(`snapshot.json`);文件不可读时命令失败(扫描模式只跳过)。 */
  snapshot: { type: "string" },
  /** `show` / `view` 命令专用:用文件默认导出的 `defineReport(...)` 替换两者共用的默认报告。 */
  report: { type: "string" },
  /** `show` / `view` 命令专用:选择报告的初始页;`show` 渲染该页并在尾部附其余页索引,`view` 以它作初始路由。未命中的页 id 按用法错误退出并列出可用页 id。 */
  page: { type: "string" },
  /** `show` / `view` 命令专用:只统计新执行的 attempt(排除携带条目与跨快照拼入的历史执行);被排除的题按覆盖事实转为榜单占位行,不静默消失。 */
  fresh: { type: "boolean" },
  /** `exp` 命令专用:补齐被强杀打断的实验级 teardown——只对选中的实验各执行一次 teardown(新进程语义),不派发 attempt、不跑 setup;没有遗留登记也照常执行。与 eval 前缀位置参数组合是用法错误。 */
  teardown: { type: "boolean" },
  /** 只打印本次会匹配到的 eval × 运行配置,不实际执行(人读文本或 `--json` 单文档,见「机器怎么读:--json」)。 */
  dry: { type: "boolean" },
  /** 忽略上次运行结果,不跳过已通过的 (experiment, eval) 组合,强制全部重跑。 */
  force: { type: "boolean" },
  /** CI 中推荐使用:让软阈值(`soft`)失败也计入整条 eval 的 verdict。 */
  strict: { type: "boolean" },
  /** 某个 eval 的一次 attempt 通过后,停止该 eval 剩余的 attempts;省略默认关(`runs` 默认跑满、测完整通过率)。 */
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


function parseArgs(argv: string[]): { command: string; positionals: string[]; flags: Flags } {
  if (argv[0] === "--") argv = argv.slice(1);

  // --diff=<路径> 预扫:diff 本体是布尔(裸 --diff = 文件级摘要),路径只接受 = 连写。
  let diffPath: string | undefined;
  // --keep-sandbox[=failed|all] 预扫:本体是布尔(裸 = failed 档),档位只接受 = 连写。
  let keepSandboxTier: "failed" | "all" | undefined;
  // --timing[=summary|full] 预扫:node:util 的单个 option 不支持 boolean|string 联合，
  // 所以 mode 在严格 parseArgs 前提取，再把两种形式统一成布尔 --timing。
  let timingMode: "summary" | "full" | undefined;
  argv = argv.map((arg) => {
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

  let values: Record<string, string | boolean | undefined>;
  let rawPositionals: string[];
  try {
    const parsed = nodeParseArgs({ args: argv, options: FLAG_OPTIONS, allowPositionals: true, strict: true });
    values = parsed.values as Record<string, string | boolean | undefined>;
    rawPositionals = parsed.positionals;
  } catch (e) {
    process.stderr.write(t("cli.flag.parseError", { message: e instanceof Error ? e.message : String(e) }));
    process.exit(1);
  }

  // 第一个位置参数若是已知命令,则为命令;其余是 eval id 前缀 / view 输入。
  const commands = new Set(["exp", "show", "list", "view", "clean", "init", "watch", "run", "sandbox"]);
  let command = "run";
  let positionals = rawPositionals;
  if (rawPositionals[0] && commands.has(rawPositionals[0])) {
    command = rawPositionals[0];
    positionals = rawPositionals.slice(1);
  }

  const flags: Flags = {
    agent: values.agent as string | undefined,
    model: values.model as string | undefined,
    runs: numberFlag("runs", values.runs as string | undefined),
    maxConcurrency: numberFlag("max-concurrency", values["max-concurrency"] as string | undefined),
    timeout: numberFlag("timeout", values.timeout as string | undefined),
    budget: numberFlag("budget", values.budget as string | undefined),
    tag: values.tag as string | undefined,
    junit: values.junit as string | undefined,
    json: values.json === true,
    out: values.out as string | undefined,
    port: numberFlag("port", values.port as string | undefined),
    dry: values.dry === true,
    force: values.force === true,
    strict: values.strict === true,
    earlyExit: values["no-early-exit"] === true ? false : values["early-exit"] === true ? true : undefined,
    open: values["no-open"] === true ? false : values.open === true ? true : undefined,
    help: values.help === true,
    version: values.version === true,
    source: values.source === true,
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
    results: values.results as string | undefined,
    snapshot: values.snapshot as string | undefined,
    report: values.report as string | undefined,
    page: values.page as string | undefined,
    fresh: values.fresh === true,
    orphans: values.orphans === true,
    teardown: values.teardown === true,
  };
  return { command, positionals, flags };
}

/**
 * exp 只接受两类输入:位置参数选「跑哪些 eval」+ 调度/输出/机器出口 flag 选「对着哪个 agent、
 * 怎么跑」。show / view 专属的证据切面(`--source`/`--execution`/`--diff`)、时间轴(`--history`)、
 * Scope 收窄(`--exp`/`--results`)、报告装载(`--report`/`--page`)、查看器
 * (`--snapshot`/`--out`/`--port`/`--open`)不能被 exp 静默忽略(见 docs/feature/experiments/
 * cli.md「用法错误」)。返回第一个被误用的 flag 及其归属命令(用于报错),没有误用返回 undefined。
 */
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
  if (flags.results !== undefined) return { flag: "--results", command: BOTH };
  if (flags.report !== undefined) return { flag: "--report", command: BOTH };
  if (flags.page !== undefined) return { flag: "--page", command: BOTH };
  if (flags.fresh) return { flag: "--fresh", command: BOTH };
  if (flags.snapshot !== undefined) return { flag: "--snapshot", command: VIEW };
  if (flags.out !== undefined) return { flag: "--out", command: VIEW };
  if (flags.port !== undefined) return { flag: "--port", command: VIEW };
  if (flags.open !== undefined) return { flag: "--open", command: VIEW };
  return undefined;
}

/** 调度项的环境变量层(标志 > 环境变量 > config > 默认,见 docs/cli.md「配置优先级」)。 */
function envNumber(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    process.stderr.write(t("cli.envInvalidNumber", { name, value: raw }));
    process.exit(1);
  }
  return n;
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

async function loadConfig(cwd: string): Promise<Config> {
  const path = join(cwd, "niceeval.config.ts");
  if (!existsSync(path)) {
    throw new Error(t("cli.config.missing"));
  }
  const mod = (await import(pathToFileURL(path).href)) as { default?: Config };
  if (!mod.default) throw new Error(t("cli.config.noDefault"));
  return mod.default;
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
  "`--source` / `--execution` / `--diff` for evidence; the snapshot directories the CLI prints",
  "are the structured source of truth: `snapshot.json` holds the run's metadata and each",
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
        "  // TODO(judge): semantic assertions (t.judge.*) are silently skipped until a judge",
        "  // model is configured — an all-green run does not mean the judge ran. Any",
        "  // OpenAI-compatible /chat/completions service works; the key is read from",
        "  // OPENAI_API_KEY unless apiKeyEnv says otherwise.",
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
    if (d.key === "interrupted") {
      interrupted = true;
    } else if (d.key.startsWith("budget-exhausted:")) {
      unstarted += d.count;
    } else if (d.key.startsWith("fail-fast:")) {
      // run 级 fail-fast 造成的未派发同样计入 unstarted(结论落 incomplete,见
      // docs/feature/experiments/architecture.md「Completion 与退出」)。
      unstarted += d.count;
      failFastSkipped += d.count;
    } else if (d.key.startsWith("dispatch-halted:")) {
      // 止损闸停派发造成的未派发(见 docs/feature/error-classification/architecture.md
      // 「记账」)。这条诊断的 count 是「同一死因被声明了几次」(重复声明折叠),不是未派发数——
      // 未派发数由 emitter 累计后写在 data.unstarted 里(与 budget-exhausted 同一口径)。
      const halted = typeof d.data?.unstarted === "number" ? d.data.unstarted : 0;
      unstarted += halted;
      haltedSkipped += halted;
    } else if (d.key.startsWith("reporter-error:")) {
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
  await loadDotenv(cwd);
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));

  // --help / --version 不需要 config,先于一切命令处理。
  if (flags.help) {
    process.stdout.write(t("cli.help"));
    process.exit(0);
  }

  if (flags.version) {
    process.stdout.write(`${await packageVersion()}\n`);
    process.exit(0);
  }

  if (command === "view") {
    // 位置参数只有一种含义:eval id 前缀(收窄有效根)。结果根经 --results 递入,
    // 单开一份快照经 --snapshot 递入;--report 整槽替换报告槽(与 show --report 吃同一个文件),
    // --page 定初始页。文件与目录都不进位置参数(docs/feature/reports/view.md「打开与收窄」)。
    // --out 接受同一收窄:出站内容即收窄后的有效根(docs/feature/reports/view.md「静态导出」)。
    let viewInput: { input?: string; patterns: string[] };
    try {
      viewInput = resolveViewInput(cwd, positionals, {
        ...(flags.results !== undefined ? { results: flags.results } : {}),
        ...(flags.snapshot !== undefined ? { snapshot: flags.snapshot } : {}),
      });
    } catch (e) {
      exitOnViewUserError(e);
    }
    const scan = {
      patterns: viewInput.patterns,
      ...(flags.experiment !== undefined ? { experiment: flags.experiment } : {}),
      ...(flags.report !== undefined ? { report: { path: flags.report, cwd } } : {}),
      ...(flags.page !== undefined ? { page: flags.page } : {}),
      ...(flags.fresh ? { fresh: true } : {}),
    };
    if (flags.out) {
      const out = await buildView({ input: viewInput.input, out: flags.out, scan }).catch(exitOnViewUserError);
      process.stdout.write(t("cli.view.exportedDir", { out }));
      process.exit(0);
    }
    const server = await startViewServer({ input: viewInput.input, port: flags.port, scan }).catch(
      exitOnViewUserError,
    );
    process.stdout.write(t("cli.view.url", { url: server.url }));
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
      // CLI flag 是 --results(结果根);sandbox 命令组的内部选项名保持 run,值语义相同。
      run: flags.results,
      orphans: flags.orphans,
      force: flags.force,
    });
    process.exit(code);
  }

  if (command === "show") {
    // show 不依赖 niceeval.config.ts:读的是 .niceeval/(或 --results 指定的结果根)的落盘结果。
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
      results: flags.results,
      report: flags.report,
      page: flags.page,
      fresh: flags.fresh,
      json: flags.json,
    });
    process.exit(code);
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

  if (command === "watch") {
    process.stdout.write(t("cli.unimplemented", { command }));
    process.exit(0);
  }

  const config = await loadConfig(cwd);
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

  if (command === "exp") {
    if (flags.agent || flags.model) {
      process.stderr.write(t("cli.exp.agentModelFlagUnsupported"));
      process.exit(1);
    }
    const viewerFlag = firstViewerOnlyFlag(flags);
    if (viewerFlag) {
      process.stderr.write(t("cli.exp.viewerFlagUnsupported", { flag: viewerFlag.flag, command: viewerFlag.command }));
      process.exit(1);
    }
    const experiments = await discoverExperiments(cwd);
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
      const { staleTeardownReminder } = await import("./runner/teardown-registry.ts");
      const staleReminder = await staleTeardownReminder(
        resolvePath(cwd, ".niceeval"),
        new Set(selected.filter((e) => e.teardown).map((e) => e.id)),
        hostname(),
      ).catch(() => undefined);
      if (staleReminder) process.stderr.write(staleReminder);
    }

    // `--teardown`:只对选中的实验各执行一次实验级 teardown(新进程语义),不派发任何 attempt、
    // 不跑 setup;与 eval 前缀位置参数组合是用法错误(这个 flag 选择的是「只收尾」这种跑法,
    // 不参与 eval 选择)。启动自愈(选中实验里遗留登记的补执行)发生在 runEvals() 内部
    // 触发 setup 之前,不需要这里重复处理(见 run.ts 的 recoverStaleTeardownRegistration)。
    if (flags.teardown) {
      if (extraPatterns.length > 0) {
        process.stderr.write(t("cli.exp.teardownNoEvalPatterns"));
        process.exit(1);
      }
      const niceevalRootForTeardown = resolvePath(cwd, ".niceeval");
      const { isStaleTeardownRegistration, readTeardownRegistrations, removeTeardownRegistrationIfPresent } =
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
          // 独立 `--teardown` 路径不派发任何 attempt、不打开快照,没有 `SnapshotMeta.facts`
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
            .filter(({ entry }) => isStaleTeardownRegistration(entry, hostname()))
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
    for (const exp of selected) {
      // 一个实验 = 一个配置(单 model)。跨模型对比写多个实验文件,各钉一个 model。
      // evals 谓词在这里对本次 invocation 的候选 eval 各求值一次;下游(dry-run、sandbox 查表、
      // fingerprint/carry、attempt 展开)只消费 selectedEvalIds,不重新调用谓词
      // (见 docs/feature/experiments/library.md「evals」)。
      const { selectedEvals, selectedEvalIds } = resolveExperimentEvals({
        experimentId: exp.id,
        selector: exp.evals,
        cliPatterns: extraPatterns,
        evals,
      });
      // 一个 experiment 选中的 eval 必须同一题型:通过率(defineEval)与总分(defineScoreEval)
      // 是两种不能相加的读数,混型是启动期配置错误(见 docs/feature/experiments/score-points.md
      // 「横截面聚合:同型实验,各读各的」)。
      const scoringSplit = splitByScoring(selectedEvals);
      if (scoringSplit.pass.length > 0 && scoringSplit.points.length > 0) {
        process.stderr.write(t("cli.experiment.mixedScoring", {
          experimentId: exp.id,
          passCount: scoringSplit.pass.length,
          passIds: scoringSplit.pass.join(", "),
          pointsCount: scoringSplit.points.length,
          pointsIds: scoringSplit.points.join(", "),
        }));
        process.exit(1);
      }
      // --strict 的全部作用是「把带线 soft 翻成 gate」,而计分制的判定面只认前置中止:
      // 这个 flag 对计分制实验一件事都做不了,静默接受一个什么都不做的 flag 会让人以为
      // 判定收紧了(见 docs/feature/experiments/score-points.md「计分制没有 --strict」)。
      if (flags.strict && scoringSplit.points.length > 0 && scoringSplit.pass.length === 0) {
        process.stderr.write(t("cli.experiment.strictOnPoints", {
          experimentId: exp.id,
          count: scoringSplit.points.length,
        }));
        process.exit(1);
      }
      agentRuns.push({
        agent: exp.agent,
        model: exp.model,
        reasoningEffort: exp.reasoningEffort,
        flags: exp.flags ?? {},
        runs: flags.runs ?? envNumber("NICEEVAL_RUNS") ?? exp.runs ?? 1,
        earlyExit: flags.earlyExit ?? exp.earlyExit ?? false,
        sandbox: exp.sandbox ?? config.sandbox,
        timeoutMs: flags.timeout ?? envNumber("NICEEVAL_TIMEOUT") ?? exp.timeoutMs ?? config.timeoutMs,
        budget: flags.budget ?? envNumber("NICEEVAL_BUDGET") ?? exp.budget,
        selectedEvalIds,
        experimentId: exp.id,
        description: exp.description,
        labels: exp.labels,
        evalFilterFingerprint: fingerprintEvalsFilter(exp.evals, extraPatterns),
        strict: flags.strict,
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
  } else {
    // 裸 run / `niceeval <eval>` 不再执行。运行配置必须来自 experiments/,
    // 这样 agent/model/flags/runs/budget 与结果聚合都有可签入的身份。
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
  const totalAttempts = agentRuns.reduce((sum, run, i) => sum + matchedByRun[i]!.length * run.runs, 0);
  const uniqueEvalIds = new Set(matchedByRun.flat().map((e) => e.id));

  if (totalAttempts === 0) {
    process.stderr.write(t("cli.experiment.noEvalsSelected", {
      selection: experimentSelection,
      experiments: availableExperimentPaths,
    }));
    process.exit(1);
  }

  // environments 查表在 dry-run 与真实运行共用的规划边界完成；缺表项在任何沙箱/agent 花费前穷举失败。
  prepareRunSandboxes(evals, agentRuns, config.sandbox);

  // 提前算好携入计划:coordinator 的 plan 事件与 runEvals 内部实际调度必须共用同一份
  // planCarry() 判断,否则两边各自算一遍,一旦不一致,dashboard/事件流展示的"携入"就会和
  // run.ts 真实调度的"携入"对不上(见 memory 的 live-carry-row-shows-waiting-forever)。
  // `--dry`(两种形态)都需要这份计算:`--dry --json` 的 `ExpPlanDocument.matrix[].reused`,
  // 人读 `--dry` 首行的携入摘要(见 docs/feature/experiments/cli.md 开头示例与「事件与计划
  // 文档的 TypeScript 形状」),口径必须与真正开跑时一致。
  const priorResults = flags.force ? undefined : await loadLatestResultsPerEval(join(cwd, ".niceeval"));
  const carryPlan = priorResults?.length ? await planCarry(evals, agentRuns, priorResults, config.sandbox) : undefined;

  if (flags.dry) {
    // --dry 只按所选形态打印计划,不运行、不落盘——一次完成的读取,不是事件流
    // (见 docs/feature/experiments/cli.md「机器怎么读:--json」)。两种形态共用同一份摊平
    // 矩阵——(experimentId, evalId) 逐行,携带同一口径的 reused 预测——不是各自重算一遍。
    const dryRuns = Math.max(1, ...agentRuns.map((r) => r.runs));
    const rowInputs: { experimentId: string; evalId: string; reused: boolean }[] = [];
    for (let i = 0; i < agentRuns.length; i++) {
      const run = agentRuns[i]!;
      for (const e of matchedByRun[i]!) {
        const carriedCount = carryPlan?.carriedAttemptsByKey.get(cacheKey(run, e.id))?.size ?? 0;
        rowInputs.push({ experimentId: run.experimentId ?? "", evalId: e.id, reused: carriedCount >= run.runs });
      }
    }
    // 只读锁目录,不取锁、不等待(见 docs/feature/experiments/architecture.md「并发
    // Invocation:用例锁」);过期(无人续心跳)的锁不算"正被持锁运行",不标注。裸 run(没有
    // experimentId)不参与锁,恒不标注。并行读——矩阵行数可能不小,不逐行串行等磁盘。
    const niceevalRootForDry = resolvePath(cwd, ".niceeval");
    const now = Date.now();
    const lockedFlags = await Promise.all(
      rowInputs.map(async (row) => {
        if (!row.experimentId) return false;
        const lock = await readCaseLock(niceevalRootForDry, row.experimentId, row.evalId).catch(() => undefined);
        return lock !== undefined && !isCaseLockStale(lock, now);
      }),
    );
    const matrix: JsonPlanRow[] = rowInputs.map((row, i) => ({ ...row, ...(lockedFlags[i] ? { locked: true } : {}) }));
    if (outputForm === "json") {
      process.stdout.write(
        renderJsonPlanDocument({
          total: totalAttempts,
          evals: uniqueEvalIds.size,
          configs: agentRuns.length,
          runs: dryRuns,
          matrix,
        }),
      );
    } else {
      process.stdout.write(
        renderHumanDryPlan({
          totalAttempts,
          evals: uniqueEvalIds.size,
          configs: agentRuns.length,
          runs: dryRuns,
          reused: carryPlan?.carriedResults.length ?? 0,
          rows: matrix.map((row) => ({ experimentId: row.experimentId, evalId: row.evalId, locked: row.locked })),
        }),
      );
    }
    process.exit(0);
  }

  const reusedFailures = (carryPlan?.carriedResults ?? [])
    .map(failureDetailFromResult)
    .filter((failure) => failure !== undefined);

  // 无全局默认:并发上限由 sandbox provider 的推荐值决定(多个 agentRun 各有 sandbox 时取
  // 最小值,最保守的 provider 决定上限)。同一个值既进 RunFeedbackPlan.shape,也传给 runEvals——
  // 两处必须是同一个数字,dashboard 展示的并发上限不能和真实调度的并发上限对不上。
  const sandboxDefaultConcurrency = resolvedSandboxRecommendedConcurrency(evals, agentRuns, config.sandbox);
  const maxConcurrency =
    flags.maxConcurrency ??
    envNumber("NICEEVAL_MAX_CONCURRENCY") ??
    config.maxConcurrency ??
    sandboxDefaultConcurrency;

  const plan: RunFeedbackPlan = {
    shape: { evals: uniqueEvalIds.size, configs: agentRuns.length, totalAttempts, maxConcurrency },
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
  const coordinator = createFeedbackCoordinator({ profile: outputForm, renderer, io });
  coordinator.start(plan);

  // Ctrl+C / kill 的三级响应,核心目标:任何情况下都不留下孤儿沙箱。
  //   1 次:abort controller → runEvals 把它喂给 Effect signal → 各 attempt 的 Scope 跑 release
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
  let runInFlight: Promise<unknown> | undefined;
  let forcing = false;
  const forceCleanupAndExit = (code: number) => {
    if (forcing) return;
    forcing = true;
    void (async () => {
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
        process.exit(130); // 第三次:硬退
      }
    });
  }

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
      signal: ctrl.signal,
      priorResults,
      carryPlan,
      keepSandbox: flags.keepSandbox,
      niceevalRoot: resolvePath(cwd, ".niceeval"),
    });
    // 交给强清路径一个可等待的收尾句柄:二次中断/看门狗强清时先有界等它收口,让在飞的
    // teardown 链跑完,而不是 process.exit 把它们连同进程一起杀掉。
    runInFlight = inFlight;
    summary = await inFlight;
  } catch (e) {
    // 真崩溃前先撤下 dashboard,不让半帧 ANSI 状态和下面 main().catch 打印的错误交织。
    await coordinator.stopDynamic();
    throw e;
  }

  // 正常返回(含被中断后走部分汇总)后再兜一刀:Scope finalizer 没停掉的残留沙箱、没被运行
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

  // 机器反馈闭环的入口:跑完直接给出每个已创建快照的目录,agent/CI 读 snapshot.json 与各
  // attempt 的 result.json / artifact(events/trace/diff),不必解析人类向的流式输出。相对 cwd
  // 的路径更友好;结果落在 cwd 外时(relative 路径以 .. 开头)原样打印绝对路径。打印本身由
  // renderer 的 "saved" 处理完成,这里只负责把路径交给 coordinator。
  const paths = artifacts.outputDirs().map(({ dir }) => {
    const rel = relative(cwd, dir);
    return rel && !rel.startsWith("..") ? rel : dir;
  });

  await coordinator.finish({ summary, completion, paths, junit: junitPath });

  // 退出码统一走 CompletionStatus 驱动的语义(interrupted → 130、incomplete/required reporter
  // 失败 → 1),不再只看 verdict 计数;两种 profile 共用同一套退出码,不是 json 专属。failed/errored
  // 先按 (experiment, eval) 折叠再喂给 computeExitCode——它只认 InvocationSummary 原始字段,不知道
  // 「同一 eval 的重试轮不该重复计红」这条 eval 级判定规则(被 runs+earlyExit 重试吸收的失败,
  // 先挂一次、后来过了,不该把进程判红,否则 CI 判定与 evalLevelStats 报表口径不一致;
  // 见 memory 的 cli-exit-code-attempt-level-not-eval-level)。
  const foldedStats = evalLevelStats(summary.results, (r) => `${r.experimentId ?? ""}|${r.id}`);
  const exitCode = computeExitCode({ ...summary, failed: foldedStats.failed, errored: foldedStats.errored }, completion);
  process.exit(exitCode);
}

main().catch(async (e) => {
  process.stderr.write(t("cli.error", { error: formatThrown(e) }));
  // 真·崩溃路径也别留孤儿:强清还活着的沙箱(带超时)、排空实验级 cleanup 注册表、用例锁与
  // 实验闸租约,再退。
  await stopAllSandboxes();
  await drainExperimentTeardowns();
  await drainHeldCaseLocks();
  await drainHeldGateLeases();
  process.exit(2);
});
