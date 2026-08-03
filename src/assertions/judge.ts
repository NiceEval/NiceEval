// LLM-as-judge:用一个与被测 agent 完全分离的裁判模型做结构化 autoevals 评分。
//
// 裁判模型走 OpenAI 兼容的 /chat/completions。model 与 base_url 是配置,只从代码来:
//   model:    judge.model(单次断言 → Experiment → Eval → Config),没有内置默认模型
//   base_url: judge.baseUrl  →  官方端点(https://api.openai.com/v1)
// key 是凭据,只从环境来,且只读一个名字(不跨家族猜 CODEX_/OPENAI_):
//   judge.apiKeyEnv 指向的环境变量  →  NICEEVAL_JUDGE_KEY
// 边界见 docs/architecture.md「配置从代码来,凭据从环境来」。
//
// closedQA / factuality / summarizes 直接用 autoevals 库(braintrust)。

import { ClosedQA, Factuality, Summary } from "autoevals";
import OpenAI from "openai";
import { unavailable, type EvalScore, type EvalUnavailable } from "./collector.ts";
import type { AssertionHandle, AutoevalsNamespace, JudgeConfig, JudgeNamespace, AssertionEvaluationContext } from "../types.ts";
import { getEnv } from "../util.ts";
import { t } from "../i18n/index.ts";

interface ResolvedJudge {
  /** 未配置时为 undefined —— judge 没有内置默认模型,必须在 eval 或 config 的 judge 配置里显式指定。 */
  model: string | undefined;
  baseUrl: string;
  apiKey: string | undefined;
  /** 单次判分调用的上限(见 JUDGE_TIMEOUT_MS 的理由)。 */
  timeoutMs: number;
}

/** 单次判分调用的默认上限:判分材料可以是整段长会话,更短的上限会把慢而能用的网关判成
 *  评不了;三分钟足以把「慢」与「挂死」分开(见 docs/feature/judge/library.md
 *  「调用预算与执行顺序」)。eval 与 config 的 judge 逐字段合并后仍没有 timeoutMs 才落到这里。 */
const JUDGE_TIMEOUT_MS = 180_000;
const JUDGE_MAX_ATTEMPTS = 3;
const JUDGE_RETRY_BASE_DELAY_MS = 1_000;

function resolveJudge(judge: JudgeConfig | undefined): ResolvedJudge {
  const model = judge?.model;
  const baseUrl = judge?.baseUrl ?? "https://api.openai.com/v1";
  const apiKey = getEnv(judge?.apiKeyEnv ?? "NICEEVAL_JUDGE_KEY");
  return { model, baseUrl, apiKey, timeoutMs: judge?.timeoutMs ?? JUDGE_TIMEOUT_MS };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export interface JudgeDeps {
  record(spec: {
    name: string;
    severity: "soft";
    /** 检查方式摘要(如 `closedQA("…")`);落盘进 AssertionResult.detail,也是 live 面板
     *  `judge k/n · <检查方式>` 用的那一份文本(见 collector 的 onJudgeProgress)。 */
    detail: string;
    /** 这是一条判分断言:collector 据此逐条上报判分推进。 */
    judge: true;
    evaluate(ctx: AssertionEvaluationContext): Promise<EvalScore | EvalUnavailable>;
  }): AssertionHandle;
  judge: JudgeConfig | undefined;
  getOutput: () => string;
  /** 最后一条用户消息,作为 autoevals 的 input 字段。 */
  getInput: () => string;
  signal?: AbortSignal;
  /** Judge transport retry 的测试时钟注入；不改变作者 API。 */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
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

function objectField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function judgeStatus(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const status = objectField(current, "status");
    if (typeof status === "number" && Number.isInteger(status)) return status;
    const nested = objectField(current, "error");
    if (nested !== undefined) {
      const nestedStatus = objectField(nested, "status");
      if (typeof nestedStatus === "number" && Number.isInteger(nestedStatus)) return nestedStatus;
    }
    current = objectField(current, "cause");
  }
  return undefined;
}

function judgeCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const direct = objectField(current, "code");
    if (typeof direct === "string" && direct !== "") return direct;
    const nested = objectField(current, "error");
    const nestedCode = objectField(nested, "code");
    if (typeof nestedCode === "string" && nestedCode !== "") return nestedCode;
    current = objectField(current, "cause");
  }
  return undefined;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (typeof headers !== "object" || headers === null) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === "string") return value;
  }
  return undefined;
}

