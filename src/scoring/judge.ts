// LLM-as-judge:用一个与被测 agent 完全分离的裁判模型做结构化 autoevals 评分。
//
// 裁判模型走 OpenAI 兼容的 /chat/completions。base_url 解析优先级:
//   judge.baseUrl  →  NICEEVAL_JUDGE_BASE  →  CODEX_BASE_URL  →  OPENAI_BASE_URL  →  官方端点(https://api.openai.com/v1)
// key 解析优先级(judge.apiKeyEnv 指向的是环境变量名,取其值参与链条):
//   judge.apiKeyEnv 指向的环境变量  →  NICEEVAL_JUDGE_KEY  →  CODEX_API_KEY  →  OPENAI_API_KEY
//
// closedQA / factuality / summarizes 直接用 autoevals 库(braintrust)。

import { ClosedQA, Factuality, Summary } from "autoevals";
import { unavailable, type EvalScore, type EvalUnavailable } from "./collector.ts";
import type { AssertionHandle, AutoevalsNamespace, JudgeConfig, JudgeNamespace, ScoringContext } from "../types.ts";
import { getEnv } from "../util.ts";
import { t } from "../i18n/index.ts";

interface ResolvedJudge {
  /** 未配置时为 undefined —— judge 没有内置默认模型,必须显式指定(config / eval / NICEEVAL_JUDGE_MODEL)。 */
  model: string | undefined;
  baseUrl: string;
  apiKey: string | undefined;
}

function resolveJudge(judge: JudgeConfig | undefined): ResolvedJudge {
  const model = judge?.model ?? getEnv("NICEEVAL_JUDGE_MODEL");
  const baseUrl =
    judge?.baseUrl ??
    getEnv("NICEEVAL_JUDGE_BASE") ??
    getEnv("CODEX_BASE_URL") ??
    getEnv("OPENAI_BASE_URL") ??
    "https://api.openai.com/v1";
  const apiKey =
    (judge?.apiKeyEnv ? getEnv(judge.apiKeyEnv) : undefined) ??
    getEnv("NICEEVAL_JUDGE_KEY") ??
    getEnv("CODEX_API_KEY") ??
    getEnv("OPENAI_API_KEY");
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

/** 预检显式配置的 judge:验证 model + API key 存在,并发最小请求确认端点可达。
 *  返回错误描述字符串,可达则返回 undefined。*/
export async function probeJudge(judge: JudgeConfig, signal?: AbortSignal): Promise<string | undefined> {
  const resolved = resolveJudge(judge);
  if (!resolved.model) return t("judge.modelMissing");
  if (!resolved.apiKey) {
    const envHint = judge.apiKeyEnv ?? "NICEEVAL_JUDGE_KEY / OPENAI_API_KEY";
    return t("judge.probeMissingKey", { model: resolved.model, envHint });
  }
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
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(t("judge.httpError", { status: res.status, body: body.slice(0, 300) }));
    }
  } catch (e) {
    return t("judge.probeFailed", { model: resolved.model, error: e instanceof Error ? e.message : String(e) });
  }
  return undefined;
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

  type Scorer = (args: Record<string, unknown>) => Promise<{ score?: number | null }>;

  // 三个 autoevals 方法只差评分器和材料字段名,共享行为(record spec / 材料构造 /
  // 分数归一 / evidence)单一出处。model 解析:单次 { model } → judge config →
  // NICEEVAL_JUDGE_MODEL;没解析到模型或 key 时该条记 unavailable(带 reason),
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
            return unavailable("judge-model-unresolved (no model in config, NICEEVAL_JUDGE_MODEL unset)");
          }
          if (!resolved.apiKey) {
            const envHint = deps.judge?.apiKeyEnv ?? "NICEEVAL_JUDGE_KEY / OPENAI_API_KEY";
            return unavailable(`judge-key-unresolved (${envHint} unset)`);
          }
          const output = await materialFor(ctx, opts?.on);
          const result = await scorer({
            input: deps.getInput(),
            output,
            [payloadKey]: reference,
            model,
            openAiBaseUrl: resolved.baseUrl,
            openAiApiKey: resolved.apiKey,
          });
          return {
            score: clamp01(result.score ?? 0),
            detail: (result as { rationale?: string }).rationale || undefined,
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
