// cases: docs/engineering/testing/unit/record.md
// 完整源码调用树、面相关投影与 send 事实派生的单元测试。

import { describe, expect, it } from "vitest";
import type { AssertionResult, PhaseTiming, StreamEvent } from "../types.ts";
import {
  assembleSourceTree,
  deriveSendAnnotations,
  projectSourceView,
} from "./annotated-source.ts";

const SOURCE_PATH = "evals/weather.eval.ts";

type EvaluatedAssertionResult = Exclude<AssertionResult, { outcome: "unavailable" }>;

function assertion(
  over: Partial<Omit<EvaluatedAssertionResult, "name">> & Pick<EvaluatedAssertionResult, "name">,
): EvaluatedAssertionResult {
  const { name, severity = "soft", score = 1, outcome = "passed", ...details } = over;
  return {
    name,
    severity,
    score,
    outcome,
    ...details,
  };
}

describe("deriveSendAnnotations", () => {
  it("第 i 条用户消息配第 i 个 turn 节点(与 --execution 分轮同一规则);无 loc 的轮不产出", () => {
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "first", loc: { file: SOURCE_PATH, line: 3, column: 5 } },
      { type: "message", role: "assistant", text: "reply" },
      { type: "message", role: "user", text: "second (no loc)" },
      { type: "message", role: "user", text: "third", loc: { file: SOURCE_PATH, line: 9, column: 5 } },
    ];
    const phases: PhaseTiming[] = [{
      name: "eval.run",
      durationMs: 5000,
      children: [
        { id: "n1", key: "sandbox.command", label: "git", startOffsetMs: 0, durationMs: 10 },
        { id: "n2", key: "agent.turn", label: "s1/t1", startOffsetMs: 10, durationMs: 1500 },
        { id: "n3", key: "agent.turn", label: "s1/t2", startOffsetMs: 1510, durationMs: 900, failed: true },
        { id: "n4", key: "agent.turn", label: "s1/t3", startOffsetMs: 2410, durationMs: 300 },
      ],
    }];

    const sends = deriveSendAnnotations(events, phases);
    expect(sends).toEqual([
      { label: "s1/t1", status: "completed", durationMs: 1500, loc: { file: SOURCE_PATH, line: 3, column: 5 } },
      // 第二条用户消息没有 loc → 不产出;第三条配第 3 个 turn 节点,不因跳过而错位
      { label: "s1/t3", status: "completed", durationMs: 300, loc: { file: SOURCE_PATH, line: 9, column: 5 } },
    ]);
  });

  it("时间树缺 turn 节点时回退 t<i> 标签、无墙钟;没有事件时为空", () => {
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "only", loc: { file: SOURCE_PATH, line: 1 } },
    ];
    expect(deriveSendAnnotations(events, undefined)).toEqual([
      { label: "t1", status: "completed", loc: { file: SOURCE_PATH, line: 1 } },
    ]);
    expect(deriveSendAnnotations(null, undefined)).toEqual([]);
    expect(deriveSendAnnotations([], undefined)).toEqual([]);
  });

  it("保留用户 message 的 sourceOrder，让源码树能与断言和直接给分统一排序", () => {
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "only", loc: { file: SOURCE_PATH, line: 1 }, sourceOrder: 7 },
    ];
    expect(deriveSendAnnotations(events, undefined)).toEqual([
      { label: "t1", status: "completed", loc: { file: SOURCE_PATH, line: 1 }, sourceOrder: 7 },
    ]);
  });
});