function retryAfterMs(headers: unknown): number | undefined {
  const raw = headerValue(headers, "retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function isTransientJudgeStatus(status: number | undefined): boolean {
  return status === 408 || status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

function isConnectionFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const name = objectField(current, "name");
    const code = objectField(current, "code");
    if (name === "APIUserAbortError") return false;
    if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") return true;
    if (typeof code === "string" && /^(?:ECONN|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|ERR_TLS)/i.test(code)) {
      return true;
    }
    if (/fetch failed|socket hang up|connection (?:reset|closed|refused)|network error|other side closed|timed? out|timeout|\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)\b/i.test(errorSummary(current))) {
      return true;
    }
    current = objectField(current, "cause");
  }
  return false;
}

function isTransientJudgeFailure(error: unknown): boolean {
  const status = judgeStatus(error);
  return isTransientJudgeStatus(status) || (status === undefined && isConnectionFailure(error));
}

function defaultJudgeSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 超时证据里的秒数:整秒不带小数(180_000 → `180s`),非整秒保留一位。 */
function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

/** 这条判分断言的检查方式摘要,如 `closedQA("修改是否聚焦问题?")`。判分材料的 rubric 可能很长,
 *  摘要按显示口径收口。这一份文本同时是落盘的 `detail` 与 live 面板 `judge k/n · …` 的后半段
 *  ——两处同源,不在别处第二次拼。 */
const CHECK_SUMMARY_MAX = 80;
function checkSummary(kind: string, reference: string): string {
  const flat = reference.replace(/\s+/g, " ").trim();
  const short = flat.length > CHECK_SUMMARY_MAX ? `${flat.slice(0, CHECK_SUMMARY_MAX)}…` : flat;
  return `${kind}(${JSON.stringify(short)})`;
}

