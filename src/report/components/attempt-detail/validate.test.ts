// cases: docs/engineering/testing/unit/reports.md
// "validate*Data 递归覆盖到嵌套字段" 行:attempt-detail 十一个叶子的 validate*Data 表驱动字段突变覆盖,重点是 AttemptConversationData
// 的 AttemptConversationReply 判别联合(每个 kind 分支各自的必填字段)与其余嵌套结构
// (AttemptIdentity / AssertionResult 判别联合 / TraceSpan / AttemptDiffFileEntry 的 net 枚举)。

import { describe, expect, it } from "vitest";
import {
  validateAssertionsData,
  validateConversationData,
  validateDiagnosticsData,
  validateDiffData,
  validateErrorData,
  validateSourceData,
  validateSummaryData,
  validateTimelineData,
  validateTraceData,
  validateUsageData,
} from "./index.tsx";

const validIdentity = { experimentId: "compare/codex", snapshotStartedAt: "2026-07-01T00:00:00Z", evalId: "q1", attempt: 0 };
const validCapabilities = { source: true, execution: true, timing: false, diff: false };

describe("validateSummaryData", () => {
  const valid = {
    locator: "@1abcdef2",
    identity: validIdentity,
    verdict: "passed",
    durationMs: 1000,
    costUSD: 0.01,
    capabilities: validCapabilities,
  };

  it("合规 literal 通过", () => {
    expect(validateSummaryData(valid)).toBeNull();
  });

  it("costUSD 为 null 合法(缺失不冒充 0)", () => {
    expect(validateSummaryData({ ...valid, costUSD: null })).toBeNull();
  });

  it("identity 缺 snapshotStartedAt 报错定位到嵌套字段", () => {
    const bad = { ...valid, identity: { experimentId: "compare/codex", evalId: "q1", attempt: 0 } };
    expect(validateSummaryData(bad)).toMatch(/"identity\.snapshotStartedAt"/);
  });

  it("capabilities.timing 非布尔报错", () => {
    const bad = { ...valid, capabilities: { ...validCapabilities, timing: "false" } };
    expect(validateSummaryData(bad)).toMatch(/"capabilities\.timing"/);
  });

  it("totalScore 省略合法(通过制);非数字报错", () => {
    expect(validateSummaryData(valid)).toBeNull();
    expect(validateSummaryData({ ...valid, totalScore: 4 })).toBeNull();
    expect(validateSummaryData({ ...valid, totalScore: "4" })).toMatch(/"totalScore"/);
  });
});

describe("validateErrorData", () => {
  const valid = { code: "unexpected-error", message: "boom", phase: "eval.run", locator: "@1abcdef2" };

  it("合规 literal 通过,commandEvidenceHint 省略或为 true 都合法", () => {
    expect(validateErrorData(valid)).toBeNull();
    expect(validateErrorData({ ...valid, commandEvidenceHint: true })).toBeNull();
  });

  it("commandEvidenceHint 不是 true 时报错", () => {
    expect(validateErrorData({ ...valid, commandEvidenceHint: false })).toMatch(/"commandEvidenceHint"/);
  });

  it("必填字符串缺失时定位到字段", () => {
    expect(validateErrorData({ code: "x", message: "boom", locator: "@1abcdef2" })).toMatch(/"phase"/);
  });
});

