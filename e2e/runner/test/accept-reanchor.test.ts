// owner: docs/engineering/testing/e2e/runner.md#runner-accept-reanchor
// regression: memory/accept-source-run-diverges-from-project-current-identity.md
// rerun: pnpm e2e --repo runner -- --run test/accept-reanchor.test.ts

import { only } from "@niceeval/testkit";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

interface ExpEvent {
  event: string;
  total?: number;
  reused?: number;
  locator?: string;
  experimentId?: string;
  evalId?: string;
  verdict?: string;
  attempts?: number;
  passed?: number;
}

interface DryTarget {
  experimentId: string;
  evalId: string;
  slots: Array<{ state: "reused" | "gap" }>;
  readbacks: Array<{
    source: { attemptId: string; locator: string };
    verdict: string | { state: string; value?: string };
  }>;
}

interface DryPlan {
  total: number;
  reused: number;
  matrix: DryTarget[];
}

type ReportScalar = null | boolean | number | string;

interface ReportTableBlock {
  type: "table";
  caption: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, ReportScalar>>;
}

interface ReportBlock {
  type: string;
  children?: ReportBlock[];
  caption?: string;
  columns?: Array<{ key: string; label: string }>;
  rows?: Array<Record<string, ReportScalar>>;
}

interface RunMembershipShow {
  format: "niceeval.report-show/v1";
  sample: {
    selection: { policy: string; runIds?: string[] };
    runCount: number;
    slotCount: number;
    denominator: number;
  };
  tree: { pages: Array<{ pageId: string; route: string; node: ReportBlock }> };
}

interface ProjectCurrentShow {
  format: "niceeval.report-show/v1";
  sample: {
    selection: {
      policy: "project-current";
      experimentIds: "all" | string[];
      selectedRunIds: string[];
    };
    runCount: number;
    slotCount: number;
    denominator: number;
  };
}

const RUN_MEMBERSHIP_COLUMN_KEYS = [
  "runId",
  "slotId",
  "slotState",
  "memberAction",
  "memberRelation",
  "sourceAttemptLocator",
  "evidenceState",
] as const;

function reportTables(blocks: ReportBlock[]): ReportTableBlock[] {
  const tables: ReportTableBlock[] = [];
  const visit = (block: ReportBlock): void => {
    if (
      block.type === "table" &&
      block.caption !== undefined &&
      block.columns !== undefined &&
      block.rows !== undefined
    ) {
      tables.push({
        type: "table",
        caption: block.caption,
        columns: block.columns,
        rows: block.rows,
      });
    }
    for (const child of block.children ?? []) visit(child);
  };
  for (const block of blocks) visit(block);
  return tables;
}

