// owner: docs/engineering/testing/architecture/unit/assertions.md#证明范围规范
import { expect, test } from "vitest";
import { bindConversationMaterial, projectConversation } from "./conversation-material.ts";
import { snapshotJudgeMaterial } from "./judge.ts";

// @feature docs/feature/judge/README.md
test("conversation budgets preserve protected Unicode records and account for every omitted byte deterministically", () => {
  const output = "首".repeat(2000) + "尾";
  const handle = bindConversationMaterial(Object.freeze({}), () => projectConversation([{ partial: ["adapter-partial"], reply: "done", events: [
    { type: "message", role: "user", text: "original-input" },
    { type: "message", role: "assistant", text: "earlier-message" },
    { type: "operation.started", operationId: "call", operation: { kind: "tool", name: "read", input: { path: "file" } } },
    { type: "operation.finished", operationId: "call", kind: "tool", status: "completed", output },
    { type: "message", role: "assistant", text: "done" },
  ] }]));
  const first = snapshotJudgeMaterial({ nested: [handle] }, 900).material;
  expect(Object.isFrozen(first)).toBe(true);
  expect(first).toEqual(snapshotJudgeMaterial({ nested: [handle] }, 900).material);
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(900);
  const text = JSON.stringify(first);
  expect(text).toContain("original-input");
  expect(text).toContain("earlier-message");
  expect(text).toContain("done");
  expect(text).toContain("adapter-partial");
  const projection = (first as { nested: { records: { output?: string }[]; omissions: { path: string; omittedBytes: number }[] }[] }).nested[0]!;
  const result = projection.records.find(record => record.output !== undefined)!.output!;
  const omission = projection.omissions[0]!;
  const marker = `[niceeval omitted ${omission.omittedBytes} UTF-8 bytes at ${omission.path}]`;
  expect(result).toContain(marker);
  expect(Buffer.byteLength(JSON.stringify(output)) - Buffer.byteLength(result.replace(marker, ""))).toBe(omission.omittedBytes);
  expect(snapshotJudgeMaterial({ plain: "x".repeat(2000) }, 100).material).toEqual({ plain: "x".repeat(2000) });
});

// @feature docs/feature/judge/README.md
test("tool outputs yield their budget before inputs and earlier assistant messages, while protected records are never cut", () => {
  const earlier = "assistant".repeat(200);
  const handle = bindConversationMaterial({}, () => projectConversation([{ partial: [], reply: "done", events: [
    { type: "message", role: "user", text: "protected" },
    { type: "message", role: "assistant", text: earlier },
    { type: "operation.started", operationId: "call", operation: { kind: "tool", name: "read", input: "input".repeat(400) } },
    { type: "operation.finished", operationId: "call", kind: "tool", status: "completed", output: "output".repeat(400) },
    { type: "message", role: "assistant", text: "done" },
  ] }]));
  const snapshot = snapshotJudgeMaterial(handle, 3000).material;
  const text = JSON.stringify(snapshot);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(3000);
  expect(text).toContain(earlier);
  const projection = snapshot as { omissions: { path: string }[] };
  expect(projection.omissions.map(item => item.path)).toEqual(["/records/3/output", "/records/2/input"]);
  const tiny = snapshotJudgeMaterial(handle, 100).material;
  expect(Buffer.byteLength(JSON.stringify(tiny))).toBeGreaterThan(100);
  expect(JSON.stringify(tiny)).toContain("protected");
  expect(JSON.stringify(tiny)).toContain("done");
});
