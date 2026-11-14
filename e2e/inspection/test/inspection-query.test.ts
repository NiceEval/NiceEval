// rerun: pnpm e2e test --candidate built --repo inspection -- --run test/inspection-query.test.ts
import { only } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @regression memory/inspection-query-missing-overview-and-trace-detail.md
// @regression memory/inspection-source-detail-reuses-assertion-string-limit.md
test.concurrent("machine consumer follows show links from current results to a failed assertion, command output, and file diff", async () => {
  await inspectionE2E.case(
    "inspection-addressing",
    { artifacts: inspectionCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const evalPath = join(projectRoot, "evals/inspection.eval.ts");
      await writeFile(evalPath, (await readFile(evalPath, "utf8")).replace(".score(5)", ".score(5).gate()"));
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      const runId = only(run.expReceipt().createdRunIds, () => true);
      const event = only(run.expEvalEvents(), (entry) => entry.evalId === "inspection");
      expect(event.verdict, run.diagnostic()).toBe("failed");
      const locator = event.locator;
      const current = await niceeval.run(["show", "--json"]);
      expect(current.exitCode, current.diagnostic()).toBe(0);
      const project = current.inspectionSuccess("project.get");
      expect(project).not.toHaveProperty("protocol");
      expect(project).not.toHaveProperty("behaviorVersion");
      const attemptLink = only(
        project.links,
        (link) => link.rel === "attempt" && link.command === `niceeval show ${locator}`,
      );
      const attempt = await niceeval.run([...attemptLink.command.slice("niceeval ".length).split(" "), "--json"]);
      expect(attempt.exitCode, attempt.diagnostic()).toBe(0);
      const outline = attempt.inspectionSuccess("attempt.get");
      expect(outline.attempt.verdict).toBe("failed");
      const failedEntry = only(
        outline.attempt.assertions.entries,
        (entry) => entry.display.label === "Mismatched Boolean contributes zero",
      );
      const assertionLink = only(
        outline.links,
        (link) => link.rel === "assertion" && link.command.includes(failedEntry.entryId),
      );
      const assertion = await niceeval.run([...assertionLink.command.slice("niceeval ".length).split(" "), "--json"]);
      expect(assertion.exitCode, assertion.diagnostic()).toBe(0);
      expect(JSON.stringify(assertion.inspectionSuccess("attempt.assertion.detail").assertion)).toContain(
        "Mismatched Boolean contributes zero",
      );
      const explicitAssertion = await niceeval.run([
        "show",
        locator,
        "assertions",
        failedEntry.entryId,
        "--full",
        "--json",
      ]);
      expect(explicitAssertion.stdout).toBe(assertion.stdout);
      const executionLink = only(outline.links, (link) => link.rel === "execution");
      const execution = await niceeval.run([...executionLink.command.slice("niceeval ".length).split(" "), "--json"]);
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      const trace = execution.inspectionSuccess("attempt.trace");
      const commandLinks = trace.links.filter(
        (link) => link.rel === "execution-item" && link.command.includes("command_"),
      );
      expect(commandLinks.length, execution.diagnostic()).toBeGreaterThan(0);
      const commands = [];
      for (const link of commandLinks) {
        const command = await niceeval.run([...link.command.slice("niceeval ".length).split(" "), "--json"]);
        expect(command.exitCode, command.diagnostic()).toBe(0);
        commands.push(command.inspectionSuccess("attempt.trace.detail").detail);
      }
      expect(JSON.stringify(commands)).toContain("inspection-command-output");
      const diffLink = only(outline.links, (link) => link.rel === "diff");
      const diff = await niceeval.run([...diffLink.command.slice("niceeval ".length).split(" "), "--json"]);
      expect(diff.exitCode, diff.diagnostic()).toBe(0);
      const fileLink = diff.inspectionSuccess("attempt.diff").links.find((link) => link.rel === "file-change");
      expect(fileLink, diff.diagnostic()).toBeDefined();
      const file = await niceeval.run([...fileLink!.command.slice("niceeval ".length).split(" "), "--json"]);
      expect(file.exitCode, file.diagnostic()).toBe(0);
      expect(JSON.stringify(file.inspectionSuccess("attempt.diff").diff)).toContain("inspection diff evidence");
      for (const [args, operation] of [
        [["--record", ".niceeval/record.sqlite"], "overview.get"],
        [[`run:${runId}`], "run.get"],
        [["runs"], "run.list"],
        [["exp:main"], "experiment.get"],
        [["exp:main", "assertions"], "experiments.assertions"],
        [[locator, "source"], "attempt.sources"],
        [[locator, "timing"], "attempt.timing"],
        [[locator, "usage"], "attempt.usage"],
        [[locator, "artifacts"], "attempt.artifacts"],
      ] as const) {
        const read = await niceeval.run(["show", ...args, "--json"]);
        expect(read.exitCode, read.diagnostic()).toBe(0);
        expect(read.inspectionSuccess(operation).operation).toBe(operation);
      }
      const toolEntry = only(
        outline.attempt.assertions.entries,
        (entry) => entry.display.label === "Inspection tool occurrence",
      );
      const toolDetail = await niceeval.run(["show", locator, toolEntry.entryId, "--full", "--json"]);
      expect(toolDetail.exitCode, toolDetail.diagnostic()).toBe(0);
      expect(JSON.stringify(toolDetail.inspectionSuccess("attempt.assertion.detail"))).toContain("input-tail");
      expect(JSON.stringify(toolDetail.inspectionSuccess("attempt.assertion.detail"))).toContain("output-tail");
      const human = await niceeval.run(["show", locator]);
      expect(human.exitCode, human.diagnostic()).toBe(0);
      for (const link of outline.links) expect(human.stdout).toContain(link.command);
      expect(human.stdout).toContain(`Open: niceeval view ${locator}`);
      const explained = await niceeval.run(["show", `run:${runId}`, "--explain", "--json"]);
      expect(explained.exitCode, explained.diagnostic()).toBe(0);
      expect(explained.inspectionExplanation("run.get").outcome).toBe("explanation");
      const compare = await niceeval.run(["compare", runId, "--", runId, "--json"]);
      expect(compare.exitCode, compare.diagnostic()).toBe(0);
      expect(compare.inspectionSuccess("runs.compare").comparison.exactMemberSet).toBe(true);
      for (const args of [
        [locator, "source", failedEntry.entryId],
        [locator, "unknown_id"],
        [locator, "usage", "--actor", "actor"],
        [locator, "--full"],
      ]) {
        const rejected = await niceeval.run(["show", ...args]);
        expect(rejected.exitCode, rejected.diagnostic()).not.toBe(0);
        expect(rejected.stderr).not.toBe("");
      }
      const unknown = await niceeval.run(["query"]);
      expect(unknown.exitCode, unknown.diagnostic()).not.toBe(0);
    },
  );
});
