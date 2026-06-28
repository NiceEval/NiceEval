// fastevals CLI 入口。两类输入:位置参数选「哪些 eval」(id 前缀),flag 选「怎么跑」。
//   fastevals [pattern...]            发现并运行(默认 agent)
//   fastevals exp [组|配置] [pattern]  跑实验
//   fastevals list                    只列出发现到的 eval
//   fastevals --agent <name> ...

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildRegistry, resolveAgent } from "./agents/registry.ts";
import { discoverEvals, discoverExperiments, makeFilter } from "./runner/discover.ts";
import { runEvals, type AgentRun } from "./runner/run.ts";
import { Console as ConsoleReporter } from "./runner/reporters/console.ts";
import type { Config, DiscoveredExperiment, Reporter } from "./types.ts";

interface Flags {
  agent?: string;
  sandbox?: string;
  model?: string;
  runs?: number;
  maxConcurrency?: number;
  timeout?: number;
  earlyExit?: boolean;
  dry: boolean;
  strict: boolean;
  quiet: boolean;
}

const BOOL_FLAGS = new Set(["dry", "strict", "quiet", "early-exit", "no-early-exit", "force", "watch", "json"]);

function parseArgs(argv: string[]): { command: string; positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = { dry: false, strict: false, quiet: false };
  let command = "run";
  let i = 0;

  // 第一个非 flag token 若是已知命令,则为命令
  const commands = new Set(["exp", "list", "view", "init", "watch", "run"]);
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
        case "timeout": flags.timeout = Number(value); break;
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
  const path = join(cwd, "fastevals.config.ts");
  if (!existsSync(path)) {
    throw new Error("找不到 fastevals.config.ts(请在项目根运行)。");
  }
  const mod = (await import(pathToFileURL(path).href)) as { default?: Config };
  if (!mod.default) throw new Error("fastevals.config.ts 需要 default export(defineConfig(...))。");
  return mod.default;
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

  if (command === "view" || command === "init" || command === "watch") {
    process.stdout.write(`命令 "${command}" 暂未实现(MVP)。\n`);
    process.exit(0);
  }

  const config = await loadConfig(cwd);
  const registry = buildRegistry(config.agents ?? []);
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
      const agents = Array.isArray(exp.agent) ? exp.agent : [exp.agent];
      const models = exp.model === undefined ? [undefined] : Array.isArray(exp.model) ? exp.model : [exp.model];
      for (const an of agents) {
        for (const m of models) {
          agentRuns.push({
            agent: resolveAgent(registry, an),
            model: m,
            flags: exp.flags ?? {},
            runs: flags.runs ?? exp.runs ?? 1,
            earlyExit: flags.earlyExit ?? exp.earlyExit ?? true,
            sandbox: flags.sandbox ?? exp.sandbox ?? config.sandbox,
            timeoutMs: flags.timeout ?? exp.timeoutMs ?? config.timeoutMs,
            budget: exp.budget,
            evalFilter: evalsFilterFromExperiment(exp.evals, extraPatterns),
            experimentId: exp.id,
          });
        }
      }
    }
  } else {
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
  reporters.push(...(config.reporters ?? []));

  const summary = await runEvals({
    config,
    evals,
    agentRuns,
    reporters,
    maxConcurrency: flags.maxConcurrency ?? config.maxConcurrency ?? 4,
  });

  const failedExit = summary.failed > 0 || (flags.strict && summary.scored > 0);
  process.exit(failedExit ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`fastevals 出错:${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(2);
});
