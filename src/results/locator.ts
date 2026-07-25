// AttemptLocator:Attempt 的不透明、可复制、可发布的短标识(定稿见 docs/feature/record/library.md
// 「按 locator 寻址一个 attempt」、docs/concepts.md「Attempt 定位符」、docs/feature/reports/view.md 的 `#/attempt/@<locator>` 路由)。
//
// locator 由不可变身份元组 {experimentId, 快照 startedAt, evalId, attempt 下标(0-indexed)}
// 确定性派生 —— 不是数组下标、不是当前 Selection 顺序、不编码快照目录名或磁盘路径。
// 这份身份与磁盘布局(attemptDirOf/experimentDirOf,见 format.ts)是两回事:身份稳定,
// 目录名可能因清洗规则或历史原因漂移。
//
// 本模块只管编码/解码/批量建索引这三件事,不碰磁盘、不知道 AttemptHandle 长什么样——
// reader(open.ts)后续集成时,拿着扫描出的每个 attempt 的身份元组调 buildLocatorIndex,
// 建一份 locator → AttemptHandle 的索引;CLI 层拿用户输入的 "@..." 串调 resolveAttemptLocator。

import { createHash } from "node:crypto";

/** 不透明的 Attempt 定位符:`@` + 1 位 scheme 字符 + 定长 base36 body。字符串品牌,防止和普通 string 混用。 */
export type AttemptLocator = string & { readonly __brand: "AttemptLocator" };

/** locator 派生自的不可变身份元组;attempt 是 EvalResult.attempt 的 0-indexed 值,不是展示用的 1-indexed 序号。 */
export interface AttemptIdentity {
  experimentId: string;
  /** SnapshotMeta.startedAt 字段(不是快照目录名——两者通常但不总是相等,见 writer.ts 的说明)。 */
  snapshotStartedAt: string;
  evalId: string;
  /** 0-indexed;展示层(CLI/show)在边界处 +1,身份本身永远用内部下标。 */
  attempt: number;
}

/** locator 前缀,恒为 `@`;与 Eval id 前缀在 CLI 位置参数解析里无歧义(eval id 不以 `@` 起头)。 */
export const ATTEMPT_LOCATOR_PREFIX = "@";

/** 当前编码 scheme 版本;scheme 字符本身就是这个数的 36 进制单字符(1 → "1")。 */
const CURRENT_SCHEME = 1;
/** scheme 字符之后的定长 body 长度(base36 字符数)。36^7 ≈ 7.8×10^10,批量建索引撞车概率可忽略。 */
const BODY_LENGTH = 7;
const RADIX = 36;
const BODY_PATTERN = /^[0-9a-z]+$/;

/**
 * 确定性、带版本编码:同一身份元组永远产出同一 locator;scheme 版本混进哈希输入,
 * 一旦编码规则升级(scheme 号递增),新旧两代 locator 天然落在不同哈希空间,不会互相撞车。
 */
export function encodeAttemptLocator(identity: AttemptIdentity): AttemptLocator {
  assertValidIdentity(identity);
  const schemeChar = CURRENT_SCHEME.toString(RADIX);
  const canonical = canonicalIdentityString(identity);
  const digest = createHash("sha256").update(`niceeval.attempt-locator.v${CURRENT_SCHEME}\u0000${canonical}`).digest();
  const body = digestToBase36Body(digest);
  return `${ATTEMPT_LOCATOR_PREFIX}${schemeChar}${body}` as AttemptLocator;
}

/** decodeAttemptLocator 的结果:locator 是身份的单向哈希,这里只判断字符串本身合不合法,不还原身份元组。 */
export type LocatorDecodeResult = { valid: true; scheme: number } | { valid: false; reason: string };

/**
 * 语法校验:`@` 前缀 + scheme 字符 + body。不查 body 是否真对应某个已知 Attempt——
 * 那是 reader 建好的 locator → AttemptHandle 索引的事(resolveAttemptLocator)。
 */
export function decodeAttemptLocator(locator: string): LocatorDecodeResult {
  if (typeof locator !== "string" || locator.length === 0) {
    return { valid: false, reason: "Locator is empty." };
  }
  if (!locator.startsWith(ATTEMPT_LOCATOR_PREFIX)) {
    return { valid: false, reason: `Locator must start with "${ATTEMPT_LOCATOR_PREFIX}" (got "${locator}").` };
  }
  const rest = locator.slice(ATTEMPT_LOCATOR_PREFIX.length);
  if (rest.length < 2) {
    return { valid: false, reason: `Locator "${locator}" is too short to contain a scheme character and a body.` };
  }
  const schemeChar = rest[0];
  const scheme = Number.parseInt(schemeChar, RADIX);
  if (!Number.isInteger(scheme) || scheme < 0 || schemeChar !== scheme.toString(RADIX)) {
    return { valid: false, reason: `Locator "${locator}" has an invalid scheme character "${schemeChar}".` };
  }
  const body = rest.slice(1);
  if (!BODY_PATTERN.test(body)) {
    return { valid: false, reason: `Locator "${locator}" body must be lowercase base36 (0-9, a-z); got "${body}".` };
  }
  if (scheme === CURRENT_SCHEME && body.length !== BODY_LENGTH) {
    return {
      valid: false,
      reason: `Locator "${locator}" declares scheme ${scheme} but its body has length ${body.length} (expected ${BODY_LENGTH}).`,
    };
  }
  return { valid: true, scheme };
}

