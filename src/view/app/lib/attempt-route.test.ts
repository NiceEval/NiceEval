// #/attempt/@<locator> 深链的纯函数单测:解析 / 格式化往返、坏输入、按 locator 定位。

import { describe, expect, it } from "vitest";
import { formatAttemptHash, parseAttemptHash, resolveAttemptLocator } from "./attempt-route.ts";
import type { AttemptLocator, ViewResult, ViewSnapshot } from "../types.ts";

const LOCATOR_A = "@1abc123" as AttemptLocator;
const LOCATOR_B = "@1zzz999" as AttemptLocator;

const attempt = (locator: AttemptLocator | undefined, index: number): ViewResult => ({
  id: `demo/eval-${index}`,
  agent: "demo-agent",
  verdict: "passed",
  attempt: 0,
  durationMs: 1,
  assertions: [],
  ...(locator !== undefined ? { locator } : {}),
});

// 快照只有 results 参与定位,其余元信息字段与路由无关。
const snap = (results: ViewResult[]): ViewSnapshot => ({ results }) as ViewSnapshot;

describe("parseAttemptHash / formatAttemptHash", () => {
  it("parses the canonical `@<scheme><body>` locator shape", () => {
    expect(parseAttemptHash("#/attempt/@1abc123")).toBe("@1abc123");
  });

  it("round-trips through formatAttemptHash", () => {
    for (const locator of [LOCATOR_A, LOCATOR_B, "@10000000" as AttemptLocator]) {
      expect(parseAttemptHash(formatAttemptHash(locator))).toBe(locator);
    }
  });

  it("formatAttemptHash matches the report tree's DEFAULT_WEB_CONTEXT.attemptHref format exactly", () => {
    // src/report/tree.ts: attemptHref: (locator) => `#/attempt/${locator}` — locator 本身自带 "@" 前缀。
    expect(formatAttemptHash(LOCATOR_A)).toBe(`#/attempt/${LOCATOR_A}`);
  });

  it("rejects non-attempt hashes and malformed shapes", () => {
    for (const hash of [
      "",
      "#",
      "#/",
      "#tab-experiments", // 页内锚点不归这条路由
      "#/compare/a/b",
      "#/attempt",
      "#/attempt/",
      "#/attempt/exp/snap/eval/a0", // 旧的两段式路由,不再被接受
      "#/attempt/nolocatorprefix",
      "#/attempt/@", // 只有前缀,没有 scheme + body
      "#/attempt/@ABC123", // 大写不合法(base36 恒小写)
      "#/attempt/@1abc 123", // 含空格
      "#/attempt/@1abc/123", // 含 "/"
    ]) {
      expect(parseAttemptHash(hash), hash).toBeNull();
    }
  });
});

describe("resolveAttemptLocator", () => {
  const snapshots = [
    snap([attempt(LOCATOR_A, 0), attempt(LOCATOR_B, 1)]),
    snap([attempt("@1other01" as AttemptLocator, 2)]),
  ];

  it("finds the attempt whose injected locator matches", () => {
    expect(resolveAttemptLocator(snapshots, LOCATOR_A)).toBe(snapshots[0]!.results[0]);
    expect(resolveAttemptLocator(snapshots, LOCATOR_B)).toBe(snapshots[0]!.results[1]);
  });

  it("returns null for unknown locators", () => {
    expect(resolveAttemptLocator(snapshots, "@1nosuch1" as AttemptLocator)).toBeNull();
  });

  it("returns null when results predate locator injection (old baked data)", () => {
    const legacy = attempt(undefined, 0);
    expect(resolveAttemptLocator([snap([legacy])], LOCATOR_A)).toBeNull();
  });
});
