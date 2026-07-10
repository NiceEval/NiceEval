// niceeval CLI 入口。执行 eval 必须以 experiment 为单位;位置参数只在 exp 后筛 eval id 前缀。
//   niceeval exp [组|配置] [pattern]  跑实验
//   niceeval show [pattern]          终端读结果:榜单 / 单 eval / 证据切面 / 时间轴 / --report
//   niceeval list                    只列出发现到的 eval
//   niceeval clean                   删除 .niceeval/ 历史运行工件

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs as nodeParseArgs } from "node:util";
import { discoverEvals, discoverExperiments, makeFilter } from "./runner/discover.ts";
import { runEvals, type AgentRun } from "./runner/run.ts";
import { runWho } from "./runner/types.ts";
import { stopAllSandboxes, liveSandboxCount } from "./sandbox/registry.ts";
import { evalLevelStats } from "./shared/outcome.ts";
import { sandboxRecommendedConcurrency } from "./sandbox/resolve.ts";
import { Console as ConsoleReporter } from "./runner/reporters/console.ts";
import { Json, JUnit } from "./runner/reporters/json.ts";
import { Live as LiveReporter, type LiveRow } from "./runner/reporters/live.ts";
import { Artifacts as ArtifactsReporter } from "./runner/reporters/artifacts.ts";
import {
  buildView,
  startViewServer,
  loadLatestResultsPerEval,
  resolveViewInput,
  IncompatibleResultsError,
  ViewInputError,
} from "./view/index.ts";
import { ReportLoadError } from "./report/load.ts";
import { runShow } from "./show/index.ts";
import { t } from "./i18n/index.ts";
import { formatThrown, upsertManagedBlock } from "./util.ts";
import type { Config, DiscoveredExperiment, Reporter } from "./types.ts";

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
  quiet: boolean;
  force: boolean;
  strict: boolean;
  budget?: number;
  tag?: string;
  junit?: string;
  json?: string;
  open?: boolean;
  out?: string;
  port?: number;
  latest?: boolean;
  help: boolean;
  version: boolean;
  // ── show 专属(位置参数仍是 eval id 前缀;这些 flag 选「怎么看」)──
  transcript: boolean;
  trace: boolean;
  diff: boolean;
  /** --diff=<路径>(必须 = 连写;空格形式会把路径当 eval id 前缀,按文档如此)。 */
  diffPath?: string;
  history: boolean;
  experiment?: string;
  attempt?: number;
  run?: string;
  report?: string;
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
  /** `view` 命令专用:证据室只带每个实验最新一份快照(发布口径,静态导出体积不随结果历史增长);缺省带全量历史,深链可达一切。 */
  latest: { type: "boolean" },
  // show 的证据切面 / 时间轴 / 报告装载(docs-site/zh/guides/viewing-results.mdx)。
  /** `show` 命令专用:渲染单个 eval 的完整对话与工具调用(证据切面)。 */
  transcript: { type: "boolean" },
  /** `show` 命令专用:渲染单个 eval 的 trace 瀑布文本版(证据切面)。 */
  trace: { type: "boolean" },
  // --diff 是布尔;--diff=<路径> 在 parseArgs 前预扫成 diffPath(路径必须 = 连写,
  // 空格形式的下一个 token 仍是位置参数 = eval id 前缀,与文档一致)。
  /** `show` 命令专用:sandbox 里的文件改动摘要;`--diff=<文件路径>` 看单个文件的完整改动(路径必须 `=` 连写)。 */
  diff: { type: "boolean" },
  /** `show` 命令专用:跨 run 时间轴,只列真实执行;与 `--report` 互斥。 */
  history: { type: "boolean" },
  /** `show` / `view` 命令专用:选集只留该实验。 */
  experiment: { type: "string" },
  /** `show` 命令专用:指定详情 / 证据切面看第几次 attempt(与展示一致的 1 计序号)。 */
  attempt: { type: "string" },
  /** `show` / `view` 命令专用:钉死看某一个结果目录(历史 run 或 `copySnapshots` 产物)。 */
  run: { type: "string" },
  /** `show` / `view` 命令专用:把默认榜单整槽换成你的报告文件(默认导出 `defineReport(...)`)。 */
  report: { type: "string" },
  /** 只打印本次会匹配到的 eval × 运行配置,不实际执行。 */
  dry: { type: "boolean" },
  /** 关闭控制台 / live 进度输出(reporter 仍会写 artifacts)。 */
  quiet: { type: "boolean" },
  /** 忽略上次运行结果,不跳过已通过的 (experiment, eval) 组合,强制全部重跑。 */
  force: { type: "boolean" },
  /** CI 中推荐使用:让软阈值(`soft`)失败也计入整条 eval 的 outcome。 */
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

