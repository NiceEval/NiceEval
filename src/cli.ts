// fasteval CLI 入口。两类输入:位置参数选「哪些 eval」(id 前缀),flag 选「怎么跑」。
//   fasteval [pattern...]            发现并运行(默认 agent)
//   fasteval exp [组|配置] [pattern]  跑实验
//   fasteval list                    只列出发现到的 eval
//   fasteval clean                   删除 .fasteval/ 历史运行工件
//   fasteval --agent <name> ...

import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildRegistry, resolveAgent } from "./agents/registry.ts";
import { BUILTIN_AGENTS } from "./agents/builtin.ts";
import { discoverEvals, discoverExperiments, makeFilter } from "./runner/discover.ts";
import { runEvals, type AgentRun } from "./runner/run.ts";
import { Console as ConsoleReporter } from "./runner/reporters/console.ts";
import { Artifacts as ArtifactsReporter } from "./runner/reporters/artifacts.ts";
import { buildView, startViewServer } from "./view/index.ts";
import type { Config, DiscoveredExperiment, Reporter } from "./types.ts";

interface Flags {
  agent?: string;
  sandbox?: string;
  model?: string;
  runs?: number;
  maxConcurrency?: number;
  sandboxConcurrency?: number;
  timeout?: number;
  earlyExit?: boolean;
  dry: boolean;
  strict: boolean;
  quiet: boolean;
  open?: boolean;
  out?: string;
  port?: number;
}