describe("assembleSourceTree / projectSourceView", () => {
  it("以 entry 建主干、沿 callers 下钻 helper，并把无 loc 证据留在 unmapped", () => {
    const entry = { path: "evals/main.ts", content: "await helper();\n", role: "entry" as const };
    const helper = { path: "evals/helper.ts", content: "t.expect(true);\n", role: "referenced" as const };
    const mapped = assertion({
      name: "helper-check",
      loc: {
        file: "evals/helper.ts",
        line: 1,
        callers: [{ kind: "project", file: "evals/main.ts", line: 1 }],
      },
    });
    const unmapped = assertion({ name: "no-location" });
    const tree = assembleSourceTree({ entry, sources: [entry, helper], assertions: [mapped, unmapped], scoreEntries: [], sends: [] });

    expect(tree.spine.file).toBe(entry.path);
    expect(tree.spine.lines[0]!.calls[0]!.target).toMatchObject({ kind: "source", node: { file: helper.path } });
    const helperTarget = tree.spine.lines[0]!.calls[0]!.target;
    expect(helperTarget.kind).toBe("source");
    if (helperTarget.kind !== "source") throw new Error("expected helper source target");
    expect(helperTarget.node.lines[0]!.annotations).toEqual([{ kind: "assertion", assertion: mapped }]);
    expect(tree.unmapped.assertions).toEqual([unmapped]);
    expect(projectSourceView(tree, { mode: "default" }).spine.lines.map((line) => line.line)).toEqual([1]);
  });

  it("缺少 callers 路径中的源码时保留 unavailable block，不吞掉证据", () => {
    const entry = { path: "evals/main.ts", content: "await missing();\n", role: "entry" as const };
    const result = assertion({
      name: "lost-helper",
      loc: {
        file: "evals/missing.ts",
        line: 1,
        callers: [{ kind: "project", file: "evals/main.ts", line: 1 }],
      },
    });
    const tree = assembleSourceTree({ entry, sources: [entry], assertions: [result], scoreEntries: [], sends: [] });
    const missingTarget = tree.spine.lines[0]!.calls[0]!.target;
    expect(missingTarget).toMatchObject({ kind: "unavailable", file: "evals/missing.ts" });
    if (missingTarget.kind !== "unavailable") throw new Error("expected unavailable source target");
    expect(missingTarget.annotations).toEqual([{ kind: "assertion", assertion: result }]);
    expect(tree.unmapped.assertions).toEqual([]);
  });

  it("正文存在但 loc 行号越界时仍保留 unavailable，且中止沿调用边传播", () => {
    const entry = { path: "evals/main.ts", content: "await helper();\n", role: "entry" as const };
    const helper = { path: "evals/helper.ts", content: "only one line\n", role: "referenced" as const };
    const loc = {
      file: helper.path,
      line: 9,
      callers: [{ kind: "project" as const, file: entry.path, line: 1 }],
    };
    const failed = assertion({ name: "stale-line", outcome: "failed", score: 0, severity: "gate", loc });
    const tree = assembleSourceTree({
      entry,
      sources: [entry, helper],
      assertions: [failed],
      scoreEntries: [],
      sends: [],
      abort: loc,
    });

    const call = tree.spine.lines[0]!.calls[0]!;
    expect(call.target).toMatchObject({ kind: "unavailable", file: helper.path, line: 9 });
    if (call.target.kind !== "unavailable") throw new Error("expected unavailable source target");
    expect(call.target.annotations).toEqual([{ kind: "assertion", assertion: failed }]);
    expect(call.summary).toMatchObject({ failed: 1, unavailable: 1, aborted: true });
    expect(tree.unmapped.assertions).toEqual([]);
  });

  it("package 与 unavailable 中间段不会吞掉更深的可用项目源码", () => {
    const entry = { path: "evals/main.ts", content: "await adapter();\n", role: "entry" as const };
    const helper = { path: "evals/helper.ts", content: "t.check();\n", role: "referenced" as const };
    const result = assertion({
      name: "callback-check",
      loc: {
        file: helper.path,
        line: 1,
        callers: [
          { kind: "project", file: entry.path, line: 1 },
          { kind: "package", package: "adapter-package" },
          { kind: "project", file: "evals/missing-callback.ts", line: 1 },
        ],
      },
    });
    const tree = assembleSourceTree({ entry, sources: [entry, helper], assertions: [result], scoreEntries: [], sends: [] });

    const packageTarget = tree.spine.lines[0]!.calls[0]!.target;
    expect(packageTarget).toMatchObject({ kind: "package", package: "adapter-package" });
    if (packageTarget.kind !== "package") throw new Error("expected package source target");
    const missingTarget = packageTarget.calls[0]!.target;
    expect(missingTarget).toMatchObject({ kind: "unavailable", file: "evals/missing-callback.ts" });
    if (missingTarget.kind !== "unavailable") throw new Error("expected unavailable source target");
    const helperTarget = missingTarget.calls[0]!.target;
    expect(helperTarget).toMatchObject({ kind: "source", node: { file: helper.path } });
    if (helperTarget.kind !== "source") throw new Error("expected helper source target");
    expect(helperTarget.node.lines[0]!.annotations).toEqual([{ kind: "assertion", assertion: result }]);
  });

  it("调用摘要从子树向上汇总三态断言、给分与中止，unavailable 不计入 failed", () => {
    const entry = { path: "evals/main.ts", content: "line 1\nawait helper();\nline 3\n", role: "entry" as const };
    const helper = { path: "evals/helper.ts", content: "line 1\nt.check();\nline 3\n", role: "referenced" as const };
    const loc = {
      file: helper.path,
      line: 2,
      callers: [{ kind: "project" as const, file: entry.path, line: 2 }],
    };
    const passed = assertion({ name: "passed", outcome: "passed", score: 1, loc });
    const failed = assertion({ name: "failed", outcome: "failed", score: 0, severity: "soft", loc });
    const unavailable: AssertionResult = { name: "missing", outcome: "unavailable", severity: "gate", reason: "no-evidence", loc };
    const tree = assembleSourceTree({
      entry,
      sources: [entry, helper],
      assertions: [passed, failed, unavailable],
      scoreEntries: [{ label: "bonus", points: 4, loc }],
      sends: [],
      abort: loc,
    });
    const call = tree.spine.lines[1]!.calls[0]!;
    expect(call.summary).toEqual({
      checks: 3,
      passed: 1,
      failed: 1,
      unavailable: 1,
      points: { earned: 4, available: 4 },
      aborted: true,
    });
    expect(tree.summary).toEqual(call.summary);
  });

  it("同一源码行按 sourceOrder 混排 send、断言与直接给分；历史缺序号只走稳定回退", () => {
    const entry = { path: "evals/main.ts", content: "t.send(); t.check(); t.score();\n", role: "entry" as const };
    const loc = { file: entry.path, line: 1 };
    const orderedAssertion = assertion({ name: "check", loc, sourceOrder: 2 });
    const legacyAssertion = assertion({ name: "legacy-check", loc });
    const tree = assembleSourceTree({
      entry,
      sources: [entry],
      assertions: [orderedAssertion, legacyAssertion],
      scoreEntries: [{ label: "bonus", points: 3, loc, sourceOrder: 3 }],
      sends: [{ label: "t1", status: "completed", loc, sourceOrder: 1 }],
    });

    expect(tree.spine.lines[0]!.annotations).toEqual([
      { kind: "send", send: { label: "t1", status: "completed", loc, sourceOrder: 1 } },
      { kind: "assertion", assertion: orderedAssertion },
      { kind: "score", score: { label: "bonus", points: 3, loc, sourceOrder: 3 } },
      { kind: "assertion", assertion: legacyAssertion },
    ]);
  });

  it("调用摘要把 pointsAvailable 与实际 points 分开汇总，保留零分和 unavailable 的满分", () => {
    const entry = { path: "evals/main.ts", content: "t.check();\n", role: "entry" as const };
    const loc = { file: entry.path, line: 1 };
    const failed = assertion({
      name: "zero-earned",
      outcome: "failed",
      score: 0,
      points: 0,
      pointsAvailable: 5,
      loc,
    });
    const unavailable: AssertionResult = {
      name: "missing-evidence",
      outcome: "unavailable",
      severity: "soft",
      reason: "no-evidence",
      pointsAvailable: 7,
      loc,
    };
    const tree = assembleSourceTree({
      entry,
      sources: [entry],
      assertions: [failed, unavailable],
      scoreEntries: [],
      sends: [],
    });

    expect(tree.summary.points).toEqual({ earned: 0, available: 12 });
  });

  it("full 只展开全部调用路径，节点内仍按主干3/子树2与8/4阈值折叠", () => {
    const content = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");
    const entry = { path: "evals/main.ts", content, role: "entry" as const };
    const helper = { path: "evals/helper.ts", content, role: "referenced" as const };
    const tree = assembleSourceTree({
      entry,
      sources: [entry, helper],
      assertions: [assertion({
        name: "ok",
        loc: {
          file: helper.path,
          line: 15,
          callers: [{ kind: "project", file: entry.path, line: 15 }],
        },
      })],
      scoreEntries: [],
      sends: [],
    });
    const normal = projectSourceView(tree, { mode: "default" });
    const full = projectSourceView(tree, { mode: "full" });
    expect(normal.spine.lines.map((line) => line.line)).toEqual([12, 13, 14, 15, 16, 17, 18]);
    const normalCall = normal.spine.lines.find((line) => line.line === 15)!.calls[0]!;
    const fullCall = full.spine.lines.find((line) => line.line === 15)!.calls[0]!;
    expect(normalCall.open).toBe(false);
    expect(fullCall.open).toBe(true);
    if (fullCall.target.kind !== "source") throw new Error("expected source call");
    expect(fullCall.target.node.lines.map((line) => line.line)).toEqual([13, 14, 15, 16, 17]);
  });

  it("默认投影超过行预算时只收起深层路径，不丢主干与调用汇总", () => {
    const entry = { path: "evals/main.ts", content: "await helper();\n", role: "entry" as const };
    const helperContent = Array.from({ length: 24 }, (_, index) => `check ${index + 1}`).join("\n");
    const helper = { path: "evals/helper.ts", content: helperContent, role: "referenced" as const };
    const assertions = Array.from({ length: 24 }, (_, index) => assertion({
      name: `failed-${index}`,
      outcome: "failed",
      score: 0,
      severity: "soft",
      loc: {
        file: helper.path,
        line: index + 1,
        callers: [{ kind: "project" as const, file: entry.path, line: 1 }],
      },
    }));
    const tree = assembleSourceTree({ entry, sources: [entry, helper], assertions, scoreEntries: [], sends: [] });
    const projected = projectSourceView(tree, { mode: "default", budgetLines: 10 });
    expect(projected.spine.lines.map((line) => line.line)).toEqual([1]);
    expect(projected.spine.lines[0]!.calls[0]!.open).toBe(false);
    expect(projected.spine.lines[0]!.calls[0]!.summary.failed).toBe(24);
  });

  it("单文件模式显示指定文件全文，并合并该文件在多条调用路径上的标注", () => {
    const entry = { path: "evals/main.ts", content: "a();\nb();\n", role: "entry" as const };
    const helper = { path: "evals/shared/helper.ts", content: "one\ntwo\nthree\n", role: "referenced" as const };
    const assertions = [1, 2].map((entryLine) => assertion({
      name: `via-${entryLine}`,
      loc: {
        file: helper.path,
        line: entryLine,
        callers: [{ kind: "project" as const, file: entry.path, line: entryLine }],
      },
    }));
    const tree = assembleSourceTree({ entry, sources: [entry, helper], assertions, scoreEntries: [], sends: [] });
    const projected = projectSourceView(tree, { mode: "file", file: helper.path });
    expect(projected.spine.file).toBe(helper.path);
    expect(projected.spine.lines.map((line) => line.text)).toEqual(["one", "two", "three"]);
    expect(projected.spine.lines.flatMap((line) => line.annotations).map((annotation) => annotation.kind)).toEqual([
      "assertion",
      "assertion",
    ]);
  });
});
