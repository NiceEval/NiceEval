
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createE2EContext, only, pollUntil } from "@niceeval/testkit";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { createLoopbackBackend, whileRunning } from "./support.js";

const e2e = createE2EContext({
  repoId: "record",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-run-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")] },
});

test.concurrent("运行创建后立即可发现，并冻结完整 expected slots [necase_SVJG4JP8WN5TWCQF]", async () => {
  await e2e.case("run-create-discovery", async ({ commands: { niceeval } }) => {
    const backend = await createLoopbackBackend();
    const process = niceeval.start(
      ["exp", "run-journey", "--rerun", "all", "--json"],
      { env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: backend.endpoint }, timeoutMs: 90_000 },
    );
    try {
      await whileRunning(backend.waitForAttempt(0), process, "the first Attempt reached its backend");
      const active = await whileRunning(pollUntil(async () => {
        const receipt = await niceeval.run(["run", "list", "--json"]);
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        return receipt.runListDocument().runs.find((run) =>
          run.state === "active" && run.coverage.expected === 2 && run.coverage.published === 0
        );
      }, { timeoutMs: 20_000, intervalMs: 50, label: "the created Run to be listed" }), process, "the created Run became visible");
      expect(active).toMatchObject({
        experimentId: "run-journey",
        state: "active",
        coverage: { expected: 2, published: 0, missing: 2 },
      });
      expect(active.runId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(active.invocationId).toEqual(expect.any(String));

      const receipt = await niceeval.run(["run", "show", active.runId, "--json"]);
      expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
      const shown = receipt.runGetDocument();
      expect(shown.run).toMatchObject({
        runId: active.runId,
        state: "active",
        coverage: { expected: 2, published: 0, missing: 2 },
      });
      expect(shown.run.slots).toHaveLength(2);
      expect(shown.run.slots).toEqual(expect.arrayContaining([
        expect.objectContaining({ evalId: "run-journey", attemptOrdinal: 0, publication: { state: "pending" } }),
        expect.objectContaining({ evalId: "run-journey", attemptOrdinal: 1, publication: { state: "pending" } }),
      ]));
    } finally {
      await process.dispose();
      await backend.close();
    }
  });
});

