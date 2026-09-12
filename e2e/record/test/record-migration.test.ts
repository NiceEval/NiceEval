// rerun: pnpm e2e test --repo record -- --run test/record-migration.test.ts

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createE2EContext, only } from "@niceeval/testkit";
import { expect, test } from "vitest";

const e2e = createE2EContext({
  repoId: "record",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-record-migration-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")] },
});

const predecessors = [
  {
    version: "0.15",
    experiments: [
      {
        id: "migration-agent",
        adapter: {
          name: "record-migration-agent",
          contract: "niceeval.agent/v1",
          behaviorRevision: null,
        },
        context: {
          model: "migration-model-agent",
          flags: {
            application: "user-flag-application",
            agentId: "user-flag-agentId",
            nested: { application: "agentId" },
          },
          labels: { migration: "historical-agent", application: "agentId" },
        },
        assertion: {
          label: "migration-agent-assertion-application-agentId",
          predecessorObserved: "agent:predecessor",
          currentObserved: "agent:current",
        },
      },
    ],
  },
  {
    version: "0.16",
    experiments: [
      {
        id: "migration-agent",
        adapter: {
          name: "record-migration-agent",
          contract: "niceeval.agent/v1",
          behaviorRevision: null,
        },
        context: {
          model: "migration-model-agent",
          flags: {
            application: "user-flag-application",
            agentId: "user-flag-agentId",
            nested: { application: "agentId" },
          },
          labels: { migration: "historical-agent", application: "agentId" },
        },
        assertion: {
          label: "migration-agent-assertion-application-agentId",
          predecessorObserved: "agent:predecessor",
          currentObserved: "agent:current",
        },
      },
      {
        id: "migration-custom",
        adapter: {
          name: "record-migration-custom",
          contract: "record-migration-custom",
          behaviorRevision: "1",
        },
        context: {
          model: "migration-model-custom",
          flags: {
            application: "user-flag-application",
            agentId: "user-flag-agentId",
            nested: { application: "agentId" },
          },
          labels: { migration: "historical-custom", application: "agentId" },
        },
        assertion: {
          label: "migration-custom-assertion-application-agentId",
          predecessorObserved: "custom:predecessor",
          currentObserved: "custom:current",
        },
      },
    ],
  },
] as const;