test("审阅变更后 accept 以 reference Member 采用旧 Attempt，保留 verdict/evidence 与审计 provenance", async () => {
  await runnerE2E.case(
    "accept-reanchor",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const root = paths.projectRoot;
    const initial = await niceeval.run(["exp", "accept", "--json"]);
    expect(initial.exitCode, initial.diagnostic()).toBe(0);
    const initialEvents = initial.ndjson<ExpEvent>();
    const initialStart = only(initialEvents, (event) => event.event === "start", initial.diagnostic());
    expect(initialStart).toMatchObject({ event: "start", total: 1, reused: 0 });
    const initialEval = only(initialEvents, (event) => event.event === "eval", initial.diagnostic());
    expect(initialEval).toMatchObject({
      event: "eval",
      experimentId: "accept",
      evalId: "accept/accept-target",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    });
    expect(initial.expReceipt()).toMatchObject({ completion: "completed" });
    const oldLocator = initialEval.locator!;
    expect(oldLocator).toMatch(/^@1[0-9A-HJKMNP-TV-Z]{12}$/);

    const evalPath = join(root, "evals", "accept", "accept-target.eval.ts");
    const evalSource = readFileSync(evalPath, "utf8");
    expect(evalSource).toContain('await t.send("accept")');
    writeFileSync(evalPath, evalSource.replace('await t.send("accept")', 'await t.send("accept after review")'), "utf8");

    const humanDry = await niceeval.run(["exp", "accept", "--dry"]);
    expect(humanDry.exitCode, humanDry.diagnostic()).toBe(0);
    expect(humanDry.stdout).toContain("gap 0:identity-mismatch");
    expect(humanDry.stdout).toContain(`source ${oldLocator} · prior · verdict passed`);
    expect(humanDry.stdout).toContain(`accept: niceeval accept ${oldLocator}`);

    const jsonDry = await niceeval.run(["exp", "accept", "--dry", "--json"]);
    expect(jsonDry.exitCode, jsonDry.diagnostic()).toBe(0);
    const plan = jsonDry.json<DryPlan>();
    expect(plan).toMatchObject({ total: 1, reused: 0 });
    const changedTarget = plan.matrix.find((row) => row.evalId === "accept/accept-target");
    expect(changedTarget).toBeDefined();
    expect(changedTarget!.slots.map((slot) => slot.state)).toEqual(["gap"]);
    expect(changedTarget!.readbacks).toHaveLength(1);
    expect(changedTarget!.readbacks[0]!.source.locator).toBe(oldLocator);
    expect(changedTarget!.readbacks[0]!.verdict).toMatchObject({ state: "available", value: "passed" });

    const accepted = await niceeval.run(["accept", oldLocator]);
    expect(accepted.exitCode, accepted.diagnostic()).toBe(0);
    expect(accepted.stdout).toContain(`Accepted source Attempt ${oldLocator} into new Run `);
    const acceptedRunMatch = accepted.stdout.match(
      /into new Run ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\. Result locator remains (@1[0-9A-HJKMNP-TV-Z]{12})\./,
    );
    expect(acceptedRunMatch, accepted.diagnostic()).not.toBeNull();
    const acceptedRunId = acceptedRunMatch![1]!;
    const newLocator = acceptedRunMatch![2]!;
    // Explicit adoption writes a reference Member, so its result locator keeps
    // the immutable source Attempt identity instead of manufacturing an Attempt.
    expect(newLocator).toBe(oldLocator);

    const acceptedCurrent = await niceeval.run(["show", "--run", acceptedRunId, "--json"]);
    expect(acceptedCurrent.exitCode, acceptedCurrent.diagnostic()).toBe(0);
    const acceptedShow = acceptedCurrent.json<RunMembershipShow>();
    expect(acceptedShow).toMatchObject({
      format: "niceeval.report-show/v1",
      sample: {
        selection: { policy: "explicit-runs", runIds: [acceptedRunId] },
        runCount: 1,
        slotCount: 1,
        denominator: 1,
      },
      tree: { pages: [{ pageId: "run-membership", route: "/" }] },
    });
    const runMembershipPage = acceptedShow.tree.pages.find((page) => page.pageId === "run-membership");
    expect(runMembershipPage).toBeDefined();
    const matchingTables = reportTables([runMembershipPage!.node]).filter((table) =>
      table.columns.map((column) => column.key).join("\u0000") === RUN_MEMBERSHIP_COLUMN_KEYS.join("\u0000")
    );
    expect(matchingTables).toHaveLength(1);
    const acceptedRunRows = matchingTables[0]!.rows.filter((row) => row.runId === acceptedRunId);
    expect(acceptedRunRows).toHaveLength(1);
    const acceptedSlotId = acceptedRunRows[0]!.slotId;
    expect(typeof acceptedSlotId).toBe("string");
    const acceptedRow = matchingTables[0]!.rows.find((row) =>
      row.runId === acceptedRunId && row.slotId === acceptedSlotId
    );
    expect(acceptedRow).toEqual({
      runId: acceptedRunId,
      slotId: acceptedSlotId,
      slotState: "included",
      memberAction: "accepted",
      memberRelation: "reference",
      sourceAttemptLocator: oldLocator,
      evidenceState: "available",
    });

    // Explicit --run proves the durable reference, while the default read proves
    // accept used the same current target identity as project-current planning.
    const projectCurrent = await niceeval.run(["show", "--json"]);
    expect(projectCurrent.exitCode, projectCurrent.diagnostic()).toBe(0);
    expect(projectCurrent.json<ProjectCurrentShow>()).toMatchObject({
      format: "niceeval.report-show/v1",
      sample: {
        selection: {
          policy: "project-current",
          selectedRunIds: [acceptedRunId],
        },
        runCount: 1,
        slotCount: 1,
        denominator: 1,
      },
    });

    const currentEvidence = await niceeval.run(["show", newLocator, "--execution"]);
    expect(currentEvidence.exitCode, currentEvidence.diagnostic()).toBe(0);
    expect(currentEvidence.stdout).toContain("runner-fixture-ok");

    // An accepted action explains this Run's membership; it is deliberately
    // not a future eligibility grant for the immutable source Attempt.
    const nextDry = await niceeval.run(["exp", "accept", "--dry", "--json"]);
    expect(nextDry.exitCode, nextDry.diagnostic()).toBe(0);
    const nextPlan = nextDry.json<DryPlan>();
    expect(nextPlan).toMatchObject({ total: 1, reused: 0 });
    const nextTarget = nextPlan.matrix.find((row) => row.evalId === "accept/accept-target");
    expect(nextTarget).toBeDefined();
    expect(nextTarget!.slots.map((slot) => slot.state)).toEqual(["gap"]);
    expect(nextTarget!.readbacks[0]!.source.locator).toBe(newLocator);
    },
  );
});