describe("validateAssertionsData", () => {
  const passed = { name: "eq", severity: "gate", outcome: "passed", score: 1 };
  const unavailable = { name: "judge", severity: "soft", outcome: "unavailable", reason: "judge-model-unresolved" };

  it("合规 literal 通过(含 unavailable 分支)", () => {
    const valid = { attention: [unavailable], passedGroups: [{ group: "", items: [passed] }] };
    expect(validateAssertionsData(valid)).toBeNull();
  });

  it("passed/failed 分支缺 score 报错", () => {
    const bad = { attention: [{ name: "eq", severity: "gate", outcome: "passed" }], passedGroups: [] };
    expect(validateAssertionsData(bad)).toMatch(/"attention\[0\]\.score"/);
  });

  it("unavailable 分支缺 reason 报错", () => {
    const bad = { attention: [{ name: "judge", severity: "soft", outcome: "unavailable" }], passedGroups: [] };
    expect(validateAssertionsData(bad)).toMatch(/"attention\[0\]\.reason"/);
  });

  it("outcome 不在判别集合内报错", () => {
    const bad = { attention: [{ name: "eq", severity: "gate", outcome: "flaky", score: 1 }], passedGroups: [] };
    expect(validateAssertionsData(bad)).toMatch(/"attention\[0\]\.outcome"/);
  });

  it("passedGroups[i].items 嵌套断言报错定位到分组内下标", () => {
    const bad = { attention: [], passedGroups: [{ group: "setup", items: [{ name: "eq", severity: "gate" }] }] };
    expect(validateAssertionsData(bad)).toMatch(/"passedGroups\[0\]\.items\[0\]\.outcome"/);
  });

  it("scorePointsEarned 省略合法(通过制);结构错误报错", () => {
    const valid = { attention: [passed], passedGroups: [], scorePointsEarned: { earned: 1, total: 2 } };
    expect(validateAssertionsData(valid)).toBeNull();
    expect(validateAssertionsData({ attention: [], passedGroups: [] })).toBeNull();
    const bad = { attention: [], passedGroups: [], scorePointsEarned: { earned: "1", total: 2 } };
    expect(validateAssertionsData(bad)).toMatch(/"scorePointsEarned\.earned"/);
  });
});

describe("validateSourceData", () => {
  const validSummary = {
    totalAssertions: 1,
    mappedAssertions: 1,
    unmappedAssertions: 0,
    passed: 1,
    failed: 0,
    gate: 1,
    soft: 0,
    totalLines: 10,
    annotatedLines: 1,
  };
  const valid = {
    locator: "@1abcdef2",
    sourcePath: "eval.ts",
    lines: [{ line: 1, text: "t.send(...)", assertions: [], sends: [], turns: [], scoreEntries: [] }],
    unmapped: [],
    passedGroups: [],
    unlocatedTurns: [],
    summary: validSummary,
  };

  it("合规 literal 通过", () => {
    expect(validateSourceData(valid)).toBeNull();
  });

  it("summary 缺 totalLines 报错", () => {
    const bad = { ...valid, summary: { ...validSummary, totalLines: undefined } };
    expect(validateSourceData(bad)).toMatch(/"summary\.totalLines"/);
  });

  it("lines[i].assertions 嵌套断言结构错误报错", () => {
    const bad = { ...valid, lines: [{ line: 1, text: "x", assertions: [{ name: "eq" }], sends: [], turns: [], scoreEntries: [] }] };
    expect(validateSourceData(bad)).toMatch(/"lines\[0\]\.assertions\[0\]\.severity"/);
  });

  it("lines[i].turns[j].replies[k] 递归校验回复判别联合", () => {
    const bad = {
      ...valid,
      lines: [
        {
          line: 1,
          text: "x",
          assertions: [],
          sends: [],
          turns: [{ label: "s1/t1", status: "completed", sentText: "go", replies: [{ kind: "assistant" }] }],
          scoreEntries: [],
        },
      ],
    };
    expect(validateSourceData(bad)).toMatch(/"lines\[0\]\.turns\[0\]\.replies\[0\]\.text"/);
  });

  it("lines[i].scoreEntries 嵌套 ScoreEntry 结构错误报错", () => {
    const bad = { ...valid, lines: [{ line: 1, text: "x", assertions: [], sends: [], turns: [], scoreEntries: [{ label: "x" }] }] };
    expect(validateSourceData(bad)).toMatch(/"lines\[0\]\.scoreEntries\[0\]\.points"/);
  });

  it("lines[i].aborted / unreached 非 true 报错;省略合法", () => {
    expect(validateSourceData(valid)).toBeNull();
    const bad = { ...valid, lines: [{ ...valid.lines[0], aborted: "yes" }] };
    expect(validateSourceData(bad)).toMatch(/"lines\[0\]\.aborted"/);
  });

  it("unmappedScoreEntries 存在时按分组结构校验,省略合法", () => {
    const withEntries = { ...valid, unmappedScoreEntries: [{ group: "", items: [{ label: "bonus", points: 2 }] }] };
    expect(validateSourceData(withEntries)).toBeNull();
    const bad = { ...valid, unmappedScoreEntries: [{ group: "", items: [{ label: "bonus" }] }] };
    expect(validateSourceData(bad)).toMatch(/"unmappedScoreEntries\[0\]\.items\[0\]\.points"/);
  });
});

