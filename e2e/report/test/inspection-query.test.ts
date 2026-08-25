// owner: docs/engineering/testing/e2e/report.md#inspection-query
// regression: memory/analysis-usage-projection-conflates-conversation-limitations.md
// rerun: pnpm e2e test --repo report -- --run test/inspection-query.test.ts

import { only } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

const OPERATION_CATALOG = [
  "runs.list",
  "run.get",
  "run.summary",
  "attempt.get",
  "attempt.trace",
  "attempt.diff",
  "attempt.sources",
  "attempt.artifacts",
  "runs.compare",
] as const;

interface QueryDiscoveryDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operations: readonly {
    readonly id: string;
    readonly behaviorVersion: string;
  }[];
}

interface RunSummaryDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: "run.summary";
  readonly behaviorVersion: string;
  readonly sealedCutoff: unknown;
  readonly selection: unknown;
  readonly issues: readonly unknown[];
  readonly evidence: unknown;
  readonly summary: unknown;
}

interface QueryExplanationDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: "run.summary";
  readonly behaviorVersion: string;
  readonly sealedCutoff: unknown;
  readonly selection: unknown;
  readonly factKinds: readonly string[];
}

test("machine consumer 发现固定 catalog，再从显式 Record snapshot explain 并读取闭合 Run summary", async () => {
  await reportE2E.case(
    "inspection-query",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const runId = only(run.expReceipt().runIds, () => true, run.diagnostic());
      const attempt = only(
        run.expEvalEvents(),
        (event) => event.evalId === "inspection",
        run.diagnostic(),
      );
      expect(attempt).toMatchObject({ verdict: "passed" });

      const discovery = await niceeval.run(["query", "discover"]);
      expect(discovery.exitCode, discovery.diagnostic()).toBe(0);
      const discoveryDocument = discovery.json<QueryDiscoveryDocument>();
      expect(discoveryDocument.protocol).toBe("niceeval.query/v1");
      expect(discoveryDocument.operations.map(({ id }) => id).toSorted()).toEqual(
        [...OPERATION_CATALOG].sort(),
      );
      for (const operation of discoveryDocument.operations) {
        expect(operation.behaviorVersion, operation.id).not.toBe("");
      }

      const snapshotPath = join(projectRoot, "query.record-snapshot.sqlite");
      const exported = await niceeval.run(["record", "snapshot", "--output", snapshotPath]);
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

      const requestPath = join(projectRoot, "run-summary.request.json");
      await writeFile(
        requestPath,
        `${JSON.stringify({
          protocol: "niceeval.query/v1",
          operation: { kind: "run.summary", runId },
        })}\n`,
        "utf8",
      );
      const explained = await niceeval.run([
        "query",
        "explain",
        "--record",
        snapshotPath,
        "--request",
        requestPath,
      ]);
      expect(explained.exitCode, explained.diagnostic()).toBe(0);
      const explanation = explained.json<QueryExplanationDocument>();
      expect(explanation).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "run.summary",
        behaviorVersion: expect.any(String),
        sealedCutoff: expect.anything(),
        selection: expect.anything(),
        factKinds: expect.any(Array),
      });
      expect(explanation.behaviorVersion).not.toBe("");

      const queried = await niceeval.run([
        "query",
        "run",
        "--record",
        snapshotPath,
        "--request",
        requestPath,
      ]);
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      const document = queried.json<RunSummaryDocument>();
      expect(document).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "run.summary",
        behaviorVersion: expect.any(String),
        sealedCutoff: expect.anything(),
        selection: expect.anything(),
        issues: expect.any(Array),
        evidence: expect.anything(),
        summary: expect.anything(),
      });
      expect(document.behaviorVersion).not.toBe("");
      const publicSummary = JSON.stringify(document.summary);
      expect(publicSummary).toContain(runId);
      expect(publicSummary).toContain(attempt.locator);
      expect(publicSummary).toContain("passed");
      expect(publicSummary).toContain('"inputTokens":10');
      expect(publicSummary).toContain('"outputTokens":5');
      expect(queried.stdout).not.toContain(projectRoot);
      expect(queried.stdout).not.toContain(".niceeval/");
    },
  );
});
