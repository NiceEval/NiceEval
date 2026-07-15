// loadAttemptEvidence 单测(定稿契约见 plan/attempt-evidence-feedback-loop.md「中性数据准备」、
// src/results/attempt-evidence.ts 的头注)。用真实 createResultsWriter → openResults 的读写链路
// 落一份最小 fixture(不手写 JSON 文件,理由同 loadAnnotatedEvalSource 的既有端到端测试:
// 这条链路本身就是被测对象的一部分),覆盖四种 capability 组合与 identity 正确性。

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createResultsWriter,
  loadAttemptEvidence,
  openResults,
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
  { type: "action.called", callId: "c1", name: "get_weather", input: { city: "Brooklyn" } },
  { type: "action.result", callId: "c1", output: { tempF: 72 }, status: "completed" },
];

const TRACE: TraceSpan[] = [
  { traceId: "t1", spanId: "s1", name: "tool.get_weather", startMs: 0, endMs: 10, attributes: { call_id: "c1" } },
];

const NONEMPTY_DIFF: DiffData = { generatedFiles: { "a.txt": "hello" }, deletedFiles: [] };
const EMPTY_DIFF: DiffData = { generatedFiles: {}, deletedFiles: [] };

/** 起一个 writer,写一条 attempt,finish,再从头 openResults 读回它的 AttemptHandle。 */
async function seedAttempt(
  root: string,
  entry: Partial<AttemptEntry> & { id: string },
  artifacts?: AttemptArtifacts,
): Promise<AttemptHandle> {
  const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
  const snap = await writer.snapshot({ experimentId: "compare/bub", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
  await snap.writeAttempt(
    { verdict: "passed", attempt: 0, durationMs: 1000, assertions: [], ...entry },
    artifacts,
  );
  await writer.finish();
  const results = await openResults(root);
  return results.experiments[0]!.latest.evals.find((e) => e.id === entry.id)!.attempts[0]!;
}

describe("loadAttemptEvidence", () => {
  it("四个 capability 全部具备:eval / execution / timing / diff", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(
      root,
      { id: "weather/brooklyn", assertions: ASSERTIONS },
      { events: EVENTS, trace: TRACE, diff: NONEMPTY_DIFF, sources: [{ path: SOURCE_PATH, content: SOURCE_CONTENT }] },
    );

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.evalSource).not.toBeNull();
    expect(evidence.evalSource!.sourcePath).toBe(SOURCE_PATH);
    expect(evidence.execution).not.toBeNull();
    expect(evidence.execution!.timingAvailable).toBe(true);
    // action 节点唯一关联上了 span(call_id 精确匹配),不是只挂了个 telemetry-only 节点。
    const actionNode = evidence.execution!.nodes.find((n) => n.kind === "action");
    expect(actionNode).toBeDefined();
    expect((actionNode as { span?: TraceSpan }).span).toBeDefined();
    expect(evidence.diff).toEqual(NONEMPTY_DIFF);

    expect(evidence.capabilities).toEqual({ eval: true, execution: true, timing: true, diff: true });
  });

  it("四个 capability 全部缺失:没有 source / events / trace / diff,不崩溃", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(root, { id: "weather/queens" });

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.evalSource).toBeNull();
    expect(evidence.execution).toBeNull();
    expect(evidence.diff).toBeNull();
    expect(evidence.capabilities).toEqual({ eval: false, execution: false, timing: false, diff: false });
  });

  it("有 events 没有 OTel spans:execution 为真、timing 为假", async () => {
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

    expect(evidence.diff).toEqual(EMPTY_DIFF);
    expect(evidence.capabilities.diff).toBe(false);
  });

  it("identity 与源 attempt 的 experimentId / snapshotStartedAt / evalId / attempt 完全一致", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(root, { id: "weather/dover", attempt: 0 });

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.identity).toEqual({
      experimentId: "compare/bub",
      snapshotStartedAt: "2026-07-01T08:00:00.000Z",
      evalId: "weather/dover",
      attempt: 0,
    });
    expect(evidence.identity.experimentId).toBe(attempt.experimentId);
    expect(evidence.identity.evalId).toBe(attempt.evalId);
    expect(evidence.identity.attempt).toBe(attempt.result.attempt);
    expect(evidence.identity.snapshotStartedAt).toBe(attempt.snapshot.startedAt);
    // 真实读取路径:locator 恒有值,且与 attempt.locator 原样一致(不重算)。
    expect(attempt.locator).toBeDefined();
    expect(evidence.locator).toBe(attempt.locator);
  });

  it("artifactPaths.dir 是这个 attempt 落盘目录的绝对路径", async () => {
    const root = await makeRoot();
    const attempt = await seedAttempt(root, { id: "weather/salem" }, { events: EVENTS });

    const evidence = await loadAttemptEvidence(attempt);

    expect(evidence.artifactPaths.dir).toBe(join(attempt.snapshot.dir, attempt.ref.attempt));
  });
});