describe("validateTimelineData", () => {
  const valid = { locator: "@1abcdef2", phases: [{ name: "eval.run", durationMs: 500 }], trace: null };

  it("合规 literal 通过(trace 为 null)", () => {
    expect(validateTimelineData(valid)).toBeNull();
  });

  it("trace 为数组时逐项校验 TraceSpan", () => {
    const bad = { ...valid, trace: [{ traceId: "t1", spanId: "s1", name: "turn", startMs: 0 }] };
    expect(validateTimelineData(bad)).toMatch(/"trace\[0\]\.endMs"/);
  });

  it("phases[i] 缺 durationMs 报错", () => {
    const bad = { ...valid, phases: [{ name: "eval.run" }] };
    expect(validateTimelineData(bad)).toMatch(/"phases\[0\]\.durationMs"/);
  });
});

describe("validateConversationData — AttemptConversationReply 判别联合", () => {
  const valid = {
    locator: "@1abcdef2",
    rounds: [{ sentText: "go", replies: [{ kind: "assistant", text: "ok" }] }],
  };

  it("合规 literal 通过", () => {
    expect(validateConversationData(valid)).toBeNull();
  });

  it.each([
    ["assistant", { kind: "assistant" }, /"rounds\[0\]\.replies\[0\]\.text"/],
    ["tool 缺 callId", { kind: "tool", name: "shell", input: "ls" }, /"rounds\[0\]\.replies\[0\]\.callId"/],
    ["tool 缺 input", { kind: "tool", callId: "c1", name: "shell" }, /"rounds\[0\]\.replies\[0\]\.input"/],
    ["skill 缺 skill", { kind: "skill" }, /"rounds\[0\]\.replies\[0\]\.skill"/],
    ["context 缺 text", { kind: "context", source: "hook" }, /"rounds\[0\]\.replies\[0\]\.text"/],
    ["subagent 缺 name", { kind: "subagent", callId: "c1" }, /"rounds\[0\]\.replies\[0\]\.name"/],
    ["input 缺 request", { kind: "input" }, /"rounds\[0\]\.replies\[0\]\.request"/],
    ["raw 缺 raw", { kind: "raw" }, /"rounds\[0\]\.replies\[0\]\.raw"/],
    ["未知 kind", { kind: "unknown-future-kind" }, /"rounds\[0\]\.replies\[0\]\.kind"/],
  ])("%s 报错定位到具体缺失字段", (_label, reply, expected) => {
    const bad = { locator: "@1abcdef2", rounds: [{ sentText: "go", replies: [reply] }] };
    expect(validateConversationData(bad)).toMatch(expected);
  });

  it("compaction 分支无必填字段,裸 { kind: 'compaction' } 合法", () => {
    const ok = { locator: "@1abcdef2", rounds: [{ sentText: "go", replies: [{ kind: "compaction" }] }] };
    expect(validateConversationData(ok)).toBeNull();
  });

  it("round.loc 存在时校验 SourceLoc 结构;省略 loc 合法(流首无位置信息的兜底轮)", () => {
    expect(validateConversationData(valid)).toBeNull();
    const withLoc = { locator: "@1abcdef2", rounds: [{ loc: { file: "eval.ts", line: 3 }, sentText: "go", replies: [] }] };
    expect(validateConversationData(withLoc)).toBeNull();
    const badLoc = { locator: "@1abcdef2", rounds: [{ loc: { file: "eval.ts" }, sentText: "go", replies: [] }] };
    expect(validateConversationData(badLoc)).toMatch(/"rounds\[0\]\.loc\.line"/);
  });

  it("failedCommands 省略合法(没有失败命令);存在时逐项校验 FailedCommandEvidence", () => {
    expect(validateConversationData(valid)).toBeNull(); // valid 本身没有 failedCommands 字段
    const withCommands = {
      ...valid,
      failedCommands: [
        { timingNodeId: "n1", phase: "sandbox.prepare.eval", display: "npm ci", exitCode: 1, stdout: "", stderr: "boom" },
      ],
    };
    expect(validateConversationData(withCommands)).toBeNull();
    const missingExitCode = { ...valid, failedCommands: [{ timingNodeId: "n1", phase: "sandbox.prepare.eval", display: "npm ci", stdout: "", stderr: "boom" }] };
    expect(validateConversationData(missingExitCode)).toMatch(/"failedCommands\[0\]\.exitCode"/);
  });
});

