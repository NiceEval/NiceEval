// 运行器:发现产出的 eval × agent × runs → attempt,有界并发调度,把每个 attempt
// 跑成一个 EvalResult。沙箱编排的固定段在这里(起沙箱→上传→基线→setup→驱动 agent→
// 采 diff→跑脚本→评分→判决→停沙箱),adapter 只填「把 agent 跑起来」一段。

import { resolve as resolvePath } from "node:path";
import { createSandbox } from "../sandbox/resolve.ts";
import { createEvalContext } from "../context/context.ts";
import { EvalRequirementFailed, EvalSkipped, TurnFailed } from "../context/control-flow.ts";
import { computeVerdict } from "../scoring/verdict.ts";
import { deriveRunFacts } from "../o11y/derive.ts";
import { buildO11ySummary } from "../o11y/derive.ts";
import {
  captureGeneratedFiles,
  collectWorkspaceFiles,
  initGitAndCommit,
  isDirectory,
} from "./sandbox-prep.ts";
import { estimateCost } from "./pricing.ts";
import type {
  Agent,
  Config,
  DiscoveredEval,
  EvalResult,
  JudgeConfig,
  Reporter,
  RunSummary,
  Sandbox,
  ScoringContext,
  ScriptResult,
  Verdict,
} from "../types.ts";

/** 一个 (agent, model, flags) 的运行配置 —— 由 CLI / 实验展开。 */
export interface AgentRun {
  agent: Agent;
  model?: string;
  flags: Record<string, unknown>;
  runs: number;
  earlyExit: boolean;
  sandbox?: string;
  timeoutMs?: number;
  budget?: number;
  evalFilter: (id: string) => boolean;
  experimentId?: string;
}

export interface RunOptions {
  config: Config;
  evals: DiscoveredEval[];
  agentRuns: AgentRun[];
  reporters: Reporter[];
  maxConcurrency: number;
  signal?: AbortSignal;
}

interface Attempt {
  evalDef: DiscoveredEval;
  run: AgentRun;
  attempt: number;
  key: string; // agent+model+evalId,用于早停
}

export async function runEvals(opts: RunOptions): Promise<RunSummary> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // 展开 attempts
  const attempts: Attempt[] = [];
  for (const run of opts.agentRuns) {
    const evals = opts.evals.filter((e) => run.evalFilter(e.id));
    for (const evalDef of evals) {
      const key = `${run.agent.name}|${run.model ?? ""}|${evalDef.id}`;
      for (let i = 0; i < run.runs; i++) {
        attempts.push({ evalDef, run, attempt: i, key });
      }
    }
  }

  const firstAgent = opts.agentRuns[0]?.agent;
  for (const r of opts.reporters) {
    await r.onRunStart?.(opts.evals.map((e) => ({ id: e.id })), firstAgent as Agent);
  }

  const results: EvalResult[] = [];
  const passedKeys = new Set<string>();
  let reportQueue: Promise<unknown> = Promise.resolve();

  const queue = [...attempts];
  const inFlight = new Set<Promise<void>>();

  const launch = (a: Attempt): Promise<void> => {
    const p = (async () => {
      // 早停:同 key 已通过且开了 earlyExit → 跳过
      if (a.run.earlyExit && passedKeys.has(a.key)) return;
      const result = await runAttempt(a, opts.config, opts.signal);
      results.push(result);
      if (result.verdict === "passed") passedKeys.add(a.key);
      reportQueue = reportQueue.then(() =>
        Promise.all(opts.reporters.map((r) => r.onEvalComplete?.(result))),
      );
    })().finally(() => {
      inFlight.delete(p);
    });
    inFlight.add(p);
    return p;
  };

  while (queue.length || inFlight.size) {
    while (queue.length && inFlight.size < opts.maxConcurrency) {
      launch(queue.shift()!);
    }
    if (inFlight.size) await Promise.race(inFlight);
  }
  await reportQueue;

  // 稳定排序:按发现顺序 + attempt
  const order = new Map(opts.evals.map((e, i) => [e.id, i]));
  results.sort(
    (a, b) =>
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) ||
      a.agent.localeCompare(b.agent) ||
      a.attempt - b.attempt,
  );

  const summary = summarize(results, firstAgent?.name ?? "", startedAt, Date.now() - t0);
  reportQueue = Promise.resolve();
  for (const r of opts.reporters) await r.onRunComplete?.(summary);
  return summary;
}

function summarize(
  results: EvalResult[],
  agent: string,
  startedAt: string,
  durationMs: number,
): RunSummary {
  const counts = { passed: 0, failed: 0, scored: 0, skipped: 0, errored: 0 };
  let inTok = 0;
  let outTok = 0;
  let cost = 0;
  for (const r of results) {
    counts[r.verdict] += 1;
    if (r.error) counts.errored += 1;
    inTok += r.usage?.inputTokens ?? 0;
    outTok += r.usage?.outputTokens ?? 0;
    cost += r.estimatedCostUSD ?? 0;
  }
  return {
    agent,
    startedAt,
    completedAt: new Date().toISOString(),
    passed: counts.passed,
    failed: counts.failed,
    scored: counts.scored,
    skipped: counts.skipped,
    errored: counts.errored,
    durationMs,
    usage: { inputTokens: inTok, outputTokens: outTok },
    estimatedCostUSD: cost || undefined,
    results,
  };
}