test.concurrent("Attempt 原子发布后，active Run 与 portable Record 均完整可读 [necase_71RKBRSMD0ER677F]", async () => {
  await e2e.case("attempt-readable-while-active", async ({ paths, commands: { niceeval } }) => {
    const unpublishedCanary = `niceeval-unpublished-attempt-canary-${randomUUID()}`;
    const backend = await createLoopbackBackend();
    const process = niceeval.start(
      ["exp", "run-journey", "--rerun", "all", "--json"],
      {
        env: {
          NICEEVAL_RUN_JOURNEY_ENDPOINT: backend.endpoint,
        },
        timeoutMs: 90_000,
      },
    );
    try {
      await whileRunning(backend.waitForAttempt(0), process, "the first Attempt reached its backend");
      const active = await whileRunning(pollUntil(async () => {
        const receipt = await niceeval.run(["run", "list", "--json"]);
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        return receipt.runListDocument().runs.find((run) => run.state === "active" && run.coverage.expected === 2);
      }, { timeoutMs: 20_000, intervalMs: 50, label: "the active Run to be listed" }), process, "the active Run became visible");
      const beforePublicationReceipt = await niceeval.run(["run", "show", active.runId, "--json"]);
      expect(beforePublicationReceipt.exitCode, beforePublicationReceipt.diagnostic()).toBe(0);
      const beforePublication = beforePublicationReceipt.runGetDocument();
      expect(beforePublication.run).toMatchObject({
        state: "active",
        coverage: { expected: 2, published: 0, missing: 2 },
      });
      expect(beforePublication.run.slots).toEqual(expect.arrayContaining([
        expect.objectContaining({ attemptOrdinal: 0, publication: { state: "pending" } }),
        expect.objectContaining({ attemptOrdinal: 1, publication: { state: "pending" } }),
      ]));

      backend.completeAttempt(0);
      await whileRunning(backend.waitForAttempt(1), process, "the second Attempt reached its backend");
      const shown = await whileRunning(pollUntil(async () => {
        const receipt = await niceeval.run(["run", "show", active.runId, "--json"]);
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        const document = receipt.runGetDocument();
        return document.run.coverage.published === 1 ? document : undefined;
      }, { timeoutMs: 20_000, intervalMs: 50, label: "the first Attempt publication" }), process, "the first Attempt publication became visible");
      expect(shown.run).toMatchObject({ state: "active", coverage: { expected: 2, published: 1, missing: 1 } });
      const published = only(shown.run.slots, (slot) => slot.publication.state === "published", JSON.stringify(shown));
      expect(published).toMatchObject({
        evalId: "run-journey",
        attemptOrdinal: 0,
        publication: {
          state: "published",
          action: "executed",
          attemptLocator: expect.stringMatching(/^@1[0-9A-HJKMNP-TV-Z]{12}$/u),
          originRunId: active.runId,
          originSlotId: published.slotId,
        },
      });
      expect(only(shown.run.slots, (slot) => slot.publication.state === "pending", JSON.stringify(shown))).toMatchObject({
        attemptOrdinal: 1,
        publication: { state: "pending" },
      });
      if (published.publication.state !== "published") throw new Error("Expected a published slot");

      const request = join(paths.projectRoot, "published-attempt.query.json");
      await writeFile(request, `${JSON.stringify({
        protocol: "niceeval.query/v1",
        operation: { kind: "attempt.get", locator: published.publication.attemptLocator },
      })}\n`, "utf8");
      const attemptReceipt = await niceeval.run(["query", "run", "--request", request]);
      expect(attemptReceipt.exitCode, attemptReceipt.diagnostic()).toBe(0);
      expect(attemptReceipt.attempt()).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.get",
        issues: [],
        attempt: {
          locator: published.publication.attemptLocator,
          core: { outcome: "completed" },
        },
      });

      const humanAttempt = await niceeval.run(["show", published.publication.attemptLocator]);
      expect(humanAttempt.exitCode, humanAttempt.diagnostic()).toBe(0);
      expect(humanAttempt.stdout, humanAttempt.diagnostic()).toContain(published.publication.attemptLocator);
      expect(humanAttempt.stdout, humanAttempt.diagnostic()).toContain("completed");

      const humanOverview = await niceeval.run(["show"]);
      expect(humanOverview.exitCode, humanOverview.diagnostic()).toBe(0);
      expect(humanOverview.stdout, humanOverview.diagnostic()).toContain("1/2");
      expect(humanOverview.stdout, humanOverview.diagnostic()).toContain("1 passed Attempts hidden");

      backend.completeAttempt(1, `run-journey-attempt-published ${unpublishedCanary}`);
      await whileRunning(backend.waitForAssertion(1), process, "the second Attempt recorded its unpublished assertion");

      expect(process.signal("SIGINT")).toBe(true);
      const interruptedReceipt = await process.done;
      expect(interruptedReceipt.exitCode, interruptedReceipt.diagnostic()).toBe(130);
      expect(interruptedReceipt.expReceipt(), interruptedReceipt.diagnostic()).toMatchObject({
        completion: "interrupted",
        createdRunIds: [active.runId],
      });

      const canonicalRecord = join(paths.projectRoot, ".niceeval", "record.sqlite");
      const canonicalBytes = await readFile(canonicalRecord);
      expect(canonicalBytes.includes(Buffer.from(unpublishedCanary, "utf8"))).toBe(false);

      const externalRecord = join(paths.projectRoot, "finished-record.sqlite");
      await rename(canonicalRecord, externalRecord);
      const externalAttemptReceipt = await niceeval.run([
        "query",
        "run",
        "--record",
        externalRecord,
        "--request",
        request,
      ]);
      expect(externalAttemptReceipt.exitCode, externalAttemptReceipt.diagnostic()).toBe(0);
      expect(externalAttemptReceipt.attempt()).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.get",
        issues: [],
        attempt: {
          locator: published.publication.attemptLocator,
          core: { outcome: "completed" },
        },
      });
    } finally {
      await process.dispose();
      await backend.close();
    }
  });
});

