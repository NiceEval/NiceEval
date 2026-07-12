// AttemptLocator 单测(定稿见 docs/feature/results/library.md「按 locator 寻址一个 attempt」、docs/concepts.md「Attempt 定位符」):
// 确定性编码、字段敏感(任一身份字段变化都换 locator)、@ 前缀与定长 base36 格式、decode 的语法
// 校验分支、大批量下的实际无撞车、buildLocatorIndex 的撞车检测(用可注入的 encode 强制制造撞车,
// 不依赖真实哈希小概率碰撞)与「相同身份重复出现不算撞车」(--resume 携带条目跨快照复现同一身份的场景)、
// resolveAttemptLocator 的 found/malformed/not-found 三态。

import { describe, expect, it } from "vitest";
import {
  ATTEMPT_LOCATOR_PREFIX,
  LocatorCollisionError,
  buildLocatorIndex,
  decodeAttemptLocator,
  encodeAttemptLocator,
  resolveAttemptLocator,
  type AttemptIdentity,
} from "./locator.ts";

function id(over: Partial<AttemptIdentity> = {}): AttemptIdentity {
  return {
    experimentId: "compare/bub",
    snapshotStartedAt: "2026-07-01T08:00:00.000Z",
    evalId: "algebra/q1",
    attempt: 0,
    ...over,
  };
}

describe("encodeAttemptLocator · 确定性与格式", () => {
  it("同一身份元组永远编码出同一个 locator", () => {
    const a = encodeAttemptLocator(id());
    const b = encodeAttemptLocator(id());
    expect(a).toBe(b);
  });

  it("以 @ 开头,后跟 1 位 scheme 字符 + 定长 base36 body", () => {
    const locator = encodeAttemptLocator(id());
    expect(locator.startsWith(ATTEMPT_LOCATOR_PREFIX)).toBe(true);
    expect(locator).toMatch(/^@[0-9a-z]+$/);
    const decoded = decodeAttemptLocator(locator);
    expect(decoded).toEqual({ valid: true, scheme: 1 });
  });

  it("四个身份字段中任一变化,locator 都会变(不会因为拼接歧义碰巧撞上)", () => {
    const base = encodeAttemptLocator(id());
    expect(encodeAttemptLocator(id({ experimentId: "compare/other" }))).not.toBe(base);
    expect(encodeAttemptLocator(id({ snapshotStartedAt: "2026-07-01T08:00:00.001Z" }))).not.toBe(base);
    expect(encodeAttemptLocator(id({ evalId: "algebra/q2" }))).not.toBe(base);
    expect(encodeAttemptLocator(id({ attempt: 1 }))).not.toBe(base);
  });

  it("拒绝非法身份:空字符串字段、非法 attempt", () => {
    expect(() => encodeAttemptLocator(id({ experimentId: "" }))).toThrow();
    expect(() => encodeAttemptLocator(id({ snapshotStartedAt: "" }))).toThrow();
    expect(() => encodeAttemptLocator(id({ evalId: "" }))).toThrow();
    expect(() => encodeAttemptLocator(id({ attempt: -1 }))).toThrow();
    expect(() => encodeAttemptLocator(id({ attempt: 1.5 }))).toThrow();
  });

  it("大批量身份(不同 experiment × eval × attempt × startedAt 组合)实际不撞车", () => {
    const locators = new Set<string>();
    let count = 0;
    for (let exp = 0; exp < 10; exp++) {
      for (let ev = 0; ev < 20; ev++) {
        for (let attempt = 0; attempt < 5; attempt++) {
          for (const startedAt of ["2026-07-01T08:00:00.000Z", "2026-07-02T09:30:00.000Z"]) {
            locators.add(
              encodeAttemptLocator(
                id({ experimentId: `exp-${exp}`, evalId: `group/eval-${ev}`, attempt, snapshotStartedAt: startedAt }),
              ),
            );
            count++;
          }
        }
      }
    }
    expect(count).toBe(2000);
    expect(locators.size).toBe(count);
  });
});

