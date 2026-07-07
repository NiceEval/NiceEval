// Braintrust 报告器:把一次 niceeval 运行作为一个 Braintrust experiment 上报,
// 每个 attempt 一行(scores = 断言,metrics = 时长/token/成本),跨提交比较与团队共享。
// `braintrust` 是可选依赖:动态 import,装了才用得上,没装在 onRunStart 报错
// (reporter 错误按框架约定只记 diagnostic,不会让运行崩)。

import type { EvalResult, Reporter } from "../../types.ts";

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
  metadata?: Record<string, unknown>;
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
    metadata?: Record<string, unknown>;
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
  input?: unknown;
  output?: unknown;
  error?: unknown;
  scores?: Record<string, number>;
  metadata?: Record<string, unknown>;
  metrics?: Record<string, number>;
}

/**
 * 创建 Braintrust 报告器。挂在 `defineConfig({ reporters })` 上观测整次运行,
 * 或挂在单个 eval 的 `reporters` 上只观测它(同一实例被多个 eval 引用时共享一个实验)。
 */
export function Braintrust(config: BraintrustConfig = {}): Reporter {
  let sdk: BraintrustSdk | undefined;
  let experiment: BraintrustExperiment | undefined;

  return {
    async onRunStart(evals, agent) {
      sdk = await loadBraintrustSdk();
      experiment = await sdk.init({
        project: config.projectId ? undefined : (config.project ?? "niceeval"),
        projectId: config.projectId,
        experiment: config.experiment,
        baseExperiment: config.baseExperiment,
        baseExperimentId: config.baseExperimentId,
        update: config.update,
        apiKey: config.apiKey,
        metadata: {
          agent: agent?.name,
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

    async onRunComplete() {
      if (!experiment) return;
      try {
        await sdk?.flush();
        const summary = await experiment.summarize();
        if (summary.experimentUrl) {
          process.stderr.write(`Braintrust experiment: ${summary.experimentUrl}\n`);
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
 * - scores:soft 断言按名字记分,gate 断言记在 `gate:` 前缀下 —— 实验 diff 里
 *   gate 回归和 soft 分数回归用同一套机制看。重名断言追加 `#n` 消歧,不静默覆盖。
 * - metrics:start/end(Braintrust 由此算时长)+ token 用量 + 估算成本;缺就不写,不编 0。
 * - metadata:身份维度(agent / model / experiment / attempt / flags)+ 失败断言明细。
 */
export function toBraintrustEvent(result: EvalResult): BraintrustLogEvent {
  const scores: Record<string, number> = {};
  for (const a of result.assertions) {
    const base = a.severity === "gate" ? `gate:${a.name}` : a.name;
    let key = base;
    for (let n = 2; key in scores; n++) key = `${base}#${n}`;
    // Braintrust 要求 0..1
    scores[key] = Math.min(1, Math.max(0, a.score));
  }

  const metrics: Record<string, number> = {};
  if (result.startedAt) {
    const start = Date.parse(result.startedAt) / 1000;
    if (Number.isFinite(start)) {
      metrics.start = start;
      metrics.end = start + result.durationMs / 1000;
    }
  }
  if (result.usage) {
    metrics.prompt_tokens = result.usage.inputTokens;
    metrics.completion_tokens = result.usage.outputTokens;
    metrics.tokens = result.usage.inputTokens + result.usage.outputTokens;
    if (result.usage.cacheReadTokens !== undefined) metrics.cache_read_tokens = result.usage.cacheReadTokens;
    if (result.usage.cacheWriteTokens !== undefined) metrics.cache_write_tokens = result.usage.cacheWriteTokens;
  }
  if (result.estimatedCostUSD !== undefined) metrics.estimated_cost_usd = result.estimatedCostUSD;

  const metadata: Record<string, unknown> = {
    eval: result.id,
    agent: result.agent,
    attempt: result.attempt,
    outcome: result.outcome,
  };
  if (result.model !== undefined) metadata.model = result.model;
  if (result.experimentId !== undefined) metadata.experiment = result.experimentId;
  if (result.experiment?.flags && Object.keys(result.experiment.flags).length > 0) {
    metadata.flags = result.experiment.flags;
  }
  if (result.skipReason !== undefined) metadata.skipReason = result.skipReason;
  const failed = result.assertions
    .filter((a) => !a.passed)
    .map((a) => ({ name: a.name, detail: a.detail }));
  if (failed.length > 0) metadata.failedAssertions = failed;

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
