// Braintrust 报告器:把一次 niceeval 运行作为一个 Braintrust experiment 上报,
// 每个 attempt 一行(scores = 断言,metrics = 时长/token/成本),跨提交比较与团队共享。
// `braintrust` 是可选依赖:动态 import,装了才用得上,没装在 onInvocationStart 报错
// (reporter 错误按框架约定只记 diagnostic,不会让运行崩)。

import type { EvalResult, JsonValue, Reporter } from "../../types.ts";
import { attemptTerminalOf, factRecordOf, scoreOutcomeOf, verdictForTerminal } from "../../record/fact-record.ts";
import { reportActivity } from "../feedback/sink.ts";

export interface BraintrustConfig {
  /** Braintrust 项目名;省略时用 "niceeval"。 */
  project?: string;
  /** Braintrust 项目 id;与 project 给一个即可。 */
  projectId?: string;
  /** 实验名;省略时由 Braintrust 自动命名。 */
  experiment?: string;
  /** 作为对比基线(diff base)的既有实验名。 */
  baseExperiment?: string;
  /** 作为对比基线(diff base)的既有实验 id。 */
  baseExperimentId?: string;
  /** true = 更新同名既有实验,而不是新建一个。 */
  update?: boolean;
  /** 实验级附加 metadata;与 niceeval 自动写入的字段合并,同名以这里为准。 */
  metadata?: globalThis.Record<string, JsonValue>;
  /** API key;省略时 SDK 读 BRAINTRUST_API_KEY 环境变量。 */
  apiKey?: string;
}

/**
 * Braintrust SDK 的最小类型面。本地声明是为了不把 `braintrust` 变成编译期依赖;
 * 动态 import 后按这个形状断言。
 */
interface BraintrustSdk {
  // SDK 里 init 同步返回(登录与建实验都是惰性的);统一 await,同步/异步都兼容。
  init(options: {
    project?: string;
    projectId?: string;
    experiment?: string;
    baseExperiment?: string;
    baseExperimentId?: string;
    update?: boolean;
    apiKey?: string;
    metadata?: globalThis.Record<string, JsonValue>;
    setCurrent?: boolean;
  }): BraintrustExperiment | Promise<BraintrustExperiment>;
  flush(): Promise<void>;
}

interface BraintrustExperiment {
  log(event: BraintrustLogEvent): void;
  summarize(): Promise<{ experimentUrl?: string }>;
}

export interface BraintrustLogEvent {
  id?: string;
  input?: string;
  output?: string;
  error?: EvalResult["error"];
  scores?: globalThis.Record<string, number>;
  metadata?: globalThis.Record<string, JsonValue>;
  metrics?: globalThis.Record<string, number>;
}

/**
 * 创建 Braintrust 报告器。挂在 `defineConfig({ reporters })` 上观测整次运行,
 * 或挂在单个 eval 的 `reporters` 上只观测它(同一实例被多个 eval 引用时共享一个实验)。
 */
export function Braintrust(config: BraintrustConfig = {}): Reporter {
  let sdk: BraintrustSdk | undefined;
  let experiment: BraintrustExperiment | undefined;

  return {
    async onInvocationStart(evals) {
      sdk = await loadBraintrustSdk();
      experiment = await sdk.init({
        project: config.projectId ? undefined : (config.project ?? "niceeval"),
        projectId: config.projectId,
        experiment: config.experiment,
        baseExperiment: config.baseExperiment,
        baseExperimentId: config.baseExperimentId,
        update: config.update,
        apiKey: config.apiKey,
        // 不再写顶层单一 agent:一次 Invocation 可能横跨多个 (agent, model, flags) 配置,
        // 启动时还没有任何结果,写一个必然只代表其中一份配置的值就是撒谎(见
        // docs/runner.md「Reporter 与运行器事件」)。每行自己的 agent 身份仍在
        // toBraintrustEvent() 的 metadata.agent 里,逐 attempt 精确;跨行的 agent 集合可以
        // 从 Braintrust 自己按 metadata.agent 分组得到,不需要实验级再存一份。
        metadata: {
          evals: evals.map((e) => e.id),
          ...config.metadata,
        },
        // 不设为全局 current experiment,避免污染用户代码里的 braintrust 全局态。
        setCurrent: false,
      });
    },

    onEvalComplete(result) {
      experiment?.log(toBraintrustEvent(result));
    },

    async onInvocationComplete() {
      if (!experiment) return;
      try {
        await sdk?.flush();
        const summary = await experiment.summarize();
        if (summary.experimentUrl) {
          reportActivity(`Braintrust experiment: ${summary.experimentUrl}`);
        }
      } finally {
        experiment = undefined;
        sdk = undefined;
      }
    },
  };
}

/**
 * EvalResult → Braintrust 一行。导出仅为单测;映射口径:
 * - scores:每个已消费且成功的 Score Fact 记归一化分；阈值 verdict use 另记 0/1。
 * - metrics:start/end(Braintrust 由此算时长)+ token 用量 + 估算成本;缺就不写,不编 0。
 * - metadata:身份维度(agent / model / experiment / attempt / flags)+ 失败断言明细。
 */