describe("decodeAttemptLocator · 语法校验", () => {
  it("接受一个真实编码出来的 locator", () => {
    expect(decodeAttemptLocator(encodeAttemptLocator(id()))).toEqual({ valid: true, scheme: 1 });
  });

  it.each([
    ["", "空字符串"],
    ["7k2m9qz", "缺 @ 前缀"],
    ["@", "只有前缀,没有 scheme 和 body"],
    ["@1", "只有 scheme,没有 body"],
    ["@1ABC123", "body 含大写字母"],
    ["@1x7f3q!", "body 含非法字符"],
    ["@1abc123", "scheme 1 的 body 长度不对(6 位,期望 7 位)"],
    ["@1abcdefg1", "scheme 1 的 body 长度不对(8 位,期望 7 位)"],
  ])("拒绝畸形 locator %s (%s)", (input) => {
    const result = decodeAttemptLocator(input);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason.length).toBeGreaterThan(0);
  });

  it("scheme 字符非法(不是单个 base36 数字)判定为畸形", () => {
    const result = decodeAttemptLocator("@!x7f3qz");
    expect(result).toEqual({ valid: false, reason: expect.stringContaining("scheme character") });
  });
});

describe("buildLocatorIndex", () => {
  it("正常建索引:每个身份映射到对应的句柄", () => {
    const identities = [id({ evalId: "algebra/q1" }), id({ evalId: "algebra/q2" }), id({ attempt: 1 })];
    const index = buildLocatorIndex(identities.map((identity, i) => ({ identity, handle: `handle-${i}` })));
    expect(index.size).toBe(3);
    for (let i = 0; i < identities.length; i++) {
      expect(index.get(encodeAttemptLocator(identities[i]))).toBe(`handle-${i}`);
    }
  });

  it("相同身份重复出现不算撞车(--resume 携带条目跨快照复现同一身份);索引仍只有一条,后者覆盖前者", () => {
    const identity = id();
    const index = buildLocatorIndex([
      { identity, handle: "old-snapshot-handle" },
      { identity, handle: "new-snapshot-handle" },
    ]);
    expect(index.size).toBe(1);
    expect(index.get(encodeAttemptLocator(identity))).toBe("new-snapshot-handle");
  });

  it("两个不同身份撞车时抛出 LocatorCollisionError,携带 locator 与两个身份", () => {
    // 用可注入的 encode 强制制造撞车:真实哈希函数下撞车概率可忽略,不适合用来做确定性测试。
    const forcedCollision = (_identity: AttemptIdentity): ReturnType<typeof encodeAttemptLocator> =>
      "@1collided" as ReturnType<typeof encodeAttemptLocator>;
    const a = id({ evalId: "algebra/q1" });
    const b = id({ evalId: "algebra/q2" });
    let thrown: unknown;
    try {
      buildLocatorIndex(
        [
          { identity: a, handle: "handle-a" },
          { identity: b, handle: "handle-b" },
        ],
        forcedCollision,
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(LocatorCollisionError);
    const err = thrown as LocatorCollisionError;
    expect(err.locator).toBe("@1collided");
    expect(err.identities).toEqual([a, b]);
    expect(err.message).toContain("collision");
  });

  it("撞车中若第三个身份与已记录身份相同,不重复抛错(只有真正不同的身份对才算撞车)", () => {
    const sameEncode = (() => {
      let calls = 0;
      return (_identity: AttemptIdentity) => {
        calls++;
        return `@1samesame` as ReturnType<typeof encodeAttemptLocator>;
      };
    })();
    const identity = id();
    const index = buildLocatorIndex(
      [
        { identity, handle: "first" },
        { identity, handle: "second" },
      ],
      sameEncode,
    );
    expect(index.size).toBe(1);
  });
});

describe("resolveAttemptLocator", () => {
  const identity = id();
  const index = buildLocatorIndex([{ identity, handle: { name: "the-attempt" } }]);
  const locator = encodeAttemptLocator(identity);

  it("找到:返回 found 连同 locator 与句柄", () => {
    const result = resolveAttemptLocator(index, locator);
    expect(result).toEqual({ kind: "found", locator, handle: { name: "the-attempt" } });
  });

  it("语法不对:返回 malformed,不查索引", () => {
    const result = resolveAttemptLocator(index, "not-a-locator");
    expect(result.kind).toBe("malformed");
    if (result.kind === "malformed") {
      expect(result.input).toBe("not-a-locator");
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("语法对但索引里没有:返回 not-found", () => {
    // 构造一个语法合法但从未被 encode 出来过的 locator。
    const unknown = "@1zzzzzzz";
    expect(decodeAttemptLocator(unknown).valid).toBe(true);
    const result = resolveAttemptLocator(index, unknown);
    expect(result).toEqual({ kind: "not-found", locator: unknown });
  });
});