test.concurrent("0.15 与 0.16 的公开 producer Record 经正常项目动作自动迁移并保留结果与引用 [necase_W26XFXH8K05QA8C5]", async () => {
  for (const predecessor of predecessors) {
    await e2e.case(
      `record-migration-${predecessor.version.replaceAll(".", "-")}`,
      { artifacts: [{ source: ".niceeval", target: `.niceeval-${predecessor.version}`, optional: true }] },
      async ({ paths: { projectRoot }, commands: { niceeval } }) => {
        const fixtureRecord = join(
          projectRoot,
          "fixtures",
          "record-migration",
          "predecessors",
          predecessor.version,
          "record.sqlite",
        );
        const fixtureBytes = await readFile(fixtureRecord);
        const externalRecord = join(projectRoot, `external-${predecessor.version}.sqlite`);
        await copyFile(fixtureRecord, externalRecord);
        const externalRequest = join(projectRoot, `external-${predecessor.version}.request.json`);
        await writeFile(externalRequest, `${JSON.stringify({
          protocol: "niceeval.query/v1",
          operation: { kind: "run.get", runId: randomUUID() },
        })}\n`, "utf8");

        const external = await niceeval.run([
          "query", "run", "--record", externalRecord, "--request", externalRequest,
        ]);
        expect(external.exitCode, external.diagnostic()).toBe(2);
        expect(external.queryFailure().failure).toMatchObject({
          code: "inspection-source-invalid",
          correction: "fix-record-source",
        });
        expect(external.queryFailure().failure.reason).toContain("original project");
        expect(await readFile(externalRecord)).toEqual(fixtureBytes);

        const canonicalRoot = join(projectRoot, ".niceeval");
        await mkdir(canonicalRoot, { recursive: true });
        await copyFile(fixtureRecord, join(canonicalRoot, "record.sqlite"));

        // This is the first current-candidate open and a normal project write;
        // migration is automatic rather than a test-only maintenance action.
        const currentRunIds = new Map<string, string>();
        for (const experiment of predecessor.experiments) {
          const current = await niceeval.run([
            "exp", experiment.id, "--rerun", "all", "--json",
          ]);
          expect(current.exitCode, current.diagnostic()).toBe(0);
          expect(current.expReceipt(), current.diagnostic()).toMatchObject({ completion: "completed" });
          currentRunIds.set(
            experiment.id,
            only(current.expReceipt().createdRunIds, () => true, current.diagnostic()),
          );
        }

        const listed = await niceeval.run(["run", "list", "--json"]);
        expect(listed.exitCode, listed.diagnostic()).toBe(0);
        const runs = listed.runListDocument().runs;
        expect(runs).toHaveLength(predecessor.experiments.length * 2);

        for (const experiment of predecessor.experiments) {
          const currentRunId = currentRunIds.get(experiment.id);
          if (currentRunId === undefined) throw new Error(`current Run missing for ${experiment.id}`);
          const origin = only(
            runs,
            (run) => run.experimentId === experiment.id && run.runId !== currentRunId,
            listed.diagnostic(),
          );

          const originShownReceipt = await niceeval.run(["run", "show", origin.runId, "--json"]);
          expect(originShownReceipt.exitCode, originShownReceipt.diagnostic()).toBe(0);
          const originShown = originShownReceipt.runGetDocument();
          const originSlot = only(
            originShown.run.slots,
            (slot) => slot.publication.state === "published",
            originShownReceipt.diagnostic(),
          );
          if (originSlot.publication.state !== "published") throw new Error("predecessor slot was not published");

          const currentShownReceipt = await niceeval.run(["run", "show", currentRunId, "--json"]);
          expect(currentShownReceipt.exitCode, currentShownReceipt.diagnostic()).toBe(0);
          const currentShown = currentShownReceipt.runGetDocument();
          const currentSlot = only(
            currentShown.run.slots,
            (slot) => slot.publication.state === "published",
            currentShownReceipt.diagnostic(),
          );
          if (currentSlot.publication.state !== "published") throw new Error("current slot was not published");
          expect(currentSlot.publication.attemptLocator).not.toBe(originSlot.publication.attemptLocator);

          for (const [label, runId, locator, observed] of [
            ["origin", origin.runId, originSlot.publication.attemptLocator, experiment.assertion.predecessorObserved],
            ["current", currentRunId, currentSlot.publication.attemptLocator, experiment.assertion.currentObserved],
          ] as const) {
            const request = join(projectRoot, `${predecessor.version}-${experiment.id}-${label}.request.json`);
            await writeFile(request, `${JSON.stringify({
              protocol: "niceeval.query/v1",
              operation: { kind: "run.get", runId },
            })}\n`, "utf8");
            const queried = await niceeval.run(["query", "run", "--request", request]);
            expect(queried.exitCode, queried.diagnostic()).toBe(0);
            const document = queried.querySuccess("run.get");
            expect(document.run.value).toMatchObject({
              runId,
              experimentId: experiment.id,
              context: {
                experimentId: experiment.id,
                execution: {
                  adapter: experiment.adapter,
                  model: experiment.context.model,
                  reasoningEffort: null,
                  flags: experiment.context.flags,
                },
                labels: experiment.context.labels,
              },
            });
            expect(document.run.attempts).toEqual([
              expect.objectContaining({ outcome: "completed" }),
            ]);
            expect(document.run.members).toEqual([
              expect.objectContaining({
                action: "executed",
                attempt: expect.objectContaining({ originRunId: runId }),
              }),
            ]);
            expect(document.run.value.context?.execution.adapter).not.toHaveProperty("kind");
            expect(document.run.value.context?.execution).not.toHaveProperty("application");

            const attemptRequest = join(
              projectRoot,
              `${predecessor.version}-${experiment.id}-${label}-attempt.request.json`,
            );
            await writeFile(attemptRequest, `${JSON.stringify({
              protocol: "niceeval.query/v1",
              operation: { kind: "attempt.get", locator },
            })}\n`, "utf8");
            const attemptQuery = await niceeval.run(["query", "run", "--request", attemptRequest]);
            expect(attemptQuery.exitCode, attemptQuery.diagnostic()).toBe(0);
            const attemptDocument = attemptQuery.querySuccess("attempt.get");
            expect(attemptDocument.attempt.assertions.state).toBe("available");
            const assertionEntry = only(
              attemptDocument.attempt.assertions.entries,
              (entry) => entry.display.label === experiment.assertion.label,
              attemptQuery.diagnostic(),
            );

            const assertionRequest = join(
              projectRoot,
              `${predecessor.version}-${experiment.id}-${label}-assertion.request.json`,
            );
            await writeFile(assertionRequest, `${JSON.stringify({
              protocol: "niceeval.query/v1",
              operation: {
                kind: "attempt.assertion.detail",
                locator,
                entryId: assertionEntry.entryId,
              },
            })}\n`, "utf8");
            const assertionQuery = await niceeval.run(["query", "run", "--request", assertionRequest]);
            expect(assertionQuery.exitCode, assertionQuery.diagnostic()).toBe(0);
            const assertionDocument = assertionQuery.querySuccess("attempt.assertion.detail");
            expect(assertionDocument.assertion).toMatchObject({
              entryId: assertionEntry.entryId,
              display: { label: experiment.assertion.label },
              check: {
                label: experiment.assertion.label,
                state: "matched",
                observed: {
                  kind: "fields",
                  fields: expect.arrayContaining([
                    { label: "outcome", value: { kind: "value", value: "matched" } },
                  ]),
                },
              },
            });
            expect(assertionDocument.assertion).toMatchObject({
              entry: {
                materials: {
                  source: {
                    kind: "content",
                    encoding: "json",
                    content: {
                      state: "available",
                      base64: Buffer.from(JSON.stringify(observed), "utf8").toString("base64"),
                    },
                  },
                },
              },
            });
          }

          const accepted = await niceeval.run(["accept", originSlot.publication.attemptLocator]);
          expect(accepted.exitCode, accepted.diagnostic()).toBe(0);
          const acceptedRunMatch = accepted.stdout.match(
            /into new Run ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\. Result locator remains (@1[0-9A-HJKMNP-TV-Z]{12})\./u,
          );
          expect(acceptedRunMatch, accepted.diagnostic()).not.toBeNull();
          const acceptedRunId = acceptedRunMatch?.[1];
          if (acceptedRunId === undefined) throw new Error("accept did not publish its Run identity");
          expect(acceptedRunMatch?.[2]).toBe(originSlot.publication.attemptLocator);

          const acceptedShownReceipt = await niceeval.run(["run", "show", acceptedRunId, "--json"]);
          expect(acceptedShownReceipt.exitCode, acceptedShownReceipt.diagnostic()).toBe(0);
          const acceptedSlot = only(
            acceptedShownReceipt.runGetDocument().run.slots,
            (slot) => slot.publication.state === "published",
            acceptedShownReceipt.diagnostic(),
          );
          expect(acceptedSlot.publication).toMatchObject({
            state: "published",
            action: "accepted",
            attemptLocator: originSlot.publication.attemptLocator,
            originRunId: origin.runId,
          });

          const acceptedRequest = join(projectRoot, `${predecessor.version}-${experiment.id}-accepted.request.json`);
          await writeFile(acceptedRequest, `${JSON.stringify({
            protocol: "niceeval.query/v1",
            operation: { kind: "run.get", runId: acceptedRunId },
          })}\n`, "utf8");
          const acceptedQuery = await niceeval.run(["query", "run", "--request", acceptedRequest]);
          expect(acceptedQuery.exitCode, acceptedQuery.diagnostic()).toBe(0);
          const acceptedDocument = acceptedQuery.querySuccess("run.get");
          expect(acceptedDocument.run.members).toEqual([
            expect.objectContaining({
              action: "accepted",
              attempt: expect.objectContaining({ originRunId: origin.runId }),
            }),
          ]);
          expect(acceptedDocument.run.value.context?.execution.adapter).toEqual(experiment.adapter);
        }

        // Reopening the now-current Record is a no-op: identities and references
        // remain readable without cloning predecessor rows a second time.
        const reopened = await niceeval.run(["run", "list", "--json"]);
        expect(reopened.exitCode, reopened.diagnostic()).toBe(0);
        const reopenedAgain = await niceeval.run(["run", "list", "--json"]);
        expect(reopenedAgain.exitCode, reopenedAgain.diagnostic()).toBe(0);
        expect(reopenedAgain.runListDocument()).toEqual(reopened.runListDocument());
      },
    );
  }
});