/** autoevals/OpenAI 的错误类名不稳定；诊断只保留 status、服务端 code、模型与有界摘要。 */
function judgeFailureEvidence(
  error: unknown,
  model: string,
  attempts: number,
  retried: boolean,
): string {
  const status = judgeStatus(error);
  const code = judgeCode(error);
  const parts = [`model=${model}`];
  if (status !== undefined) parts.push(`HTTP ${status}`);
  if (code !== undefined) parts.push(`code=${code}`);
  parts.push(errorSummary(error));
  parts.push(retried ? `retry=yes · attempts=${attempts}` : "retry=no");
  if (attempts >= JUDGE_MAX_ATTEMPTS) parts.push("retries exhausted");
  return parts.join(" · ");
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

type AutoevalOpenAIClient = NonNullable<Parameters<typeof ClosedQA>[0]["client"]>;

/**
 * autoevals 与应用都依赖同一版 OpenAI SDK，但 pnpm 因 zod 3/4 peer context 生成了两个类型身份。
 * 运行时 facade 相同；把例外固定在这一处，评分调用本身继续由各 scorer 的真实参数类型检查。
 */
function bridgeAutoevalClient(client: OpenAI): { readonly client: AutoevalOpenAIClient } {
  // @ts-expect-error Same OpenAI SDK version, distinct pnpm peer-context private-field identity.
  return { client };
}

/** 预检显式配置的 judge:验证 model + API key 存在,并发最小请求确认端点可达。传输失败(超时、
 *  连接失败)以及 429、408、5xx 等瞬时 HTTP 状态后重试一次,**每次探测各自拥有完整的 20 秒预算**;
 *  永久 HTTP 错误不重试——回应是确定性答案。返回错误描述字符串,可达则返回 undefined。*/
export async function probeJudge(judge: JudgeConfig, signal?: AbortSignal): Promise<string | undefined> {
  const resolved = resolveJudge(judge);
  if (!resolved.model) return t("judge.modelMissing");
  if (!resolved.apiKey) {
    const envHint = judge.apiKeyEnv ?? "NICEEVAL_JUDGE_KEY";
    return t("judge.probeMissingKey", { model: resolved.model, envHint });
  }
  const endpoint = resolved.baseUrl.replace(/\/$/, "");
  // probe 对瞬时传输失败与 HTTP 状态显式重试一次；实际评分由自己的 transport policy
  // 在总预算内显式重试，二者不共享隐式重放。
  for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt++) {
    // 20s 上限**每次尝试各建一份**(见 docs/feature/judge/library.md「派发前预检」:每次探测
    // 各自拥有完整的 20 秒预算)。建在循环外会让第一次超时耗尽预算后,第二次拿着已 abort 的
    // signal 0ms 即败——重试形同虚设,而重试存在的理由正是把瞬时抖动与真不可用分开。
    // 与外层 signal(Ctrl+C)合流:任一触发都中断这次探测。超时源的 reason 是 TimeoutError,
    // 下面据此把「网关不回」与其它失败分开报,给出可行动的下一步。
    const timeoutSignal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    const probeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      // 只确认可达 + 鉴权通过,不关心回复内容(真实评分走 autoevals)。
      // 不带 max_tokens 等采样参数:新款模型(o 系 / gpt-5.x)会 400 拒掉 max_tokens,
      // probe 的职责只是「端点通、key 对、model 认识」,参数越少越不误伤。
      const url = `${endpoint}/chat/completions`;
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
        if (isTransientJudgeStatus(res.status) && attempt < PROBE_MAX_ATTEMPTS) {
          const delay = retryAfterMs(res.headers);
          if (delay !== undefined) await defaultJudgeSleep(delay, probeSignal);
          continue;
        }
        return t("judge.probeFailed", {
          endpoint,
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
          return t("judge.probeTimeout", {
            endpoint,
            model: resolved.model,
            attempts: attempt,
            seconds: PROBE_TIMEOUT_MS / 1000,
          });
        }
        return t("judge.probeFailed", { endpoint, model: resolved.model, error: errorSummary(e) });
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

  const materialFor = async (ctx: AssertionEvaluationContext, on?: string): Promise<string> => {
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

  // 三个 autoevals 方法只差评分器和材料字段名,共享行为(record spec / 材料构造 /
  // 分数归一 / evidence)单一出处。model 解析:单次 { model } → judge config;
  // 没解析到模型或 key 时该条记 unavailable(带 reason),
  // 绝不静默消失、也不在调用点崩——评不了的折叠交给 Severity 与 Verdict 规则。
  const makeAutoeval =
    (kind: "closedQA" | "factuality" | "summarizes") =>
    (reference: string, opts?: { on?: string; model?: string }) => {
      const model = opts?.model ?? resolved.model;
      return deps.record({
        name: `judge:autoevals:${kind}`,
        severity: "soft",
        detail: checkSummary(kind, reference),
        judge: true,
        evaluate: async (ctx) => {
          if (!model) {
            return unavailable("judge-model-unresolved (no judge model in the eval or project config)");
          }
          if (!resolved.apiKey) {
            const envHint = deps.judge?.apiKeyEnv ?? "NICEEVAL_JUDGE_KEY";
            return unavailable(`judge-key-unresolved (${envHint} unset)`);
          }
          const output = await materialFor(ctx, opts?.on);
          let result: { score?: number | null } | undefined;
          // 判分调用有界:到点中断这次调用并记 unavailable。超时源自建 setTimeout +
          // AbortController(不是 AbortSignal.timeout):既要真正取消在飞的请求,也要在网关
          // 连 abort 都不回应时仍然按时结束等待,所以调用与计时器一起 race。
          const budget = new AbortController();
          let timedOut = false;
          let attempts = 0;
          let retried = false;
          const deadlineAt = Date.now() + resolved.timeoutMs;
          const timer = setTimeout(() => {
            timedOut = true;
            budget.abort();
          }, resolved.timeoutMs);
          const callSignal = deps.signal ? AbortSignal.any([deps.signal, budget.signal]) : budget.signal;
          try {
            for (let attempt = 0; attempt < JUDGE_MAX_ATTEMPTS; attempt++) {
              if (Date.now() >= deadlineAt || budget.signal.aborted) {
                timedOut = true;
                return unavailable("judge-call-failed", `model=${model} · timed out after ${formatSeconds(resolved.timeoutMs)} · retry=${retried ? "yes" : "no"} · attempts=${attempts}`);
              }
              attempts = attempt + 1;
              try {
                // 每次物理调用都在这里显式发生；SDK maxRetries=0，避免隐藏重放。
                const input = deps.getInput();
                const client = bridgeAutoevalClient(judgeClient(resolved.apiKey, resolved.baseUrl, callSignal));
                const call = Promise.resolve(
                  kind === "closedQA"
                    ? ClosedQA({ input, output, criteria: reference, model, ...client })
                    : kind === "factuality"
                      ? Factuality({ input, output, expected: reference, model, ...client })
                      : Summary({ input, output, expected: reference, model, ...client }),
                );
                call.catch(() => {});
                result = await Promise.race([
                  call,
                  new Promise<never>((_, reject) => {
                    budget.signal.addEventListener("abort", () => reject(new Error("judge call exceeded its budget")), {
                      once: true,
                    });
                  }),
                ]);
                break;
              } catch (error) {
                if (timedOut || deps.signal?.aborted) {
                  return unavailable("judge-call-failed", timedOut
                    ? `model=${model} · timed out after ${formatSeconds(resolved.timeoutMs)} · retry=${retried ? "yes" : "no"} · attempts=${attempts}`
                    : `model=${model} · interrupted · retry=no · attempts=${attempts}`);
                }
                if (!isTransientJudgeFailure(error) || attempt + 1 >= JUDGE_MAX_ATTEMPTS) {
                  return unavailable("judge-call-failed", judgeFailureEvidence(error, model, attempts, retried));
                }
                const remaining = deadlineAt - Date.now();
                if (remaining <= 0) {
                  timedOut = true;
                  return unavailable("judge-call-failed", `model=${model} · timed out after ${formatSeconds(resolved.timeoutMs)} · retry=${retried ? "yes" : "no"} · attempts=${attempts}`);
                }
                const retryAfter = retryAfterMs(objectField(error, "headers"));
                const jitter = (deps.random ?? Math.random)() * JUDGE_RETRY_BASE_DELAY_MS * 2 ** attempt;
                const delay = Math.min(retryAfter ?? jitter, remaining);
                retried = true;
                try {
                  await (deps.sleep ?? defaultJudgeSleep)(delay, budget.signal);
                } catch {
                  timedOut = budget.signal.aborted;
                  return unavailable("judge-call-failed", timedOut
                    ? `model=${model} · timed out after ${formatSeconds(resolved.timeoutMs)} · retry=yes · attempts=${attempts}`
                    : `model=${model} · interrupted · retry=no · attempts=${attempts}`);
                }
              }
            }
          } finally {
            clearTimeout(timer);
          }
          if (result === undefined || typeof result.score !== "number" || !Number.isFinite(result.score)) {
            return unavailable("judge-call-failed", `model=${model} · response did not contain a finite numeric score · retry=no · attempts=${attempts}`);
          }
          // detail 只有「检查方式」一个含义(见 docs/feature/assertions/architecture.md
          // 「断言记录」),已由 spec.detail 给出;裁判自述的理由没有记录字段,不挤进这里,
          // 否则判定行标题会变成摘要 + 一整段理由。evidence 仍是判分看的材料。
          return {
            score: clamp01(result.score),
            evidence: output,
          };
        },
      });
    };

  return {
    autoevals: {
      closedQA: makeAutoeval("closedQA"),
      factuality: makeAutoeval("factuality"),
      summarizes: makeAutoeval("summarizes"),
    },
  };
}
