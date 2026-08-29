// owner: docs/engineering/testing/e2e/inspection.md#inspection-query
// regression: memory/analysis-usage-projection-conflates-conversation-limitations.md
// regression: memory/inspection-query-missing-overview-and-trace-detail.md
// rerun: pnpm e2e test --repo inspection -- --run test/inspection-query.test.ts

import { only } from "@niceeval/testkit";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

const OPERATION_CATALOG = [
  "overview.get",
  "experiment.get",
  "runs.list",
  "run.get",
  "run.summary",
  "run.overview",
  "attempt.get",
  "attempt.assertion.detail",
  "attempt.trace",
  "attempt.trace.detail",
  "attempt.timing",
  "attempt.usage",
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
  readonly operation: "run.get";
  readonly behaviorVersion: string;
  readonly source: {
    readonly kind: "operational";
    readonly sealedCutoffIdentity: string;
  };
  readonly sealedCutoff: unknown;
  readonly selection: unknown;
  readonly issues: readonly unknown[];
  readonly evidence: unknown;
  readonly run: unknown;
}

interface RunOverviewDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: "attempt.usage";
  readonly behaviorVersion: string;
  readonly source: {
    readonly kind: "operational";
    readonly sealedCutoffIdentity: string;
  };
  readonly sealedCutoff: unknown;
  readonly selection: unknown;
  readonly issues: readonly unknown[];
  readonly evidence: unknown;
  readonly usage: {
    readonly limitations: readonly unknown[];
    readonly totals: {
      readonly inputTokens: { readonly state: string; readonly value: number | null };
      readonly outputTokens: { readonly state: string; readonly value: number | null };
    };
  };
}

interface QueryExplanationDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: "run.get";
  readonly behaviorVersion: string;
  readonly source: {
    readonly kind: "operational";
    readonly sealedCutoffIdentity: string;
  };
  readonly sealedCutoff: unknown;
  readonly selection: unknown;
  readonly factKinds: readonly string[];
}

interface OverviewDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: "overview.get";
  readonly behaviorVersion: "2";
  readonly source: {
    readonly kind: "operational";
    readonly sealedCutoffIdentity: string;
  };
  readonly overview: {
    readonly format: "niceeval.inspection.overview/v1";
    readonly experiments: readonly {
      readonly experimentId: string;
      readonly score: {
        readonly state: string;
        readonly value: number | null;
        readonly samples: number;
        readonly total: number;
        readonly basis: string;
        readonly issues: readonly unknown[];
        readonly refs: readonly { readonly identity: { readonly kind: "attempt"; readonly locator: string } }[];
        readonly unit?: string;
        readonly bounds?: { readonly min?: number; readonly max?: number };
      };
    }[];
    readonly cells: readonly {
      readonly experimentId: string;
      readonly evalId: string;
      readonly denominator: {
        readonly expected: number;
        readonly observed: number;
        readonly classified: number;
        readonly missing: number;
      };
      readonly evaluationKind: "pass" | "points" | "mixed";
      readonly verdict: {
        readonly tally: {
          readonly passed: number;
          readonly failed: number;
          readonly errored: number;
          readonly skipped: number;
        };
        readonly passRate: {
          readonly state: string;
          readonly value: number;
          readonly samples: number;
          readonly total: number;
          readonly basis: string;
          readonly issues: readonly unknown[];
          readonly refs: readonly { readonly identity: { readonly kind: "attempt"; readonly locator: string } }[];
        };
      };
      readonly score: {
        readonly state: string;
        readonly value: number | null;
        readonly samples: number;
        readonly total: number;
        readonly basis: string;
        readonly issues: readonly unknown[];
        readonly refs: readonly { readonly identity: { readonly kind: "attempt"; readonly locator: string } }[];
        readonly unit?: string;
        readonly bounds?: { readonly min?: number; readonly max?: number };
      };
      readonly costUSD: {
        readonly state: string;
        readonly value: number | null;
        readonly source: "observed" | "estimated" | null;
        readonly samples: number;
        readonly total: number;
        readonly basis: string;
        readonly issues: readonly unknown[];
        readonly refs: readonly { readonly identity: { readonly kind: "attempt"; readonly locator: string } }[];
      };
      readonly coverage: readonly unknown[];
      readonly issues: readonly unknown[];
      readonly members: readonly {
        readonly runId: string;
        readonly action: string;
        readonly relation: string | null;
        readonly locator: string;
        readonly score: {
          readonly state: string;
          readonly value: number | null;
          readonly samples: number;
          readonly total: number;
          readonly basis: string;
          readonly issues: readonly unknown[];
          readonly refs: readonly { readonly identity: { readonly kind: "attempt"; readonly locator: string } }[];
          readonly unit?: string;
          readonly bounds?: { readonly min?: number; readonly max?: number };
        };
      }[];
    }[];
  };
}

