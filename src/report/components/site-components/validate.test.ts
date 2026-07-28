// cases: docs/engineering/testing/unit/reports.md
// "validate*Data 递归覆盖到嵌套字段" 行:site-components 五个 validate*Data 的表驱动字段突变覆盖,重点是 SampleIssue 三个已登记
// kind(unfinished-run / missing-startedAt / unreadable-run)各自的必填字段,以及未登记 kind 的前向兼容放行路径(与 ScopeWarnings 组件的「未知 kind
// 单独成组」渲染回退是同一条契约,结构校验不能比渲染逻辑更严);以及 SnapshotDiagnostics 的 SnapshotDiagnosticsItem/DiagnosticRecord 嵌套字段。

import { describe, expect, it } from "vitest";
import {
  validateCopyFixPromptData,
  validateHeroData,
  validateScopeWarningsData,
  validateSnapshotDiagnosticsData,
  validateTraceWaterfallData,
} from "./index.tsx";

describe("validateHeroData", () => {
  it("合规 literal 通过,latestStartedAt 为 null 合法(空范围不编造当前时间)", () => {
    expect(validateHeroData({ latestStartedAt: null, runs: 0 })).toBeNull();
  });

  it("runs 非数字报错", () => {
    expect(validateHeroData({ latestStartedAt: null, runs: "0" })).toMatch(/"runs"/);
  });
});

describe("validateScopeWarningsData — SampleIssue 判别联合", () => {
  it("dangling-evidence 缺 evalId 报错", () => {
    const bad = [{ code: "dangling-evidence", experimentId: "exp/a", attempt: 1, artifactBase: "result", artifacts: [] }];
    expect(validateScopeWarningsData(bad)).toMatch(/"data\[0\]\.evalId"/);
    const ok = [{ code: "dangling-evidence", experimentId: "exp/a", evalId: "q1", attempt: 1, artifactBase: "result", artifacts: [] }];
    expect(validateScopeWarningsData(ok)).toBeNull();
  });

  it("unfinished-run 缺 dir 报错", () => {
    const bad = [{ code: "unfinished-run", experimentId: "exp/a", startedAt: "t1" }];
    expect(validateScopeWarningsData(bad)).toMatch(/"data\[0\]\.dir"/);
  });

  it("unreadable-run 的 reason 不在三态枚举内报错;没有 experimentId 字段本身合法(非实验作用域)", () => {
    const bad = [{ code: "unreadable-run", dir: "/r/snap", reason: "corrupted" }];
    expect(validateScopeWarningsData(bad)).toMatch(/"data\[0\]\.reason"/);
    const ok = [{ code: "unreadable-run", dir: "/r/snap", reason: "malformed" }];
    expect(validateScopeWarningsData(ok)).toBeNull();
  });

  it("Issue 不带渲染 message 或 command 仍合法", () => {
    const ok = [{ code: "unreadable-run", dir: "/r/snap", reason: "incomplete" }];
    expect(validateScopeWarningsData(ok)).toBeNull();
  });

  it("未知 code 报错", () => {
    expect(validateScopeWarningsData([{ code: "future-kind" }])).toMatch(/"data\[0\]\.code"/);
  });
});

describe("validateSnapshotDiagnosticsData", () => {
  const validRecord = { code: "experiment-teardown-failed", level: "warning", message: "m", phase: "experiment.teardown" };
  const valid = [{ experimentId: "exp/a", startedAt: "2026-07-01T00:00:00Z", diagnostics: [validRecord] }];

  it("合规 literal 通过", () => {
    expect(validateSnapshotDiagnosticsData(valid)).toBeNull();
  });

  it("缺 experimentId 报错", () => {
    const bad = [{ startedAt: "2026-07-01T00:00:00Z", diagnostics: [validRecord] }];
    expect(validateSnapshotDiagnosticsData(bad)).toMatch(/"data\[0\]\.experimentId"/);
  });

  it("缺 startedAt 报错", () => {
    const bad = [{ experimentId: "exp/a", diagnostics: [validRecord] }];
    expect(validateSnapshotDiagnosticsData(bad)).toMatch(/"data\[0\]\.startedAt"/);
  });

  it("diagnostics[i].level 不在 warning/error 二态内报错(不是 verdict 的别名)", () => {
    const bad = [{ ...valid[0], diagnostics: [{ ...validRecord, level: "info" }] }];
    expect(validateSnapshotDiagnosticsData(bad)).toMatch(/"data\[0\]\.diagnostics\[0\]\.level"/);
  });

  it("diagnostics[i] 缺 phase 报错;开放 code 不限枚举,任意字符串都合法", () => {
    const bad = [{ ...valid[0], diagnostics: [{ code: "x", level: "warning", message: "m" }] }];
    expect(validateSnapshotDiagnosticsData(bad)).toMatch(/"data\[0\]\.diagnostics\[0\]\.phase"/);
    const okFutureCode = [{ ...valid[0], diagnostics: [{ ...validRecord, code: "future-code-not-yet-registered" }] }];
    expect(validateSnapshotDiagnosticsData(okFutureCode)).toBeNull();
  });

  it("diagnostics 为空数组合法(投影阶段已过滤,但 data 结构本身不禁止空数组)", () => {
    expect(validateSnapshotDiagnosticsData([{ experimentId: "exp/a", startedAt: "2026-07-01T00:00:00Z", diagnostics: [] }])).toBeNull();
  });
});

describe("validateCopyFixPromptData", () => {
  it("合规 literal 通过", () => {
    expect(validateCopyFixPromptData({ prompt: "fix it", failures: 1 })).toBeNull();
  });

  it("failures 非数字报错", () => {
    expect(validateCopyFixPromptData({ prompt: "x", failures: "1" })).toMatch(/"failures"/);
  });
});

describe("validateTraceWaterfallData", () => {
  const validSpan = { name: "turn", kind: "agent", startOffsetMs: 0, durationMs: 100, failed: false };
  const valid = [{ experimentId: "exp/a", evalId: "q1", locator: "@1abcdef2", durationMs: 100, spans: [validSpan] }];

  it("合规 literal 通过", () => {
    expect(validateTraceWaterfallData(valid)).toBeNull();
  });

  it("durationMs 为 null 合法(trace 缺失时如实显示缺失)", () => {
    expect(validateTraceWaterfallData([{ ...valid[0], durationMs: null }])).toBeNull();
  });

  it("spans[i].kind 不在四态枚举内报错", () => {
    const bad = [{ ...valid[0], spans: [{ ...validSpan, kind: "runner" }] }];
    expect(validateTraceWaterfallData(bad)).toMatch(/"data\[0\]\.spans\[0\]\.kind"/);
  });

  it("spans[i].failed 非布尔报错", () => {
    const bad = [{ ...valid[0], spans: [{ ...validSpan, failed: "true" }] }];
    expect(validateTraceWaterfallData(bad)).toMatch(/"data\[0\]\.spans\[0\]\.failed"/);
  });
});