test.concurrent("用户 SIGINT 中断时保留已发布 Attempt 并解释未发布 slot [necase_XAJRPPHVE3PG7TBV]", async () => {
  await e2e.case("sigint-preserves-publication", async ({ commands: { niceeval } }) => {
    const backend = await createLoopbackBackend();
    const process = niceeval.start(
      ["exp", "run-journey", "--rerun", "all", "--json"],
      { env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: backend.endpoint }, timeoutMs: 90_000 },
    );
    try {
      await whileRunning(backend.waitForAttempt(0), process, "the first Attempt reached its backend");
      const active = await whileRunning(pollUntil(async () => {
        const receipt = await niceeval.run(["run", "list", "--json"]);
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        return receipt.runListDocument().runs.find((run) => run.state === "active" && run.coverage.expected === 2);
      }, { timeoutMs: 20_000, intervalMs: 50, label: "the active Run to be listed" }), process, "the active Run became visible");
      backend.completeAttempt(0);
      await whileRunning(backend.waitForAttempt(1), process, "the second Attempt reached its backend");
      const before = await whileRunning(pollUntil(async () => {
        const receipt = await niceeval.run(["run", "show", active.runId, "--json"]);
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        const document = receipt.runGetDocument();
        return document.run.coverage.published === 1 ? document : undefined;
      }, { timeoutMs: 20_000, intervalMs: 50, label: "the first Attempt publication" }), process, "the first Attempt publication became visible");
      const published = only(before.run.slots, (slot) => slot.publication.state === "published", JSON.stringify(before));
      if (published.publication.state !== "published") throw new Error("Expected a published slot");

      expect(process.signal("SIGINT")).toBe(true);
      const interruptedReceipt = await process.done;
      expect(interruptedReceipt.exitCode, interruptedReceipt.diagnostic()).toBe(130);
      expect(interruptedReceipt.expReceipt(), interruptedReceipt.diagnostic()).toMatchObject({
        completion: "interrupted",
        createdRunIds: [active.runId],
      });
      const receipt = await niceeval.run(["run", "show", active.runId, "--json"]);
      expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
      const interrupted = receipt.runGetDocument();
      expect(interrupted.run).toMatchObject({ state: "interrupted", coverage: { expected: 2, published: 1, missing: 1 } });
      expect(only(interrupted.run.slots, (slot) => slot.publication.state === "published", JSON.stringify(interrupted))).toMatchObject({
        publication: { attemptId: published.publication.attemptId, attemptLocator: published.publication.attemptLocator },
      });
      expect(only(interrupted.run.slots, (slot) => slot.publication.state === "absent", JSON.stringify(interrupted))).toMatchObject({
        attemptOrdinal: 1,
        publication: { state: "absent", reason: "interrupted-before-publication" },
      });
    } finally {
      await process.dispose();
      await backend.close();
    }
  });
});

