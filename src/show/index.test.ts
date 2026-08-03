// cases: docs/engineering/testing/unit/reports.md
// 覆盖「参数化页与下钻目标」：不带 `--report` 的 `show @<locator>` 忽略项目默认报告，始终走官方 Attempt 页。
// 观察面是 runShow 的成功/错误语义，不锁终端排版；显式报告的缺页用法矩阵由 e2e/report 验收。

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { RECORD_FORMAT, RECORD_SCHEMA_VERSION } from "../types.ts";
import { openRecord } from "../record/index.ts";
import { defineReport } from "../report/definition/report.ts";
import { runShow } from "./index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRecord(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-show-attempt-"));
  roots.push(root);
  const experimentId = "exp/default-report";
  const evalId = "case/one";
  const startedAt = "2026-07-08T10:00:00.000Z";
  const runId = "exp-default-report:2026-07-08T10-00-00-000Z";
  const runDir = join(root, experimentId, "2026-07-08T10-00-00-000Z");
  const attemptDir = join(runDir, evalId, "a0");

  await mkdir(attemptDir, { recursive: true });
  await writeFile(
    join(runDir, "run.json"),
    JSON.stringify({
      format: RECORD_FORMAT,
      schemaVersion: RECORD_SCHEMA_VERSION,
      producer: { name: "niceeval", version: "0.4.6" },
      runId,
      experimentId,
      agent: "fixture-agent",
      startedAt,
      completedAt: startedAt,
      configHash: "fixture-config",
      experiment: {
        attempts: 1,
        earlyExit: false,
        selectedEvalIds: [evalId],
        sandboxLayer: {},
        sandboxPlansByEval: {},
        agentInstalls: [],
      },
    }),
    "utf-8",
  );
  await writeFile(
    join(attemptDir, "result.json"),
    JSON.stringify({
      id: evalId,
      verdict: "passed",
      attempt: 0,
      durationMs: 1000,
      assertions: [],
      evidenceCoverage: completeEvidenceCoverage,
    }),
    "utf-8",
  );
  return root;
}

describe("show locator 的默认报告选择", () => {
  it("不带 --report 的 locator 不读取项目 config.report，仍渲染官方 Attempt 诊断页", async () => {
    const root = await makeRecord();
    const locator = (await openRecord(root)).experiments[0]!.latestRun.evals[0]!.attempts[0]!.locator!;
    let out = "";
    let err = "";
    const configuredReportWithoutAttemptPage = defineReport({
      pages: [{ id: "overview", title: "Overview", render: () => null }],
    });

    const code = await runShow(
      root,
      [locator],
      { record: root, configReport: configuredReportWithoutAttemptPage },
      {
        out: (text) => (out += text),
        err: (text) => (err += text),
        width: 100,
      },
    );

    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain(locator);
  });
});
