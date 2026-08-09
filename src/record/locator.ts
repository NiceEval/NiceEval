// Attempt locator 的纯领域契约：编码只依赖持久化 Run 身份，索引忠实保留同一 locator 的
// 全部候选；读取与写入分别在自己的边界解释多候选和碰撞。

import { createHash } from "node:crypto";

/** 不透明的 Attempt 定位符。 */
export type AttemptLocator = string & { readonly __brand: "AttemptLocator" };

/** locator 派生自的不可变身份元组。attempt 使用 0-indexed 落盘口径。 */
export interface AttemptIdentity {
  runId: string;
  evalId: string;
  attempt: number;
}

export const ATTEMPT_LOCATOR_PREFIX = "@";

const CURRENT_SCHEME = 1;
const BODY_LENGTH = 12;
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_BODY_PATTERN = /^[0-9A-HJKMNP-TV-Z]{12}$/;

/**
 * `{runId, evalId, attempt}` 的规范 JSON 数组做 SHA-256，取摘要前 60 bit，按 Crockford
 * base32 编为 12 位 body。scheme 不混入哈希输入；它只声明这套规范化与编码规则。
 */
export function encodeAttemptLocator(identity: AttemptIdentity): AttemptLocator {
  assertValidIdentity(identity);
  const digest = createHash("sha256").update(canonicalIdentityString(identity)).digest();
  return `${ATTEMPT_LOCATOR_PREFIX}${CURRENT_SCHEME}${digestPrefixToCrockfordBody(digest)}` as AttemptLocator;
}

export type LocatorDecodeResult = { valid: true; scheme: number } | { valid: false; reason: string };

/** 只校验 locator 语法，不查记录索引，也不尝试从单向摘要还原身份。 */
export function decodeAttemptLocator(locator: string): LocatorDecodeResult {
  if (locator.length === 0) return { valid: false, reason: "Locator is empty." };
  if (!locator.startsWith(ATTEMPT_LOCATOR_PREFIX)) {
    return { valid: false, reason: `Locator must start with "${ATTEMPT_LOCATOR_PREFIX}" (got "${locator}").` };
  }
  if (locator.length !== 2 + BODY_LENGTH) {
    return {
      valid: false,
      reason: `Locator "${locator}" must contain one scheme character and a ${BODY_LENGTH}-character body (${2 + BODY_LENGTH} characters total).`,
    };
  }
  const schemeChar = locator[1]!;
  if (!/^[0-9]$/.test(schemeChar)) {
    return { valid: false, reason: `Locator "${locator}" has an invalid scheme character "${schemeChar}".` };
  }
  const body = locator.slice(2);
  if (!CROCKFORD_BODY_PATTERN.test(body)) {
    return {
      valid: false,
      reason: `Locator "${locator}" body must use canonical uppercase Crockford base32 characters (0-9, A-H, J-K, M-N, P-T, V-Z).`,
    };
  }
  return { valid: true, scheme: Number(schemeChar) };
}

/** 一个索引候选：持久化身份与调用方句柄成对保留。 */
export interface LocatorAttempt<T> {
  identity: AttemptIdentity;
  handle: T;
  /** reader 使用落盘的权威 locator；省略时按 identity 派生。 */
  locator?: AttemptLocator;
}

export type LocatorIndex<T> = Map<AttemptLocator, LocatorAttempt<T>[]>;

/**
 * 建立多值索引。同 locator 的候选全部保留；是否是写入碰撞或读取歧义由消费边界决定，
 * 不能在建索引时覆盖其中一条，也不能让 openRecord 因历史坏数据整体不可读。
 */
export function buildLocatorIndex<T>(attempts: Iterable<LocatorAttempt<T>>): LocatorIndex<T> {
  const index: LocatorIndex<T> = new Map();
  for (const attempt of attempts) {
    const locator = attempt.locator ?? encodeAttemptLocator(attempt.identity);
    const candidates = index.get(locator);
    if (candidates) candidates.push(attempt);
    else index.set(locator, [attempt]);
  }
  return index;
}

export type LocatorResolution<T> =
  | { kind: "found"; locator: AttemptLocator; handle: T }
  | { kind: "malformed"; input: string; reason: string }
  | { kind: "not-found"; locator: AttemptLocator }
  | { kind: "ambiguous"; locator: AttemptLocator; candidates: readonly LocatorAttempt<T>[] };

