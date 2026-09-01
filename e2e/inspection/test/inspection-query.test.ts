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

test("machine consumer 发现固定 catalog，再从 project Run 读取 origin Attempt 的闭合事实 [necase_79TQ9VGG316D8FK0]", async () => {
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
      const discoveryDocument = discovery.queryDiscovery();
      expect(discovery.stdout).toBe(`${JSON.stringify(discoveryDocument)}\n`);
      expect(discoveryDocument.protocol).toBe("niceeval.query/v1");
      expect(discoveryDocument.operations.map(({ id }) => id).toSorted()).toEqual(
        [...OPERATION_CATALOG].sort(),
      );

      const sourceBoundDiscovery = await niceeval.run([
        "query",
        "discover",
        "--record",
        "removed-record-snapshot.sqlite",
      ]);
      expect(sourceBoundDiscovery.exitCode, sourceBoundDiscovery.diagnostic()).toBe(2);
      expect(sourceBoundDiscovery.queryFailure()).toMatchObject({
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
      const overviewDocument = overview.querySuccess("overview.get");
      expect(overview.stdout).toBe(`${JSON.stringify(overviewDocument)}\n`);
      expect(overviewDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "overview.get",
        source: {
          kind: "project-record",
          sealedCutoffIdentity: expect.any(String),
        },
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
        members: [{
          runId: carriedRunId,
          publication: {
            state: "published",
            action: "carried",
            attemptLocator: locator,
            originRunId: runId,
          },
        }],
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
          publication: {
            state: "published",
            action: "executed",
            attemptLocator: alternateLocator,
            originRunId: alternateRunId,
          },
        }],
      });
      const multiInspectionCell = only(
        overviewDocument.overview.cells,
        (cell) => cell.experimentId === "inspection-multi" && cell.evalId === "inspection",
        overview.diagnostic(),
      );
      const multiInspectionLocators = multiInspectionCell.members
        .map(({ publication }) => publication.attemptLocator)
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
          (member) => member.publication.attemptLocator === memberLocator,
          overview.diagnostic(),
        )).toMatchObject({
          runId: multiRunId,
          publication: {
            state: "published",
            action: "executed",
            attemptLocator: memberLocator,
            originRunId: multiRunId,
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
          },
        });
      }
      const multiSecondaryCell = only(
        overviewDocument.overview.cells,
        (cell) => cell.experimentId === "inspection-multi" && cell.evalId === "overview-secondary",
        overview.diagnostic(),
      );
      const multiSecondaryLocators = multiSecondaryCell.members
        .map(({ publication }) => publication.attemptLocator)
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
          (member) => member.publication.attemptLocator === memberLocator,
          overview.diagnostic(),
        )).toMatchObject({
          publication: {
            state: "published",
            attemptLocator: memberLocator,
            score: {
              state: "available",
              value: 2,
              samples: 1,
              total: 1,
              basis: "slot",
              bounds: { min: 0, max: 2 },
            },
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
      const explanation = explained.queryExplanation("run.get");
      expect(explained.stdout).toBe(`${JSON.stringify(explanation)}\n`);
      expect(explanation).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "run.get",
        source: {
          kind: "project-record",
          sealedCutoffIdentity: expect.any(String),
        },
        sealedCutoff: expect.anything(),
        selection: expect.anything(),
        factKinds: expect.any(Array),
      });

      const queried = await niceeval.run([
        "query",
        "run",
        "--request",
        requestPath,
      ]);
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      const document = queried.querySuccess("run.get");
      expect(queried.stdout).toBe(`${JSON.stringify(document)}\n`);
      expect(document).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "run.get",
        source: {
          kind: "project-record",
          sealedCutoffIdentity: explanation.source.sealedCutoffIdentity,
        },
        sealedCutoff: expect.anything(),
        selection: expect.anything(),
        issues: expect.any(Array),
        evidence: expect.anything(),
        run: expect.anything(),
      });
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
      const runOverviewDocument = overviewQueried.querySuccess("attempt.usage");
      expect(runOverviewDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.usage",
        source: {
          kind: "project-record",
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
      const carriedSummaryDocument = carriedSummary.querySuccess("run.get");
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
        const operationDocument = result.querySuccess(operation.kind);
        expect(result.stdout).toBe(`${JSON.stringify(operationDocument)}\n`);
        expect(operationDocument).toMatchObject({
          protocol: "niceeval.query/v1",
          operation: operation.kind,
        });

        if (operation.kind === "attempt.get") {
          const attemptDocument = operationDocument;
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
          const assertionDocument = assertionDetail.querySuccess("attempt.assertion.detail");
          expect(assertionDetail.stdout).toBe(`${JSON.stringify(assertionDocument)}\n`);
          expect(assertionDocument).toMatchObject({
            protocol: "niceeval.query/v1",
            operation: "attempt.assertion.detail",
            assertion: {
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
          const traceDocument = operationDocument;
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
          const detailDocument = detail.querySuccess("attempt.trace.detail");
          expect(detail.stdout).toBe(`${JSON.stringify(detailDocument)}\n`);
          expect(detailDocument).toMatchObject({
            protocol: "niceeval.query/v1",
            operation: "attempt.trace.detail",
            detail: {
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
          const sourcesDocument = operationDocument;
          expect(sourcesDocument.sources.state, JSON.stringify(sourcesDocument.sources)).toBe("available");
          expect(sourcesDocument).toMatchObject({
            sources: {
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
      const missingDocument = missing.queryFailure();
      expect(missing.stdout).toBe(`${JSON.stringify(missingDocument)}\n`);
      expect(missingDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        outcome: "failure",
        operation: "run.get",
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
      const invalidDocument = invalid.queryFailure();
      expect(invalid.stdout).toBe(`${JSON.stringify(invalidDocument)}\n`);
      expect(invalidDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        outcome: "failure",
        operation: null,
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
