// owner: docs/engineering/testing/e2e/report.md#inspection-query
// regression: memory/analysis-usage-projection-conflates-conversation-limitations.md
// rerun: pnpm e2e test --repo report -- --run test/inspection-query.test.ts

import { only } from "@niceeval/testkit";
import { access, writeFile } from "node:fs/promises";
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

interface QueryFailureDocument {
  readonly protocol: "niceeval.query/v1";
  readonly outcome: "failure";
  readonly operation: string | null;
  readonly behaviorVersion: string | null;
  readonly failure: {
    readonly code: string;
    readonly reason: string;
    readonly correction: string;
  };
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
      const locator = attempt.locator.startsWith("@") ? attempt.locator : `@${attempt.locator}`;

      const discovery = await niceeval.run(["query", "discover"]);
      expect(discovery.exitCode, discovery.diagnostic()).toBe(0);
      const discoveryDocument = discovery.json<QueryDiscoveryDocument>();
      expect(discovery.stdout).toBe(`${JSON.stringify(discoveryDocument)}\n`);
      expect(discoveryDocument.protocol).toBe("niceeval.query/v1");
      expect(discoveryDocument.operations.map(({ id }) => id).toSorted()).toEqual(
        [...OPERATION_CATALOG].sort(),
      );
      expect(new Set(discoveryDocument.operations.map(({ behaviorVersion }) => behaviorVersion))).toEqual(
        new Set(["1"]),
      );

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
      expect(explained.stdout).toBe(`${JSON.stringify(explanation)}\n`);
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
      expect(queried.stdout).toBe(`${JSON.stringify(document)}\n`);
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
      expect(publicSummary).toContain(locator);
      expect(publicSummary).toContain("passed");
      expect(publicSummary).toContain('"inputTokens":10');
      expect(publicSummary).toContain('"outputTokens":5');
      expect(publicSummary).toContain("fixture conversation history is intentionally partial");
      expect(queried.stdout).not.toContain(projectRoot);
      expect(queried.stdout).not.toContain(".niceeval/");

      const operationRequestPath = join(projectRoot, "fixed-operation.request.json");
      const operations = [
        { kind: "runs.list" },
        { kind: "run.get", runId },
        { kind: "run.summary", runId },
        { kind: "attempt.get", locator },
        { kind: "attempt.trace", locator },
        { kind: "attempt.diff", locator },
        { kind: "attempt.sources", locator },
        { kind: "attempt.artifacts", locator },
        { kind: "runs.compare", mode: "paired", leftRunIds: [runId], rightRunIds: [runId] },
      ] as const;
      for (const operation of operations) {
        await writeFile(operationRequestPath, `${JSON.stringify({
          protocol: "niceeval.query/v1",
          operation,
        })}\n`, "utf8");
        const result = await niceeval.run([
          "query",
          "run",
          "--record",
          snapshotPath,
          "--request",
          operationRequestPath,
        ]);
        expect(result.exitCode, result.diagnostic()).toBe(0);
        const operationDocument = result.json<{ readonly protocol: string; readonly operation: string }>();
        expect(result.stdout).toBe(`${JSON.stringify(operationDocument)}\n`);
        expect(operationDocument).toMatchObject({
          protocol: "niceeval.query/v1",
          operation: operation.kind,
        });
      }

      await writeFile(operationRequestPath, `${JSON.stringify({
        protocol: "niceeval.query/v1",
        operation: { kind: "run.get", runId: "missing-run" },
      })}\n`, "utf8");
      const missing = await niceeval.run([
        "query",
        "run",
        "--record",
        snapshotPath,
        "--request",
        operationRequestPath,
      ]);
      expect(missing.exitCode, missing.diagnostic()).toBe(2);
      const missingDocument = missing.json<QueryFailureDocument>();
      expect(missing.stdout).toBe(`${JSON.stringify(missingDocument)}\n`);
      expect(missingDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        outcome: "failure",
        operation: "run.get",
        behaviorVersion: expect.any(String),
        failure: {
          code: "inspection-selection-missing",
          correction: "choose-existing-selection",
        },
      });
      expect(missing.stderr).toBe("niceeval query failed: inspection-selection-missing\n");

      await writeFile(operationRequestPath, '{"protocol":"niceeval.query/v0"}\n', "utf8");
      const invalid = await niceeval.run([
        "query",
        "run",
        "--record",
        snapshotPath,
        "--request",
        operationRequestPath,
      ]);
      expect(invalid.exitCode, invalid.diagnostic()).toBe(2);
      const invalidDocument = invalid.json<QueryFailureDocument>();
      expect(invalid.stdout).toBe(`${JSON.stringify(invalidDocument)}\n`);
      expect(invalidDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        outcome: "failure",
        operation: null,
        behaviorVersion: null,
        failure: {
          code: "inspection-request-invalid",
          correction: "fix-request",
        },
      });
      expect(invalid.stderr).toBe("niceeval query failed: inspection-request-invalid\n");

      for (const retiredCommand of ["show", "insight"] as const) {
        const retired = await niceeval.run([retiredCommand]);
        expect(retired.exitCode, retired.diagnostic()).toBe(1);
        expect(retired.stdout).toBe("");
        expect(retired.stderr).toBe(
          `Unknown command "${retiredCommand}".\nRun \`niceeval --help\` for usage.\n`,
        );
      }

      const retiredStaticPath = join(projectRoot, "retired-static-view");
      const staticView = await niceeval.run(["view", "--out", retiredStaticPath]);
      expect(staticView.exitCode, staticView.diagnostic()).toBe(1);
      expect(staticView.stdout).toBe("");
      expect(staticView.stderr).toContain("Unknown option '--out'");
      expect(staticView.stderr).toContain("Run `niceeval --help` for usage.\n");
      await expect(access(retiredStaticPath)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});