/** buildLocatorIndex 的输入项:一个已知 Attempt 的身份 + 调用方自己的句柄类型(通常是 AttemptHandle)。 */
export interface LocatorAttempt<T> {
  identity: AttemptIdentity;
  handle: T;
}

/**
 * 撞车:两个不同的身份元组独立编码出了同一个 locator 字符串。设计上应当极其罕见
 * (见 BODY_LENGTH 的空间量级),但绝不能被静默吞掉——reader 打开结果根时一旦命中,
 * 直接抛出,交给上层(未来的 CLI 层)决定怎么给用户看。
 */
export class LocatorCollisionError extends Error {
  constructor(
    public readonly locator: AttemptLocator,
    public readonly identities: readonly [AttemptIdentity, AttemptIdentity],
  ) {
    super(
      `Attempt locator collision: "${locator}" was independently derived for two different attempts ` +
        `(${identityLabel(identities[0])} and ${identityLabel(identities[1])}). ` +
        "This should be astronomically unlikely; if it happens, the encoding scheme needs a wider body.",
    );
    this.name = "LocatorCollisionError";
  }
}

/**
 * 批量建 locator → 句柄索引。同一身份元组出现多次(如 --resume 携带条目在新旧两个快照里
 * 都能被扫描到,身份沿用原 Attempt 不变)不算撞车,后出现的覆盖先出现的;真正撞车
 * ——两个不同身份编码同一个字符串——才抛 LocatorCollisionError。
 *
 * @param encode @internal 仅供测试注入确定性会撞车的编码函数;生产调用不传,用默认实现。
 */
export function buildLocatorIndex<T>(
  attempts: Iterable<LocatorAttempt<T>>,
  encode: (identity: AttemptIdentity) => AttemptLocator = encodeAttemptLocator,
): Map<AttemptLocator, T> {
  const index = new Map<AttemptLocator, T>();
  const identityByLocator = new Map<AttemptLocator, AttemptIdentity>();
  for (const { identity, handle } of attempts) {
    const locator = encode(identity);
    const prior = identityByLocator.get(locator);
    if (prior && !identitiesEqual(prior, identity)) {
      throw new LocatorCollisionError(locator, [prior, identity]);
    }
    identityByLocator.set(locator, identity);
    index.set(locator, handle);
  }
  return index;
}

/** resolveAttemptLocator 的结果:found / malformed / not-found 三种失败模式互相区分,不折叠成一个 Error。 */
export type LocatorResolution<T> =
  | { kind: "found"; locator: AttemptLocator; handle: T }
  | { kind: "malformed"; input: string; reason: string }
  | { kind: "not-found"; locator: AttemptLocator };

/**
 * 拿用户输入的原始字符串(通常来自 CLI 的 `@...` 位置参数)在已建好的索引里查找。
 * 先语法校验(decodeAttemptLocator),语法都不对就不必查索引;语法对但索引里没有 ——
 * 已损坏、已过期(指向被清理的快照)、或纯粹打错——一律 not-found,由调用方决定怎么提示。
 */
export function resolveAttemptLocator<T>(index: ReadonlyMap<AttemptLocator, T>, input: string): LocatorResolution<T> {
  const decoded = decodeAttemptLocator(input);
  if (!decoded.valid) {
    return { kind: "malformed", input, reason: decoded.reason };
  }
  const locator = input as AttemptLocator;
  const handle = index.get(locator);
  if (handle === undefined) {
    return { kind: "not-found", locator };
  }
  return { kind: "found", locator, handle };
}

// ───────────────────────── 内部实现 ─────────────────────────

function assertValidIdentity(identity: AttemptIdentity): void {
  if (!identity.experimentId) throw new Error("encodeAttemptLocator requires a non-empty identity.experimentId.");
  if (!identity.snapshotStartedAt) throw new Error("encodeAttemptLocator requires a non-empty identity.snapshotStartedAt.");
  if (!identity.evalId) throw new Error("encodeAttemptLocator requires a non-empty identity.evalId.");
  if (!Number.isInteger(identity.attempt) || identity.attempt < 0) {
    throw new Error(`encodeAttemptLocator requires identity.attempt to be a non-negative integer, got ${String(identity.attempt)}.`);
  }
}

/** 身份元组 → 规范字符串:JSON 数组序列化天然转义、定长分隔,不会因字段内容碰巧含分隔符而歧义。 */
function canonicalIdentityString(identity: AttemptIdentity): string {
  return JSON.stringify([identity.experimentId, identity.snapshotStartedAt, identity.evalId, identity.attempt]);
}

function identitiesEqual(a: AttemptIdentity, b: AttemptIdentity): boolean {
  return (
    a.experimentId === b.experimentId &&
    a.snapshotStartedAt === b.snapshotStartedAt &&
    a.evalId === b.evalId &&
    a.attempt === b.attempt
  );
}

function identityLabel(identity: AttemptIdentity): string {
  return `${identity.experimentId}@${identity.snapshotStartedAt} ${identity.evalId} a${identity.attempt}`;
}

/** sha256 摘要(32 字节)→ 定长 base36 字符串:把摘要视为一个大整数取模,均匀落进 [0, 36^BODY_LENGTH)。 */
const BODY_MODULUS = BigInt(RADIX) ** BigInt(BODY_LENGTH);

function digestToBase36Body(digest: Buffer): string {
  let n = 0n;
  for (const byte of digest) n = (n << 8n) | BigInt(byte);
  return (n % BODY_MODULUS).toString(RADIX).padStart(BODY_LENGTH, "0");
}
