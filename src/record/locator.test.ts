// owner: docs/engineering/testing/unit/record.md#60-bit-locator-碰撞
// cases: docs/engineering/testing/unit/record.md
// 60-bit locator 碰撞不能由真实 E2E 概率性、稳定地制造；只保留冲突的读写两侧。

import { describe, expect, it } from "vitest";
import {
  LocatorCollisionError,
  assertLocatorRegistrationsAvailable,
  buildLocatorIndex,
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

describe("locator 多候选索引与解析", () => {
  it("同 locator 的每个候选都保留，resolve 返回 ambiguous 而不任选一个", () => {
    const locator = encodeAttemptLocator(id());
    const first = { identity: id(), handle: "first", locator };
    const second = { identity: id({ runId: "other-run" }), handle: "second", locator };
    const index = buildLocatorIndex([first, second]);

    expect(resolveAttemptLocator(index, locator)).toEqual({
      kind: "ambiguous",
      locator,
      candidates: [first, second],
    });
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
});