test.concurrent("存在引用时拒绝删除 origin，删除依赖后可安全重试 [necase_AY5TKPWYF4GQ8EDT]", async () => {
  await e2e.case("reference-safe-delete", async ({ commands: { niceeval } }) => {
    const backend = await createLoopbackBackend();
    const process = niceeval.start(
      ["exp", "run-journey", "--rerun", "all", "--json"],
      { env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: backend.endpoint }, timeoutMs: 90_000 },
    );
    try {
      await whileRunning(backend.waitForAttempt(0), process, "the first Attempt reached its backend");
      const origin = await whileRunning(pollUntil(async () => {
        const receipt = await niceeval.run(["run", "list", "--json"]);
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        return receipt.runListDocument().runs.find((run) => run.state === "active" && run.coverage.expected === 2);
      }, { timeoutMs: 20_000, intervalMs: 50, label: "the origin Run to be listed" }), process, "the origin Run became visible");
      backend.completeAttempt(0);
      await whileRunning(backend.waitForAttempt(1), process, "the second Attempt reached its backend");
      const originShown = await whileRunning(pollUntil(async () => {
        const receipt = await niceeval.run(["run", "show", origin.runId, "--json"]);
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        const document = receipt.runGetDocument();
        return document.run.coverage.published === 1 ? document : undefined;
      }, { timeoutMs: 20_000, intervalMs: 50, label: "the origin Attempt publication" }), process, "the origin Attempt publication became visible");
      const published = only(originShown.run.slots, (slot) => slot.publication.state === "published", JSON.stringify(originShown));
      if (published.publication.state !== "published") throw new Error("Expected a published slot");
      expect(process.signal("SIGINT")).toBe(true);
      const interrupted = await process.done;
      expect(interrupted.exitCode, interrupted.diagnostic()).toBe(130);

      const beforeReceipt = await niceeval.run(["run", "list", "--json"]);
      expect(beforeReceipt.exitCode, beforeReceipt.diagnostic()).toBe(0);
      const known = new Set(beforeReceipt.runListDocument().runs.map((run) => run.runId));
      const accepted = await niceeval.run(["accept", published.publication.attemptLocator]);
      expect(accepted.exitCode, accepted.diagnostic()).toBe(0);
      const afterReceipt = await niceeval.run(["run", "list", "--json"]);
      expect(afterReceipt.exitCode, afterReceipt.diagnostic()).toBe(0);
      const dependency = only(afterReceipt.runListDocument().runs, (run) => !known.has(run.runId), afterReceipt.diagnostic());
      expect(dependency).toMatchObject({ state: "completed", coverage: { expected: 1, published: 1, missing: 0 } });
      const dependencyReceipt = await niceeval.run(["run", "show", dependency.runId, "--json"]);
      expect(dependencyReceipt.exitCode, dependencyReceipt.diagnostic()).toBe(0);
      expect(only(dependencyReceipt.runGetDocument().run.slots, (slot) => slot.publication.state === "published", dependencyReceipt.diagnostic())).toMatchObject({
        publication: { state: "published", action: "accepted", attemptId: published.publication.attemptId, originRunId: origin.runId },
      });

      const refused = await niceeval.run(["run", "delete", origin.runId, "--yes", "--json"]);
      expect(refused.exitCode, refused.diagnostic()).not.toBe(0);
      expect(`${refused.stdout}\n${refused.stderr}`).toContain("run-referenced");
      expect(`${refused.stdout}\n${refused.stderr}`).toContain(dependency.runId);
      expect(`${refused.stdout}\n${refused.stderr}`).toContain(published.publication.attemptLocator);
      const retainedReceipt = await niceeval.run(["run", "list", "--json"]);
      expect(retainedReceipt.exitCode, retainedReceipt.diagnostic()).toBe(0);
      expect(retainedReceipt.runListDocument().runs.map((run) => run.runId)).toContain(origin.runId);

      const deleteDependency = await niceeval.run(["run", "delete", dependency.runId, "--yes", "--json"]);
      expect(deleteDependency.exitCode, deleteDependency.diagnostic()).toBe(0);
      const deleteOrigin = await niceeval.run(["run", "delete", origin.runId, "--yes", "--json"]);
      expect(deleteOrigin.exitCode, deleteOrigin.diagnostic()).toBe(0);
      const finalReceipt = await niceeval.run(["run", "list", "--json"]);
      expect(finalReceipt.exitCode, finalReceipt.diagnostic()).toBe(0);
      expect(finalReceipt.runListDocument().runs.map((run) => run.runId)).not.toContain(origin.runId);
    } finally {
      await process.dispose();
      await backend.close();
    }
  });
});

