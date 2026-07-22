// Format & mechanism domain(docs/engineering/testing/e2e/report.md 第 1-4 点):断言磁盘上的
// Results 格式、openResults() 库读取的一致性、--json 的一致性、--junit 折叠规则,以及在真实
// passed attempt 上的 README §4.3 CLI 读回(show / show --execution)。
// 消费 scripts/evidence.ts 产出的 Evidence 对象——自己不运行任何 Experiment
// (docs/engineering/testing/e2e/README.md §4.2 明确把本仓库对第 1 点排除在 CLI-black-box 规则
// 之外:format 本身就是被测对象)。风格遵循 docs/engineering/testing/e2e/verification.md:
// 通过 `sh()` 执行 shell 字面量命令,用 node:assert/strict,不用测试框架——遇到第一个被破坏的
// 契约就直接抛出。
//
// 针对同一次真实运行,检查以下四件事:
//   1. 磁盘格式            —— snapshot.json / result.json / events.json / sources.json / o11y.json
//   2. openResults() 一致性 —— 公开的读取库是对 #1 的忠实投影
//   3. --json 一致性        —— CLI 的机器可读摘要与 #1/#2 一致
//   4. --junit 折叠         —— failed → <failure>,errored → <error>
// 再加上在真实 passed attempt 上的 README §4.3 CLI 读回。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { openResults } from "niceeval/results";
import { sh } from "./sh.ts";
import type { Evidence } from "./evidence.ts";

interface AssertionResultLike {
  outcome: "passed" | "failed" | "unavailable";
  score?: number;
}

