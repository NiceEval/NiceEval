// niceeval CLI 入口。执行 eval 必须以 experiment 为单位;位置参数只在 exp 后筛 eval id 前缀。
//   niceeval exp [组|配置] [pattern]  跑实验
//   niceeval list                    只列出发现到的 eval
//   niceeval clean                   删除 .niceeval/ 历史运行工件

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverEvals, discoverExperiments, makeFilter } from "./runner/discover.ts";
import { runEvals, type AgentRun } from "./runner/run.ts";
import { stopAllSandboxes, liveSandboxCount } from "./sandbox/registry.ts";
import { sandboxRecommendedConcurrency } from "./sandbox/resolve.ts";
import { Console as ConsoleReporter } from "./runner/reporters/console.ts";
import { JUnit } from "./runner/reporters/json.ts";
import { Live as LiveReporter, type LiveRow } from "./runner/reporters/live.ts";
import { Artifacts as ArtifactsReporter } from "./runner/reporters/artifacts.ts";
import { buildView, startViewServer, loadMostRecentResults, IncompatibleResultsError } from "./view/index.ts";
import { t } from "./i18n/index.ts";
import type { Config, DiscoveredExperiment, Reporter } from "./types.ts";

/** `niceeval view <summary.json>` 指向版本不同的报告时:打印 npx 提示后退出,不抛堆栈。 */
function exitOnIncompatibleResults(e: unknown): never {
  if (e instanceof IncompatibleResultsError) {
    process.stderr.write(e.message);
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
  open?: boolean;
  out?: string;
  port?: number;
}

const BOOL_FLAGS = new Set([
  "dry",
  "quiet",
  "force",
  "strict",
  "early-exit",
  "no-early-exit",
  "open",
  "no-open",
  "force",
  "watch",
  "json",
]);

function parseArgs(argv: string[]): { command: string; positionals: string[]; flags: Flags } {
  if (argv[0] === "--") argv = argv.slice(1);
  const positionals: string[] = [];
  const flags: Flags = { dry: false, quiet: false, force: false, strict: false };
  let command = "run";
  let i = 0;

  // 第一个非 flag token 若是已知命令,则为命令
  const commands = new Set(["exp", "list", "view", "clean", "init", "watch", "run"]);
  if (argv[0] && !argv[0].startsWith("-") && commands.has(argv[0])) {
    command = argv[0];
    i = 1;
  }

  for (; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok.startsWith("--")) {
      const name = tok.slice(2);
      if (name === "no-early-exit") {
        flags.earlyExit = false;
        continue;
      }
      if (name === "early-exit") {
        flags.earlyExit = true;
        continue;
      }
      if (name === "no-open") {
        flags.open = false;
        continue;
      }
      if (name === "open") {
        flags.open = true;
        continue;
      }
      if (BOOL_FLAGS.has(name)) {
        if (name === "dry") flags.dry = true;
        else if (name === "quiet") flags.quiet = true;
        else if (name === "force") flags.force = true;
        else if (name === "strict") flags.strict = true;
        continue;
      }
      const value = argv[++i];
      switch (name) {
        case "agent": flags.agent = value; break;
        case "model": flags.model = value; break;
        case "runs": flags.runs = Number(value); break;
        case "max-concurrency": flags.maxConcurrency = Number(value); break;
case "timeout": flags.timeout = Number(value); break;
        case "budget": flags.budget = Number(value); break;
        case "tag": flags.tag = value; break;
        case "junit": flags.junit = value; break;
        case "out": flags.out = value; break;
        case "port": flags.port = Number(value); break;
        case "sandbox":
          process.stderr.write(t("cli.sandboxFlagRemoved"));
          process.exit(1);
          break;
        default: break; // 未知 flag 忽略
      }
    } else {
      positionals.push(tok);
    }
  }
  return { command, positionals, flags };
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

async function main(): Promise<void> {
  const cwd = process.cwd();
  await loadDotenv(cwd);
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));

  if (command === "view") {
    if (flags.out) {
      const out = await buildView({ input: positionals[0], out: flags.out }).catch(exitOnIncompatibleResults);
      process.stdout.write(t("cli.view.exported", { out }));
      process.exit(0);
    }
    const server = await startViewServer({ input: positionals[0], port: flags.port }).catch(exitOnIncompatibleResults);
    process.stdout.write(t("cli.view.url", { url: server.url }));
    if (flags.open !== false) {
      const opened = await openBrowser(server.url);
      if (!opened) process.stderr.write(t("cli.browserOpenFailed", { url: server.url }));
    }
    process.stdout.write(t("cli.pressCtrlC"));
    await new Promise(() => {});
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
  let expMaxConcurrency: number | undefined;

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
        flags: exp.flags ?? {},
        runs: flags.runs ?? exp.runs ?? 1,
        earlyExit: flags.earlyExit ?? exp.earlyExit ?? true,
        sandbox: exp.sandbox ?? config.sandbox,
        timeoutMs: flags.timeout ?? exp.timeoutMs ?? config.timeoutMs,
        budget: flags.budget ?? exp.budget,
        evalFilter: evalsFilterFromExperiment(exp.evals, extraPatterns),
        experimentId: exp.id,
        strict: flags.strict,
      });
    }
    const vals = selected.map((e) => e.maxConcurrency).filter((v): v is number => v !== undefined);
    if (vals.length > 0) expMaxConcurrency = Math.min(...vals);
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
        const who = agentRun.model
          ? `${agentRun.agent.name}/${agentRun.model}`
          : agentRun.agent.name;
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
  reporters.push(ArtifactsReporter());
  if (flags.junit) reporters.push(JUnit(flags.junit));
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

  const priorResults = flags.force ? undefined : await loadMostRecentResults(join(cwd, ".niceeval"));

  const summary = await runEvals({
    config,
    evals,
    agentRuns,
    reporters,
    maxConcurrency: flags.maxConcurrency ?? expMaxConcurrency ?? config.maxConcurrency ?? sandboxDefaultConcurrency,
    signal: ctrl.signal,
    onProgress,
    priorResults,
  });

  // 正常返回(含被中断后走部分汇总)后再兜一刀:Scope finalizer 没停掉的残留沙箱在这里强清。
  // 跑顺利时登记表已空,是 no-op。
  await stopAllSandboxes();

  const failedExit = summary.failed > 0 || summary.errored > 0;
  process.exit(failedExit ? 1 : 0);
}

main().catch(async (e) => {
  process.stderr.write(t("cli.error", { error: e instanceof Error ? e.stack ?? e.message : String(e) }));
  // 真·崩溃路径也别留孤儿:强清还活着的沙箱(带超时),再退。
  await stopAllSandboxes();
  process.exit(2);
});
