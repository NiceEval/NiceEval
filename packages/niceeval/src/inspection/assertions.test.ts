// cases: docs/engineering/testing/architecture/unit/reports.md
import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { mintRecordContentHandle } from "../record/attachment/content.ts";
import { projectAttemptAssertionDetail } from "./assertions.ts";
import type { InspectionAssertionsRead } from "./facts.ts";
import type { InspectionFactSource } from "./source.ts";
import { renderAssertions } from "../show/render.ts";

// @use-case docs/feature/inspection/use-case/inspection-show-as-json.md
test.concurrent("compact assertions keep decisions and rationales without reading large sealed materials", () => {
  const bytes = Buffer.from("large material ".repeat(90_000));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const handle = mintRecordContentHandle("text");
  const entryId = "ae_00000000000000000001";
  const unavailable = { state: "unavailable", reason: "not-recorded" };
  const input = {
    state: "available", issues: [],
    value: { entries: [{
      entryId, display: { label: "Answer matches", groupPath: [] }, criterion: unavailable,
      materials: { source: { kind: "content", content: handle, encoding: "utf-8", byteLength: bytes.length, preview: "large material" }, evidence: [], coverage: { state: "complete" }, limitations: [] },
      evaluation: { kind: "ordinary", observed: { kind: "fields", fields: [{ label: "rationale", value: { kind: "value", value: "Expected answer was absent." } }] } },
      decision: { result: "mismatched", reason: "condition-not-met", gate: "failed" },
      control: { state: "available", value: "none" },
      contribution: { state: "earned", earned: 0, points: 1 },
      policy: { requirement: { state: "available", value: "required" }, condition: unavailable },
      explanationRetention: unavailable,
    }], sourceSites: [] },
    contents: new WeakMap([[handle, { contentId: "material", byteLength: bytes.length, digest, chunkCount: 1 }]]),
  } as unknown as InspectionAssertionsRead;
  let reads = 0;
  const source = { readContentPage: () => {
    reads++;
    return { contentId: "material", afterOrdinal: -1, chunks: [{ ordinal: 0, bytes }], nextOrdinal: null };
  } } as unknown as InspectionFactSource;
  const turns = { state: "not-recorded" } as const;
  const compact = projectAttemptAssertionDetail(source, input, turns, entryId, "compact")!;
  expect(reads).toBe(0);
  expect(JSON.stringify(compact).length).toBeLessThan(10_000);
  expect(JSON.stringify(compact)).not.toContain("base64");
  expect(compact).toMatchObject({ entry: { contribution: { earned: 0, points: 1 } }, check: { state: "mismatched", reason: "condition-not-met" } });
  const text = renderAssertions("@1000000000000", [compact]);
  expect(text).toContain("Gates 1 fail · Scored 1");
  expect(text).toContain("GATE fail  SCORE 0/1");
  expect(text).toContain("0/1");
  expect(text).toContain("Expected answer was absent.");
  expect(text).toContain("Next");
  const full = projectAttemptAssertionDetail(source, input, turns, entryId)!;
  expect(reads).toBe(1);
  expect(full).toMatchObject({ entry: { materials: { source: { content: { base64: bytes.toString("base64") } } } } });
});