interface AttemptRecordLike {
  id: string;
  verdict: "passed" | "failed" | "skipped" | "errored";
  durationMs: number;
  assertions: AssertionResultLike[];
  usage?: { inputTokens: number; outputTokens: number };
  estimatedCostUSD?: number;
  locator?: string;
  error?: unknown;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export async function verifyFormat(evidence: Evidence): Promise<void> {
  // ---------------------------------------------------------------------
  // 第 4 点(JUnit 折叠):failed → <failure>,errored → <error>,二者互斥。
  // ---------------------------------------------------------------------
  const failXml = readFileSync(evidence.junit.fail, "utf8");
  assert.ok(failXml.includes("<failure"), "deliberate-fail's JUnit has no <failure> — failed verdict didn't fold correctly");
  assert.ok(!failXml.includes("<error"), "deliberate-fail's JUnit unexpectedly has an <error> — failed/errored folding isn't mutually exclusive");

  const errorXml = readFileSync(evidence.junit.error, "utf8");
  assert.ok(errorXml.includes("<error"), "deliberate-error's JUnit has no <error> — errored verdict didn't fold correctly");
  assert.ok(!errorXml.includes("<failure"), "deliberate-error's JUnit unexpectedly has a <failure> — errored got miscategorized as a failed assertion");

  // ---------------------------------------------------------------------
  // 第 1 点:磁盘格式,直接读取(本仓库对「只能走 CLI」规则免除)。
  // ---------------------------------------------------------------------
  const snapDir = evidence.main.snapshotDir;
  const snapshot = readJson<Record<string, unknown>>(join(snapDir, "snapshot.json"));
  assert.equal(snapshot.format, "niceeval.results", 'snapshot.json.format must be the literal string "niceeval.results"');
  assert.equal(typeof snapshot.schemaVersion, "number", "snapshot.json.schemaVersion must be a number");
  assert.equal((snapshot.producer as { name?: string } | undefined)?.name, "niceeval", 'snapshot.json.producer.name must be "niceeval" for the official writer');
  assert.equal(snapshot.experimentId, "main", "snapshot.json.experimentId must be the experiment id");
  assert.equal(snapshot.agent, "results-mechanism", "snapshot.json.agent must be the Agent's name");
  assert.equal(snapshot.model, "deepseek-chat", "snapshot.json.model must be the experiment's model");
  assert.equal(typeof snapshot.startedAt, "string", "snapshot.json.startedAt must be an ISO string");
  for (const perAttemptField of ["attempts", "evals", "results"]) {
    assert.ok(
      !(perAttemptField in snapshot),
      `snapshot.json must carry no per-attempt data — found "${perAttemptField}" (architecture.md: 快照元数据...不含任何逐 attempt 数据)`,
    );
  }

  assert.equal(evidence.main.attempts.length, 2, `Evidence.main.attempts should have 2 entries (runs:2, earlyExit:false), found ${evidence.main.attempts.length}`);

  const attemptRecords: AttemptRecordLike[] = [];
  const sourceShas = new Set<string>();
  let sharedSha: string | undefined;

  for (const { attemptDir } of evidence.main.attempts) {
    const result = readJson<AttemptRecordLike>(join(attemptDir, "result.json"));
    attemptRecords.push(result);

    assert.equal(result.id, "tool-call", `result.json.id mismatch in ${attemptDir}`);
    assert.ok(["passed", "failed", "skipped", "errored"].includes(result.verdict), `result.json.verdict "${result.verdict}" isn't one of the 4 documented states in ${attemptDir}`);
    assert.equal(result.verdict, "passed", `tool-call attempt in ${attemptDir} did not pass: ${JSON.stringify(result.error ?? result.assertions)}`);
    assert.equal(typeof result.durationMs, "number", `result.json.durationMs missing in ${attemptDir}`);

    assert.ok(Array.isArray(result.assertions) && result.assertions.length > 0, `result.json.assertions missing/empty in ${attemptDir}`);
    for (const a of result.assertions) {
      assert.ok(["passed", "failed", "unavailable"].includes(a.outcome), `assertion outcome "${a.outcome}" not one of passed/failed/unavailable in ${attemptDir}`);
      if (a.outcome !== "unavailable") {
        assert.equal(typeof a.score, "number", `assertion missing numeric score in ${attemptDir}: ${JSON.stringify(a)}`);
      }
    }

    // durationMs / usage / estimatedCostUSD 三件套:usage 存在 ⇒ estimatedCostUSD 也必须存在。
    assert.ok(result.usage, `result.json.usage missing in ${attemptDir} — the real gateway call didn't report usage`);
    assert.equal(typeof result.usage!.inputTokens, "number", `usage.inputTokens missing in ${attemptDir}`);
    assert.equal(typeof result.usage!.outputTokens, "number", `usage.outputTokens missing in ${attemptDir}`);
    assert.equal(typeof result.estimatedCostUSD, "number", `estimatedCostUSD missing alongside usage in ${attemptDir} (architecture.md: durationMs/usage/estimatedCostUSD 三件套成组出现)`);
    assert.ok(result.estimatedCostUSD! > 0, `estimatedCostUSD should be > 0 in ${attemptDir}, got ${result.estimatedCostUSD}`);

    const events = readJson<{ type: string; name?: string; callId?: string; status?: string; role?: string }[]>(join(attemptDir, "events.json"));
    const called = events.find((e) => e.type === "action.called" && e.name === "get_stock_price");
    assert.ok(called, `events.json in ${attemptDir} has no action.called for get_stock_price`);
    const actionResult = events.find((e) => e.type === "action.result" && e.callId === called!.callId);
    assert.ok(actionResult, `events.json in ${attemptDir} has no action.result matching callId ${called!.callId}`);
    assert.equal(actionResult!.status, "completed", `action.result.status in ${attemptDir} should be "completed"`);
    assert.ok(events.some((e) => e.type === "message" && e.role === "assistant"), `events.json in ${attemptDir} has no assistant message event`);

    const sources = readJson<{ path: string; sha256: string }[]>(join(attemptDir, "sources.json"));
    assert.ok(Array.isArray(sources) && sources.length > 0, `sources.json missing/empty in ${attemptDir}`);
    const evalSource = sources.find((s) => s.path.includes("tool-call.eval"));
    assert.ok(evalSource, `sources.json in ${attemptDir} doesn't reference tool-call.eval.ts (entries: ${JSON.stringify(sources)})`);
    assert.ok(!("content" in (evalSource as unknown as Record<string, unknown>)), `sources.json entries must be references (path+sha256), not inlined content, in ${attemptDir}`);
    sourceShas.add(evalSource!.sha256);
    sharedSha = evalSource!.sha256;

    const o11y = readJson<{ totalToolCalls: number; usage?: unknown }>(join(attemptDir, "o11y.json"));
    assert.ok(o11y.totalToolCalls >= 1, `o11y.json.totalToolCalls should be >= 1 in ${attemptDir}, got ${o11y.totalToolCalls}`);
    assert.ok(o11y.usage, `o11y.json.usage missing in ${attemptDir}`);
  }

  // 同一个 eval 文件的两次 attempt 必须去重到同一个 snapshot 级别的 source blob。
  assert.equal(
    sourceShas.size,
    1,
    `the 2 attempts of tool-call reference ${sourceShas.size} distinct source sha256s — expected 1 (same eval file, snapshot-level dedup across attempts)`,
  );
  const blobPath = join(snapDir, "sources", `${sharedSha}.json`);
  assert.ok(existsSync(blobPath), `snapshot-level dedup repository missing ${blobPath} for the shared eval source`);
  const blob = readJson<{ content: string }>(blobPath);
  assert.ok(blob.content.includes("get_stock_price"), `sources/${sharedSha}.json content doesn't look like tool-call.eval.ts`);

  // ---------------------------------------------------------------------
  // 第 2 点:openResults() 一致性——是对第 1 点的忠实投影,而不是另一个独立的真相来源。
  // ---------------------------------------------------------------------
  const results = await openResults(evidence.resultsRoot);
  const exp = results.experiments.find((e) => e.id === "main");
  assert.ok(exp, 'openResults() has no experiment "main"');
  const snap = exp!.latest;
  assert.equal(snap.experimentId, snapshot.experimentId, "openResults() snapshot.experimentId disagrees with disk snapshot.json");
  assert.equal(snap.agent, snapshot.agent, "openResults() snapshot.agent disagrees with disk snapshot.json");
  assert.equal(snap.model, snapshot.model, "openResults() snapshot.model disagrees with disk snapshot.json");
  assert.equal(snap.schemaVersion, snapshot.schemaVersion, "openResults() schemaVersion disagrees with disk snapshot.json");

  const toolCallEval = snap.evals.find((e) => e.id === "tool-call");
  assert.ok(toolCallEval, 'openResults() snapshot has no eval "tool-call"');
  assert.equal(toolCallEval!.attempts.length, 2, `openResults() reports ${toolCallEval!.attempts.length} attempts for tool-call, disk has 2`);

  const diskByLocator = new Map(attemptRecords.map((r) => [r.locator, r]));
  for (const attempt of toolCallEval!.attempts) {
    const onDisk = diskByLocator.get(attempt.result.locator);
    assert.ok(onDisk, `openResults() attempt with locator ${attempt.result.locator} has no matching on-disk result.json`);
    assert.equal(attempt.result.verdict, onDisk!.verdict, "openResults() verdict disagrees with disk result.json");
    assert.equal(attempt.result.estimatedCostUSD, onDisk!.estimatedCostUSD, "openResults() estimatedCostUSD disagrees with disk result.json");
    assert.equal(attempt.result.usage?.inputTokens, onDisk!.usage!.inputTokens, "openResults() usage.inputTokens disagrees with disk result.json");
    assert.equal(attempt.result.usage?.outputTokens, onDisk!.usage!.outputTokens, "openResults() usage.outputTokens disagrees with disk result.json");

    const events = await attempt.events();
    assert.ok(events, "openResults() attempt.events() returned null for a fresh attempt that has events.json on disk");
    assert.ok(
      events!.some((e) => e.type === "action.called" && (e as { name?: string }).name === "get_stock_price"),
      "openResults() events() is missing the action.called seen on disk",
    );

    const sourceArtifacts = await attempt.sources();
    assert.ok(sourceArtifacts, "openResults() attempt.sources() returned null");
    assert.ok(
      sourceArtifacts!.some((s) => "content" in s && (s as { path: string }).path.includes("tool-call.eval")),
      "openResults() sources() should resolve the reference+blob into {path, content}[], not leave it as a raw reference",
    );

    const o11ySummary = await attempt.o11y();
    assert.ok(o11ySummary, "openResults() attempt.o11y() returned null despite o11y.json existing on disk");
  }

  // ---------------------------------------------------------------------
  // 第 3 点:--json 一致性——CLI 的机器可读摘要与磁盘 + openResults() 保持一致。
  // ---------------------------------------------------------------------
  const jsonSummary = readJson<{
    agent: string;
    model?: string;
    passed: number;
    failed: number;
    errored: number;
    results: AttemptRecordLike[];
  }>(evidence.jsonSummaryPath);
  assert.equal(jsonSummary.agent, "results-mechanism", "--json RunSummary.agent disagrees with the Agent's name");
  assert.equal(jsonSummary.model, "deepseek-chat", "--json RunSummary.model disagrees with the experiment's model");
  assert.equal(jsonSummary.passed, 2, "--json RunSummary.passed should count both tool-call attempts");
  assert.equal(jsonSummary.failed, 0, "--json RunSummary.failed should be 0 for the main Experiment");
  assert.equal(jsonSummary.errored, 0, "--json RunSummary.errored should be 0 for the main Experiment");
  assert.ok(Array.isArray(jsonSummary.results) && jsonSummary.results.length === 2, "--json RunSummary.results should have 2 entries (2 attempts)");

  for (const r of jsonSummary.results) {
    const onDisk = diskByLocator.get(r.locator);
    assert.ok(onDisk, `--json result with locator ${r.locator} has no matching on-disk result.json`);
    assert.equal(r.verdict, onDisk!.verdict, "--json verdict disagrees with disk result.json");
    assert.equal(r.estimatedCostUSD, onDisk!.estimatedCostUSD, "--json estimatedCostUSD disagrees with disk result.json");
  }

  // ---------------------------------------------------------------------
  // README §4.3 CLI 读回,在真实 passed attempt 上验证。
  // ---------------------------------------------------------------------
  const locator = evidence.main.attempts[0]!.locator;
  const board = sh(`pnpm exec niceeval show ${locator}`);
  assert.ok(board.includes("tool-call"), "show @locator output doesn't mention the tool-call eval id");
  assert.ok(board.includes("passed"), "show @locator output doesn't show a passed verdict");

  const execution = sh(`pnpm exec niceeval show ${locator} --execution`);
  assert.ok(execution.includes("get_stock_price"), "show --execution is missing the get_stock_price call node — the tool call didn't reach the display layer");
}