export function toBraintrustEvent(result: EvalResult): BraintrustLogEvent {
  const scores: globalThis.Record<string, number> = {};
  const fact = factRecordOf(result);
  const terminal = attemptTerminalOf(result);
  const verdict = verdictForTerminal(result);
  if (fact !== undefined) {
    const consumedFactIds = new Set<string>();
    for (const use of fact.factUses) {
      if (use.useKind === "verdict") consumedFactIds.add(use.target.factId);
      else if (use.input.kind === "fact") consumedFactIds.add(use.input.factId);
    }
    const byId = new Map(fact.factResults.map((item) => [item.factId, item]));
    for (const item of fact.factResults) {
      if (item.factKind !== "score" || item.outcome !== "scored" || !consumedFactIds.has(item.factId)) continue;
      addScore(scores, `fact:${item.factId}`, item.normalizedScore);
    }
    for (const use of fact.factUses) {
      if (use.useKind !== "verdict" || use.target.kind !== "score") continue;
      const target = byId.get(use.target.factId);
      if (target?.factKind !== "score" || target.outcome !== "scored") continue;
      if (use.outcome !== "passed" && use.outcome !== "failed") continue;
      const stableUseKey = use.key ?? use.label ?? target.name;
      addScore(scores, `use:${stableUseKey}`, use.outcome === "passed" ? 1 : 0);
    }
    // A scored zero is a successful terminal, whereas invalid is the only
    // observed zero for terminal validity. Unavailable/errored intentionally
    // omit this score rather than masquerading as ordinary 0.
    if (terminal === "scored") addScore(scores, "niceeval:terminal", 1);
    if (terminal === "invalid") addScore(scores, "niceeval:terminal", 0);
  }

  const metrics: globalThis.Record<string, number> = {};
  if (result.startedAt) {
    const start = Date.parse(result.startedAt) / 1000;
    if (Number.isFinite(start)) {
      metrics.start = start;
      metrics.end = start + result.durationMs / 1000;
    }
  }
  if (result.usage) {
    const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, reasoningTokens, requests } = result.usage;
    if (inputTokens !== undefined) metrics.prompt_tokens = inputTokens;
    if (outputTokens !== undefined) metrics.completion_tokens = outputTokens;
    if (inputTokens !== undefined && outputTokens !== undefined) metrics.tokens = inputTokens + outputTokens;
    if (cacheReadTokens !== undefined) metrics.cache_read_tokens = cacheReadTokens;
    if (cacheCreationTokens !== undefined) metrics.cache_creation_tokens = cacheCreationTokens;
    if (reasoningTokens !== undefined) metrics.reasoning_tokens = reasoningTokens;
    if (requests !== undefined) metrics.requests = requests;
  }
  if (result.estimatedCostUSD !== undefined) metrics.estimated_cost_usd = result.estimatedCostUSD;

  const metadata: globalThis.Record<string, JsonValue> = {
    eval: result.id,
    agent: result.agent,
    attempt: result.attempt,
    verdict,
    terminal,
  };
  if (result.model !== undefined) metadata.model = result.model;
  if (result.experimentId !== undefined) metadata.experiment = result.experimentId;
  if (result.experiment?.flags && Object.keys(result.experiment.flags).length > 0) {
    metadata.flags = result.experiment.flags;
  }
  if (result.skipReason !== undefined) metadata.skipReason = result.skipReason;
  if (fact !== undefined) {
    metadata.evaluationAlgorithm = fact.evaluationAlgorithm;
    metadata.evaluationKind = fact.evaluationKind;
    metadata.factResults = fact.factResults as unknown as JsonValue;
    metadata.factUses = fact.factUses as unknown as JsonValue;
    const score = scoreOutcomeOf(result);
    if (score !== undefined) metadata.scoreResult = score as unknown as JsonValue;
  }

  // 一次运行内 (experiment, eval, agent, model, attempt) 唯一;Braintrust 按 id 合并重复行。
  const id = [result.experimentId ?? "", result.id, result.agent, result.model ?? "", `a${result.attempt}`].join("|");

  return {
    id,
    input: result.description ?? result.id,
    output: lastAssistantText(result.events),
    error: result.error,
    scores,
    metadata,
    metrics,
  };
}

function addScore(scores: globalThis.Record<string, number>, base: string, value: number): void {
  let key = base;
  for (let n = 2; key in scores; n++) key = `${base}#${n}`;
  scores[key] = value;
}

/** agent 的最终回复文本(事件流里最后一条 assistant message);没有就不填。 */
function lastAssistantText(events: EvalResult["events"]): string | undefined {
  if (!events) return undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "message" && e.role === "assistant") return e.text;
  }
  return undefined;
}

/** 动态 import 说明:specifier 放变量里,`braintrust` 不进编译期依赖,没装也能 typecheck。 */
const BRAINTRUST_PACKAGE = "braintrust";

async function loadBraintrustSdk(): Promise<BraintrustSdk> {
  try {
    return (await import(BRAINTRUST_PACKAGE)) as unknown as BraintrustSdk;
  } catch {
    throw new Error(
      "The 'braintrust' package is required for the Braintrust reporter but was not found. Install it with: npm install braintrust (and set BRAINTRUST_API_KEY).",
    );
  }
}
