// cases: docs/engineering/testing/unit/reports.md

import { describe, expect, it } from "vitest";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { assembleSourceTree } from "../record/annotated-source.ts";
import { encodeAttemptLocator, type AttemptIdentity } from "../record/locator.ts";
import type { AttemptEvidence } from "../record/attempt-evidence.ts";
import type { AssertionResult, EvalResult, SourcePathFrame } from "../types.ts";
import { annotatedSourceResult } from "./tasks.ts";

const identity: AttemptIdentity = { runId: "run-source-selection", evalId: "eval/source", attempt: 0 };

function assertion(name: string, file: string, callers: SourcePathFrame[] = []): AssertionResult {
  return {
    name,
    severity: "soft",
    outcome: "passed",
    score: 1,
    loc: { file, line: 1, callers },
  };
}

function sourceEvidence(): AttemptEvidence {
  const entry = { path: "evals/main.ts", content: "run();\n", role: "entry" as const };
  const first = { path: "evals/a/helper.ts", content: "first();\n", role: "referenced" as const };
  const second = { path: "evals/b/helper.ts", content: "second();\n", role: "referenced" as const };
  const assertions = [
    assertion("first", first.path),
    assertion("second", second.path),
    assertion("unavailable", "evals/missing.ts", [{ kind: "project", file: entry.path, line: 1 }]),
  ];
  const result: EvalResult = {
    id: identity.evalId,
    agent: "agent",
    verdict: "passed",
    attempt: identity.attempt,
    durationMs: 1,
    assertions,
    evidenceCoverage: completeEvidenceCoverage,
  };
  return {
    locator: encodeAttemptLocator(identity),
    identity,
    experimentId: "experiment/source",
    result,
    events: null,
    evalSource: assembleSourceTree({
      entry,
      sources: [entry, first, second],
      assertions,
      scoreEntries: [],
      sends: [],
    }),
    execution: null,
    diff: null,
    trace: null,
    commands: null,
    artifactPaths: { dir: "/tmp/niceeval/source-selection" },
    capabilities: { source: true, execution: false, timing: false, diff: false },
  };
}

describe("annotatedSourceResult 的单文件选择", () => {
  it("按已捕获路径后缀唯一匹配，返回该文件全文", async () => {
    const result = await annotatedSourceResult(sourceEvidence(), { mode: "file", file: "a/helper.ts" });
    expect(result.source?.spine.file).toBe("evals/a/helper.ts");
    expect(result.source?.spine.lines.map((line) => line.text)).toEqual(["first();"]);
  });

  it("后缀命中多个文件时列出候选并拒绝猜测", async () => {
    await expect(annotatedSourceResult(sourceEvidence(), { mode: "file", file: "helper.ts" }))
      .rejects.toMatchObject({
        requested: "helper.ts",
        candidates: ["evals/a/helper.ts", "evals/b/helper.ts"],
      });
  });

  it("0 命中明确报错，unavailable 路径不冒充可读的 captured file", async () => {
    await expect(annotatedSourceResult(sourceEvidence(), { mode: "file", file: "missing.ts" }))
      .rejects.toThrow('No captured source file matches suffix "missing.ts"');
  });
});
