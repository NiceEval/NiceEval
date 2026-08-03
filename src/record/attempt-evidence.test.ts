// cases: docs/engineering/testing/unit/record.md
// loadAttemptEvidence 单测(定稿契约见 plan/attempt-evidence-feedback-loop.md「中性数据准备」、
// src/record/attempt-evidence.ts 的头注)。用真实 createWriter → openRecord 的读写链路
// 落一份最小 fixture(不手写 JSON 文件，确保真实写入/读取链路参与验证：
// 这条链路本身就是被测对象的一部分),覆盖四种 capability 组合与 identity 正确性。

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiffArtifact } from "../types.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import {
  createWriter,
  loadAttemptEvidence,
  openRecord,
  type AttemptArtifacts,
  type AttemptEntry,
  type AttemptHandle,
  type DiffData,
  type EvalResult,
  type StreamEvent,
  type TraceSpan,
} from "./index.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-attempt-evidence-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const SOURCE_PATH = "evals/a.eval.ts";
const SOURCE_CONTENT = 'import { defineEval } from "niceeval";\nexport default defineEval({\n  test() {},\n});\n';

const ASSERTIONS: EvalResult["assertions"] = [
  { name: "check-1", outcome: "passed" as const, severity: "gate", score: 1, loc: { file: SOURCE_PATH, line: 3 } },
];

const EVENTS: StreamEvent[] = [
  { type: "message", role: "assistant", text: "looking at weather" },
  { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "get_weather", input: { city: "Brooklyn" } } },
  { type: "operation.finished", operationId: "c1", kind: "tool", output: { tempF: 72 }, status: "completed" },
];

const TRACE: TraceSpan[] = [
  { traceId: "t1", spanId: "s1", name: "tool.get_weather", startMs: 0, endMs: 10, attributes: { call_id: "c1" } },
];

const NONEMPTY_DIFF: DiffArtifact = [{ window: "turn1", changes: { "a.txt": { status: "added", after: "hello" } } }];
const EMPTY_DIFF: DiffArtifact = [{ window: "turn1", changes: {} }];
const LEGACY_DIFF: DiffArtifact = [{ window: "legacy-window", changes: { "legacy.txt": { status: "added", after: "kept" } } }];

/** 起一个 writer,写一条 attempt,finish,再从头 openRecord 读回它的 AttemptHandle。 */
async function seedAttempt(
  root: string,
  entry: Partial<AttemptEntry> & { id: string },
  artifacts?: AttemptArtifacts,
): Promise<AttemptHandle> {
  const writer = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
  const snap = await writer.run({ experimentId: "compare/bub", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
  await snap.writeAttempt(
    { verdict: "passed", attempt: 0, durationMs: 1000, assertions: [], evidenceCoverage: completeEvidenceCoverage, ...entry },
    artifacts,
  );
  await snap.finish();
  const results = await openRecord(root);
  return results.experiments[0]!.latestRun.evals.find((e) => e.id === entry.id)!.attempts[0]!;
}

describe("loadAttemptEvidence", () => {
  it("四个 capability 全部具备:source / execution / timing / diff", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(
      root,
      { id: "weather/brooklyn", assertions: ASSERTIONS, phases: [{ name: "eval.run", durationMs: 900 }] },
      {
        events: EVENTS,
        trace: TRACE,
        diff: NONEMPTY_DIFF,
        sources: [{ path: SOURCE_PATH, content: SOURCE_CONTENT, role: "entry" }],
      },
    );

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.evalSource).not.toBeNull();
    expect(evidence.evalSource!.spine.file).toBe(SOURCE_PATH);
    expect(evidence.execution).not.toBeNull();
    expect(evidence.execution!.timingAvailable).toBe(true);
    // action 节点唯一关联上了 span(call_id 精确匹配),不是只挂了个 telemetry-only 节点。
    const actionNode = evidence.execution!.nodes.find((n) => n.kind === "action");
    expect(actionNode).toBeDefined();
    expect((actionNode as { span?: TraceSpan }).span).toBeDefined();
    expect(evidence.diff?.windows).toEqual(NONEMPTY_DIFF);

    expect(evidence.capabilities).toEqual({ source: true, execution: true, timing: true, diff: true });
  });

  it("读取历史 diff artifact 时把旧窗口标签当不透明字符串原样保留,不迁移", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(root, { id: "weather/legacy" }, { diff: LEGACY_DIFF });

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.diff?.windows).toEqual(LEGACY_DIFF);
  });

  it("四个 capability 全部缺失:没有 sources / events / trace / diff,不崩溃", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(root, { id: "weather/queens" });

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.evalSource).toBeNull();
    expect(evidence.execution).toBeNull();
    expect(evidence.diff).toBeNull();
    expect(evidence.capabilities).toEqual({ source: false, execution: false, timing: false, diff: false });
  });

  it("有 events 没有 phases(旧 runner 产出):execution 为真、timing 为假", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(root, { id: "weather/albany" }, { events: EVENTS });

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.execution).not.toBeNull();
    expect(evidence.execution!.timingAvailable).toBe(false);
    expect(evidence.execution!.nodes.some((n) => n.kind === "action")).toBe(true);
    expect(evidence.capabilities.execution).toBe(true);
    expect(evidence.capabilities.timing).toBe(false);
  });

  it("diff 存在但两个数组都空:capabilities.diff 为假,不是真", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(root, { id: "weather/rome" }, { diff: EMPTY_DIFF });

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.diff?.windows).toEqual(EMPTY_DIFF);
    expect(evidence.capabilities.diff).toBe(false);
  });

  it("源码树把前置中止锚在首条 failed stopOnFailure 断言，而不是最后一条记录", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(
      root,
      {
        id: "weather/abort-anchor",
        assertions: [
          {
            name: "first-stop",
            outcome: "failed",
            severity: "gate",
            score: 0,
            stopOnFailure: true,
            loc: { file: SOURCE_PATH, line: 2 },
          },
          {
            name: "later-stop",
            outcome: "failed",
            severity: "gate",
            score: 0,
            stopOnFailure: true,
            loc: { file: SOURCE_PATH, line: 3 },
          },
        ],
      },
      { sources: [{ path: SOURCE_PATH, content: SOURCE_CONTENT, role: "entry" }] },
    );

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.evalSource?.spine.lines[1]?.aborted).toBe(true);
    expect(evidence.evalSource?.spine.lines[2]?.aborted).toBeUndefined();
  });

  it("locator identity 与源 attempt 的 runId / evalId / attempt 一致，experiment 作为独立归属", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(root, { id: "weather/dover", attempt: 0 });

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.identity).toEqual({
      runId: attempt.run.runId,
      evalId: "weather/dover",
      attempt: 0,
    });
    expect(evidence.experimentId).toBe(attempt.experimentId);
    expect(evidence.identity.evalId).toBe(attempt.evalId);
    expect(evidence.identity.attempt).toBe(attempt.result.attempt);
    // 真实读取路径:locator 恒有值,且与 attempt.locator 原样一致(不重算)。
    expect(attempt.locator).toBeDefined();
    expect(evidence.locator).toBe(attempt.locator);
  });

  it("artifactPaths.dir 是这个 attempt 落盘目录的绝对路径", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(root, { id: "weather/salem" }, { events: EVENTS });

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.artifactPaths.dir).toBe(join(attempt.run.dir, attempt.ref.attempt));
  });
});
