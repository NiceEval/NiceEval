// Regression note: memory/assertion-snapshot-shape-needs-blob-fallback.md
// rerun: pnpm e2e test --repo eval -- --run test/assertion-values.test.ts

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only, type E2ECommand, type ProcessReceipt } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertionEntries, inspectAttempt, type AssertionInspectionCheckpoint } from "./inspection.ts";

const MATCHED_LABELS = [
  "inOrder.adjacent:matched", "inOrder.subsequence:matched", "inOrder.distinct-items:matched",
  "inOrder.known-witness:matched", "inOrder.alternatives:matched", "inOrder.not:matched",
  "inOrder.step-known-witness:matched", "inOrder.heard-movement:matched",
  "countWhere:matched", "countWhere.empty:matched", "filterWhere.mapEach:matched", "mapValue:matched",
  "includes:matched", "excludes:matched", "pattern:matched", "includesUrl:matched",
  "hasSections:matched", "isDefined:matched", "isTrue:matched", "isFalse:matched",
  "equals:matched", "matches:matched", "satisfies:matched", "defineValueMatch:matched",
  "jsonMatch:matched", "referencesAnyPath:matched", "and:matched", "or:matched", "not:matched",
  "similarity:matched", "defineScoreMatch:matched", "commandSucceeded:matched",
  "toolMatch.name:matched", "toolMatch.input:matched", "toolMatch.output:matched",
  "toolMatch.status:matched", "toolMatch.path:matched", "toolOccurrence.exact:matched",
  "toolMatch.input-only:matched", "toolOccurrence.atLeast:matched", "notCalledTool:matched",
  "commandMatch:matched", "events.raw-value:matched", "eventOccurrence.atLeast:matched",
  "eventOccurrence.exactly:matched", "eventOccurrence.greaterThan:matched",
  "eventOccurrence.atMost:matched", "eventOccurrence.lessThan:matched", "eventMatch:matched", "eventMatch.tool:matched",
  "eventMatch.finished:matched", "eventOrder:matched",
] as const;

const MISMATCHED_LABELS = [
  "inOrder.reverse:mismatched", "inOrder.empty:mismatched", "inOrder.single-item:mismatched",
  "inOrder.impossible:mismatched", "inOrder.not:mismatched", "inOrder.heard-movement:mismatched",
  "countWhere:mismatched", "filterWhere.mapEach:mismatched", "mapValue:mismatched",
  "includes:mismatched", "excludes:mismatched", "pattern:mismatched", "includesUrl:mismatched",
  "hasSections:mismatched", "isDefined:mismatched", "isTrue:mismatched", "isFalse:mismatched",
  "equals:mismatched", "matches:mismatched", "satisfies:mismatched", "defineValueMatch:mismatched",
  "jsonMatch:mismatched", "referencesAnyPath:mismatched", "and:mismatched", "or:mismatched",
  "not:mismatched", "similarity:mismatched", "defineScoreMatch:mismatched",
  "commandSucceeded:mismatched", "toolMatch.name:mismatched", "toolMatch.input:mismatched",
  "toolMatch.output:mismatched", "toolMatch.status:mismatched", "toolMatch.path:mismatched",
  "toolMatch.input-only:mismatched", "toolOccurrence.exact:mismatched",
  "toolOccurrence.atLeast:mismatched", "notCalledTool:mismatched",
  "commandMatch.executable:mismatched", "commandMatch.argsStart:mismatched",
  "commandMatch.excludes:mismatched", "commandMatch.status:mismatched", "eventMatch:mismatched",
  "eventMatch.tool:mismatched", "eventMatch.finished:mismatched", "eventOrder:mismatched",
] as const;

const UNAVAILABLE_LABELS = [
  "inOrder.possible:unavailable", "inOrder.nonfinite:unavailable", "inOrder.null:unavailable",
  "inOrder.hole:unavailable", "inOrder.not:unavailable", "inOrder.step:unavailable",
  "inOrder.partial:unavailable", "inOrder.source:unavailable",
  "countWhere.nan:unavailable", "countWhere.partial:unavailable", "countWhere.item:unavailable",
  "filterWhere.item:unavailable", "mapEach.nan:unavailable", "mapValue.nan:unavailable",
] as const;

