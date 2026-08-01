// Agent send 执行失败的结构化 envelope 与分类链。Turn.status === "failed" 是已经取得
// 可信协议终态的领域结果，不经过这里；只有 send() 无法返回可信 Turn 时才 reject
// SendFailure（契约见 docs/feature/error-classification/architecture.md）。

import type { StreamEvent, Usage } from "../types.ts";
import {
  callClassifier,
  errorChainText,
  failureClassOf,
  type AttemptFailureClassifier,
  type FailureClass,
} from "../shared/failure-class.ts";

export type SendAcceptance = "rejected" | "started" | "unknown";

/** send() 无法返回可信 Turn 时 reject 的结构化 envelope。 */
export interface SendFailure {
  readonly type: "agent-send-failed";
  /** 只有协议能证明输入未被受理时才可写 rejected。 */
  readonly acceptance: SendAcceptance;
  readonly message: string;
  readonly cause?: unknown;
  readonly events?: readonly StreamEvent[];
  readonly usage?: Usage;
  readonly process?: {
    readonly exitCode?: number;
    readonly signal?: string;
    readonly stdout?: string;
    readonly stderr?: string;
  };
}

export type SendFailureClassifier = (failure: SendFailure) => FailureClass | undefined;

/** 构造可跨 package 副本识别的纯数据 envelope；识别不依赖 instanceof。 */
export function makeSendFailure(input: Omit<SendFailure, "type">): SendFailure {
  if (input.acceptance !== "rejected" && input.acceptance !== "started" && input.acceptance !== "unknown") {
    throw new TypeError(`invalid SendFailure acceptance: ${String(input.acceptance)}`);
  }
  if (typeof input.message !== "string" || input.message.trim() === "") {
    throw new TypeError("SendFailure message must be a non-empty string");
  }
  return { type: "agent-send-failed", ...input };
}

/** 结构守卫；自定义 adapter 即使来自第二份 niceeval，也能被 core 识别。 */
export function isSendFailure(value: unknown): value is SendFailure {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<SendFailure>;
  return (
    v.type === "agent-send-failed" &&
    (v.acceptance === "rejected" || v.acceptance === "started" || v.acceptance === "unknown") &&
    typeof v.message === "string" &&
    v.message.trim() !== ""
  );
}

const MAX_FAILURE_TEXT = 4096;
// C0/C1 控制字符不进入终端/JSON 摘要；保留换行和 tab 便于 diagnoseFailure 的多行证据阅读。
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const ANSI_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

/** 与最终 AttemptError 和分类器同源的有界、安全失败摘要。 */
export function sendFailureText(failure: SendFailure): string {
  const clean = failure.message.replace(ANSI_ESCAPE, "").replace(CONTROL_CHARACTERS, "").trim();
  if (clean.length <= MAX_FAILURE_TEXT) return clean;
  return `${clean.slice(0, MAX_FAILURE_TEXT - 1)}…`;
}

/**
 * 未遵守契约而直接抛出的任意值不会漏成 unexpected-error：运行时在唯一 send choke point
 * 把它保守归一为 acceptance=unknown，并保留 cause 供诊断和 fatal 分类穿透。
 */
export function normalizeSendFailure(error: unknown): SendFailure {
  if (isSendFailure(error)) return error;
  return makeSendFailure({
    acceptance: "unknown",
    message: errorChainText(error) || String(error),
    cause: error,
  });
}

const RATE_LIMIT_CODES = new Set(["429", "RATE_LIMIT", "RATE_LIMITED", "TOO_MANY_REQUESTS"]);
const NETWORK_CODES = /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|CERT_|ERR_TLS)/i;

/**
 * 保守回退只读结构化 code/status；自然语言、空 events 与非零退出码都不能证明未受理。
 * scope 永远留在默认 attempt 档。
 */
export function classifySendFailure(failure: SendFailure): FailureClass {
  for (const candidate of structuredFacts(failure)) {
    const status = numberField(candidate, "status", "statusCode", "httpStatus");
    const code = stringOrNumberField(candidate, "code", "errorCode");
    const normalizedCode = code?.toUpperCase().replace(/[ -]+/g, "_");
    if (status === 429 || (normalizedCode !== undefined && RATE_LIMIT_CODES.has(normalizedCode))) {
      return { retryable: true, reason: "rate_limit" };
    }
    if (normalizedCode !== undefined && NETWORK_CODES.test(normalizedCode)) {
      return { retryable: true, reason: "network" };
    }
  }
  return { retryable: false };
}

export interface SendFailureClassifiers {
  experiment?: AttemptFailureClassifier;
  adapter?: SendFailureClassifier;
}

/** 完整五道链：声明 → 实验 → adapter → 保守回退 → acceptance 门。 */
export function resolveSendFailureClass(
  failure: SendFailure,
  classifiers: SendFailureClassifiers = {},
): FailureClass {
  const declared = failureClassOf(failure);
  const info = { phase: "agent.run" as const, text: sendFailureText(failure), cause: failure };
  const resolved =
    declared ??
    callClassifier(classifiers.experiment, info) ??
    callClassifier(classifiers.adapter, failure) ??
    classifySendFailure(failure);
  const hasStartedEvidence = failure.events !== undefined && sendAcceptanceFromEvents(failure.events) === "started";
  if (resolved.retryable && (failure.acceptance !== "rejected" || hasStartedEvidence)) {
    return { ...resolved, retryable: false };
  }
  return resolved;
}

/** 内置 adapter 用：一旦已有 agent 产出，受理事实至少是 started。 */
export function sendAcceptanceFromEvents(events: readonly StreamEvent[]): "started" | "unknown" {
  return events.some((event) =>
    (event.type === "message" && event.role === "assistant") ||
    event.type === "thinking" ||
    event.type === "action.called" ||
    event.type === "action.result"
  )
    ? "started"
    : "unknown";
}

function* structuredFacts(failure: SendFailure): Generator<globalThis.Record<string, unknown>> {
  let current: unknown = failure;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6 && current !== null && typeof current === "object"; depth++) {
    if (seen.has(current)) return;
    seen.add(current);
    const object = current as globalThis.Record<string, unknown>;
    yield object;
    current = object.cause;
  }
}

function numberField(object: globalThis.Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) if (typeof object[key] === "number") return object[key];
  return undefined;
}

function stringOrNumberField(object: globalThis.Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return undefined;
}
