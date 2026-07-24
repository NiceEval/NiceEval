// turn 失败分类链:把一次 send 失败(抛出 / 返回 failed Turn)归成一份 `FailureClass`。
// 判据全文见 docs/feature/error-classification/README.md「分类」;两轴词表、糖衣类与守卫在
// src/shared/failure-class.ts(全仓单源),这里只落 turn 这条链——五道里的「保守兜底」与
// 「受理证据门」两道的实现在本文件,抛出点声明走守卫、实验分类器挂在 ExperimentDef、adapter
// 分类器挂在 Agent(src/agents/types.ts),本文件只按序询问它们。执行体的重试时序在
// send-retry.ts:本模块只回答「这次失败能不能安全重发、波及多远」,不碰次数/退避/槽位。

import type { Turn } from "../types.ts";
import {
  callClassifier,
  errorChainText,
  failureClassOf,
  type AttemptFailureClassifier,
  type FailureClass,
} from "../shared/failure-class.ts";

/** 一次 send 失败的两种浮出形态:`send()` 抛出异常,或返回 `status: "failed"` 的 Turn。 */
export type TurnFailure =
  | { readonly type: "thrown"; readonly error: unknown }
  | { readonly type: "turn-failed"; readonly turn: Turn };

/**
 * adapter 可选分类器:返回 `undefined` 表示「不认识,交给后续链路」。分类器必须快、纯、
 * 不抛错——抛错按 `undefined` 回落处理,自身错误被吞掉,不会掩盖原始失败。
 */
export type TurnErrorClassifier = (failure: TurnFailure) => FailureClass | undefined;

/**
 * 失败 Turn 的错误摘要:取 `events` 里最后一个 `type: "error"` 事件的 message。
 * 与 `context.turnFailed` 报错文案、保守兜底分类器读的同一段文本同源——不出现
 * 「报错说 A、分类看 B」。没有 error 事件(status: "failed" 但 adapter 没吐错误事件)时
 * 返回 `undefined`。
 */
export function turnErrorText(turn: Turn): string | undefined {
  for (let i = turn.events.length - 1; i >= 0; i--) {
    const e = turn.events[i];
    if (e.type === "error") return e.message;
  }
  return undefined;
}

/** 两种 `TurnFailure` 形态统一取「给人读也给分类器看」的那段文本。 */
export function turnFailureText(failure: TurnFailure): string {
  return failure.type === "thrown" ? errorChainText(failure.error) : (turnErrorText(failure.turn) ?? "");
}

/** turn 失败在生命周期词表里的归属:adapter send 期间打开的那一段。 */
const TURN_FAILURE_PHASE = "agent.run" as const;

// 限流关键字 / 明示 retry later → rate_limit;正则形状对齐 sandbox IO 分类器
// (src/sandbox/errors.ts 的 classifySandboxIoError),各自实现、不共享模块。
const RATE_LIMIT_PATTERN = /too many requests|rate.?limit|\b429\b|retry later|concurrency limit/i;
// 连接建立层错误(DNS 解析失败 / 连接被拒 / TLS 握手失败)→ network。刻意不包含
// ECONNRESET / socket hang up 这类「连接中途断开」——那属于「无法证明未受理」的歧义类,
// 判据见 docs/feature/error-classification/README.md「分类」。
const NETWORK_CODE_PATTERN = /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|CERT_|ERR_TLS)/i;
const NETWORK_MESSAGE_PATTERN = /getaddrinfo|connection refused|certificate|tls handshake|connect etimedout|connection timeout/i;

/**
 * 保守兜底分类器:turn 链里的第四道。对失败文本做正则匹配,认不出的一律 `{ retryable: false }`
 * ——宁可判死一个 attempt,不产出不可信的 verdict(判据见 README「分类」)。兜底永不给出超出
 * `"attempt"` 的 scope:框架无法从文案证明兄弟必死,扩 scope 只属于携带作者知识的通道。
 */
export function classifyTurnError(failure: TurnFailure): FailureClass {
  const text = turnFailureText(failure);
  if (RATE_LIMIT_PATTERN.test(text)) return { retryable: true, reason: "rate_limit" };
  const code = errorCode(failure);
  if ((code && NETWORK_CODE_PATTERN.test(code)) || NETWORK_MESSAGE_PATTERN.test(text)) {
    return { retryable: true, reason: "network" };
  }
  return { retryable: false };
}

function errorCode(failure: TurnFailure): string | undefined {
  if (failure.type !== "thrown") return undefined;
  const e = failure.error;
  if (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string") {
    return (e as { code: string }).code;
  }
  return undefined;
}

/** 失败 Turn 里被认作「agent 侧已产出」的事件类型——受理证据门查的就是这四种。 */
const AGENT_EVIDENCE_TYPES = new Set(["message", "thinking", "action.called", "action.result"]);

/** 受理证据门:失败 Turn 的 events 里已出现任何 agent 侧产出,即证明 agent 已受理并开始工作。 */
export function hasAgentEvidence(turn: Turn): boolean {
  return turn.events.some((e) => AGENT_EVIDENCE_TYPES.has(e.type));
}

/** turn 链上两个可选声明通道;都省略时链退化成「抛出点 → 兜底 → 证据门」。 */
export interface TurnClassifiers {
  /** 实验作者的 `ExperimentDef.classifyFailure`,按自家坐标识别共享基建死因。 */
  experiment?: AttemptFailureClassifier;
  /** adapter 作者的 `Agent.classifyTurnError`,识别自家协议的错误形状。 */
  adapter?: TurnErrorClassifier;
}

/**
 * turn 失败分类链的完整决议(五道,先给出非 `undefined` 结果的一道定分类):
 *
 * 1. 抛出点携带的分类(`failureClassOf`,含 cause 链穿透)——作者知识优先级最高;
 * 2. 实验分类器——按自家坐标(host、路径)过滤,特异性高于协议通用形状,排在 adapter 之前
 *    保证「两者同时认领时 scope 赢」(裁决见 memory/failure-chain-experiment-before-adapter.md);
 * 3. adapter 分类器;
 * 4. 保守兜底正则;
 * 5. 受理证据门(执行体的否决权,只裁时间轴):失败 Turn 里已有 agent 产出事件时 `retryable`
 *    强制降为 `false`,`reason` 与 `scope` 原样保留——门裁的是重发安全性,不是波及范围。
 *
 * 分类器抛错按 `undefined` 回落(继续问后续通道),分类是旁路,不得用新错误掩盖原始失败。
 */
export function resolveTurnFailureClass(failure: TurnFailure, classifiers: TurnClassifiers = {}): FailureClass {
  const declared = failure.type === "thrown" ? failureClassOf(failure.error) : undefined;
  const resolved = declared ?? classifyByChain(failure, classifiers);
  if (resolved.retryable && failure.type === "turn-failed" && hasAgentEvidence(failure.turn)) {
    return { ...resolved, retryable: false };
  }
  return resolved;
}

function classifyByChain(failure: TurnFailure, classifiers: TurnClassifiers): FailureClass {
  if (classifiers.experiment) {
    const info = {
      phase: TURN_FAILURE_PHASE,
      text: turnFailureText(failure),
      cause: failure.type === "thrown" ? failure.error : failure.turn,
    };
    const cls = callClassifier(classifiers.experiment, info);
    if (cls) return cls;
  }
  return callClassifier(classifiers.adapter, failure) ?? classifyTurnError(failure);
}