export function resolveAttemptLocator<T>(index: ReadonlyMap<AttemptLocator, readonly LocatorAttempt<T>[]>, input: string): LocatorResolution<T> {
  const decoded = decodeAttemptLocator(input);
  if (!decoded.valid) return { kind: "malformed", input, reason: decoded.reason };
  const locator = input as AttemptLocator;
  const candidates = index.get(locator) ?? [];
  if (candidates.length === 0) return { kind: "not-found", locator };
  if (candidates.length > 1) return { kind: "ambiguous", locator, candidates };
  return { kind: "found", locator, handle: candidates[0]!.handle };
}

/** fresh locator 已被另一个不可变身份占用。 */
export class LocatorCollisionError extends Error {
  constructor(
    public readonly locator: AttemptLocator,
    public readonly identities: readonly [AttemptIdentity, AttemptIdentity],
  ) {
    super(
      `Attempt locator collision: "${locator}" belongs to both ${identityLabel(identities[0])} and ` +
        `${identityLabel(identities[1])}. The locator is derived and cannot be regenerated with a different value.`,
    );
    this.name = "LocatorCollisionError";
  }
}

export interface AttemptLocatorRegistration {
  identity: AttemptIdentity;
  locator: AttemptLocator;
}

/**
 * 写入侧登记检查：把当前记录根候选与本批 fresh 计划放在同一索引中，第一处异身份同值即失败。
 * 同身份重复登记是幂等；carry 不调用本函数，因此永远不会被新 Run 身份重算。
 */
export function assertLocatorRegistrationsAvailable<T>(
  existing: ReadonlyMap<AttemptLocator, readonly LocatorAttempt<T>[]>,
  registrations: Iterable<AttemptLocatorRegistration>,
): void {
  const identitiesByLocator = new Map<AttemptLocator, AttemptIdentity[]>();
  for (const [locator, candidates] of existing) {
    identitiesByLocator.set(locator, candidates.map((candidate) => candidate.identity));
  }
  for (const registration of registrations) {
    const identities = identitiesByLocator.get(registration.locator) ?? [];
    const conflicting = identities.find((identity) => !attemptIdentitiesEqual(identity, registration.identity));
    if (conflicting) {
      throw new LocatorCollisionError(registration.locator, [conflicting, registration.identity]);
    }
    if (!identities.some((identity) => attemptIdentitiesEqual(identity, registration.identity))) {
      identities.push(registration.identity);
      identitiesByLocator.set(registration.locator, identities);
    }
  }
}

function assertValidIdentity(identity: AttemptIdentity): void {
  if (!identity.runId) throw new Error("encodeAttemptLocator requires a non-empty identity.runId.");
  if (!identity.evalId) throw new Error("encodeAttemptLocator requires a non-empty identity.evalId.");
  if (!Number.isInteger(identity.attempt) || identity.attempt < 0) {
    throw new Error(`encodeAttemptLocator requires identity.attempt to be a non-negative integer, got ${String(identity.attempt)}.`);
  }
}

function canonicalIdentityString(identity: AttemptIdentity): string {
  return JSON.stringify([identity.runId, identity.evalId, identity.attempt]);
}

export function attemptIdentitiesEqual(a: AttemptIdentity, b: AttemptIdentity): boolean {
  return a.runId === b.runId && a.evalId === b.evalId && a.attempt === b.attempt;
}

function identityLabel(identity: AttemptIdentity): string {
  return `${identity.runId} ${identity.evalId} a${identity.attempt}`;
}

/** SHA-256 前 60 bit → 12 位 Crockford base32。 */
function digestPrefixToCrockfordBody(digest: Buffer): string {
  let prefix = 0n;
  for (let index = 0; index < 8; index += 1) prefix = (prefix << 8n) | BigInt(digest[index]!);
  prefix >>= 4n;
  let body = "";
  for (let index = 0; index < BODY_LENGTH; index += 1) {
    body = CROCKFORD_ALPHABET[Number(prefix & 31n)]! + body;
    prefix >>= 5n;
  }
  return body;
}
