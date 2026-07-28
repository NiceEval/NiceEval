// 值匹配共享工具:deepEqual 与 schema 校验的唯一实现。
// expect 匹配器(equals / matches)和 turn.outputEquals / outputMatches 共用同一套,
// 保证「同样两个值在不同断言入口下判定一致」——此前两处各写一份,NaN/Date 行为不同。

/** 小而全的深比较:处理基本值、NaN、数组、Date、纯对象。 */
export function deepEqual(a: unknown, b: unknown): boolean {
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

  const ao = a as globalThis.Record<string, unknown>;
  const bo = b as globalThis.Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * 用 schema 校验 value。优先 Standard Schema(schema['~standard'].validate),
 * 否则退化到 zod 风格的 .safeParse / .parse。校验通过 true,否则 false;任何异常 → false。
 */
export async function validateSchema(value: unknown, schema: unknown): Promise<boolean> {
  try {
    const std = (schema as { ["~standard"]?: { validate?: (v: unknown) => unknown } } | null)?.[
      "~standard"
    ];
    if (std && typeof std.validate === "function") {
      // validate 可能同步也可能返回 Promise;成功结果不带 issues。
      const result = (await std.validate(value)) as { issues?: unknown } | null | undefined;
      return result != null && result.issues == null;
    }

    const zodish = schema as {
      safeParse?: (v: unknown) => { success?: boolean };
      parse?: (v: unknown) => unknown;
    } | null;

    if (zodish && typeof zodish.safeParse === "function") {
      const result = zodish.safeParse(value);
      return Boolean(result && result.success);
    }
    if (zodish && typeof zodish.parse === "function") {
      zodish.parse(value);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