describe("validateDiagnosticsData", () => {
  it("合规 literal 通过", () => {
    const valid = { groups: [{ phase: "eval.run", items: [{ code: "x", level: "warning", message: "m", phase: "eval.run" }] }] };
    expect(validateDiagnosticsData(valid)).toBeNull();
  });

  it("level 不在 warning/error 内报错", () => {
    const bad = { groups: [{ phase: "eval.run", items: [{ code: "x", level: "info", message: "m", phase: "eval.run" }] }] };
    expect(validateDiagnosticsData(bad)).toMatch(/"groups\[0\]\.items\[0\]\.level"/);
  });
});

describe("validateUsageData", () => {
  const validUsage = {
    locator: "@1abcdef2",
    experimentId: "compare/codex",
    evalId: "q1",
    attempt: 0,
    verdict: "passed",
  };

  it("身份字段齐全、其余字段全省略时合规(没有 events/usage 时的最小合法形态)", () => {
    expect(validateUsageData(validUsage)).toBeNull();
  });

  it("缺 experimentId 报错", () => {
    const bad = { ...validUsage, experimentId: undefined };
    expect(validateUsageData(bad)).toMatch(/"experimentId"/);
  });

  it("turns 非数字报错;省略合法", () => {
    expect(validateUsageData({ ...validUsage, turns: 3 })).toBeNull();
    expect(validateUsageData({ ...validUsage, turns: "3" })).toMatch(/"turns"/);
  });

  it("usage 存在时逐字段校验(均可选),某字段非数字报错", () => {
    expect(validateUsageData({ ...validUsage, usage: { inputTokens: 1, outputTokens: 2 } })).toBeNull();
    expect(validateUsageData({ ...validUsage, usage: { requests: 4 } })).toBeNull(); // 只有 requests 也合法
    const bad = { ...validUsage, usage: { inputTokens: "1" } };
    expect(validateUsageData(bad)).toMatch(/"usage\.inputTokens"/);
  });

});

describe("validateTraceData", () => {
  it("spans[i] 缺 spanId 报错", () => {
    const bad = { locator: "@1abcdef2", spans: [{ traceId: "t1", name: "turn", startMs: 0, endMs: 1 }] };
    expect(validateTraceData(bad)).toMatch(/"spans\[0\]\.spanId"/);
  });
});

describe("validateDiffData", () => {
  const valid = {
    locator: "@1abcdef2",
    files: [{ path: "a.ts", change: "modified", added: 1, removed: 0, windows: [{ window: "s1/t1", patch: "@@ -1 +1 @@" }] }],
  };

  it("合规 literal 通过", () => {
    expect(validateDiffData(valid)).toBeNull();
  });

  it("change 不在三态枚举内报错", () => {
    const bad = { ...valid, files: [{ ...valid.files[0], change: "none" }] };
    expect(validateDiffData(bad)).toMatch(/"files\[0\]\.change"/);
  });

  it("增删行数不是数字报错", () => {
    const bad = { ...valid, files: [{ ...valid.files[0], removed: "0" }] };
    expect(validateDiffData(bad)).toMatch(/"files\[0\]\.added"/);
  });
});