interface AttemptGetDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: "attempt.get";
  readonly behaviorVersion: "1";
  readonly attempt: {
    readonly assertions: {
      readonly state: string;
      readonly entries: readonly {
        readonly entryId: string;
        readonly display: { readonly label?: string; readonly key?: string };
      }[];
    };
  };
}

interface AttemptAssertionDetailDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: "attempt.assertion.detail";
  readonly behaviorVersion: "1";
  readonly assertion: {
    readonly format: "niceeval.inspection.assertion-detail/v1";
    readonly entryId: string;
    readonly display: { readonly label?: string; readonly key?: string };
    readonly sourceSites: readonly unknown[];
    readonly check: {
      readonly label: string;
      readonly state: string;
      readonly expected: unknown | null;
      readonly observed: unknown | null;
      readonly reason: string | null;
      readonly anchor: unknown | null;
      readonly children: readonly unknown[];
    };
    readonly matcher: {
      readonly state: string;
      readonly sourceState: string;
      readonly comparator: unknown;
      readonly sourceLedger: unknown;
      readonly debugger: {
        readonly state: "current" | "legacy";
        readonly subject: "tool" | "event" | "source-row";
        readonly query: unknown;
        readonly receipt?: unknown;
        readonly source: {
          readonly final: {
            readonly state: string;
            readonly rows: readonly MatcherDebuggerRow[];
            readonly limitations: readonly unknown[];
          };
          readonly atEvaluation: {
            readonly state: string;
            readonly rows: readonly MatcherDebuggerRow[];
            readonly limitations: readonly unknown[];
          };
        };
        readonly identityRelation: { readonly state: string; readonly reason?: string };
        readonly overlayRetention: string;
        readonly steps: readonly unknown[];
      } | null;
      readonly targets: readonly {
        readonly state: string;
        readonly anchor: {
          readonly kind: string;
          readonly toolOccurrenceId?: string;
          readonly eventId?: string;
        };
      }[];
      readonly sandboxCommandJoin: { readonly state: string; readonly reason?: string };
    };
  };
}

interface MatcherDebuggerRow {
  readonly kind: "tool" | "event" | "legacy-source-row";
  readonly rowId: string;
  readonly number: string;
  readonly phase: "at-evaluation" | "outside-evaluation-snapshot" | "historical";
  readonly summary: string;
  readonly detail: unknown;
  readonly locator?: {
    readonly kind: "tool-occurrence" | "event";
    readonly toolOccurrenceId?: string;
    readonly eventId?: string;
  };
  readonly evaluation: { readonly result: string; readonly difference?: unknown };
  readonly conversationTarget: {
    readonly state: "exact" | "unavailable";
    readonly turnId?: string;
    readonly eventId?: string;
    readonly anchor?: string;
    readonly reason?: string;
  };
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

interface AttemptTraceDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: "attempt.trace";
  readonly behaviorVersion: "1";
  readonly trace: {
    readonly format: "niceeval.inspection.trace/v1";
    readonly conversation: {
      readonly items: readonly {
        readonly itemId: string;
        readonly kind: string;
        readonly tool?: string;
        readonly input?: string;
        readonly output?: string;
        readonly outcome?: string;
        readonly toolOccurrenceId?: string;
      }[];
    };
  };
}