test.concurrent("SIGKILL 后自动沿用已发布 Attempt，只执行缺失 slot 并可显式收口旧 Run [necase_H632V0FG1N2KEBJ5]", async () => {
  await e2e.case("sigkill-recovery", async ({ commands: { niceeval } }) => {
    const backend = await createLoopbackBackend();
    const process = niceeval.start(
      ["exp", "run-journey", "--rerun", "all", "--json"],
      { env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: backend.endpoint }, timeoutMs: 90_000 },
    );
    try {
      await whileRunning(backend.waitForAttempt(0), process, "the first Attempt reached its backend");
      const active = await whileRunning(pollUntil(async () => {
        const receipt = await niceeval.run(["run", "list", "--json"]);
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        return receipt.runListDocument().runs.find((run) => run.state === "active" && run.coverage.expected === 2);
      }, { timeoutMs: 20_000, intervalMs: 50, label: "the active Run to be listed" }), process, "the active Run became visible");
      backend.completeAttempt(0);
      await whileRunning(backend.waitForAttempt(1), process, "the second Attempt reached its backend");
      const beforeKill = await whileRunning(pollUntil(async () => {
        const receipt = await niceeval.run(["run", "show", active.runId, "--json"]);
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        const document = receipt.runGetDocument();
        return document.run.coverage.published === 1 ? document : undefined;
      }, { timeoutMs: 20_000, intervalMs: 50, label: "the first Attempt publication" }), process, "the first Attempt publication became visible");
      const published = only(beforeKill.run.slots, (slot) => slot.publication.state === "published", JSON.stringify(beforeKill));
      if (published.publication.state !== "published") throw new Error("Expected a published slot");

      expect(process.signal("SIGKILL")).toBe(true);
      const killed = await process.done;
      expect(killed.signal, killed.diagnostic()).toBe("SIGKILL");
      const activeReceipt = await niceeval.run(["run", "show", active.runId, "--json"]);
      expect(activeReceipt.exitCode, activeReceipt.diagnostic()).toBe(0);
      const stillActive = activeReceipt.runGetDocument();
      expect(stillActive.run).toMatchObject({ state: "active", coverage: { expected: 2, published: 1, missing: 1 } });
      expect(only(stillActive.run.slots, (slot) => slot.publication.state === "published", JSON.stringify(stillActive))).toMatchObject({
        publication: { attemptLocator: published.publication.attemptLocator },
      });

      const recoveryPlanReceipt = await niceeval.run(["exp", "run-journey", "--dry", "--json"], {
        env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: backend.endpoint },
      });
      expect(recoveryPlanReceipt.exitCode, recoveryPlanReceipt.diagnostic()).toBe(0);
      const recoveryPlan = decodeExpPlanDocument(recoveryPlanReceipt.json());
      expect(recoveryPlan, recoveryPlanReceipt.diagnostic()).toMatchObject({ total: 2, reused: 1 });
      expect(only(recoveryPlan.matrix.flatMap((row) => row.slots), (slot) => slot.state === "reused", JSON.stringify(recoveryPlan))).toMatchObject({
        state: "reused",
      });
      const resumed = niceeval.start(
        ["exp", "run-journey", "--json"],
        { env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: backend.endpoint }, timeoutMs: 90_000 },
      );
      const dispatchedOrdinal = await whileRunning(Promise.race([
        backend.waitForAttempt(0, 2).then(() => 0 as const),
        backend.waitForAttempt(1, 2).then(() => 1 as const),
      ]), resumed, "the missing Attempt to be dispatched");
      expect(dispatchedOrdinal).toBe(1);
      backend.completeAttempt(1);
      const resumedReceipt = await resumed.done;
      expect(resumedReceipt.exitCode, resumedReceipt.diagnostic()).toBe(0);

      const resumedRunId = resumedReceipt.expReceipt().createdRunIds[0]!;
      const resumedRunReceipt = await niceeval.run(["run", "show", resumedRunId, "--json"]);
      expect(resumedRunReceipt.exitCode, resumedRunReceipt.diagnostic()).toBe(0);
      const resumedRun = resumedRunReceipt.runGetDocument();
      expect(resumedRun.run).toMatchObject({ state: "completed", coverage: { expected: 2, published: 2, missing: 0 } });
      expect(only(resumedRun.run.slots, (slot) =>
        slot.publication.state === "published" && slot.publication.action === "carried",
      JSON.stringify(resumedRun))).toMatchObject({
        attemptOrdinal: 0,
        publication: { attemptLocator: published.publication.attemptLocator, originRunId: active.runId },
      });
      expect(only(resumedRun.run.slots, (slot) =>
        slot.publication.state === "published" && slot.publication.action === "executed",
      JSON.stringify(resumedRun))).toMatchObject({ attemptOrdinal: 1 });

      const recovered = await niceeval.run(["run", "recover", active.runId, "--yes", "--json"]);
      expect(recovered.exitCode, recovered.diagnostic()).toBe(0);
      const recoveredReceipt = await niceeval.run(["run", "show", active.runId, "--json"]);
      expect(recoveredReceipt.exitCode, recoveredReceipt.diagnostic()).toBe(0);
      const recoveredRun = recoveredReceipt.runGetDocument();
      expect(recoveredRun.run).toMatchObject({ state: "interrupted", coverage: { expected: 2, published: 1, missing: 1 } });
      expect(only(recoveredRun.run.slots, (slot) => slot.publication.state === "published", JSON.stringify(recoveredRun))).toMatchObject({
        publication: { attemptLocator: published.publication.attemptLocator },
      });
      expect(only(recoveredRun.run.slots, (slot) => slot.publication.state === "absent", JSON.stringify(recoveredRun))).toMatchObject({
        publication: { state: "absent", reason: "interrupted-before-publication" },
      });

      const cleanupReference = await niceeval.run(["run", "delete", resumedRunId, "--yes", "--json"]);
      expect(cleanupReference.exitCode, cleanupReference.diagnostic()).toBe(0);
      const cleanupOrigin = await niceeval.run(["run", "delete", active.runId, "--yes", "--json"]);
      expect(cleanupOrigin.exitCode, cleanupOrigin.diagnostic()).toBe(0);
    } finally {
      await process.dispose();
      await backend.close();
    }
  });
});