const BOOL_FLAGS = new Set([
  "dry",
  "strict",
  "quiet",
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
  const flags: Flags = { dry: false, strict: false, quiet: false };
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
        else if (name === "strict") flags.strict = true;
        else if (name === "quiet") flags.quiet = true;
        continue;
      }
      const value = argv[++i];
      switch (name) {
        case "agent": flags.agent = value; break;
        case "sandbox": flags.sandbox = value; break;
        case "model": flags.model = value; break;
        case "runs": flags.runs = Number(value); break;
        case "max-concurrency": flags.maxConcurrency = Number(value); break;
        case "sandbox-concurrency": flags.sandboxConcurrency = Number(value); break;
        case "timeout": flags.timeout = Number(value); break;
        case "out": flags.out = value; break;
        case "port": flags.port = Number(value); break;
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
  const path = join(cwd, "fasteval.config.ts");
  if (!existsSync(path)) {
    throw new Error("找不到 fasteval.config.ts(请在项目根运行)。");
  }
  const mod = (await import(pathToFileURL(path).href)) as { default?: Config };
  if (!mod.default) throw new Error("fasteval.config.ts 需要 default export(defineConfig(...))。");
  return mod.default;
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
      const out = await buildView({ input: positionals[0], out: flags.out });
      process.stdout.write(`已导出实验查看页:${out}\n`);
      process.exit(0);
    }
    const server = await startViewServer({ input: positionals[0], port: flags.port });
    process.stdout.write(`fasteval view: ${server.url}\n`);
    if (flags.open !== false) {
      const opened = await openBrowser(server.url);
      if (!opened) process.stderr.write(`无法自动打开浏览器,请手动访问:${server.url}\n`);
    }
    process.stdout.write("按 Ctrl+C 退出。\n");
    await new Promise(() => {});
  }

  if (command === "clean") {
    await rm(join(cwd, ".fasteval"), { recursive: true, force: true });
    process.stdout.write("已删除 .fasteval/ 历史运行工件。\n");
    process.exit(0);
  }

  if (command === "init" || command === "watch") {
    process.stdout.write(`命令 "${command}" 暂未实现(MVP)。\n`);
    process.exit(0);
  }

  const config = await loadConfig(cwd);
  // 内置 agents 放前面;config.agents 同名的覆盖(registry 后写后赢)。
  const registry = buildRegistry([...BUILTIN_AGENTS, ...(config.agents ?? [])]);
  const evals = await discoverEvals(cwd);

  if (command === "list") {
    process.stdout.write(`发现 ${evals.length} 个 eval:\n`);
    for (const e of evals) process.stdout.write(`  ${e.id}${e.description ? `  — ${e.description}` : ""}\n`);
    process.exit(0);
  }

  const agentRuns: AgentRun[] = [];

  if (command === "exp") {
    const experiments = await discoverExperiments(cwd);
    const expArg = positionals[0];
    const extraPatterns = positionals.slice(1);
    const selected = expArg
      ? experiments.filter((e) => e.group === expArg || e.id === expArg || e.id.startsWith(expArg + "/"))
      : experiments;
    if (selected.length === 0) {
      process.stderr.write(`没有匹配的实验:${expArg ?? "(全部)"}。已发现:${experiments.map((e) => e.id).join(", ") || "(无)"}\n`);
      process.exit(1);
    }
    for (const exp of selected) {
      const models = exp.model === undefined ? [undefined] : Array.isArray(exp.model) ? exp.model : [exp.model];
      for (const m of models) {
        agentRuns.push({
          agent: exp.agent,
          model: m,
          flags: exp.flags ?? {},
          runs: flags.runs ?? exp.runs ?? 1,
          earlyExit: flags.earlyExit ?? exp.earlyExit ?? true,
          sandbox: flags.sandbox ?? exp.sandbox ?? config.sandbox,
          timeoutMs: flags.timeout ?? exp.timeoutMs ?? config.timeoutMs,
          budget: exp.budget,
          evalFilter: evalsFilterFromExperiment(exp.evals, extraPatterns),
          experimentId: exp.id,
          hooks: exp.hooks,
        });
      }
    }
  } else {
    // 给了 pattern 却匹配不到任何 eval:别静默跑 0 个。多半是把实验组/实验名当成了 eval
    // (例:`fasteval dev` 实为 run 命令 + pattern "dev")—— 明确报错并指路 `exp`。
    if (positionals.length > 0 && !evals.some((e) => makeFilter(positionals)(e.id))) {
      const experiments = await discoverExperiments(cwd);
      const asExp = experiments.filter((e) =>
        positionals.some((p) => e.group === p || e.id === p || e.id.startsWith(p + "/")),
      );
      process.stderr.write(`没有匹配的 eval:${positionals.join(" ")}。\n`);
      if (asExp.length > 0) {
        process.stderr.write(`提示:"${positionals[0]}" 是实验${asExp.length > 1 ? "组" : ""},你大概想跑:fasteval exp ${positionals[0]}\n`);
      } else {
        process.stderr.write(`已发现 ${evals.length} 个 eval:${evals.map((e) => e.id).join(", ") || "(无)"}\n`);
      }
      process.exit(1);
    }
    const agentName = flags.agent ?? config.defaultAgent;
    if (!agentName) {
      process.stderr.write("未指定 agent(用 --agent <name> 或 config.defaultAgent)。\n");
      process.exit(1);
    }
    agentRuns.push({
      agent: resolveAgent(registry, agentName),
      model: flags.model,
      flags: {},
      runs: flags.runs ?? 1,
      earlyExit: flags.earlyExit ?? true,
      sandbox: flags.sandbox ?? config.sandbox,
      timeoutMs: flags.timeout ?? config.timeoutMs,
      evalFilter: makeFilter(positionals),
    });
  }

  if (flags.dry) {
    process.stdout.write(`\n[dry] ${evals.length} 个 eval × ${agentRuns.length} 个运行配置:\n`);
    for (const run of agentRuns) {
      const matched = evals.filter((e) => run.evalFilter(e.id));
      const who = run.model ? `${run.agent.name}/${run.model}` : run.agent.name;
      process.stdout.write(`  ${who}${run.experimentId ? ` (exp ${run.experimentId})` : ""}: ${matched.map((e) => e.id).join(", ") || "(无匹配)"}  ×${run.runs}\n`);
    }
    process.exit(0);
  }

  const reporters: Reporter[] = [];
  if (!flags.quiet) reporters.push(ConsoleReporter());
  reporters.push(ArtifactsReporter());
  reporters.push(...(config.reporters ?? []));

  // Ctrl+C / kill:abort 这个 controller → runEvals 把它喂给 Effect.runPromise 的 signal,
  // 触发根 fiber 中断 → 每个 attempt 的 Scope 跑 release → 所有容器 stop()(治孤儿容器)。
  // 第二次信号则直接硬退出,不再等 graceful 清理。
  const ctrl = new AbortController();
  let aborting = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      if (aborting) process.exit(130); // 第二次:不耐烦了,硬退
      aborting = true;
      process.stderr.write("\n收到中断,正在清理沙箱容器…(再按一次强制退出)\n");
      ctrl.abort();
    });
  }

  const summary = await runEvals({
    config,
    evals,
    agentRuns,
    reporters,
    maxConcurrency: flags.maxConcurrency ?? config.maxConcurrency ?? 4,
    sandboxConcurrency: flags.sandboxConcurrency ?? config.sandboxConcurrency,
    signal: ctrl.signal,
  });

  const failedExit = summary.failed > 0 || (flags.strict && summary.scored > 0);
  process.exit(failedExit ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`fasteval 出错:${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(2);
});
