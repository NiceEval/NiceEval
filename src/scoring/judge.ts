// LLM-as-judge:用一个与被测 agent 完全分离的裁判模型做结构化 autoevals 评分。
//
// 裁判模型走 OpenAI 兼容的 /chat/completions。model 与 base_url 是配置,只从代码来:
//   model:    judge.model(单次断言 → eval → config),没有内置默认模型
//   base_url: judge.baseUrl  →  官方端点(https://api.openai.com/v1)
// key 是凭据,只从环境来,且只读一个名字(不跨家族猜 CODEX_/OPENAI_):
//   judge.apiKeyEnv 指向的环境变量  →  NICEEVAL_JUDGE_KEY
// 边界见 docs/architecture.md「配置从代码来,凭据从环境来」。
//
// closedQA / factuality / summarizes 直接用 autoevals 库(braintrust)。

import { ClosedQA, Factuality, Summary } from "autoevals";
import OpenAI from "openai";
import { unavailable, type EvalScore, type EvalUnavailable } from "./collector.ts";
import type { AssertionHandle, AutoevalsNamespace, JudgeConfig, JudgeNamespace, ScoringContext } from "../types.ts";
import { getEnv } from "../util.ts";
import { t } from "../i18n/index.ts";

interface ResolvedJudge {
  /** 未配置时为 undefined —— judge 没有内置默认模型,必须在 eval 或 config 的 judge 配置里显式指定。 */
  model: string | undefined;
  baseUrl: string;
  apiKey: string | undefined;
}

function resolveJudge(judge: JudgeConfig | undefined): ResolvedJudge {
  const model = judge?.model;
  const baseUrl = judge?.baseUrl ?? "https://api.openai.com/v1";
  const apiKey = (judge?.apiKeyEnv ? getEnv(judge.apiKeyEnv) : undefined) ?? getEnv("NICEEVAL_JUDGE_KEY");
  return { model, baseUrl, apiKey };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export interface JudgeDeps {
  record(spec: {
    name: string;
    severity: "soft";
    evaluate(ctx: ScoringContext): Promise<EvalScore | EvalUnavailable>;
  }): AssertionHandle;
  judge: JudgeConfig | undefined;
  getOutput: () => string;
  /** 最后一条用户消息,作为 autoevals 的 input 字段。 */
  getInput: () => string;
  signal?: AbortSignal;
}

/** 预检探测的有界等待:判分网关可能接受连接却迟迟不回(见 memory/
 *  judge-precheck-run-level-line-not-transient),没有上限会让整次运行在派发前永久挂。
 *  20s 足够慢但能用的网关回一个最小请求,又不至于让真挂死拖成无限等待。 */
const PROBE_TIMEOUT_MS = 20_000;
const PROBE_MAX_ATTEMPTS = 2;

function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 300);
}

/** autoevals/OpenAI 的 HTTP 错误在不同运行时有不同类名，只依赖稳定的 status 字段。 */
function judgeFailureEvidence(error: unknown): string {
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  const prefix = typeof status === "number" ? `HTTP ${status}: ` : "";
  return `${prefix}${errorSummary(error)}`;
}

function judgeClient(apiKey: string, baseURL: string, signal?: AbortSignal): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL,
    // 判分请求不是幂等的计费读取；禁止 SDK 在连接、超时或 5xx 后暗中重放。
    maxRetries: 0,
    fetch: signal
      ? (input, init) =>
          fetch(input, {
            ...init,
            signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
          })
      : undefined,
  });
}

/** 预检显式配置的 judge:验证 model + API key 存在,并发最小请求确认端点可达(有 20s 上限)。
 *  返回错误描述字符串,可达则返回 undefined。*/
