// 值级断言匹配器(expect)。每个匹配器产出一个 ValueAssertion:纯函数 score +
// 可链式改严重级 / 阈值。链式方法返回全新的不可变 ValueAssertion,复用同一个 score。

import type { Severity, ValueAssertion } from "../types.ts";

// ───────────────────────── 内部工厂 ─────────────────────────

/**
 * 唯一的内部工厂。gate()/soft()/atLeast() 都基于它返回新的不可变实例,
 * 三者共享同一个 score(只换 severity / threshold)。
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
    gate: () => createAssertion(name, "gate", score, threshold),
    // 转成软分(threshold 省略则沿用现有阈值)。
    soft: (t?: number) => createAssertion(name, "soft", score, t ?? threshold),
    // 软分 + 显式阈值。
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

/** 小而全的深比较:处理基本值、NaN、数组、Date、纯对象。 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  // NaN === NaN
  if (typeof a === "number" && typeof b === "number") {
    return Number.isNaN(a) && Number.isNaN(b);
  }

  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }

  // Date 按时间戳比
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }

  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;

  if (aIsArr && bIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
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

/** String(value) 含子串 / 命中正则则 1,否则 0。默认硬门槛。 */
export function includes(needle: string | RegExp): ValueAssertion {
  const label = needle instanceof RegExp ? needle.toString() : safeLabel(needle);
  return createAssertion(`includes(${label})`, "gate", (value) => {
    const s = String(value);
    if (needle instanceof RegExp) return needle.test(s) ? 1 : 0;
    return s.includes(needle) ? 1 : 0;
  });
}

/** 深相等则 1,否则 0。默认硬门槛。 */
export function equals(expected: unknown): ValueAssertion {
  return createAssertion(`equals(${safeLabel(expected)})`, "gate", (value) =>
    deepEqual(value, expected) ? 1 : 0,
  );
}

/**
 * 用 schema 校验 value。优先 Standard Schema(schema['~standard'].validate),
 * 否则退化到 zod 风格的 .safeParse / .parse。校验通过 1,否则 0;任何异常 → 0。
 */
export function matches(schema: unknown): ValueAssertion {
  return createAssertion("matches(schema)", "gate", async (value) => {
    try {
      const std = (schema as { ["~standard"]?: { validate?: (v: unknown) => unknown } } | null)?.[
        "~standard"
      ];
      if (std && typeof std.validate === "function") {
        // validate 可能同步也可能返回 Promise;成功结果不带 issues。
        const result = (await std.validate(value)) as { issues?: unknown } | null | undefined;
        return result != null && result.issues == null ? 1 : 0;
      }

      const zodish = schema as {
        safeParse?: (v: unknown) => { success?: boolean };
        parse?: (v: unknown) => unknown;
      } | null;

      if (zodish && typeof zodish.safeParse === "function") {
        const result = zodish.safeParse(value);
        return result && result.success ? 1 : 0;
      }
      if (zodish && typeof zodish.parse === "function") {
        zodish.parse(value);
        return 1;
      }
      return 0;
    } catch {
      return 0;
    }
  });
}

/** 归一化 Levenshtein 相似度 [0,1]。默认软分,阈值 0.6。 */
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

/** 自定义断言工厂:直接给名字 / 严重级 / 阈值 / score。severity 省略默认 gate。 */
export function makeAssertion(spec: {
  name: string;
  severity?: Severity;
  threshold?: number;
  score: (value: unknown) => number | Promise<number>;
}): ValueAssertion {
  return createAssertion(spec.name, spec.severity ?? "gate", spec.score, spec.threshold);
}