function assertionOutcomeMap(entries: readonly { display: unknown; decision: unknown }[]): Map<string, string> {
  return new Map(entries.flatMap((entry) => {
    if (entry.display === null || typeof entry.display !== "object" || Array.isArray(entry.display)) return [];
    if (entry.decision === null || typeof entry.decision !== "object" || Array.isArray(entry.decision)) return [];
    const label = (entry.display as Record<string, unknown>).label;
    const state = (entry.decision as Record<string, unknown>).result;
    return typeof label === "string" && typeof state === "string" ? [[label, state] as const] : [];
  }));
}
// @feature docs/feature/assertions/README.md

test.concurrent("值与连续 Match 登记可审阅的检查结果", async () => {
  const startedAt = performance.now();
  // CI needs about 4.4s per installed CLI detail read (113 entries).
  // Retain headroom for the full readback and 60s for termination/staging.
  const deadlineAt = startedAt + 600_000;
  await evalE2E.case(
    "values",
    { artifacts: [
      { source: ".niceeval", target: ".niceeval", optional: true },
      { source: ".assertion-values-diagnostics", target: "diagnostics", optional: true },
    ] },
    async ({ paths: { projectRoot }, commands: { niceeval: installedNiceeval } }) => {
      const diagnosticRoot = join(projectRoot, ".assertion-values-diagnostics");
      await mkdir(diagnosticRoot);
      let latest: {
        stage: "prepare" | "invoke" | "observe" | "outcome";
        operation: string;
        entryId?: string;
        detailIndex?: number;
        detailTotal?: number;
      } = { stage: "prepare", operation: "case" };
      let stageStartedAt = startedAt;
      let commandCount = 0;
      const record = async (event: string, receipt?: ProcessReceipt, receiptFile?: string) => {
        const now = performance.now();
        const line = JSON.stringify({
          event, ...latest, commandCount,
          elapsedMs: Math.round(now - startedAt),
          durationMs: receipt?.durationMs ?? Math.round(now - stageStartedAt),
          remainingMs: Math.max(0, Math.floor(deadlineAt - now)),
          receiptFile,
          exitCode: receipt?.exitCode, signal: receipt?.signal, timedOut: receipt?.timedOut,
        });
        await appendFile(join(diagnosticRoot, "stages.ndjson"), `${line}\n`);
        console.log(`[assertion-values] ${line}`);
      };
      const stage = async (
        phase: typeof latest.stage,
        operation: string,
        entryId?: string,
        detailIndex?: number,
        detailTotal?: number,
      ) => {
        latest = { stage: phase, operation, entryId, detailIndex, detailTotal };
        stageStartedAt = performance.now();
        await record("stage-start");
      };
      const niceeval: E2ECommand = {
        ...installedNiceeval,
        run: async (args, options) => {
          if (latest.stage !== "invoke") {
            await stage("invoke", latest.operation, latest.entryId, latest.detailIndex, latest.detailTotal);
          }
          const remainingMs = Math.floor(deadlineAt - performance.now());
          if (remainingMs <= 0) {
            await record("deadline-exhausted");
            throw new Error("Assertion values operation deadline exhausted before starting the next CLI command");
          }
          commandCount += 1;
          const receipt = await installedNiceeval.run(args, {
            ...options,
            timeoutMs: Math.min(options?.timeoutMs ?? (latest.operation.startsWith("exp:") ? 90_000 : 30_000), remainingMs),
          });
          // Preserve the public receipt before any decoder or outcome assertion can throw.
          const receiptFile = `command-${String(commandCount).padStart(3, "0")}.json`;
          await writeFile(join(diagnosticRoot, receiptFile), `${JSON.stringify(receipt)}\n`);
          await record("command-complete", receipt, receiptFile);
          if (receipt.timedOut) {
            throw new Error(`Assertion values CLI exceeded its remaining operation budget\n\n${receipt.diagnostic()}`);
          }
          await stage("observe", latest.operation, latest.entryId, latest.detailIndex, latest.detailTotal);
          return receipt;
        },
      };
      await record("case-prepared");
      try {
        await stage("invoke", "exp:assertion-values");
        const run = await niceeval.run(["exp", "assertion-values", "--rerun", "all", "--json"]);
        expect(run.exitCode, run.diagnostic()).toBe(0);
        expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
        const evaluation = only(
          run.expEvalEvents(),
          (event) => event.event === "eval" && event.evalId === "assertion-values" && event.locator !== undefined,
          run.diagnostic(),
        );
        await stage("outcome", "exp:assertion-values");
        expect(evaluation).toMatchObject({
          event: "eval",
          evalId: "assertion-values",
          verdict: "passed",
        });

        await stage("invoke", "exp:assertion-match-outcomes");
        const outcomeRun = await niceeval.run(["exp", "assertion-match-outcomes", "--rerun", "all", "--json"]);
        expect(outcomeRun.exitCode, outcomeRun.diagnostic()).toBe(1);
        expect(outcomeRun.expReceipt(), outcomeRun.diagnostic()).toMatchObject({ completion: "completed" });
        const outcomes = only(
          outcomeRun.expEvalEvents(),
          (event) => event.event === "eval" && event.evalId === "assertion-match-outcomes" && event.locator !== undefined,
          outcomeRun.diagnostic(),
        );
        await stage("outcome", "exp:assertion-match-outcomes");
        expect(outcomes).toMatchObject({ verdict: "failed" });
        await stage("prepare", "attempt.get");
        const inspected = await inspectAttempt(niceeval, projectRoot, outcomes.locator!, "attempt.get");
        await stage("outcome", "attempt.get");
        expect(inspected.receipt.exitCode, inspected.receipt.diagnostic()).toBe(0);
        expect(inspected.receipt.stdout).toBe(`${JSON.stringify(inspected.document)}\n`);
        expect(inspected.document).toMatchObject({
          protocol: "niceeval.query/v1",
          operation: "attempt.get",
          attempt: { locator: outcomes.locator, core: { outcome: "completed" }, verdict: "failed" },
        });
        expect(inspected.document.attempt.assertions.state).toBe("available");
        const indexEntries = inspected.document.attempt.assertions.entries;
        const detailPositions = new Map(indexEntries.map((entry, index) => [entry.entryId, index + 1]));
        const checkpoint: AssertionInspectionCheckpoint = (phase, entryId) =>
          stage(phase, "attempt.assertion.detail", entryId, detailPositions.get(entryId), indexEntries.length);
        const details = await inspectAssertionEntries(
          niceeval,
          projectRoot,
          outcomes.locator!,
          inspected.document.attempt.assertions.entries,
          {},
          checkpoint,
        );
        await stage("outcome", "assertion-outcomes");
        const entries = details.map((detail) => {
          expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
          expect(detail.document.assertion.entryId).toBe(detail.entry.entryId);
          return assertionEntry(detail.document, detail.receipt.diagnostic());
        });
        const states = assertionOutcomeMap(entries);
        expect([...states.keys()].sort()).toEqual([...MATCHED_LABELS, ...MISMATCHED_LABELS, ...UNAVAILABLE_LABELS].sort());
        for (const label of MATCHED_LABELS) expect(states.get(label), label).toBe("matched");
        for (const label of MISMATCHED_LABELS) expect(states.get(label), label).toBe("mismatched");
        for (const label of UNAVAILABLE_LABELS) expect(states.get(label), label).toBe("unavailable");
        const composed = entries.find(entry => entry.display.label === "filterWhere.mapEach:matched");
        expect(JSON.stringify(composed)).toContain("actor-a");
        expect(JSON.stringify(composed)).toContain("actor-c");
        expect(JSON.stringify(composed)).toContain("aggregate");
        const ordered = entries.find(entry => entry.display.label === "inOrder.heard-movement:matched");
        expect(JSON.stringify(ordered)).toContain("formally-heard");
        expect(JSON.stringify(ordered)).toContain("adopted-movement");
        expect(JSON.stringify(ordered)).toContain("heard-by-b");
        await record("case-complete");
      } catch (cause) {
        await record("case-failed");
        throw new Error(
          `Assertion values failed at ${latest.stage}: ${latest.operation}`
          + (latest.entryId === undefined ? "" : ` entryId=${latest.entryId} detail=${latest.detailIndex}/${latest.detailTotal}`)
          + ` after ${Math.round(performance.now() - startedAt)}ms; see diagnostics/stages.ndjson and command receipts`,
          { cause },
        );
      }
    },
  );
}, 660_000);
