// cases: docs/engineering/testing/unit/record.md

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeEvidenceCoverage } from "../scoring/coverage.ts";
import { RECORD_FORMAT, RECORD_SCHEMA_VERSION } from "../types.ts";
import { createWriter } from "./writer.ts";
import { openRecord } from "./open.ts";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-evidence-schema-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("record schema 14 evidenceCoverage", () => {
  it("writer writes the required six-channel field under its new name", async () => {
    expect(RECORD_SCHEMA_VERSION).toBe(14);
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "test" } });
    const run = await writer.run({ experimentId: "evidence/valid", agent: "fixture", startedAt: "2026-08-02T00:00:00.000Z" });
    await run.writeAttempt({
      id: "q1",
      attempt: 0,
      verdict: "passed",
      durationMs: 1,
      assertions: [],
      evidenceCoverage: completeEvidenceCoverage,
    });
    await run.finish();

    const raw = JSON.parse(await readFile(join(run.dir, "q1", "a0", "result.json"), "utf-8"));
    expect(raw.evidenceCoverage).toEqual(completeEvidenceCoverage);
    expect(raw).not.toHaveProperty("coverage");
  });

  it("writer rejects dynamic input that omits evidenceCoverage", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "test" } });
    const run = await writer.run({ experimentId: "evidence/missing", agent: "fixture", startedAt: "2026-08-02T00:00:00.000Z" });
    await expect(run.writeAttempt({
      id: "q1",
      attempt: 0,
      verdict: "passed",
      durationMs: 1,
      assertions: [],
    } as never)).rejects.toThrow(/writeAttempt\(\) requires evidenceCoverage/);
  });

  it("reader marks a schema-14 result with only the old coverage field malformed", async () => {
    const root = await makeRoot();
    const snapshot = join(root, "evidence_old", "2026-08-02T00-00-00-000Z");
    const attemptDir = join(snapshot, "q1", "a0");
    await mkdir(attemptDir, { recursive: true });
    await writeFile(join(snapshot, "run.json"), JSON.stringify({
      format: RECORD_FORMAT,
      schemaVersion: 14,
      producer: { name: "niceeval", version: "test" },
      runId: "00000000-0000-4000-8000-000000000000",
      experimentId: "evidence/old",
      agent: "fixture",
      startedAt: "2026-08-02T00:00:00.000Z",
    }), "utf-8");
    await writeFile(join(attemptDir, "result.json"), JSON.stringify({
      id: "q1",
      attempt: 0,
      verdict: "passed",
      durationMs: 1,
      assertions: [],
      coverage: completeEvidenceCoverage,
    }), "utf-8");

    const record = await openRecord(root);
    expect(record.unreadable).toEqual([
      expect.objectContaining({ reason: "malformed", detail: expect.stringContaining("requires evidenceCoverage") }),
    ]);
    expect(record.experiments[0]?.latestRun.attempts).toHaveLength(0);
  });
});