async function runAttempt(
  a: Attempt,
  config: Config,
  parentSignal?: AbortSignal,
): Promise<EvalResult> {
  const { evalDef, run, attempt } = a;
  const t0 = Date.now();
  const timeoutMs = run.timeoutMs ?? evalDef.timeoutMs ?? config.timeoutMs ?? 600_000;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;

  const base: EvalResult = {
    id: evalDef.id,
    agent: run.agent.name,
    model: run.model,
    verdict: "failed",
    attempt,
    durationMs: 0,
    assertions: [],
  };

  if (run.agent.kind !== "sandbox") {
    return { ...base, error: `runner 暂只支持沙箱型 agent(收到 ${run.agent.kind})` };
  }

  let sandbox: Sandbox | undefined;
  try {
    sandbox = await createSandbox({
      backend: run.sandbox ?? config.sandbox,
      timeout: timeoutMs,
      runtime: "node24",
    });

    // 上传 workspace + git 基线
    const wsDir = await resolveWorkspace(evalDef, config);
    if (wsDir) {
      const files = await collectWorkspaceFiles(wsDir);
      await sandbox.uploadFiles(files);
    }
    await initGitAndCommit(sandbox);

    // eval 级 setup(starter prep:npm install 等)
    if (evalDef.setup) {
      await evalDef.setup(sandbox);
    }

    // 构造 t,跑 test
    const judge = resolveJudge(evalDef.judge, config.judge);
    const { context, state } = createEvalContext({
      agent: run.agent,
      sandbox,
      model: run.model,
      flags: run.flags,
      shared: {},
      signal,
      log: () => {},
      judge,
    });

    let error: string | undefined;
    let skipReason: string | undefined;
    try {
      await evalDef.test(context);
    } catch (e) {
      if (e instanceof EvalSkipped) skipReason = e.reason;
      else if (e instanceof EvalRequirementFailed) {
        /* 断言已记录,非执行错误 */
      } else if (e instanceof TurnFailed) {
        error = e.message;
      } else {
        error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
    }

    // 采 diff(脚本如 next build 在采集后才跑,避免 .next 污染 diff)
    const diff = skipReason ? { generatedFiles: {}, deletedFiles: [] } : await captureGeneratedFiles(sandbox);
    state.late.diff = diff;

    // 跑 test 请求过的脚本
    const scripts: Record<string, ScriptResult> = {};
    if (!skipReason) {
      for (const s of state.requestedScripts) {
        const r = await sandbox.runCommand("npm", ["run", s]);
        scripts[s] = { success: r.exitCode === 0, output: tail(r.stdout + r.stderr) };
      }
      if (state.needsVitest) {
        const r = await sandbox.runCommand("npx", ["vitest", "run", "EVAL.ts"]);
        scripts.__vitest__ = { success: r.exitCode === 0, output: tail(r.stdout + r.stderr) };
      }
    }
    state.late.scripts = scripts;

    // 评分
    const events = state.manager.allEvents;
    const usage = state.manager.usage;
    const facts = deriveRunFacts(events);
    const scoringContext: ScoringContext = {
      events,
      facts,
      diff,
      scripts,
      usage,
      status: state.manager.lastStatus,
      readFile: async (path) => {
        try {
          return await sandbox!.readFile(path);
        } catch {
          return undefined;
        }
      },
    };
    const assertions = skipReason ? [] : await state.collector.finalize(scoringContext);
    const verdict: Verdict = computeVerdict({ error, assertions, skipReason });

    const durationMs = Date.now() - t0;
    const o11y = buildO11ySummary(events, usage, durationMs);
    const cost = estimateCost(usage, run.model, config.pricing);
    if (cost !== undefined) o11y.estimatedCostUSD = cost;

    return {
      id: evalDef.id,
      agent: run.agent.name,
      model: run.model,
      verdict,
      attempt,
      durationMs,
      assertions,
      usage,
      estimatedCostUSD: cost,
      error,
      skipReason,
      events,
      o11y,
      diff,
    };
  } catch (e) {
    return {
      ...base,
      durationMs: Date.now() - t0,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  } finally {
    if (sandbox) await sandbox.stop().catch(() => {});
  }
}

async function resolveWorkspace(
  evalDef: DiscoveredEval,
  config: Config,
): Promise<string | undefined> {
  const ws = evalDef.workspace ?? config.workspace;
  if (!ws) return undefined;
  const abs = resolvePath(process.cwd(), ws);
  return (await isDirectory(abs)) ? abs : undefined;
}

function resolveJudge(
  evalJudge: JudgeConfig | undefined,
  configJudge: JudgeConfig | undefined,
): JudgeConfig | undefined {
  return evalJudge ?? configJudge;
}

function tail(s: string, lines = 40): string {
  return s.trim().split("\n").slice(-lines).join("\n");
}
