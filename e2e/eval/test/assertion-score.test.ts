// rerun: pnpm e2e test --repo eval -- --run test/assertion-score.test.ts

import { only } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertionEntries, inspectAttempt, inspectRunSummary } from "./inspection.ts";

// @feature docs/feature/assertions/README.md
test.concurrent("计分 Eval 公开区分质量门失败、连续得分与停止", async () => {
  await evalE2E.case(
    "score",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-score", "--rerun", "all", "--json", "--junit", "junit/score.xml"]);
      expect(run.exitCode, run.diagnostic()).toBe(1);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluations = run.expEvalEvents();
      const eventsFor = (evalId: string) => evaluations.filter((event) => event.evalId === evalId);
      const scoredEvents = eventsFor("assertion-score/scored");
      const gatedEvents = eventsFor("assertion-score/gated");
      const unavailableEvents = eventsFor("assertion-score/unavailableGate");
      const emptyEvents = eventsFor("assertion-score/empty");
      const stoppedEvents = eventsFor("assertion-score/stopped");
      const skippedEvents = eventsFor("assertion-score/skipped");
      for (const [evalId, events, verdict] of [
        ["assertion-score/scored", scoredEvents, "passed"],
        ["assertion-score/empty", emptyEvents, "passed"],
        ["assertion-score/gated", gatedEvents, "failed"],
        ["assertion-score/unavailableGate", unavailableEvents, "errored"],
        ["assertion-score/stopped", stoppedEvents, "passed"],
        ["assertion-score/skipped", skippedEvents, "skipped"],
      ] as const) {
        expect(events, `${evalId} must publish the first decisive Attempt under early exit`).toHaveLength(1);
        expect(events).toEqual(events.map((event) => expect.objectContaining({
          event: "eval",
          evalId,
          verdict,
          locator: expect.any(String),
        })));
      }
      expect(evaluations.filter((event) => event.verdict === "failed")).toHaveLength(1);
      const junit = await readFile(join(projectRoot, "junit/score.xml"), "utf8");
      expect(junit).toContain('failures="2" errors="2"');
      expect(junit.match(/<testcase name="assertion-score\/gated[^\n]+<failure /g)).toHaveLength(2);
      const runId = only(run.expReceipt().createdRunIds, () => true, run.diagnostic());
      const summary = await inspectRunSummary(niceeval, projectRoot, runId);
      expect(summary.receipt.exitCode, summary.receipt.diagnostic()).toBe(0);
      expect(summary.document).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "run.summary",
        issues: [],
        summary: { denominator: { expected: 12, observed: 12 } },
      });
      for (const [evalId, verdict] of [
        ["assertion-score/scored", "passed"],
        ["assertion-score/empty", "passed"],
        ["assertion-score/gated", "failed"],
        ["assertion-score/unavailableGate", "errored"],
        ["assertion-score/stopped", "passed"],
        ["assertion-score/skipped", "skipped"],
      ] as const) {
        expect(summary.document.summary.members.filter((member) =>
          member.evalId === evalId && member.verdict === verdict
        )).toHaveLength(2);
      }

      const entriesByEval = new Map<string, (readonly ReturnType<typeof assertionEntry>[])[]>();
      for (const member of summary.document.summary.members) {
        expect(member.locator, `${member.evalId} must have a published Attempt locator`).toEqual(expect.any(String));
        const inspected = await inspectAttempt(niceeval, projectRoot, member.locator!, "attempt.get");
        expect(inspected.receipt.exitCode, inspected.receipt.diagnostic()).toBe(0);
        expect(inspected.document.attempt.assertions.state).toBe("available");
        const details = await inspectAssertionEntries(
          niceeval,
          projectRoot,
          member.locator!,
          inspected.document.attempt.assertions.entries,
        );
        const entries = details.map((detail) => {
          expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
          expect(detail.document.assertion.entryId).toBe(detail.entry.entryId);
          return assertionEntry(detail.document, detail.receipt.diagnostic());
        });
        const attempts = entriesByEval.get(member.evalId) ?? [];
        attempts.push(entries);
        entriesByEval.set(member.evalId, attempts);
      }
      for (const evalId of [
        "assertion-score/scored",
        "assertion-score/empty",
        "assertion-score/gated",
        "assertion-score/unavailableGate",
        "assertion-score/stopped",
        "assertion-score/skipped",
      ]) {
        expect(entriesByEval.get(evalId), `${evalId} must expose both published Attempt assertion sets`).toHaveLength(2);
      }
      for (const entries of entriesByEval.get("assertion-score/scored") ?? []) {
        expect(entries).toHaveLength(7);
        expect(entries.map(({ contribution }) => contribution)).toEqual(expect.arrayContaining([
          { state: "earned", points: 1, earned: 1 },
          { state: "earned", points: 2, earned: 2 },
          { state: "earned", points: 3, earned: 3 },
          { state: "earned", points: 5, earned: 0 },
          { state: "earned", points: 4, earned: 4 },
        ]));
        for (const label of ["unavailable measurement is only recorded", "unavailable condition is only recorded"]) {
          expect(only(entries, (entry) => entry.display.label === label, label)).toMatchObject({
            decision: { result: "errored", gate: "not-gate" },
            policy: { requirement: { state: "available", value: "optional" } },
            contribution: { state: "not-scored" },
          });
        }
      }
      for (const entries of entriesByEval.get("assertion-score/empty") ?? []) {
        expect(entries).toEqual([]);
      }
      for (const entries of entriesByEval.get("assertion-score/stopped") ?? []) {
        expect(entries.map(({ contribution }) => contribution)).toEqual([
          { state: "earned", points: 2, earned: 2 },
          { state: "earned", points: 4, earned: 1 },
        ]);
      }
      for (const entries of entriesByEval.get("assertion-score/gated") ?? []) {
        expect(entries.map(({ display, contribution }) => ({ label: display.label, contribution }))).toEqual([
          { label: "quality accepted", contribution: { state: "earned", points: 20, earned: 15 } },
          { label: "required fact failed", contribution: { state: "earned", points: 3, earned: 0 } },
          { label: "quality below minimum", contribution: { state: "earned", points: 20, earned: 15 } },
        ]);
        expect(entries.map(({ decision }) => decision.gate)).toEqual(["satisfied", "failed", "failed"]);
      }
      for (const entries of entriesByEval.get("assertion-score/unavailableGate") ?? []) {
        expect(entries.map(({ contribution }) => contribution)).toEqual([
          { state: "earned", points: 2, earned: 2 },
          { state: "not-scored" },
        ]);
        expect(entries[1]).toMatchObject({
          decision: { result: "errored", gate: "unavailable" },
          policy: { requirement: { state: "available", value: "required" } },
        });
      }
      for (const entries of entriesByEval.get("assertion-score/skipped") ?? []) {
        expect(entries.map(({ contribution }) => contribution)).toEqual([
          { state: "earned", points: 9, earned: 9 },
        ]);
      }
      const human = await niceeval.run(["exp", "assertion-score", "assertion-score/gated", "--rerun", "all"]);
      expect(human.exitCode, human.diagnostic()).toBe(1);
      expect(human.stdout, human.diagnostic()).toContain("FAILED");
      expect(human.stdout).not.toContain("SCORED");
      expect(human.stdout).toContain("30 score · failed · unranked");
      const shown = await niceeval.run(["show", "--experiment", "assertion-score"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toMatch(/Verdicts\s+6 passed; 2 failed; 2 errored; 2 skipped/u);
      const overviewRequest = join(projectRoot, "score-overview.json");
      await writeFile(overviewRequest, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "overview.get" } }));
      const overview = await niceeval.run(["query", "run", "--request", overviewRequest]);
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      const cells = overview.querySuccess("overview.get").overview.cells;
      expect(only(cells, (cell) => cell.evalId === "assertion-score/gated", overview.diagnostic()).score)
        .toMatchObject({ value: null, samples: 0 });
    },
  );
});
