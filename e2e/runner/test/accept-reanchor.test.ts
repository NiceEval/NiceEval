// Regression note: memory/accept-source-run-diverges-from-project-current-identity.md
// rerun: pnpm e2e test --repo runner -- --run test/accept-reanchor.test.ts

import { only } from "@niceeval/testkit";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";
// @feature docs/feature/experiments/README.md

test("审阅变更后 accept 以 reference Member 采用旧 Attempt，保留 verdict/evidence 与审计 provenance", async () => {
  await runnerE2E.case(
    "accept-reanchor",
    {
      artifacts: [
        { source: ".niceeval", target: ".niceeval", optional: true },
        { source: "identity-plan.json", target: "identity-plan.json", optional: true },
        { source: "human-output.txt", target: "human-output.txt", optional: true },
      ],
    },
    async ({ commands: { niceeval }, paths }) => {
      const root = paths.projectRoot;
      const initial = await niceeval.run(["exp", "accept", "--json"]);
      expect(initial.exitCode, initial.diagnostic()).toBe(0);
      const initialEvents = initial.expEvents();
      const initialStart = only(initialEvents, (event) => event.event === "start", initial.diagnostic());
      expect(initialStart).toMatchObject({ event: "start", total: 2, reused: 0 });
      const initialEval = only(
        initialEvents,
        (event) => event.event === "eval" && event.evalId === "accept/accept-target",
        initial.diagnostic(),
      );
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
      writeFileSync(
        evalPath,
        evalSource.replace('await t.send("accept")', 'await t.send("accept after review")'),
        "utf8",
      );

      const humanDry = await niceeval.run(["exp", "accept", "--dry"]);
      writeFileSync(join(root, "human-output.txt"), `exp --dry\n${humanDry.stdout}`, "utf8");
      expect(humanDry.exitCode, humanDry.diagnostic()).toBe(0);
      expect(humanDry.stdout).toContain("gap 0:identity-mismatch");
      expect(humanDry.stdout).toContain("source:evals/accept/accept-target.eval.ts");
      expect(humanDry.stdout).not.toMatch(/[{}]|"comparisons"|"explanation"/u);
      expect(humanDry.stdout).toContain(`source ${oldLocator} · prior · verdict passed`);
      expect(humanDry.stdout).not.toContain(`accept: niceeval accept ${oldLocator}`);

      const jsonDry = await niceeval.run(["exp", "accept", "--dry", "--json"]);
      expect(jsonDry.exitCode, jsonDry.diagnostic()).toBe(0);
      const plan = decodeExpPlanDocument(jsonDry.json());
      writeFileSync(join(root, "identity-plan.json"), jsonDry.stdout, "utf8");
      expect(plan).toMatchObject({ total: 2, reused: 1 });
      const changedTarget = plan.matrix.find((row) => row.evalId === "accept/accept-target");
      expect(changedTarget).toBeDefined();
      expect(changedTarget!.slots.map((slot) => slot.state)).toEqual(["gap"]);
      expect(changedTarget!.slots[0]!.comparisons).toContainEqual(
        expect.objectContaining({
          recordedClaim: "execution-identity",
          result: "mismatch",
          explanation: expect.objectContaining({
            kind: "changed",
            deltas: expect.arrayContaining([
              expect.objectContaining({ selector: "source:evals/accept/accept-target.eval.ts", kind: "changed" }),
            ]),
          }),
        }),
      );
      expect(changedTarget!.readbacks).toHaveLength(1);
      expect(changedTarget!.readbacks[0]!.source.locator).toBe(oldLocator);
      expect(changedTarget!.readbacks[0]!.verdict).toMatchObject({ state: "available", value: "passed" });

      const beforeRejected = await niceeval.run(["show", "runs", "--json"]);
      expect(beforeRejected.exitCode, beforeRejected.diagnostic()).toBe(0);
      const rejectedDry = await niceeval.run(["accept", oldLocator, "--dry"]);
      appendFileSync(join(root, "human-output.txt"), `\naccept --dry (rejected)\n${rejectedDry.stderr}`, "utf8");
      expect(rejectedDry.exitCode, rejectedDry.diagnostic()).not.toBe(0);
      expect(rejectedDry.stderr).toContain("error: could not accept result: accept-ineligible:");
      expect(rejectedDry.stderr).toContain("\n  source:evals/accept/accept-target.eval.ts");
      expect(rejectedDry.stderr).not.toMatch(/[{}]|"comparisons"|"explanation"/u);

      const project = await niceeval.run(["show", "--json"]);
      expect(project.exitCode, project.diagnostic()).toBe(0);
      const projectGap = project
        .inspectionSuccess("project.get")
        .project.plannedAttempts.find((slot) => slot.evalId === "accept/accept-target");
      expect(projectGap).toMatchObject({ state: "gap", reason: "identity-mismatch" });
      expect(projectGap!.explanation).toEqual(changedTarget!.slots[0]!.comparisons[0]!.explanation);
      expect(projectGap).not.toHaveProperty("comparisons");
      if (projectGap!.state === "gap") expect(JSON.stringify(projectGap!.issues)).not.toContain("comparisons");
      const rejected = await niceeval.run(["accept", oldLocator]);
      expect(rejected.exitCode, rejected.diagnostic()).not.toBe(0);
      expect(rejected.stderr).toContain("error: could not accept result: accept-ineligible:");
      expect(rejected.stderr).toContain("\n  source:evals/accept/accept-target.eval.ts");
      expect(rejected.stderr).not.toMatch(/[{}]|"comparisons"|"explanation"/u);
      const afterRejected = await niceeval.run(["show", "runs", "--json"]);
      expect(afterRejected.exitCode, afterRejected.diagnostic()).toBe(0);
      expect(afterRejected.runsList().runs).toEqual(beforeRejected.runsList().runs);
      // A changed task is not made equivalent by operator confirmation. Restore
      // the exact task before exercising explicit adoption and subsequent carry.
      writeFileSync(evalPath, evalSource, "utf8");

      // Timeout changes the combined identity without changing comparable manifest
      // inputs. Exercise the public unexplained diagnostic without editing records.
      const configPath = join(root, "niceeval.config.ts");
      const configSource = readFileSync(configPath, "utf8");
      expect(configSource).toContain("60_000");
      writeFileSync(configPath, configSource.replace("60_000", "61_000"), "utf8");
      const unexplained = await niceeval.run(["exp", "accept", "--dry"]);
      appendFileSync(join(root, "human-output.txt"), `\nexp --dry (unexplained)\n${unexplained.stdout}`, "utf8");
      expect(unexplained.exitCode, unexplained.diagnostic()).toBe(0);
      expect(unexplained.stdout).toContain("unversioned-identity-change: Execution identity changed");
      expect(unexplained.stdout).toContain("observed inputs: no differences in comparable manifest fields");
      expect(unexplained.stdout).toContain("limitation:");
      expect(unexplained.stdout).not.toMatch(/[{}]|"comparisons"|"explanation"/u);
      const unexplainedRejection = await niceeval.run(["accept", oldLocator]);
      appendFileSync(join(root, "human-output.txt"), `\naccept (unexplained)\n${unexplainedRejection.stderr}`, "utf8");
      expect(unexplainedRejection.exitCode, unexplainedRejection.diagnostic()).not.toBe(0);
      expect(unexplainedRejection.stderr).toContain("\n  unversioned-identity-change: Execution identity changed");
      expect(unexplainedRejection.stderr).not.toMatch(/[{}]|"comparisons"|"explanation"/u);
      writeFileSync(configPath, configSource, "utf8");

      const locatorPreview = await niceeval.run(["accept", oldLocator, "--dry"]);
      appendFileSync(join(root, "human-output.txt"), `\naccept --dry\n${locatorPreview.stdout}`, "utf8");
      expect(locatorPreview.exitCode, locatorPreview.diagnostic()).toBe(0);
      expect(locatorPreview.stdout).toContain(`  accept/accept-target #0 ${oldLocator} eligible`);
      expect(locatorPreview.stdout).not.toMatch(/[{}]|"members"|"comparisons"/u);
      const runPreview = await niceeval.run(["accept", "--run", initial.expReceipt().createdRunIds[0]!, "--dry"]);
      appendFileSync(join(root, "human-output.txt"), `\naccept --run --dry\n${runPreview.stdout}`, "utf8");
      expect(runPreview.exitCode, runPreview.diagnostic()).toBe(0);
      expect(runPreview.stdout).toContain(`  accept/accept-target #0 ${oldLocator} eligible`);
      expect(runPreview.stdout).toMatch(/accept\/accept-secondary #0 @1[0-9A-HJKMNP-TV-Z]{12} eligible/u);
      expect(runPreview.stdout).not.toMatch(/[{}]|"members"|"comparisons"/u);

      // Explicit acceptance must keep resolving the requested immutable origin
      // after unrelated Experiments have added their own published Attempts.
      writeFileSync(
        join(root, "experiments/locator-background.ts"),
        `
import { defineAdapter, defineExperiment } from "niceeval";
export const adapter = defineAdapter({ name: "locator-background", create: () => ({ read: () => "background" }) });
export default defineExperiment({ adapter, evals: ["locator-background"] });
`,
        "utf8",
      );
      writeFileSync(
        join(root, "evals/locator-background.eval.ts"),
        `
import { equals } from "niceeval/expect";
import { adapter } from "../experiments/locator-background.ts";
export default adapter.defineEval({ async test(t) { t.check(await t.read(), equals("background")); } });
`,
        "utf8",
      );
      mkdirSync(join(root, "experiments/locator-background-runs"), { recursive: true });
      for (let index = 0; index < 32; index += 1) {
        writeFileSync(
          join(root, `experiments/locator-background-runs/run-${index}.ts`),
          `
import { defineExperiment } from "niceeval";
import { adapter } from "../locator-background.ts";
export default defineExperiment({ adapter, evals: ["locator-background"] });
`,
          "utf8",
        );
      }
      const background = await niceeval.run(["exp", "locator-background-runs", "--json"], { timeoutMs: 180_000 });
      expect(background.exitCode, background.diagnostic()).toBe(0);
      expect(background.expReceipt().createdRunIds, background.diagnostic()).toHaveLength(32);

      const accepted = await niceeval.run(["accept", oldLocator]);
      expect(accepted.exitCode, accepted.diagnostic()).toBe(0);
      expect(accepted.stdout).toContain(`Accepted source Attempt ${oldLocator} into new Run `);
      const acceptedRunMatch = accepted.stdout.match(
        /into new Run ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\. Result locator remains (@1[0-9A-HJKMNP-TV-Z]{12})\./,
      );
      expect(acceptedRunMatch, accepted.diagnostic()).not.toBeNull();
      const acceptedRunId = acceptedRunMatch![1]!;
      expect(accepted.stdout).toContain(`niceeval show run:${acceptedRunId}`);
      const newLocator = acceptedRunMatch![2]!;
      // Explicit adoption writes a reference Member, so its result locator keeps
      // the immutable source Attempt identity instead of manufacturing an Attempt.
      expect(newLocator).toBe(oldLocator);

      const acceptedCurrent = await niceeval.run(["show", `run:${acceptedRunId}`, "--json"]);
      expect(acceptedCurrent.exitCode, acceptedCurrent.diagnostic()).toBe(0);
      const acceptedDocument = acceptedCurrent.run();
      expect(acceptedDocument).toMatchObject({ operation: "run.get", issues: [] });
      expect(acceptedDocument.run.value).toMatchObject({ runId: acceptedRunId });
      expect(acceptedDocument.run.denominator).toEqual({ expected: 1, published: 1, missing: 0 });
      expect(acceptedDocument.run.plannedAttempts).toEqual([
        expect.objectContaining({
          evalId: "accept/accept-target",
          publication: expect.objectContaining({ state: "published", attemptLocator: oldLocator }),
          state: "accepted",
          verdict: "passed",
        }),
      ]);

      const currentEvidence = await niceeval.run(["show", newLocator, "execution", "--json"]);
      expect(currentEvidence.exitCode, currentEvidence.diagnostic()).toBe(0);
      const evidenceDocument = currentEvidence.attemptTrace();
      expect(evidenceDocument).toMatchObject({ operation: "attempt.trace", issues: [] });
      expect(JSON.stringify(evidenceDocument.trace)).toContain("runner-fixture-ok");

      const acceptedRun = await niceeval.run(["accept", "--run", initial.expReceipt().createdRunIds[0]!]);
      expect(acceptedRun.exitCode, acceptedRun.diagnostic()).toBe(0);
      const acceptedWholeRunId = /into new Run ([0-9a-f-]{36})\./u.exec(acceptedRun.stdout)?.[1];
      expect(acceptedWholeRunId, acceptedRun.diagnostic()).toBeTruthy();
      expect(acceptedRun.stdout).toContain(`show: niceeval show run:${acceptedWholeRunId}`);
      expect(acceptedRun.stdout.match(/show: niceeval show run:<id>/gu)).toHaveLength(1);

      // The same target still qualifies after adoption; the immutable origin is
      // revalidated instead of turning the accepted action into a blanket grant.
      const nextDry = await niceeval.run(["exp", "accept", "--dry", "--json"]);
      expect(nextDry.exitCode, nextDry.diagnostic()).toBe(0);
      const nextPlan = decodeExpPlanDocument(nextDry.json());
      expect(nextPlan).toMatchObject({ total: 2, reused: 2 });
      const nextTarget = nextPlan.matrix.find((row) => row.evalId === "accept/accept-target");
      expect(nextTarget).toBeDefined();
      expect(nextTarget!.slots.map((slot) => slot.state)).toEqual(["reused"]);
      expect(nextTarget!.readbacks[0]!.source.locator).toBe(newLocator);
      const nextSecondary = nextPlan.matrix.find((row) => row.evalId === "accept/accept-secondary");
      expect(nextSecondary).toBeDefined();
      expect(nextSecondary!.slots.map((slot) => slot.state)).toEqual(["reused"]);
      const availableProject = await niceeval.run(["show", "--json"]);
      expect(availableProject.exitCode, availableProject.diagnostic()).toBe(0);
      const availableTarget = availableProject
        .inspectionSuccess("project.get")
        .project.plannedAttempts.find((slot) => slot.evalId === "accept/accept-target");
      expect(availableTarget).toMatchObject({ state: "reuse" });
      expect(availableTarget).not.toHaveProperty("explanation");
    },
  );
});
