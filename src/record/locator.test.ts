// cases: docs/engineering/testing/unit/record.md

import { describe, expect, it } from "vitest";
import {
  ATTEMPT_LOCATOR_PREFIX,
  LocatorCollisionError,
  assertLocatorRegistrationsAvailable,
  buildLocatorIndex,
  decodeAttemptLocator,
  encodeAttemptLocator,
  resolveAttemptLocator,
  type AttemptIdentity,
} from "./locator.ts";

function id(overrides: Partial<AttemptIdentity> = {}): AttemptIdentity {
  return {
    runId: "550e8400-e29b-41d4-a716-446655440000",
    evalId: "algebra/q1",
    attempt: 0,
    ...overrides,
  };
}

describe("encodeAttemptLocator · finalized 60-bit Crockford 契约", () => {
  it("固定身份得到固定向量；形态严格为 @ + scheme + 12 位 Crockford base32", () => {
    const locator = encodeAttemptLocator(id());
    // 固定向量独立钉住 canonical tuple、SHA-256 前 60 bit 与 Crockford 字母表，
    // 不在测试里调用另一份期望值算法。
    expect(locator).toBe("@1SDY7M94VEFSS");
    expect(locator.startsWith(ATTEMPT_LOCATOR_PREFIX)).toBe(true);
    expect(locator).toMatch(/^@1[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(decodeAttemptLocator(locator)).toEqual({ valid: true, scheme: 1 });
  });

  it("三个身份字段中任一变化都会改变 locator", () => {
    const base = encodeAttemptLocator(id());
    expect(encodeAttemptLocator(id({ runId: "550e8400-e29b-41d4-a716-446655440001" }))).not.toBe(base);
    expect(encodeAttemptLocator(id({ evalId: "algebra/q2" }))).not.toBe(base);
    expect(encodeAttemptLocator(id({ attempt: 1 }))).not.toBe(base);
  });

  it("拒绝空身份和非法 attempt", () => {
    expect(() => encodeAttemptLocator(id({ runId: "" }))).toThrow(/runId/);
    expect(() => encodeAttemptLocator(id({ evalId: "" }))).toThrow(/evalId/);
    expect(() => encodeAttemptLocator(id({ attempt: -1 }))).toThrow(/attempt/);
    expect(() => encodeAttemptLocator(id({ attempt: 1.5 }))).toThrow(/attempt/);
  });

  it("一批不同 Run × Eval × attempt 身份不碰撞", () => {
    const locators = new Set<string>();
    let count = 0;
    for (let run = 0; run < 20; run += 1) {
      for (let evalIndex = 0; evalIndex < 20; evalIndex += 1) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          locators.add(encodeAttemptLocator(id({ runId: `run-${run}`, evalId: `group/eval-${evalIndex}`, attempt })));
          count += 1;
        }
      }
    }
    expect(count).toBe(2000);
    expect(locators.size).toBe(count);
  });
});

describe("decodeAttemptLocator · 严格语法", () => {
  it.each([
    ["", "空字符串"],
    ["1SDY7M94VEFSS", "缺 @"],
    ["@1SDY7M94VEFS", "body 11 位"],
    ["@1SDY7M94VEFSS0", "body 13 位"],
    ["@1sdy7m94vefss", "小写不是 canonical Crockford"],
    ["@1SDY7M94VEFSO", "O 是 Crockford 排除字符"],
    ["@1SDY7M94VEFSI", "I 是 Crockford 排除字符"],
    ["@!SDY7M94VEFSS", "scheme 非数字"],
  ])("拒绝畸形 locator %s (%s)", (input) => {
    const result = decodeAttemptLocator(input);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason.length).toBeGreaterThan(0);
  });

  it("另一数字 scheme 仍是语法合法 locator；是否存在交给索引", () => {
    expect(decodeAttemptLocator("@2SDY7M94VEFSS")).toEqual({ valid: true, scheme: 2 });
  });
});

describe("locator 多候选索引与解析", () => {
  it("单候选 found；空索引 not-found；坏串 malformed", () => {
    const identity = id();
    const index = buildLocatorIndex([{ identity, handle: { name: "the-attempt" } }]);
    const locator = encodeAttemptLocator(identity);
    expect(resolveAttemptLocator(index, locator)).toEqual({ kind: "found", locator, handle: { name: "the-attempt" } });
    expect(resolveAttemptLocator(index, "@1ZZZZZZZZZZZZ")).toEqual({ kind: "not-found", locator: "@1ZZZZZZZZZZZZ" });
    expect(resolveAttemptLocator(index, "not-a-locator").kind).toBe("malformed");
  });

  it("同 locator 的每个候选都保留，resolve 返回 ambiguous 而不任选一个", () => {
    const locator = encodeAttemptLocator(id());
    const first = { identity: id(), handle: "first", locator };
    const second = { identity: id({ runId: "other-run" }), handle: "second", locator };
    const index = buildLocatorIndex([first, second]);
    expect(index.get(locator)).toEqual([first, second]);
    expect(resolveAttemptLocator(index, locator)).toEqual({ kind: "ambiguous", locator, candidates: [first, second] });
  });
});

describe("fresh locator 调度前登记", () => {
  it("当前记录根已有异身份同 locator 时抛 LocatorCollisionError；同身份重放幂等", () => {
    const locator = encodeAttemptLocator(id());
    const existing = buildLocatorIndex([{ identity: id(), handle: "persisted", locator }]);
    expect(() =>
      assertLocatorRegistrationsAvailable(existing, [{ identity: id({ runId: "new-run" }), locator }]),
    ).toThrow(LocatorCollisionError);
    expect(() => assertLocatorRegistrationsAvailable(existing, [{ identity: id(), locator }])).not.toThrow();
  });

  it("同一批 fresh 登记内部出现异身份同值也立即失败", () => {
    const locator = encodeAttemptLocator(id());
    expect(() =>
      assertLocatorRegistrationsAvailable(new Map(), [
        { identity: id(), locator },
        { identity: id({ evalId: "algebra/q2" }), locator },
      ]),
    ).toThrow(LocatorCollisionError);
  });
});
