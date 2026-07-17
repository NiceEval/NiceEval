// niceeval CLI 入口。执行 eval 必须以 experiment 为单位;位置参数只在 exp 后筛 eval id 前缀。
//   niceeval exp [组|配置] [pattern]  跑实验
//   niceeval show [pattern]          终端读结果:榜单 / 单 eval / 证据切面 / 时间轴 / --report
//   niceeval list                    只列出发现到的 eval
//   niceeval clean                   删除 .niceeval/ 历史运行 artifact

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs as nodeParseArgs } from "node:util";
import { discoverEvals, discoverExperiments, makeFilter } from "./runner/discover.ts";
import { runEvals, type AgentRun } from "./runner/run.ts";
import { planCarry } from "./runner/fingerprint.ts";
import { failureDetailFromResult } from "./runner/feedback/failure.ts";
import { stopAllSandboxes, liveSandboxCount } from "./sandbox/registry.ts";
import { evalLevelStats } from "./shared/verdict.ts";
import { prepareRunSandboxes, resolvedSandboxRecommendedConcurrency } from "./runner/sandbox-selection.ts";
import { Json, JUnit } from "./runner/reporters/json.ts";
import { Artifacts as ArtifactsReporter } from "./runner/reporters/artifacts.ts";
import {
  resolveOutputProfile,
  createFeedbackCoordinator,
  createNodeFeedbackIO,
  createHumanRenderer,
  createAgentRenderer,
  createCiRenderer,
  renderAgentPlanEnvelope,
  renderHumanDryPlan,
  renderCiDryPlan,
  computeCiExitCode,
  reportActivity,
  type OutputProfileFlag,
  type AgentPlanRow,
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
import { ReportLoadError } from "../dist/report/load.js";
import { runShow } from "./show/index.ts";
import { t } from "./i18n/index.ts";
import { formatThrown, upsertManagedBlock } from "./util.ts";
import type {
  CompletionStatus,
  Config,
  DiscoveredExperiment,
  ReporterError,
  ReporterRegistration,
  RunCompletion,
  RunFeedbackPlan,
  RunFeedbackState,
  RunSummary,
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
  /** 反馈 profile,已解析/校验(`auto` 默认值也算已解析——具体环境判定见 `resolveOutputProfile`)。 */
  output: OutputProfileFlag;
  force: boolean;
  strict: boolean;
  budget?: number;
  tag?: string;
  junit?: string;
  json?: string;
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
  timing?: "summary" | "full";
  keepSandbox?: "failed" | "all";
  all: boolean;
  window?: string;
  sandboxPath?: string;
  leaveRunning: boolean;
  history: boolean;
  experiment?: string;
  results?: string;
  snapshot?: string;
  report?: string;
  page?: string;
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
  /** `exp` 命令专用:跑完留下 failed/errored attempt 的沙箱现场(= `--keep-sandbox=failed`);`--keep-sandbox=all` 连 passed 也留。事后用 `niceeval sandbox list/enter/stop` 查看与销毁。 */
  "keep-sandbox": { type: "boolean" },
  /** `sandbox stop` 专用:销毁全部留存沙箱。 */
  all: { type: "boolean" },
  /** `sandbox diff` 专用:只看某个 send 窗口(如 `--window s1/t2`);省略输出全部窗口的串联视图。 */
  window: { type: "string" },
  /** `sandbox diff` 专用:只看某个文件的 patch;省略输出该窗口的全部文件。 */
  path: { type: "string" },
  /** `sandbox enter` 专用:shell 退出后让现场保持运行,不送回休眠。 */
  "leave-running": { type: "boolean" },
  /** 只运行带有该 tag 的 eval(见 `defineEval` 的 `tags`)。 */
  tag: { type: "string" },
  /** 额外写一份 JUnit XML 报告到指定路径,供 CI 消费。 */
  junit: { type: "string" },
  /** 额外写一份 JSON 结果(`RunSummary` 原样序列化)到指定路径,供 CI 或下游脚本消费。 */
  json: { type: "string" },
  /** `view` 命令专用:把结果查看器静态导出到指定目录。 */
  out: { type: "string" },
  /** `view` 命令专用:指定本地服务器监听端口。 */
  port: { type: "string" },
  // show 的证据切面 / 时间轴 / 报告装载(docs-site/zh/how-to/viewing-results.mdx)。
  // 证据切面只认 `@<locator>`(或收窄到单个 eval 的前缀)选出的那一个 attempt——不再有
  // 数字 `--attempt`,选哪个 attempt 由 locator 精确指名,不是「先选 eval 再挑第几次」。
  /** `show` 命令专用:该 attempt 运行时保存的 Eval 源码,gate/soft 断言标回源码行(证据切面)。 */
  source: { type: "boolean" },
  /** `show` 命令专用:该 attempt 的标准执行事件流(消息、thinking、Skill load、工具调用/结果);有 OTel 时同一节点补时间(证据切面)。 */
  execution: { type: "boolean" },
  /** `show` 命令专用:整个 Attempt 的统一时间树;裸 `--timing` 给有界诊断投影,`--timing=full` 逐节点展开全部 runner/已关联 OTel 节点。 */
  timing: { type: "boolean" },
  // --diff 是布尔;--diff=<路径> 在 parseArgs 前预扫成 diffPath(路径必须 = 连写,
  // 空格形式的下一个 token 仍是位置参数 = eval id 前缀,与文档一致)。
  /** `show` 命令专用:sandbox 里的文件改动摘要;`--diff=<文件路径>` 看单个文件的完整改动(路径必须 `=` 连写)。 */
  diff: { type: "boolean" },
  /** `show` 命令专用:执行时间轴——对匹配的每个 experiment × eval 分节,逐 attempt 列时间 / verdict / 摘要 / 耗时 / 成本 / locator;与 `--report` 互斥。 */
  history: { type: "boolean" },
  /** `show` / `view` 命令专用:按路径段前缀收窄 experiment(与 `niceeval exp` 位置参数同一套匹配);组名会选中组内全部配置。`view --out` 时同一收窄决定出站内容。 */
  exp: { type: "string" },
  /** `show` / `view` / `sandbox enter|list|stop` 共用:结果根目录(`.niceeval` 之外的另一个根,如 `copySnapshots` 产出的发布根)。 */
  results: { type: "string" },
  /** `view` 命令专用:只打开这一份快照文件(`snapshot.json`);文件不可读时命令失败(扫描模式只跳过)。 */
  snapshot: { type: "string" },
  /** `show` / `view` 命令专用:用文件默认导出的 `defineReport(...)` 替换两者共用的默认报告。 */
  report: { type: "string" },
  /** `show` / `view` 命令专用:选择报告的初始页;`show` 渲染该页并在尾部附其余页索引,`view` 以它作初始路由。未命中的页 id 按用法错误退出并列出可用页 id。 */
  page: { type: "string" },
  /** 只打印本次会匹配到的 eval × 运行配置,不实际执行(按下面 `--output` 选中的 profile 给出预览)。 */
  dry: { type: "boolean" },
  /** 反馈 profile:`auto`(默认)按环境自动选择,`human` / `agent` / `ci` 强制指定;只改变终端展示,不改变选择、调度、判定、artifact 或退出码。`auto` 依次判定:stderr 是 TTY → human;否则 `CI`(或其它常见 CI 平台环境变量)存在 → ci;否则 → agent。 */
  output: { type: "string" },
  /** 忽略上次运行结果,不跳过已通过的 (experiment, eval) 组合,强制全部重跑。 */
  force: { type: "boolean" },
  /** CI 中推荐使用:让软阈值(`soft`)失败也计入整条 eval 的 verdict。 */
  strict: { type: "boolean" },
  /** 某个 eval 的一次 attempt 通过后,停止该 eval 剩余的 attempts。 */
  "early-exit": { type: "boolean" },
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

const OUTPUT_PROFILE_VALUES = ["auto", "human", "agent", "ci"] as const;

/** `--output` 解析仅接受 `auto|human|agent|ci`;非法值直接报清晰用法并退出,不静默回退到某个默认值。 */
function outputFlag(raw: string | undefined): OutputProfileFlag {
  if (raw === undefined) return "auto";
  if ((OUTPUT_PROFILE_VALUES as readonly string[]).includes(raw)) return raw as OutputProfileFlag;
  process.stderr.write(t("cli.flag.invalidOutput", { value: raw }));
  process.exit(1);
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
    json: values.json as string | undefined,
    out: values.out as string | undefined,
    port: numberFlag("port", values.port as string | undefined),
    dry: values.dry === true,
    output: outputFlag(values.output as string | undefined),
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
    keepSandbox: values["keep-sandbox"] === true ? (keepSandboxTier ?? "failed") : undefined,
    all: values.all === true,
    window: values.window as string | undefined,
    sandboxPath: values.path as string | undefined,
    leaveRunning: values["leave-running"] === true,
    history: values.history === true,
    experiment: values.exp as string | undefined,
    results: values.results as string | undefined,
    snapshot: values.snapshot as string | undefined,
    report: values.report as string | undefined,
    page: values.page as string | undefined,
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
  if (flags.diff || flags.diffPath !== undefined) return { flag: "--diff", command: SHOW };
  if (flags.history) return { flag: "--history", command: SHOW };
  if (flags.experiment !== undefined) return { flag: "--exp", command: BOTH };
  if (flags.results !== undefined) return { flag: "--results", command: BOTH };
  if (flags.report !== undefined) return { flag: "--report", command: BOTH };
  if (flags.page !== undefined) return { flag: "--page", command: BOTH };
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

function evalsFilterFromExperiment(
  evals: DiscoveredExperiment["evals"],
  patterns: string[],
): (id: string) => boolean {
  const patternFilter = makeFilter(patterns);
  let expFilter: (id: string) => boolean = () => true;
  if (Array.isArray(evals)) expFilter = makeFilter(evals);
  else if (typeof evals === "function") expFilter = evals;
  return (id) => expFilter(id) && patternFilter(id);
}

/**
 * evals 过滤器的指纹(进 ExperimentRunInfo.evalFilterFingerprint,供「配置没变」判断):
 * 数组按内容、函数按函数体哈希;CLI 追加的位置参数前缀一并计入。不存过滤器本身——
 * 求值结果在 selectedEvalIds(见 runEvals)。
 */
function fingerprintEvalsFilter(evals: DiscoveredExperiment["evals"], patterns: string[]): string {
  const basis =
    evals === undefined || evals === "*"
      ? "*"
      : Array.isArray(evals)
        ? JSON.stringify([...evals].sort())
        : evals.toString();
  return createHash("sha256").update(JSON.stringify({ basis, patterns })).digest("hex").slice(0, 16);
}

/**
 * run 结束后把 coordinator 累计的诊断折成 `RunCompletion`(见 docs/feature/experiments/cli.md
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
function assembleRunCompletion(state: RunFeedbackState): RunCompletion {
  let unstarted = 0;
  let failFastSkipped = 0;
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
    } else if (d.key.startsWith("reporter-error:")) {
      // required 决定这条错误是否写进 RunCompletion.reporterErrors 并让 completion 非 complete
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
  // attempt:early-exit 计数含 fail-fast 的未派发(反馈层同一事件驱动计数守恒);
  // 「省下的重复验证」= 总数减去 fail-fast 那部分。
  const earlyExitUnstarted = Math.max(0, state.earlyExitSkipped - failFastSkipped);
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
      history: flags.history,
      experiment: flags.experiment,
      results: flags.results,
      report: flags.report,
      page: flags.page,
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
  let availableExperimentGroups = t("cli.none");

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
    availableExperimentGroups = [...new Set(experiments.map((experiment) => experiment.group || experiment.id))]
      .sort()
      .join(", ") || t("cli.none");
    const selected = expArg
      ? experiments.filter((e) => e.group === expArg || e.id === expArg || e.id.startsWith(expArg + "/"))
      : experiments;
    if (selected.length === 0) {
      process.stderr.write(t("cli.experiment.noMatch", {
        arg: expArg ?? t("cli.all"),
        experiments: experiments.map((e) => e.id).join(", ") || t("cli.none"),
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
    // 残留提醒:注册表里还有上次留下的沙箱时打一行(不阻塞、不清理)。
    {
      const { keptSandboxReminder } = await import("./sandbox/cli-commands.ts");
      const reminder = await keptSandboxReminder(cwd).catch(() => undefined);
      if (reminder) process.stderr.write(reminder);
    }
    for (const exp of selected) {
      // 一个实验 = 一个配置(单 model)。跨模型对比写多个实验文件,各钉一个 model。
      agentRuns.push({
        agent: exp.agent,
        model: exp.model,
        reasoningEffort: exp.reasoningEffort,
        flags: exp.flags ?? {},
        runs: flags.runs ?? envNumber("NICEEVAL_RUNS") ?? exp.runs ?? 1,
        earlyExit: flags.earlyExit ?? exp.earlyExit ?? true,
        sandbox: exp.sandbox ?? config.sandbox,
        timeoutMs: flags.timeout ?? envNumber("NICEEVAL_TIMEOUT") ?? exp.timeoutMs ?? config.timeoutMs,
        budget: flags.budget ?? envNumber("NICEEVAL_BUDGET") ?? exp.budget,
        evalFilter: evalsFilterFromExperiment(exp.evals, extraPatterns),
        experimentId: exp.id,
        description: exp.description,
        evalFilterFingerprint: fingerprintEvalsFilter(exp.evals, extraPatterns),
        strict: flags.strict,
        // 实验级并发上限:随 AgentRun 进调度器按实验单独限流(runner 两级信号量),
        // 不再取所有选中实验的最小值钳全局——那会让一个串行实验拖慢整批基线。
        maxConcurrency: exp.maxConcurrency,
        setup: exp.setup,
      });
    }
  } else {
    // 裸 run / `niceeval <eval>` 不再执行。运行配置必须来自 experiments/,
    // 这样 agent/model/flags/runs/budget 与结果聚合都有可签入的身份。
    const experiments = await discoverExperiments(cwd);
    const asExp = experiments.filter((e) =>
      positionals.some((p) => e.group === p || e.id === p || e.id.startsWith(p + "/")),
    );
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

  // profile 只改变反馈,不改变选择/调度/判定;显式值覆盖 auto 检测(见 resolveOutputProfile)。
  // --dry 和真正开跑共用同一个已解析 profile。
  const outputProfile = resolveOutputProfile({
    explicit: flags.output,
    isTTY: process.stderr.isTTY === true,
    env: process.env,
  });

  // matchedByRun[i] 对应 agentRuns[i] 匹配到的 eval 集合;--dry 预览与真正开跑时的
  // RunFeedbackPlan(总量、去重 eval 数)共用同一份计算,不重复过滤一遍。
  const matchedByRun = agentRuns.map((run) => evals.filter((e) => run.evalFilter(e.id)));
  const totalRuns = agentRuns.reduce((sum, run, i) => sum + matchedByRun[i]!.length * run.runs, 0);
  const uniqueEvalIds = new Set(matchedByRun.flat().map((e) => e.id));

  if (totalRuns === 0) {
    process.stderr.write(t("cli.experiment.noEvalsSelected", {
      selection: experimentSelection,
      experiments: availableExperimentGroups,
    }));
    process.exit(1);
  }

  // environments 查表在 dry-run 与真实运行共用的规划边界完成；缺表项在任何沙箱/agent 花费前穷举失败。
  prepareRunSandboxes(evals, agentRuns, config.sandbox);

  if (flags.dry) {
    // --dry 只按所选 profile 打印计划,不运行、不落盘 —— 三种 profile 各自的展示逻辑
    // 都在 runner/feedback/{human,agent,ci}.ts 里,这里只负责拼数据、选函数、写流、退出。
    if (outputProfile === "agent") {
      const rows: AgentPlanRow[] = [];
      for (let i = 0; i < agentRuns.length; i++) {
        const run = agentRuns[i]!;
        const label = run.experimentId ?? (run.model ? `${run.agent.name}/${run.model}` : run.agent.name);
        for (const e of matchedByRun[i]!) rows.push({ label, evalId: e.id });
      }
      process.stdout.write(
        renderAgentPlanEnvelope({
          total: totalRuns,
          evals: uniqueEvalIds.size,
          configs: agentRuns.length,
          runs: Math.max(1, ...agentRuns.map((r) => r.runs)),
          rows,
        }) + "\n",
      );
    } else if (outputProfile === "ci") {
      process.stdout.write(
        renderCiDryPlan({
          total: totalRuns,
          evals: uniqueEvalIds.size,
          configs: agentRuns.length,
          rows: agentRuns.map((run, i) => ({
            experimentId: run.experimentId,
            who: run.model ? `${run.agent.name}/${run.model}` : run.agent.name,
            evalIds: matchedByRun[i]!.map((e) => e.id),
            runs: run.runs,
          })),
        }),
      );
    } else {
      process.stdout.write(
        renderHumanDryPlan({
          evals: evals.length,
          configs: agentRuns.length,
          rows: agentRuns.map((run, i) => ({
            who: run.model ? `${run.agent.name}/${run.model}` : run.agent.name,
            experimentSuffix: run.experimentId ? ` (exp ${run.experimentId})` : "",
            evalIds: matchedByRun[i]!.map((e) => e.id),
            runs: run.runs,
          })),
        }),
      );
    }
    process.exit(0);
  }

  // 提前算好携入计划:coordinator 的 plan 事件与 runEvals 内部
  // 实际调度必须共用同一份 planCarry() 判断,否则两边各自算一遍,一旦不一致,dashboard/
  // envelope 展示的"携入"就会和 run.ts 真实调度的"携入"对不上(见 memory 的
  // live-carry-row-shows-waiting-forever)。
  const priorResults = flags.force ? undefined : await loadLatestResultsPerEval(join(cwd, ".niceeval"));
  const carryPlan = priorResults?.length ? await planCarry(evals, agentRuns, priorResults, config.sandbox) : undefined;
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
    shape: { evals: uniqueEvalIds.size, configs: agentRuns.length, totalRuns, maxConcurrency },
    reused: carryPlan?.carriedResults.length ?? 0,
    reusedFailures,
  };

  // 一个 run 内只有一个终端协调者(见 docs/feature/experiments/cli.md「输出流和落盘节奏」):
  // 三种 profile 各自的展示逻辑全部在 renderer 里,这里只按解析出的 profile 选一个构造好、
  // 交给 coordinator。run:start 前(coordinator.start(plan) 之前)的一切都还没有活跃 sink,
  // 出错走 bootstrap stderr;之后所有诊断都经它。
  const io = createNodeFeedbackIO();
  const commandLabel = ["niceeval", command, ...positionals].join(" ").trim();
  const renderer =
    outputProfile === "human"
      ? createHumanRenderer({ io, command: commandLabel })
      : outputProfile === "agent"
        ? createAgentRenderer({ io })
        : createCiRenderer({ io });
  const coordinator = createFeedbackCoordinator({ profile: outputProfile, renderer, io });
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
  // 兜底强清 + 退出:只跑一次,带超时(stopAllSandboxes 内每个 stop 各自有超时)。先停 dashboard
  // 的 tick/动态区域(coordinator.stopDynamic()),避免硬退时终端卡在半帧 ANSI 状态。
  let forcing = false;
  const forceCleanupAndExit = (code: number) => {
    if (forcing) return;
    forcing = true;
    void Promise.all([coordinator.stopDynamic(), stopAllSandboxes()]).finally(() => process.exit(code));
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      signalCount += 1;
      if (signalCount === 1) {
        reportActivity(t("cli.interruptCleanup").trimEnd());
        ctrl.abort();
        // 看门狗:graceful 清理 12s 还没让进程自己收口,就强清兜底。
        setTimeout(() => {
          if (liveSandboxCount() > 0) {
            reportActivity(t("cli.fallbackCleanupTimeout").trimEnd());
            forceCleanupAndExit(130);
          }
        }, 12_000).unref();
      } else if (signalCount === 2) {
        reportActivity(t("cli.forceCleanupExit").trimEnd());
        forceCleanupAndExit(130);
      } else {
        process.exit(130); // 第三次:硬退
      }
    });
  }

  // reporter 只剩正交的机器/artifact 出口:human/agent/ci 的展示完全由上面的 coordinator +
  // renderer 负责,不再有 Console/Live/Quiet 这类兼职当 reporter 的展示层(见 docs 的
  // 「CLI 只负责解析 profile、构造 coordinator/reporters、运行和退出」)。每个 reporter 在这里
  // 按来源分类 required/best-effort(见 `ReporterRegistration` 的字段注释):默认落盘的
  // artifacts、显式指定的 --json/--junit 是 agent/CI 读结果的唯一入口,写失败必须让
  // completion/退出码判红;用户 `config.reporters` 只是补充观测,失败只折成一条 diagnostic,
  // 不影响 completion。
  const reporters: ReporterRegistration[] = [];
  const artifacts = ArtifactsReporter();
  reporters.push({ reporter: artifacts, name: "artifacts", required: true });
  if (flags.junit) reporters.push({ reporter: JUnit(flags.junit), name: "junit", required: true, target: flags.junit });
  if (flags.json) reporters.push({ reporter: Json(flags.json), name: "json", required: true, target: flags.json });
  (config.reporters ?? []).forEach((reporter, i) => {
    reporters.push({ reporter, name: `config-reporter-${i}`, required: false });
  });

  let summary: RunSummary;
  try {
    summary = await runEvals({
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
  } catch (e) {
    // 真崩溃前先撤下 dashboard,不让半帧 ANSI 状态和下面 main().catch 打印的错误交织。
    await coordinator.stopDynamic();
    throw e;
  }

  // 正常返回(含被中断后走部分汇总)后再兜一刀:Scope finalizer 没停掉的残留沙箱在这里强清。
  // 跑顺利时登记表已空,是 no-op。
  await stopAllSandboxes();

  // completion 要先算好,--json/--junit 是否"这次真的写出"才有依据(见下)。
  const completion = assembleRunCompletion(coordinator.state);

  // --json/--junit 是正交机器出口,只在这次运行真的写出对应文件时才把路径交给 coordinator
  // (它转发给 ci renderer 打印独立的 json=/junit= 行,见 docs「CI 怎么用」)。判据是
  // completion.reporterErrors 里有没有这次 required reporter("json"/"junit")的失败记录——
  // 不能用 existsSync 探测磁盘:atomicWriteFile(json.ts)失败时原地保留上一次运行遗留的旧文件,
  // existsSync 只会看到"文件存在"就误判成这次写成功,把上一轮的陈旧内容当成本次结果打印出去。
  const jsonPath = flags.json && !completion.reporterErrors.some((e) => e.reporter === "json") ? flags.json : undefined;
  const junitPath =
    flags.junit && !completion.reporterErrors.some((e) => e.reporter === "junit") ? flags.junit : undefined;

  // agent 反馈闭环的入口:跑完直接给出每个已创建快照的目录,agent/ci 读 snapshot.json 与各
  // attempt 的 result.json / artifact(events/trace/diff),不必解析人类向的流式输出。相对 cwd
  // 的路径更友好;结果落在 cwd 外时(relative 路径以 .. 开头)原样打印绝对路径。打印本身由
  // renderer 的 "saved" 处理完成,这里只负责把路径交给 coordinator。
  const paths = artifacts.outputDirs().map(({ dir }) => {
    const rel = relative(cwd, dir);
    return rel && !rel.startsWith("..") ? rel : dir;
  });

  await coordinator.finish({ summary, completion, paths, json: jsonPath, junit: junitPath });

  // 退出码统一走 CompletionStatus 驱动的语义(interrupted → 130、incomplete/required reporter
  // 失败 → 1),不再只看 verdict 计数;三种 profile 共用同一套退出码,不是 ci 专属。failed/errored
  // 先按 (experiment, eval) 折叠再喂给 computeCiExitCode——它只认 RunSummary 原始字段,不知道
  // 「同一 eval 的重试轮不该重复计红」这条 eval 级判定规则(被 runs+earlyExit 重试吸收的失败,
  // 先挂一次、后来过了,不该把进程判红,否则 CI 判定与 evalLevelStats 报表口径不一致;
  // 见 memory 的 cli-exit-code-attempt-level-not-eval-level)。
  const foldedStats = evalLevelStats(summary.results, (r) => `${r.experimentId ?? ""}|${r.id}`);
  const exitCode = computeCiExitCode({ ...summary, failed: foldedStats.failed, errored: foldedStats.errored }, completion);
  process.exit(exitCode);
}

main().catch(async (e) => {
  process.stderr.write(t("cli.error", { error: formatThrown(e) }));
  // 真·崩溃路径也别留孤儿:强清还活着的沙箱(带超时),再退。
  await stopAllSandboxes();
  process.exit(2);
});
