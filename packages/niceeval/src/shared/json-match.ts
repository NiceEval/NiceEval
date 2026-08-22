import type { JsonMatch, JsonValue } from "./types.ts";

/** 按 JsonMatch 递归匹配；对象为部分匹配，数组为等长逐项匹配。 */
export function matchesJson(actual: JsonValue | undefined, expected: JsonMatch): boolean {
  return matchesJsonAt(actual, expected, actual);
}

function matchesJsonAt(actual: JsonValue | undefined, expected: JsonMatch, root: JsonValue | undefined): boolean {
  if (expected instanceof RegExp) {
    if (typeof actual === "string" && testRegExp(expected, actual)) return true;
    try {
      return testRegExp(expected, JSON.stringify(root) ?? String(root));
    } catch {
      return false;
    }
  }
  if (typeof expected === "function") return Boolean(expected(actual));
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => matchesJsonAt(actual[index], item, root))
    );
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return false;
    const actualObject = actual as globalThis.Record<string, JsonValue>;
    return Object.entries(expected).every(([key, value]) => matchesJsonAt(actualObject[key], value, root));
  }
  return Object.is(actual, expected);
}

function testRegExp(re: RegExp, value: string): boolean {
  re.lastIndex = 0;
  return re.test(value);
}

function isPlainObject(value: unknown): value is globalThis.Record<string, JsonMatch> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
