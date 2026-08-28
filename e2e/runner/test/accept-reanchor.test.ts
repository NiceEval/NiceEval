// owner: docs/engineering/testing/e2e/runner.md#runner-accept-reanchor
// regression: memory/accept-source-run-diverges-from-project-current-identity.md
// rerun: pnpm e2e test --repo runner -- --run test/accept-reanchor.test.ts

import { only } from "@niceeval/testkit";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E, writeInspectionRequest } from "./context.ts";

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
    expect(initialStart).toMatchObject({ event: "start", total: 2, reused: 0 });
    const initialEvals = initialEvents.filter((event) => event.event === "eval");
    expect(initialEvals).toHaveLength(2);
    expect(initialEvals).toEqual(expect.arrayContaining([
      expect.objectContaining({ experimentId: "accept", evalId: "accept/accept-target", verdict: "passed" }),
      expect.objectContaining({ experimentId: "accept", evalId: "accept/accept-secondary", verdict: "passed" }),
    ]));
    expect(initial.expReceipt()).toMatchObject({ completion: "completed" });
    const sourceRunId = only(initial.expReceipt().runIds, () => true, initial.diagnostic());
    const primaryEval = only(initialEvals, (event) => event.evalId === "accept/accept-target", initial.diagnostic());
    const secondaryEval = only(initialEvals, (event) => event.evalId === "accept/accept-secondary", initial.diagnostic());
    const oldLocator = primaryEval.locator!;
    const secondaryLocator = secondaryEval.locator!;
    expect(oldLocator).toMatch(/^@1[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(secondaryLocator).toMatch(/^@1[0-9A-HJKMNP-TV-Z]{12}$/);

    const experimentPath = join(root, "experiments", "accept.ts");
    const experimentSource = readFileSync(experimentPath, "utf8");
    expect(experimentSource).toContain('revision: "stable"');
    writeFileSync(experimentPath, experimentSource.replace('revision: "stable"', 'revision: "after-review"'), "utf8");

    const humanDry = await niceeval.run(["exp", "accept", "--dry"]);
    expect(humanDry.exitCode, humanDry.diagnostic()).toBe(0);
    expect(humanDry.stdout).toContain("gap 0:identity-mismatch");
    expect(humanDry.stdout).toContain(`source ${oldLocator} · prior · verdict passed`);
    expect(humanDry.stdout).toContain(`accept: niceeval accept ${oldLocator}`);

    const jsonDry = await niceeval.run(["exp", "accept", "--dry", "--json"]);
    expect(jsonDry.exitCode, jsonDry.diagnostic()).toBe(0);
    const plan = jsonDry.json<DryPlan>();
    expect(plan).toMatchObject({ total: 2, reused: 0 });
    const changedTarget = plan.matrix.find((row) => row.evalId === "accept/accept-target");
    expect(changedTarget).toBeDefined();
    expect(changedTarget!.slots.map((slot) => slot.state)).toEqual(["gap"]);
    expect(changedTarget!.readbacks).toHaveLength(1);
    expect(changedTarget!.readbacks[0]!.source.locator).toBe(oldLocator);
    expect(changedTarget!.readbacks[0]!.verdict).toMatchObject({ state: "available", value: "passed" });

    const runPreview = await niceeval.run(["accept", "--run", sourceRunId, "--dry"]);
    expect(runPreview.exitCode, runPreview.diagnostic()).toBe(0);
    expect(runPreview.stdout).toContain(`Accept source Run ${sourceRunId}`);
    expect(runPreview.stdout).toContain(oldLocator);
    expect(runPreview.stdout).toContain(secondaryLocator);
    expect(runPreview.stdout).toContain("2 members eligible");

    const beforeAccept = await niceeval.run(["show"]);
    expect(beforeAccept.exitCode, beforeAccept.diagnostic()).toBe(0);
    expect(beforeAccept.stdout).toContain("Observed   0/0");

    const accepted = await niceeval.run(["accept", "--run", sourceRunId]);
    expect(accepted.exitCode, accepted.diagnostic()).toBe(0);
    expect(accepted.stdout).toContain(`Accepted source Run ${sourceRunId} into new Run `);
    expect(accepted.stdout).toContain("2 reference members published");
    expect(accepted.stdout).toContain(oldLocator);
    expect(accepted.stdout).toContain(secondaryLocator);
    const acceptedRunMatch = accepted.stdout.match(
      /into new Run ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\./,
    );
    expect(acceptedRunMatch, accepted.diagnostic()).not.toBeNull();
    const acceptedRunId = acceptedRunMatch![1]!;

    const adoptedOverview = await niceeval.run(["show"]);
    expect(adoptedOverview.exitCode, adoptedOverview.diagnostic()).toBe(0);
    expect(adoptedOverview.stdout).toContain(oldLocator);
    expect(adoptedOverview.stdout).toContain(secondaryLocator);

    const snapshot = join(root, "accept.record-snapshot.sqlite");
    const exported = await niceeval.run(["record", "snapshot", "--output", snapshot]);
    expect(exported.exitCode, exported.diagnostic()).toBe(0);
    const acceptedRequest = await writeInspectionRequest(root, "accepted-run", {
      kind: "run.summary", runId: acceptedRunId,
    });
    const acceptedCurrent = await niceeval.run([
      "query", "run", "--record", snapshot, "--request", acceptedRequest,
    ]);
    expect(acceptedCurrent.exitCode, acceptedCurrent.diagnostic()).toBe(0);
    const acceptedDocument = acceptedCurrent.json<{
      readonly operation: string;
      readonly issues: readonly unknown[];
      readonly summary: {
        readonly runs: readonly { readonly runId: string }[];
        readonly members: readonly {
          readonly locator: string | null;
          readonly state: string;
          readonly verdict: string | null;
        }[];
      };
    }>();
    expect(acceptedDocument).toMatchObject({ operation: "run.summary", issues: [] });
    expect(acceptedDocument.summary.runs).toEqual([
      expect.objectContaining({ runId: acceptedRunId }),
    ]);
    expect(acceptedDocument.summary.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ locator: oldLocator, state: "accepted", verdict: "passed" }),
      expect.objectContaining({ locator: secondaryLocator, state: "accepted", verdict: "passed" }),
    ]));
    expect(acceptedDocument.summary.members).toHaveLength(2);

    const evidenceRequest = await writeInspectionRequest(root, "accepted-attempt-trace", {
      kind: "attempt.trace", locator: oldLocator,
    });
    const currentEvidence = await niceeval.run([
      "query", "run", "--record", snapshot, "--request", evidenceRequest,
    ]);
    expect(currentEvidence.exitCode, currentEvidence.diagnostic()).toBe(0);
    const evidenceDocument = currentEvidence.json<{ readonly operation: string; readonly issues: readonly unknown[]; readonly trace: unknown }>();
    expect(evidenceDocument).toMatchObject({ operation: "attempt.trace", issues: [] });
    expect(JSON.stringify(evidenceDocument.trace)).toContain("runner-fixture-ok");

    // An accepted action explains this Run's membership; it is deliberately
    // not a future eligibility grant for the immutable source Attempt.
    const nextDry = await niceeval.run(["exp", "accept", "--dry", "--json"]);
    expect(nextDry.exitCode, nextDry.diagnostic()).toBe(0);
    const nextPlan = nextDry.json<DryPlan>();
    expect(nextPlan).toMatchObject({ total: 2, reused: 0 });
    const nextTarget = nextPlan.matrix.find((row) => row.evalId === "accept/accept-target");
    expect(nextTarget).toBeDefined();
    expect(nextTarget!.slots.map((slot) => slot.state)).toEqual(["gap"]);
    expect(nextTarget!.readbacks[0]!.source.locator).toBe(oldLocator);

    const reviewedSource = readFileSync(experimentPath, "utf8");
    writeFileSync(
      experimentPath,
      reviewedSource
        .replace('evals: ["accept/"]', 'evals: ["accept/accept-target"]')
        .replace('revision: "after-review"', 'revision: "primary-only"'),
      "utf8",
    );

    const blockedBatch = await niceeval.run(["accept", "--run", sourceRunId, "--dry"]);
    expect(blockedBatch.exitCode, blockedBatch.diagnostic()).toBe(1);
    expect(blockedBatch.stderr).toContain("does not exactly close over the current Experiment membership");
    expect(blockedBatch.stderr).toContain("accept/accept-secondary/0 (target-eval-not-selected)");

    const afterBlockedBatch = await niceeval.run(["show"]);
    expect(afterBlockedBatch.exitCode, afterBlockedBatch.diagnostic()).toBe(0);
    expect(afterBlockedBatch.stdout).toContain("Observed   0/0");

    const acceptedSubset = await niceeval.run(["accept", oldLocator]);
    expect(acceptedSubset.exitCode, acceptedSubset.diagnostic()).toBe(0);
    const subsetOverview = await niceeval.run(["show"]);
    expect(subsetOverview.exitCode, subsetOverview.diagnostic()).toBe(0);
    expect(subsetOverview.stdout).toContain(oldLocator);
    expect(subsetOverview.stdout).not.toContain(secondaryLocator);
    },
  );
});