function parseArgs(argv: string[]): { command: string; positionals: string[]; flags: Flags } {
  if (argv[0] === "--") argv = argv.slice(1);

  // --diff=<路径> 预扫:diff 本体是布尔(裸 --diff = 文件级摘要),路径只接受 = 连写。
  let diffPath: string | undefined;
  argv = argv.map((arg) => {
    if (arg.startsWith("--diff=")) {
      const path = arg.slice("--diff=".length);
      if (path) diffPath = path;
      return "--diff";
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
  const commands = new Set(["exp", "show", "list", "view", "clean", "init", "watch", "run"]);
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
    latest: values.latest === true,
    dry: values.dry === true,
    quiet: values.quiet === true,
    force: values.force === true,
    strict: values.strict === true,
    earlyExit: values["no-early-exit"] === true ? false : values["early-exit"] === true ? true : undefined,
    open: values["no-open"] === true ? false : values.open === true ? true : undefined,
    help: values.help === true,
    version: values.version === true,
    transcript: values.transcript === true,
    trace: values.trace === true,
    diff: values.diff === true && diffPath === undefined,
    diffPath,
    history: values.history === true,
    experiment: values.experiment as string | undefined,
    attempt: numberFlag("attempt", values.attempt as string | undefined),
    run: values.run as string | undefined,
    report: values.report as string | undefined,
  };
  return { command, positionals, flags };
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
  "Its APIs and conventions may differ from anything you have seen. Read the relevant",
  "guide in `node_modules/niceeval/docs-site/zh/` before writing any eval, experiment,",
  "adapter, or niceeval config. The bundled docs are Chinese-only — that is the single",
  "authoritative, always-current version; read it regardless of your working language.",
  "After a run, drill into failures with `niceeval show <eval id>` (add `--transcript` /",
  "`--trace` / `--diff` for evidence); the `summary.json` path the CLI prints and the",
  "artifact files it references are the structured source of truth.",
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
  if (Array.isArray(evals)) expFilter = (id) => evals.includes(id) || evals.some((e) => id.startsWith(e + "/"));
  else if (typeof evals === "function") expFilter = evals;
  return (id) => expFilter(id) && patternFilter(id);
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
    // 位置参数 = eval id 前缀(收窄报告槽选集);存在的文件路径 = 单文件模式;
    // 结果目录经 --run 递入;--report 整槽替换报告槽(与 show --report 吃同一个文件)。
    let viewInput: { input?: string; patterns: string[] };
    try {
      viewInput = resolveViewInput(cwd, positionals, flags.run);
    } catch (e) {
      exitOnViewUserError(e);
    }
    const scan = {
      patterns: viewInput.patterns,
      ...(flags.latest ? { latest: true } : {}),
      ...(flags.experiment !== undefined ? { experiment: flags.experiment } : {}),
      ...(flags.report !== undefined ? { report: { path: flags.report, cwd } } : {}),
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

  if (command === "show") {
    // show 不依赖 niceeval.config.ts:读的是 .niceeval/(或 --run 指定目录)的落盘结果。
    const code = await runShow(cwd, positionals, {
      transcript: flags.transcript,
      trace: flags.trace,
      diff: flags.diff,
      diffPath: flags.diffPath,
      history: flags.history,
      experiment: flags.experiment,
      attempt: flags.attempt,
      run: flags.run,
      report: flags.report,
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

  if (command === "exp") {
    if (flags.agent || flags.model) {
      process.stderr.write(t("cli.exp.agentModelFlagUnsupported"));
      process.exit(1);
    }
    const experiments = await discoverExperiments(cwd);
    const expArg = positionals[0];
    const extraPatterns = positionals.slice(1);
    const selected = expArg
      ? experiments.filter((e) => e.group === expArg || e.id === expArg || e.id.startsWith(expArg + "/"))
      : experiments;
    if (selected.length === 0) {
      process.stderr.write(t("cli.experiment.noMatch", {
        arg: expArg ?? t("cli.all"),
        experiments: experiments.map((e) => e.id).join(", ") || t("cli.none"),
      }));
      process.exit(1);
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
        strict: flags.strict,
        // 实验级并发上限:随 AgentRun 进调度器按实验单独限流(runner 两级信号量),
        // 不再取所有选中实验的最小值钳全局——那会让一个串行实验拖慢整批基线。
        maxConcurrency: exp.maxConcurrency,
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

  if (flags.dry) {
    process.stdout.write(t("cli.dry.header", { evals: evals.length, configs: agentRuns.length }));
    for (const run of agentRuns) {
      const matched = evals.filter((e) => run.evalFilter(e.id));
      const who = run.model ? `${run.agent.name}/${run.model}` : run.agent.name;
      process.stdout.write(t("cli.dry.row", {
        who,
        experiment: run.experimentId ? ` (exp ${run.experimentId})` : "",
        evals: matched.map((e) => e.id).join(", ") || t("cli.dry.noMatches"),
        runs: run.runs,
      }));
    }
    process.exit(0);
  }

  const reporters: Reporter[] = [];
  let onProgress: ((evalId: string, who: string, msg: string) => void) | undefined;

  if (!flags.quiet) {
    if (process.stderr.isTTY) {
      // TTY 模式:用 live display 替换 Console reporter,把 attempt log 路由到状态表行尾
      const liveRows: LiveRow[] = [];
      for (const agentRun of agentRuns) {
        // who 必须与 attempt.ts 的进度上报同源(runWho):曾用 agent/model,同 agent 同 model
        // 的实验变体(xxx 与 xxx--agents-md)会被折叠成一行,0/2 看起来像同一 eval 跑两次。
        const who = runWho(agentRun);
        const matched = evals.filter((e) => agentRun.evalFilter(e.id));
        for (const evalDef of matched) {
          liveRows.push({ evalId: evalDef.id, who, total: agentRun.runs });
        }
      }
      const totalAttempts = liveRows.reduce((s, r) => s + r.total, 0);
      const live = LiveReporter(liveRows, totalAttempts);
      reporters.push(live);
      onProgress = (evalId, who, msg) => live.progress(evalId, who, msg);
    } else {
      reporters.push(ConsoleReporter());
    }
  }
  const artifacts = ArtifactsReporter();
  reporters.push(artifacts);
  if (flags.junit) reporters.push(JUnit(flags.junit));
  if (flags.json) reporters.push(Json(flags.json));
  reporters.push(...(config.reporters ?? []));

  // Ctrl+C / kill 的三级响应,核心目标:任何情况下都不留下孤儿沙箱。
  //   1 次:abort controller → runEvals 把它喂给 Effect signal → 各 attempt 的 Scope 跑 release
  //         停容器(graceful)。同时起一个看门狗:graceful 若迟迟不收口(如 vsb.stop() 挂),
  //         到点直接走兜底强清,不干等。
  //   2 次:用户等不及 —— 立刻兜底强清(带超时)再退,而不是裸 process.exit 把进程连同
  //         在飞的 stop 一起杀掉(那正是之前漏掉孤儿的根因)。
  //   3 次:真不耐烦了,硬退(此时多半已无可清理的)。
  const ctrl = new AbortController();
  let signalCount = 0;
  // 兜底强清 + 退出:只跑一次,带超时(stopAllSandboxes 内每个 stop 各自有超时)。
  let forcing = false;
  const forceCleanupAndExit = (code: number) => {
    if (forcing) return;
    forcing = true;
    void stopAllSandboxes().finally(() => process.exit(code));
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      signalCount += 1;
      if (signalCount === 1) {
        process.stderr.write(t("cli.interruptCleanup"));
        ctrl.abort();
        // 看门狗:graceful 清理 12s 还没让进程自己收口,就强清兜底。
        setTimeout(() => {
          if (liveSandboxCount() > 0) {
            process.stderr.write(t("cli.fallbackCleanupTimeout"));
            forceCleanupAndExit(130);
          }
        }, 12_000).unref();
      } else if (signalCount === 2) {
        process.stderr.write(t("cli.forceCleanupExit"));
        forceCleanupAndExit(130);
      } else {
        process.exit(130); // 第三次:硬退
      }
    });
  }

  // 无全局默认:并发上限由 sandbox 后端的推荐值决定。
  // 多个 agentRun 各有 sandbox 时取最小值(最保守的后端决定上限)。
  const sandboxRecs = agentRuns.map((r) => sandboxRecommendedConcurrency(r.sandbox));
  const sandboxDefaultConcurrency = sandboxRecs.length > 0 ? Math.min(...sandboxRecs) : 10;

  const priorResults = flags.force ? undefined : await loadLatestResultsPerEval(join(cwd, ".niceeval"));

  const summary = await runEvals({
    config,
    evals,
    agentRuns,
    reporters,
    maxConcurrency:
      flags.maxConcurrency ??
      envNumber("NICEEVAL_MAX_CONCURRENCY") ??
      config.maxConcurrency ??
      sandboxDefaultConcurrency,
    signal: ctrl.signal,
    onProgress,
    priorResults,
  });

  // 正常返回(含被中断后走部分汇总)后再兜一刀:Scope finalizer 没停掉的残留沙箱在这里强清。
  // 跑顺利时登记表已空,是 no-op。
  await stopAllSandboxes();

  // agent 反馈闭环的入口:跑完直接给出结构化结果路径,agent 读 summary.json 与各
  // attempt 的工件(events/trace/diff),不必解析人类向的流式输出。--quiet 下也输出。
  if (artifacts.outputDir()) {
    process.stdout.write(t("cli.resultsPath", { path: join(artifacts.outputDir(), "summary.json") }));
  }

  // 退出码按 eval 级判决,不按 attempt:summary.failed/errored 统计的是每次 attempt,
  // 被 runs+earlyExit 重试吸收的失败(先挂一次、后来过了)不该把进程判红——否则
  // 「runs 吸收单次抖动」在 CI 退出码这层永远不成立。折叠口径与报表/view 共用
  // foldEvalOutcome(任一轮通过 → 该 eval 通过),粒度 experimentId|eval id。
  const stats = evalLevelStats(summary.results, (r) => `${r.experimentId ?? ""}|${r.id}`);
  const failedExit = stats.failed > 0 || stats.errored > 0;
  process.exit(failedExit ? 1 : 0);
}

main().catch(async (e) => {
  process.stderr.write(t("cli.error", { error: formatThrown(e) }));
  // 真·崩溃路径也别留孤儿:强清还活着的沙箱(带超时),再退。
  await stopAllSandboxes();
  process.exit(2);
});