interface AttemptTraceDetailDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: "attempt.trace.detail";
  readonly behaviorVersion: "1";
  readonly detail: {
    readonly format: "niceeval.inspection.trace-detail/v1";
    readonly kind: "tool-occurrence";
    readonly toolOccurrenceId: string;
    readonly call: {
      readonly itemId: string;
      readonly kind: "tool-call";
      readonly tool: string;
      readonly input: string;
    };
    readonly result: {
      readonly itemId: string;
      readonly kind: "tool-result";
      readonly outcome: string;
      readonly output: string;
    };
  };
}

interface AttemptSourcesDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: "attempt.sources";
  readonly behaviorVersion: "1";
  readonly sources: {
    readonly format: "niceeval.inspection.sources/v1";
    readonly state: string;
    readonly items: readonly {
      readonly sourceItemId: string;
      readonly path: string;
      readonly sha256: string;
      readonly content: { readonly state: string; readonly text?: string };
    }[];
    readonly assertions: {
      readonly state: string;
      readonly sourceSites?: readonly {
        readonly entryId: string;
        readonly sourceOrder: number;
        readonly role: string;
        readonly source: {
          readonly state: string;
          readonly sourceItemId?: string;
          readonly sha256?: string;
        };
      }[];
    };
  };
}

test("machine consumer 发现固定 catalog，再从 project Run 读取 origin Attempt 的闭合事实", async () => {
  await inspectionE2E.case(
    "inspection-query",
    { artifacts: inspectionCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const runId = only(run.expReceipt().createdRunIds, () => true, run.diagnostic());
      const attempt = only(
        run.expEvalEvents(),
        (event) => event.evalId === "inspection",
        run.diagnostic(),
      );
      expect(attempt).toMatchObject({ verdict: "passed" });
      const locator = attempt.locator.startsWith("@") ? attempt.locator : `@${attempt.locator}`;

      const carried = await niceeval.run(["exp", "main", "--json"]);
      expect(carried.exitCode, carried.diagnostic()).toBe(0);
      expect(carried.expReceipt(), carried.diagnostic()).toMatchObject({ completion: "completed" });
      const carriedRunId = only(carried.expReceipt().createdRunIds, () => true, carried.diagnostic());
      const carriedStart = only(
        carried.ndjson<{ readonly event?: string; readonly total?: number; readonly reused?: number }>(),
        (event) => event.event === "start",
        carried.diagnostic(),
      );
      expect(carriedRunId).not.toBe(runId);
      expect(carriedStart).toMatchObject({ event: "start", total: 1, reused: 1 });

      const alternate = await niceeval.run(["exp", "alternate", "--rerun", "all", "--json"]);
      expect(alternate.exitCode, alternate.diagnostic()).toBe(0);
      expect(alternate.expReceipt(), alternate.diagnostic()).toMatchObject({ completion: "completed" });
      const alternateRunId = only(alternate.expReceipt().createdRunIds, () => true, alternate.diagnostic());
      const alternateAttempt = only(
        alternate.expEvalEvents(),
        (event) => event.evalId === "inspection",
        alternate.diagnostic(),
      );
      expect(alternateAttempt).toMatchObject({ verdict: "passed" });
      const alternateLocator = alternateAttempt.locator.startsWith("@")
        ? alternateAttempt.locator
        : `@${alternateAttempt.locator}`;

      const multi = await niceeval.run(["exp", "inspection-multi", "--rerun", "all", "--json"]);
      expect(multi.exitCode, multi.diagnostic()).toBe(0);
      expect(multi.expReceipt(), multi.diagnostic()).toMatchObject({ completion: "completed" });
      const multiRunId = only(multi.expReceipt().createdRunIds, () => true, multi.diagnostic());
      expect(only(
        multi.expEvalEvents(),
        (event) => event.evalId === "inspection",
        multi.diagnostic(),
      )).toMatchObject({ verdict: "passed", attempts: 2, passed: 2 });
      expect(only(
        multi.expEvalEvents(),
        (event) => event.evalId === "overview-secondary",
        multi.diagnostic(),
      )).toMatchObject({ verdict: "passed", attempts: 2, passed: 2 });

      const discovery = await niceeval.run(["query", "discover"]);
      expect(discovery.exitCode, discovery.diagnostic()).toBe(0);
      const discoveryDocument = discovery.json<QueryDiscoveryDocument>();
      expect(discovery.stdout).toBe(`${JSON.stringify(discoveryDocument)}\n`);
      expect(discoveryDocument.protocol).toBe("niceeval.query/v1");
      expect(discoveryDocument.operations.map(({ id }) => id).toSorted()).toEqual(
        [...OPERATION_CATALOG].sort(),
      );
      expect(new Set(discoveryDocument.operations.map(({ behaviorVersion }) => behaviorVersion))).toEqual(
        new Set(["1", "2"]),
      );

      const sourceBoundDiscovery = await niceeval.run([
        "query",
        "discover",
        "--record",
        "removed-record-snapshot.sqlite",
      ]);
      expect(sourceBoundDiscovery.exitCode, sourceBoundDiscovery.diagnostic()).toBe(2);
      expect(sourceBoundDiscovery.json<QueryFailureDocument>()).toMatchObject({
        protocol: "niceeval.query/v1",
        outcome: "failure",
        operation: null,
        failure: {
          code: "inspection-request-invalid",
          correction: "fix-request",
        },
      });

      const overviewRequestPath = join(projectRoot, "overview.request.json");
      await writeFile(
        overviewRequestPath,
        `${JSON.stringify({
          protocol: "niceeval.query/v1",
          operation: { kind: "overview.get" },
        })}\n`,
        "utf8",
      );
      const overview = await niceeval.run([
        "query",
        "run",
        "--request",
        overviewRequestPath,
      ]);
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      const overviewDocument = overview.json<OverviewDocument>();
      expect(overview.stdout).toBe(`${JSON.stringify(overviewDocument)}\n`);
      expect(overviewDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "overview.get",
        behaviorVersion: "2",
        source: {
          kind: "operational",
          sealedCutoffIdentity: expect.any(String),
        },
        overview: { format: "niceeval.inspection.overview/v1" },
      });
      const mainCell = only(
        overviewDocument.overview.cells,
        (cell) => cell.experimentId === "main" && cell.evalId === "inspection",
        overview.diagnostic(),
      );
      expect(mainCell).toMatchObject({
        evaluationKind: "points",
        denominator: { expected: 1, observed: 1, classified: 1, missing: 0 },
        verdict: {
          tally: { passed: 1, failed: 0, errored: 0, skipped: 0 },
          passRate: {
            state: "available",
            value: 1,
            samples: 1,
            total: 1,
            basis: "slot",
            issues: [],
            refs: [{ identity: { kind: "attempt", locator } }],
          },
        },
        score: {
          state: "available",
          value: 37.111111111111114,
          samples: 1,
          total: 1,
          basis: "slot",
          issues: [],
          refs: [{ identity: { kind: "attempt", locator } }],
          unit: "points",
          bounds: { min: 0, max: 43.111111111111114 },
        },
        costUSD: {
          state: "available",
          value: 0.00002,
          source: "estimated",
          samples: 1,
          total: 1,
          basis: "slot",
          issues: [],
          refs: [{ identity: { kind: "attempt", locator } }],
        },
        coverage: expect.any(Array),
        issues: expect.any(Array),
        members: [{ runId: carriedRunId, action: "carried", relation: "reference", locator }],
      });
      const alternateCell = only(
        overviewDocument.overview.cells,
        (cell) => cell.experimentId === "alternate" && cell.evalId === "inspection",
        overview.diagnostic(),
      );
      expect(alternateCell).toMatchObject({
        evaluationKind: "points",
        denominator: { expected: 1, observed: 1, classified: 1, missing: 0 },
        verdict: {
          tally: { passed: 1, failed: 0, errored: 0, skipped: 0 },
          passRate: {
            state: "available",
            value: 1,
            samples: 1,
            total: 1,
            basis: "slot",
            issues: [],
            refs: [{ identity: { kind: "attempt", locator: alternateLocator } }],
          },
        },
        score: {
          state: "available",
          value: 37.111111111111114,
          samples: 1,
          total: 1,
          basis: "slot",
          issues: [],
          refs: [{ identity: { kind: "attempt", locator: alternateLocator } }],
          unit: "points",
          bounds: { min: 0, max: 43.111111111111114 },
        },
        coverage: expect.any(Array),
        issues: expect.any(Array),
        members: [{
          runId: alternateRunId,
          action: "executed",
          relation: "origin",
          locator: alternateLocator,
        }],
      });
      const multiInspectionCell = only(
        overviewDocument.overview.cells,
        (cell) => cell.experimentId === "inspection-multi" && cell.evalId === "inspection",
        overview.diagnostic(),
      );
      const multiInspectionLocators = multiInspectionCell.members
        .map(({ locator: memberLocator }) => memberLocator)
        .toSorted();
      expect(multiInspectionLocators).toHaveLength(2);
      expect(new Set(multiInspectionLocators).size).toBe(2);
      expect(multiInspectionCell).toMatchObject({
        evaluationKind: "points",
        denominator: { expected: 2, observed: 2, classified: 2, missing: 0 },
        score: {
          state: "available",
          value: 37.111111111111114,
          samples: 2,
          total: 2,
          basis: "slot",
          issues: [],
          refs: multiInspectionLocators.map((memberLocator) => ({
            identity: { kind: "attempt", locator: memberLocator },
          })),
          unit: "points",
          bounds: { min: 0, max: 43.111111111111114 },
        },
      });
      for (const memberLocator of multiInspectionLocators) {
        expect(only(
          multiInspectionCell.members,
          (member) => member.locator === memberLocator,
          overview.diagnostic(),
        )).toMatchObject({
          runId: multiRunId,
          action: "executed",
          relation: "origin",
          locator: memberLocator,
          score: {
            state: "available",
            value: 37.111111111111114,
            samples: 1,
            total: 1,
            basis: "slot",
            issues: [],
            refs: [{ identity: { kind: "attempt", locator: memberLocator } }],
            unit: "points",
            bounds: { min: 0, max: 43.111111111111114 },
          },
        });
      }
      const multiSecondaryCell = only(
        overviewDocument.overview.cells,
        (cell) => cell.experimentId === "inspection-multi" && cell.evalId === "overview-secondary",
        overview.diagnostic(),
      );
      const multiSecondaryLocators = multiSecondaryCell.members
        .map(({ locator: memberLocator }) => memberLocator)
        .toSorted();
      expect(multiSecondaryLocators).toHaveLength(2);
      expect(new Set(multiSecondaryLocators).size).toBe(2);
      expect(multiSecondaryCell).toMatchObject({
        score: {
          state: "available",
          value: 2,
          samples: 2,
          total: 2,
          basis: "slot",
          bounds: { min: 0, max: 2 },
        },
      });
      for (const memberLocator of multiSecondaryLocators) {
        expect(only(
          multiSecondaryCell.members,
          (member) => member.locator === memberLocator,
          overview.diagnostic(),
        )).toMatchObject({
          locator: memberLocator,
          score: {
            state: "available",
            value: 2,
            samples: 1,
            total: 1,
            basis: "slot",
            bounds: { min: 0, max: 2 },
          },
        });
      }
      const multiExperiment = only(
        overviewDocument.overview.experiments,
        (experiment) => experiment.experimentId === "inspection-multi",
        overview.diagnostic(),
      );
      expect(multiExperiment.score).toMatchObject({
        state: "available",
        value: 39.111111111111114,
        samples: 2,
        total: 2,
        basis: "eval",
        unit: "points",
        bounds: { min: 0, max: 45.111111111111114 },
      });

      const requestPath = join(projectRoot, "run-summary.request.json");
      await writeFile(
        requestPath,
        `${JSON.stringify({
          protocol: "niceeval.query/v1",
          operation: { kind: "run.get", runId },
        })}\n`,
        "utf8",
      );
      const explained = await niceeval.run([
        "query",
        "explain",
        "--request",
        requestPath,
      ]);
      expect(explained.exitCode, explained.diagnostic()).toBe(0);
      const explanation = explained.json<QueryExplanationDocument>();
      expect(explained.stdout).toBe(`${JSON.stringify(explanation)}\n`);
      expect(explanation).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "run.get",
        behaviorVersion: expect.any(String),
        source: {
          kind: "operational",
          sealedCutoffIdentity: expect.any(String),
        },
        sealedCutoff: expect.anything(),
        selection: expect.anything(),
        factKinds: expect.any(Array),
      });
      expect(explanation.behaviorVersion).not.toBe("");

      const queried = await niceeval.run([
        "query",
        "run",
        "--request",
        requestPath,
      ]);
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      const document = queried.json<RunSummaryDocument>();
      expect(queried.stdout).toBe(`${JSON.stringify(document)}\n`);
      expect(document).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "run.get",
        behaviorVersion: expect.any(String),
        source: {
          kind: "operational",
          sealedCutoffIdentity: explanation.source.sealedCutoffIdentity,
        },
        sealedCutoff: expect.anything(),
        selection: expect.anything(),
        issues: expect.any(Array),
        evidence: expect.anything(),
        run: expect.anything(),
      });
      expect(document.behaviorVersion).not.toBe("");
      const publicSummary = JSON.stringify(document.run);
      expect(publicSummary).toContain(runId);
      expect(publicSummary).toContain("executed");
      expect(queried.stdout).not.toContain(projectRoot);
      expect(queried.stdout).not.toContain(".niceeval/");

      await writeFile(
        requestPath,
        `${JSON.stringify({
          protocol: "niceeval.query/v1",
          operation: { kind: "attempt.usage", locator },
        })}\n`,
        "utf8",
      );
      const overviewQueried = await niceeval.run([
        "query",
        "run",
        "--request",
        requestPath,
      ]);
      expect(overviewQueried.exitCode, overviewQueried.diagnostic()).toBe(0);
      const runOverviewDocument = overviewQueried.json<RunOverviewDocument>();
      expect(runOverviewDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.usage",
        behaviorVersion: expect.any(String),
        source: {
          kind: "operational",
          sealedCutoffIdentity: explanation.source.sealedCutoffIdentity,
        },
        issues: [],
        usage: expect.anything(),
      });
      expect(runOverviewDocument.usage.totals).toMatchObject({
        inputTokens: { state: "available", value: 10 },
        outputTokens: { state: "available", value: 5 },
      });
      expect(runOverviewDocument.usage.limitations).toEqual([]);
      expect(overviewQueried.stdout).not.toContain(projectRoot);
      expect(overviewQueried.stdout).not.toContain(".niceeval/");

      await writeFile(
        requestPath,
        `${JSON.stringify({
          protocol: "niceeval.query/v1",
          operation: { kind: "run.get", runId: carriedRunId },
        })}\n`,
        "utf8",
      );
      const carriedSummary = await niceeval.run([
        "query",
        "run",
        "--request",
        requestPath,
      ]);
      expect(carriedSummary.exitCode, carriedSummary.diagnostic()).toBe(0);
      const carriedSummaryDocument = carriedSummary.json<RunSummaryDocument>();
      expect(carriedSummaryDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "run.get",
        issues: [],
      });
      expect(JSON.stringify(carriedSummaryDocument.run)).toContain(carriedRunId);
      expect(JSON.stringify(carriedSummaryDocument.run)).toContain('"action":"carried"');

      const operationRequestPath = join(projectRoot, "fixed-operation.request.json");
      let matcherToolOccurrenceId: string | undefined;
      const operations = [
        { kind: "runs.list" },
        { kind: "experiment.get", experimentId: "main" },
        { kind: "run.get", runId },
        { kind: "attempt.get", locator },
        { kind: "attempt.trace", locator },
        { kind: "attempt.timing", locator },
        { kind: "attempt.usage", locator },
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

        if (operation.kind === "attempt.get") {
          const attemptDocument = operationDocument as AttemptGetDocument;
          const matcherEntry = only(
            attemptDocument.attempt.assertions.entries,
            (entry) => entry.display.label === "Inspection tool occurrence",
            result.diagnostic(),
          );
          expect(matcherEntry.entryId).not.toMatch(/^(?:t\d+\.c\d+|cmd\d+)$/u);
          await writeFile(operationRequestPath, `${JSON.stringify({
            protocol: "niceeval.query/v1",
            operation: {
              kind: "attempt.assertion.detail",
              locator,
              entryId: matcherEntry.entryId,
            },
          })}\n`, "utf8");
          const assertionDetail = await niceeval.run([
            "query",
            "run",
            "--request",
            operationRequestPath,
          ]);
          expect(assertionDetail.exitCode, assertionDetail.diagnostic()).toBe(0);
          const assertionDocument = assertionDetail.json<AttemptAssertionDetailDocument>();
          expect(assertionDetail.stdout).toBe(`${JSON.stringify(assertionDocument)}\n`);
          expect(assertionDocument).toMatchObject({
            protocol: "niceeval.query/v1",
            operation: "attempt.assertion.detail",
            behaviorVersion: "1",
            assertion: {
              format: "niceeval.inspection.assertion-detail/v1",
              entryId: matcherEntry.entryId,
              display: { label: "Inspection tool occurrence" },
              sourceSites: expect.any(Array),
              check: {
                label: "Inspection tool occurrence",
                state: "matched",
                expected: expect.anything(),
                observed: expect.anything(),
                reason: null,
                anchor: null,
                children: expect.any(Array),
              },
              matcher: {
                state: "available",
                sourceState: "complete",
                comparator: expect.anything(),
                sourceLedger: expect.anything(),
                debugger: {
                  state: "current",
                  subject: "tool",
                  query: {
                    kind: "collection-filter",
                    summary: expect.anything(),
                  },
                  receipt: expect.anything(),
                  source: {
                    final: {
                      state: "complete",
                      rows: expect.any(Array),
                      limitations: [],
                    },
                    atEvaluation: {
                      state: "complete",
                      rows: expect.any(Array),
                      limitations: [],
                    },
                  },
                  identityRelation: { state: "exact" },
                  overlayRetention: "complete",
                  steps: [],
                },
                sandboxCommandJoin: { state: "unavailable", reason: "not-recorded" },
              },
            },
          });
          const matcherTarget = only(
            assertionDocument.assertion.matcher.targets,
            (target) => target.anchor.kind === "tool-occurrence" &&
              typeof target.anchor.toolOccurrenceId === "string",
            assertionDetail.diagnostic(),
          );
          expect(matcherTarget).toMatchObject({
            state: "matched",
            anchor: {
              kind: "tool-occurrence",
              toolOccurrenceId: expect.any(String),
            },
          });
          matcherToolOccurrenceId = matcherTarget.anchor.toolOccurrenceId;
          const atEvaluationRow = only(
            assertionDocument.assertion.matcher.debugger?.source.atEvaluation.rows ?? [],
            (row) => row.locator?.kind === "tool-occurrence" &&
              row.locator.toolOccurrenceId === matcherToolOccurrenceId,
            assertionDetail.diagnostic(),
          );
          expect(atEvaluationRow).toMatchObject({
            kind: "tool",
            rowId: `tool:${matcherToolOccurrenceId}`,
            number: "1",
            phase: "at-evaluation",
            summary: "inspection_fixture",
            detail: { kind: "fields", fields: expect.any(Array) },
            locator: {
              kind: "tool-occurrence",
              toolOccurrenceId: matcherToolOccurrenceId,
            },
            evaluation: { result: "matched" },
            conversationTarget: {
              state: "exact",
              turnId: expect.any(String),
              eventId: expect.any(String),
              anchor: expect.any(String),
            },
          });
          const finalRow = only(
            assertionDocument.assertion.matcher.debugger?.source.final.rows ?? [],
            (row) => row.rowId === atEvaluationRow.rowId,
            assertionDetail.diagnostic(),
          );
          expect(finalRow).toEqual(atEvaluationRow);
        }

        if (operation.kind === "attempt.trace") {
          const traceDocument = operationDocument as AttemptTraceDocument;
          expect(traceDocument).toMatchObject({
            behaviorVersion: "1",
            trace: { format: "niceeval.inspection.trace/v1" },
          });
          const toolCall = only(
            traceDocument.trace.conversation.items,
            (item) => item.kind === "tool-call" && item.tool === "inspection_fixture",
            result.diagnostic(),
          );
          const toolResult = only(
            traceDocument.trace.conversation.items,
            (item) => item.kind === "tool-result" && item.outcome === "completed",
            result.diagnostic(),
          );
          expect(toolCall).toMatchObject({
            itemId: expect.any(String),
            kind: "tool-call",
            toolOccurrenceId: expect.any(String),
            input: expect.stringContaining("inspection-tool-input"),
          });
          expect(toolResult).toMatchObject({
            itemId: expect.any(String),
            kind: "tool-result",
            toolOccurrenceId: toolCall.toolOccurrenceId,
            output: expect.stringContaining("inspection-tool-result"),
          });
          expect(JSON.stringify(traceDocument.trace)).not.toMatch(/"kind":"tool-(?:start|finish)"/u);

          const toolOccurrenceId = toolCall.toolOccurrenceId;
          if (toolOccurrenceId === undefined) throw new Error("expected exact tool occurrence identity");
          expect(toolOccurrenceId).toBe(matcherToolOccurrenceId);
          expect(toolOccurrenceId).not.toMatch(/^(?:t\d+\.c\d+|cmd\d+)$/u);
          expect(toolCall.itemId).not.toMatch(/^(?:t\d+\.c\d+|cmd\d+)$/u);
          expect(toolResult.itemId).not.toMatch(/^(?:t\d+\.c\d+|cmd\d+)$/u);
          await writeFile(operationRequestPath, `${JSON.stringify({
            protocol: "niceeval.query/v1",
            operation: {
              kind: "attempt.trace.detail",
              locator,
              selector: { kind: "tool-occurrence", toolOccurrenceId },
            },
          })}\n`, "utf8");
          const detail = await niceeval.run([
            "query",
            "run",
            "--request",
            operationRequestPath,
          ]);
          expect(detail.exitCode, detail.diagnostic()).toBe(0);
          const detailDocument = detail.json<AttemptTraceDetailDocument>();
          expect(detail.stdout).toBe(`${JSON.stringify(detailDocument)}\n`);
          expect(detailDocument).toMatchObject({
            protocol: "niceeval.query/v1",
            operation: "attempt.trace.detail",
            behaviorVersion: "1",
            detail: {
              format: "niceeval.inspection.trace-detail/v1",
              kind: "tool-occurrence",
              toolOccurrenceId,
              call: {
                itemId: toolCall.itemId,
                kind: "tool-call",
                tool: "inspection_fixture",
                input: expect.stringContaining("inspection-tool-input"),
              },
              result: {
                itemId: toolResult.itemId,
                kind: "tool-result",
                outcome: "completed",
                output: expect.stringContaining("inspection-tool-result"),
              },
            },
          });
        }

        if (operation.kind === "attempt.sources") {
          const sourcesDocument = operationDocument as AttemptSourcesDocument;
          expect(sourcesDocument.sources.state, JSON.stringify(sourcesDocument.sources)).toBe("available");
          expect(sourcesDocument).toMatchObject({
            behaviorVersion: "1",
            sources: {
              format: "niceeval.inspection.sources/v1",
              state: "available",
              assertions: { state: "available" },
            },
          });
          const sourceSite = (sourcesDocument.sources.assertions.sourceSites ?? []).find(
            (site) => site.role === "declaration" && site.source.state === "mapped",
          );
          expect(sourceSite, result.diagnostic()).toBeDefined();
          if (sourceSite === undefined) throw new Error("expected a mapped declaration source site");
          const sourceItem = only(
            sourcesDocument.sources.items,
            (item) => item.sourceItemId === sourceSite.source.sourceItemId,
            result.diagnostic(),
          );
          expect(sourceSite).toMatchObject({
            entryId: expect.any(String),
            sourceOrder: expect.any(Number),
            source: {
              state: "mapped",
              sourceItemId: sourceItem.sourceItemId,
              sha256: sourceItem.sha256,
            },
          });
          expect(sourceItem).toMatchObject({
            path: "evals/inspection.eval.ts",
            content: {
              state: "available",
              text: expect.stringContaining("defineScoreEval"),
            },
          });
        }
      }

      await writeFile(operationRequestPath, `${JSON.stringify({
        protocol: "niceeval.query/v1",
        operation: { kind: "run.get", runId: "missing-run" },
      })}\n`, "utf8");
      const missing = await niceeval.run([
        "query",
        "run",
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

      for (const retiredCommand of ["insight"] as const) {
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
