// rerun: pnpm e2e test --repo record -- --run test/record-migration.test.ts

import { chmod, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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

test.concurrent("历史公开 producer Record 首次只读即可自动迁移并保留结果与引用 [necase_W26XFXH8K05QA8C5]", async () => {
  for (const predecessor of [
    ...predecessors,
    { ...predecessors[0], version: "0.15-hooks" },
    { ...predecessors[0], version: "0.17" },
    { ...predecessors[0], version: "0.17-nohooks" },
  ]) {
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
        const canonicalRoot = join(projectRoot, ".niceeval");
        await mkdir(canonicalRoot, { recursive: true });
        const canonicalRecord = join(canonicalRoot, "record.sqlite");
        await copyFile(fixtureRecord, canonicalRecord);
        const canonicalFiles = (await readdir(canonicalRoot)).sort();

        // The first current-candidate open is read-only: historical results do
        // not require an Experiment rerun before they become readable, and the
        // private migration copy must not change the canonical source material.
        const historicalListed = await niceeval.run(["run", "list", "--json"]);
        expect(historicalListed.exitCode, historicalListed.diagnostic()).toBe(0);
        expect((await readFile(canonicalRecord)).equals(fixtureBytes), "read-only access must preserve the original Record bytes").toBe(true);
        expect((await readdir(canonicalRoot)).sort()).toEqual(canonicalFiles);
        const historicalSummaries = historicalListed.runListDocument().runs;
        expect(historicalSummaries).toHaveLength(predecessor.experiments.length);
        const historicalRuns = new Map<string, { runId: string; attemptLocator: string }>();

        for (const experiment of predecessor.experiments) {
          const historicalSummary = only(
            historicalSummaries,
            (run) => run.experimentId === experiment.id,
            historicalListed.diagnostic(),
          );
          const historicalShownReceipt = await niceeval.run([
            "run", "show", historicalSummary.runId, "--json",
          ]);
          expect(historicalShownReceipt.exitCode, historicalShownReceipt.diagnostic()).toBe(0);
          const historicalSlot = only(
            historicalShownReceipt.runGetDocument().run.slots,
            (slot) => slot.publication.state === "published",
            historicalShownReceipt.diagnostic(),
          );
          if (historicalSlot.publication.state !== "published") {
            throw new Error("predecessor slot was not published");
          }
          expect(historicalSlot.publication).toMatchObject({
            state: "published",
            action: "executed",
            originRunId: historicalSummary.runId,
          });

          const historicalRequest = join(
            projectRoot,
            `${predecessor.version}-${experiment.id}-historical.request.json`,
          );
          await writeFile(historicalRequest, `${JSON.stringify({
            protocol: "niceeval.query/v1",
            operation: { kind: "run.get", runId: historicalSummary.runId },
          })}\n`, "utf8");
          const historicalQuery = await niceeval.run(["query", "run", "--request", historicalRequest]);
          expect(historicalQuery.exitCode, historicalQuery.diagnostic()).toBe(0);
          const historicalDocument = historicalQuery.querySuccess("run.get");
          expect(historicalDocument.run.value).toMatchObject({
            runId: historicalSummary.runId,
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
          expect(historicalDocument.run.members).toEqual([
            expect.objectContaining({
              action: "executed",
              attempt: expect.objectContaining({ originRunId: historicalSummary.runId }),
            }),
          ]);
          if (predecessor.version === "0.15-hooks" || predecessor.version === "0.17") {
            expect(historicalDocument.run.value.context?.execution.experimentHooks).toEqual({
              version: 1, setup: "absent", teardown: "absent",
            });
          } else {
            expect(historicalDocument.run.value.context?.execution).not.toHaveProperty("experimentHooks");
          }
          expect(historicalDocument.run.value.context?.execution.adapter).not.toHaveProperty("kind");
          expect(historicalDocument.run.value.context?.execution).not.toHaveProperty("application");
          historicalRuns.set(experiment.id, {
            runId: historicalSummary.runId,
            attemptLocator: historicalSlot.publication.attemptLocator,
          });
        }
        expect(await readFile(canonicalRecord)).toEqual(fixtureBytes);
        expect((await readdir(canonicalRoot)).sort()).toEqual(canonicalFiles);

        // External historical input is migrated in an isolated copy. Source
        // immutability is proved from its bytes and directory entries; the file
        // mode additionally exercises a source that cannot itself be rewritten.
        const externalRoot = join(projectRoot, `external-${predecessor.version}`);
        await mkdir(externalRoot, { recursive: true });
        const externalRecord = join(externalRoot, "record.sqlite");
        await copyFile(fixtureRecord, externalRecord);
        await chmod(externalRecord, 0o444);
        const externalFiles = (await readdir(externalRoot)).sort();
        const externalExperiment = predecessor.experiments[0];
        const externalHistorical = historicalRuns.get(externalExperiment.id);
        if (externalHistorical === undefined) throw new Error("external historical Run missing");
        const externalRequest = join(projectRoot, `external-${predecessor.version}.request.json`);
        await writeFile(externalRequest, `${JSON.stringify({
          protocol: "niceeval.query/v1",
          operation: { kind: "run.get", runId: externalHistorical.runId },
        })}\n`, "utf8");

        const external = await niceeval.run([
          "query", "run", "--record", externalRecord, "--request", externalRequest,
        ]);
        expect(external.exitCode, external.diagnostic()).toBe(0);
        expect(external.querySuccess("run.get").run.value).toMatchObject({
          runId: externalHistorical.runId,
          experimentId: externalExperiment.id,
          context: {
            execution: { adapter: externalExperiment.adapter },
            labels: externalExperiment.context.labels,
          },
        });
        const externalAgain = await niceeval.run([
          "query", "run", "--record", externalRecord, "--request", externalRequest,
        ]);
        expect(externalAgain.exitCode, externalAgain.diagnostic()).toBe(0);
        expect(externalAgain.querySuccess("run.get")).toEqual(external.querySuccess("run.get"));
        expect((await readFile(externalRecord)).equals(fixtureBytes), "external import must preserve the original Record bytes").toBe(true);
        expect((await readdir(externalRoot)).sort()).toEqual(externalFiles);

        // The migrated project remains writable and can add current Runs.
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
          const origin = historicalRuns.get(experiment.id);
          if (origin === undefined) throw new Error(`historical Run missing for ${experiment.id}`);

          const currentShownReceipt = await niceeval.run(["run", "show", currentRunId, "--json"]);
          expect(currentShownReceipt.exitCode, currentShownReceipt.diagnostic()).toBe(0);
          const currentShown = currentShownReceipt.runGetDocument();
          const currentSlot = only(
            currentShown.run.slots,
            (slot) => slot.publication.state === "published",
            currentShownReceipt.diagnostic(),
          );
          if (currentSlot.publication.state !== "published") throw new Error("current slot was not published");
          expect(currentSlot.publication.attemptLocator).not.toBe(origin.attemptLocator);

          const currentRequest = join(projectRoot, `${predecessor.version}-${experiment.id}-current.request.json`);
          await writeFile(currentRequest, `${JSON.stringify({
            protocol: "niceeval.query/v1",
            operation: { kind: "run.get", runId: currentRunId },
          })}\n`, "utf8");
          const currentQuery = await niceeval.run(["query", "run", "--request", currentRequest]);
          expect(currentQuery.exitCode, currentQuery.diagnostic()).toBe(0);
          const currentDocument = currentQuery.querySuccess("run.get");
          expect(currentDocument.run.value).toMatchObject({
            runId: currentRunId,
            experimentId: experiment.id,
            context: {
              experimentId: experiment.id,
              execution: {
                adapter: experiment.adapter,
                model: experiment.context.model,
                reasoningEffort: null,
                flags: {
                  application: "user-flag-application",
                  agentId: "user-flag-agentId",
                  nestedApplication: "agentId",
                },
              },
              labels: experiment.context.labels,
            },
          });
          expect(currentDocument.run.attempts).toEqual([
            expect.objectContaining({ outcome: "completed" }),
          ]);
          expect(currentDocument.run.members).toEqual([
            expect.objectContaining({
              action: "executed",
              attempt: expect.objectContaining({ originRunId: currentRunId }),
            }),
          ]);
          expect(currentDocument.run.value.context?.execution.adapter).not.toHaveProperty("kind");
          expect(currentDocument.run.value.context?.execution).not.toHaveProperty("application");

          for (const [label, locator, observed] of [
            ["origin", origin.attemptLocator, experiment.assertion.predecessorObserved],
            ["current", currentSlot.publication.attemptLocator, experiment.assertion.currentObserved],
          ] as const) {
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

          const accepted = await niceeval.run(["accept", origin.attemptLocator]);
          expect(accepted.exitCode, accepted.diagnostic()).toBe(0);
          const acceptedRunMatch = accepted.stdout.match(
            /into new Run ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\. Result locator remains (@1[0-9A-HJKMNP-TV-Z]{12})\./u,
          );
          expect(acceptedRunMatch, accepted.diagnostic()).not.toBeNull();
          const acceptedRunId = acceptedRunMatch?.[1];
          if (acceptedRunId === undefined) throw new Error("accept did not publish its Run identity");
          expect(acceptedRunMatch?.[2]).toBe(origin.attemptLocator);

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
            attemptLocator: origin.attemptLocator,
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