export async function probeJudge(judge: JudgeConfig, signal?: AbortSignal): Promise<string | undefined> {
  const resolved = resolveJudge(judge);
  if (!resolved.model) return t("judge.modelMissing");
  if (!resolved.apiKey) {
    const envHint = judge.apiKeyEnv ?? "NICEEVAL_JUDGE_KEY";
    return t("judge.probeMissingKey", { model: resolved.model, envHint });
  }
  // 20s 超时与外层 signal(Ctrl+C)合流:任一触发都中断这次探测。超时源的 reason 是
  // TimeoutError,下面据此把「网关不回」与其它失败分开报,给出可行动的下一步。
  const timeoutSignal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const probeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  // probe 只对尚未收到 HTTP 响应的传输失败重试一次。实际评分绝不走这个重试，
  // 避免一个 rubric 因隐式重放产生第二笔模型费用。
  for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt++) {
    try {
      // 只确认可达 + 鉴权通过,不关心回复内容(真实评分走 autoevals)。
      // 不带 max_tokens 等采样参数:新款模型(o 系 / gpt-5.x)会 400 拒掉 max_tokens,
      // probe 的职责只是「端点通、key 对、model 认识」,参数越少越不误伤。
      const url = `${resolved.baseUrl.replace(/\/$/, "")}/chat/completions`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolved.apiKey}`,
        },
        body: JSON.stringify({
          model: resolved.model,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
        }),
        signal: probeSignal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return t("judge.probeFailed", {
          model: resolved.model,
          error: t("judge.httpError", { status: res.status, body: body.slice(0, 300) }),
        });
      }
      return undefined;
    } catch (e) {
      // 用户中断不重试。TimeoutError、断连和 DNS / TLS 等 fetch 拒绝都属于传输失败，
      // 在第二次仍失败时按原有可行动错误反馈。
      if (signal?.aborted || attempt === PROBE_MAX_ATTEMPTS) {
        if (e instanceof Error && e.name === "TimeoutError") {
          return t("judge.probeTimeout", { model: resolved.model, seconds: PROBE_TIMEOUT_MS / 1000 });
        }
        return t("judge.probeFailed", { model: resolved.model, error: errorSummary(e) });
      }
    }
  }
  return undefined; // 循环已在成功或最终失败时返回；保留给 TypeScript 的完整性检查。
}

/** 构造 t.judge 命名空间。每个方法 record 一条延迟 soft 断言。
 *  没解析到模型或 API key 时【不静默、不抛错】:该条断言照常记录,finalize 时落成
 *  `outcome: "unavailable"`(带机器可读 reason)——rubric 写了就必须留下记录,评不了的
 *  结论按 Severity 与 Verdict 的折叠规则使 attempt errored(除非作者链 `.optional()`)。 */
export function buildJudge(deps: JudgeDeps): JudgeNamespace {
  const resolved = resolveJudge(deps.judge);

  const materialFor = async (ctx: ScoringContext, on?: string): Promise<string> => {
    if (on) {
      // on 既可能是沙箱里的文件路径,也可能是一段字面文本(如 t.sandbox.diff.get(...) 的内容)。
      // 只有「长得像路径」(单行且不长)才尝试按文件读,避免对几 KB 的 diff 文本做无谓 IO,
      // 也避免字面文本恰好命中某个存在的文件时被错读。
      const looksLikePath = !on.includes("\n") && on.length <= 512;
      if (looksLikePath) {
        const fromFile = await ctx.readFile(on).catch(() => undefined);
        if (fromFile !== undefined) return `----- ${on} -----\n${fromFile}`;
      }
      return on;
    }
    return deps.getOutput();
  };

  type Scorer = (args: globalThis.Record<string, unknown>) => Promise<{ score?: number | null }>;

  // 三个 autoevals 方法只差评分器和材料字段名,共享行为(record spec / 材料构造 /
  // 分数归一 / evidence)单一出处。model 解析:单次 { model } → judge config;
  // 没解析到模型或 key 时该条记 unavailable(带 reason),
  // 绝不静默消失、也不在调用点崩——评不了的折叠交给 Severity 与 Verdict 规则。
  const makeAutoeval =
    (kind: "closedQA" | "factuality" | "summarizes", scorer: Scorer, payloadKey: "criteria" | "expected") =>
    (reference: string, opts?: { on?: string; model?: string }) => {
      const model = opts?.model ?? resolved.model;
      return deps.record({
        name: `judge:autoevals:${kind}`,
        severity: "soft",
        evaluate: async (ctx) => {
          if (!model) {
            return unavailable("judge-model-unresolved (no judge model in the eval or project config)");
          }
          if (!resolved.apiKey) {
            const envHint = deps.judge?.apiKeyEnv ?? "NICEEVAL_JUDGE_KEY";
            return unavailable(`judge-key-unresolved (${envHint} unset)`);
          }
          const output = await materialFor(ctx, opts?.on);
          let result: { score?: number | null; rationale?: string };
          try {
            // autoevals 覆盖 HTTP、连接、调用超时与响应解析；这些边界上的任何异常都不能
            // 漏到 collector 的「求值异常 = 0 分」回退，必须成为没有可信分数的 unavailable。
            result = await scorer({
              input: deps.getInput(),
              output,
              [payloadKey]: reference,
              model,
              client: judgeClient(resolved.apiKey, resolved.baseUrl, deps.signal),
            });
          } catch (error) {
            return unavailable("judge-call-failed", judgeFailureEvidence(error));
          }
          if (typeof result.score !== "number" || !Number.isFinite(result.score)) {
            return unavailable("judge-call-failed", "response did not contain a finite numeric score");
          }
          return {
            score: clamp01(result.score),
            detail: result.rationale || undefined,
            evidence: output,
          };
        },
      });
    };

  return {
    autoevals: {
      closedQA: makeAutoeval("closedQA", ClosedQA as unknown as Scorer, "criteria"),
      factuality: makeAutoeval("factuality", Factuality as unknown as Scorer, "expected"),
      summarizes: makeAutoeval("summarizes", Summary as unknown as Scorer, "expected"),
    },
  };
}
