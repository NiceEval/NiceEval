// 值级断言匹配器(expect)。每个匹配器产出一个 ValueAssertion:纯函数 score +
// 可链式改严重级 / 阈值。链式方法返回全新的不可变 ValueAssertion,复用同一个 score。

import type { Severity, ValueAssertion } from "../types.ts";
import { stripComments } from "../util.ts";
import { deepEqual, validateSchema } from "../scoring/match.ts";

// 自定义匹配器作者用的公共类型(docs/scoring.md 的 `Assertion` 即它)。
export type { Severity, ValueAssertion } from "../types.ts";
export type { ValueAssertion as Assertion } from "../types.ts";

/** includes / excludes 的可选项。stripComments:先剥注释再匹配(只对真实代码生效)。 */
export interface MatchOptions {
  stripComments?: boolean;
}

// ───────────────────────── 内部工厂 ─────────────────────────

/**
 * 唯一的内部工厂。gate()/atLeast() 都基于它返回新的不可变实例,
 * 共享同一个 score(只换 severity / threshold)。
 */
function createAssertion(
  name: string,
  severity: Severity,
  score: (value: unknown) => number | Promise<number>,
  threshold?: number,
): ValueAssertion {
  const self: ValueAssertion = {
    name,
    severity,
    threshold,
    score,
    // 转成硬门槛(失败即整条 eval 不通过)。
    gate: (t?: number) => createAssertion(name, "gate", score, t),
    // 软阈值:默认不改变 verdict;--strict 下软阈值失败也会使 verdict=failed。
    atLeast: (t: number) => createAssertion(name, "soft", score, t),
  };
  return Object.freeze(self);
}

// ───────────────────────── 工具函数 ─────────────────────────

/** 给断言起个可读名时用,JSON.stringify 失败 / 为 undefined 时回退到 String。 */
function safeLabel(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** 经典 DP 编辑距离(滚动两行)。 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

// ───────────────────────── 匹配器 ─────────────────────────

/** 把 value 转成待匹配字符串;opts.stripComments 时先剥注释。 */
function toMatchTarget(value: unknown, opts?: MatchOptions): string {
  const s = String(value);
  return opts?.stripComments ? stripComments(s) : s;
}

/** String(value) 含子串 / 命中正则则 1,否则 0。默认硬门槛。opts.stripComments 时只看真实代码。 */
export function includes(needle: string | RegExp, opts?: MatchOptions): ValueAssertion {
  const label = needle instanceof RegExp ? needle.toString() : safeLabel(needle);
  const suffix = opts?.stripComments ? ", stripComments" : "";
  return createAssertion(`includes(${label}${suffix})`, "gate", (value) => {
    const s = toMatchTarget(value, opts);
    if (needle instanceof RegExp) return needle.test(s) ? 1 : 0;
    return s.includes(needle) ? 1 : 0;
  });
}

/** includes 的取反:不含子串 / 不命中正则则 1,否则 0。默认硬门槛。opts.stripComments 时只看真实代码。 */
export function excludes(needle: string | RegExp, opts?: MatchOptions): ValueAssertion {
  const label = needle instanceof RegExp ? needle.toString() : safeLabel(needle);
  const suffix = opts?.stripComments ? ", stripComments" : "";
  return createAssertion(`excludes(${label}${suffix})`, "gate", (value) => {
    const s = toMatchTarget(value, opts);
    if (needle instanceof RegExp) return needle.test(s) ? 0 : 1;
    return s.includes(needle) ? 0 : 1;
  });
}

/** 深相等则 1,否则 0。默认硬门槛。 */
export function equals(expected: unknown): ValueAssertion {
  return createAssertion(`equals(${safeLabel(expected)})`, "gate", (value) =>
    deepEqual(value, expected) ? 1 : 0,
  );
}

/**
 * 用 schema 校验 value——不是正则匹配,是 Standard Schema / zod 风格的结构校验。
 * 优先 Standard Schema(schema['~standard'].validate),否则退化到 zod 风格的
 * .safeParse / .parse。校验通过 1,否则 0;任何异常 → 0。默认硬门槛。
 */
export function matches(schema: unknown): ValueAssertion {
  return createAssertion("matches(schema)", "gate", async (value) =>
    (await validateSchema(value, schema)) ? 1 : 0,
  );
}

/**
 * 纯字符串编辑距离,不是语义相似度——归一化 Levenshtein 距离 [0,1](1 - 编辑距离 / 较长串长度),
 * 不理解含义,同义改写 / 语序调整会被判低分。默认软分,阈值 0.6。
 */
export function similarity(expected: string): ValueAssertion {
  return createAssertion(
    `similarity(${safeLabel(expected)})`,
    "soft",
    (value) => {
      const a = String(value);
      const b = expected;
      const maxLen = Math.max(a.length, b.length);
      if (maxLen === 0) return 1; // 两个空串视为完全相同
      return 1 - levenshtein(a, b) / maxLen;
    },
    0.6,
  );
}

/** 谓词为真则 1,否则 0。默认硬门槛;name 带上 label 便于报告辨认。 */
export function satisfies(predicate: (v: unknown) => boolean, label?: string): ValueAssertion {
  const name = label ? `satisfies(${label})` : "satisfies(predicate)";
  return createAssertion(name, "gate", (value) => (predicate(value) ? 1 : 0));
}

/** value 非 null / 非 undefined 则 1,否则 0。省掉 `x !== undefined` + isTrue 的样板。默认硬门槛。 */
export function isDefined(label?: string): ValueAssertion {
  const name = label ? `isDefined(${label})` : "isDefined()";
  return createAssertion(name, "gate", (value) => (value != null ? 1 : 0));
}

/** value === true 则 1,否则 0。带 label 的布尔断言(fileExists 等检查用)。默认硬门槛。 */
export function isTrue(label?: string): ValueAssertion {
  const name = label ? `isTrue(${label})` : "isTrue()";
  return createAssertion(name, "gate", (value) => (value === true ? 1 : 0));
}

/** CommandResult.exitCode === 0 则 1,否则 0。默认硬门槛。 */
export function commandSucceeded(): ValueAssertion {
  return createAssertion("commandSucceeded()", "gate", (value) => {
    if (value === null || typeof value !== "object") return 0;
    return (value as { exitCode?: unknown }).exitCode === 0 ? 1 : 0;
  });
}

/** value === false 则 1,否则 0。带 label 的布尔断言。默认硬门槛。 */
export function isFalse(label?: string): ValueAssertion {
  const name = label ? `isFalse(${label})` : "isFalse()";
  return createAssertion(name, "gate", (value) => (value === false ? 1 : 0));
}

/**
 * 自定义断言工厂:直接给名字 / 严重级 / 阈值 / score,一次调用即返回可用的 ValueAssertion——
 * 不像 gate()/atLeast() 那样需要二段链式调用来定级。severity 省略默认 gate。
 */
export function makeAssertion(spec: {
  name: string;
  severity?: Severity;
  threshold?: number;
  score: (value: unknown) => number | Promise<number>;
}): ValueAssertion {
  return createAssertion(spec.name, spec.severity ?? "gate", spec.score, spec.threshold);
}
