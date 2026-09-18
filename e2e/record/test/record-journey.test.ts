
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

// @feature docs/feature/run/README.md
// @regression memory/active-run-inspection-lifecycle.md

test.concurrent("运行创建后立即可发现，并冻结完整 expected slots", async () => {
  await e2e.case("run-create-discovery", async ({ paths, commands: { niceeval } }) => {
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

      const request = join(paths.projectRoot, "created-run.query.json");
      await writeFile(request, `${JSON.stringify({
        protocol: "niceeval.query/v1",
        operation: { kind: "run.get", runId: active.runId },
      })}\n`, "utf8");
      const queriedReceipt = await niceeval.run(["query", "run", "--request", request]);
      expect(queriedReceipt.exitCode, queriedReceipt.diagnostic()).toBe(0);
      const queried = queriedReceipt.querySuccess("run.get");
      expect(queried.run.value).toMatchObject({
        runId: active.runId,
        experimentId: "run-journey",
        state: "active",
      });
      expect(queried.run.value).not.toHaveProperty("completedAt");
      expect(queried.run.value).not.toHaveProperty("context");
      expect(queried.run.value.expectedSlots).toHaveLength(2);
      expect(queried.run.members).toEqual([]);

      const human = await niceeval.run(["show", "--run", active.runId]);
      expect(human.exitCode, human.diagnostic()).toBe(0);
      expect(human.stdout, human.diagnostic()).toContain(`Run ${active.runId}`);
      expect(human.stdout, human.diagnostic()).toMatch(/State\s+active/u);
      expect(human.stdout, human.diagnostic()).toContain("0/2 attempts observed");
      expect(human.stdout, human.diagnostic()).toContain("pending");
      expect(human.stdout, human.diagnostic()).not.toContain("Completed");

      expect(process.signal("SIGINT")).toBe(true);
      const interruptedReceipt = await process.done;
      expect(interruptedReceipt.exitCode, interruptedReceipt.diagnostic()).toBe(130);

      const terminalReceipt = await niceeval.run(["query", "run", "--request", request]);
      expect(terminalReceipt.exitCode, terminalReceipt.diagnostic()).toBe(0);
      const terminal = terminalReceipt.querySuccess("run.get");
      expect(terminal.source.sealedCutoffIdentity).not.toBe(queried.source.sealedCutoffIdentity);
      expect(terminal.run.value).toMatchObject({
        runId: active.runId,
        state: "interrupted",
        completedAt: expect.any(Number),
      });
      expect(terminal.run.value).not.toHaveProperty("context");
      expect(terminal.run.attempts).toEqual([]);
      expect(terminal.run.members).toHaveLength(2);
      expect(terminal.run.members).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "interrupted", attempt: null }),
      ]));

      const terminalHuman = await niceeval.run(["show", "--run", active.runId]);
      expect(terminalHuman.exitCode, terminalHuman.diagnostic()).toBe(0);
      expect(terminalHuman.stdout, terminalHuman.diagnostic()).toMatch(/State\s+interrupted/u);
      expect(terminalHuman.stdout, terminalHuman.diagnostic()).toContain("Completed");
    } finally {
      await process.dispose();
      await backend.close();
    }
  });
});

// @feature docs/feature/run/README.md
// @regression memory/active-run-inspection-lifecycle.md

test.concurrent("Attempt 原子发布后，active Run 与 portable Record 均完整可读", async () => {
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

      const activeRunRequest = join(paths.projectRoot, "active-run.query.json");
      await writeFile(activeRunRequest, `${JSON.stringify({
        protocol: "niceeval.query/v1",
        operation: { kind: "run.get", runId: active.runId },
      })}\n`, "utf8");
      const activeRunReceipt = await niceeval.run(["query", "run", "--request", activeRunRequest]);
      expect(activeRunReceipt.exitCode, activeRunReceipt.diagnostic()).toBe(0);
      const activeRun = activeRunReceipt.querySuccess("run.get");
      expect(activeRun.run.value).toMatchObject({
        runId: active.runId,
        experimentId: "run-journey",
        state: "active",
      });
      expect(activeRun.run.value).not.toHaveProperty("completedAt");
      expect(activeRun.run.value).toHaveProperty("context");
      expect(activeRun.run.members).toEqual([
        expect.objectContaining({
          slotId: published.slotId,
          action: "executed",
          attempt: expect.objectContaining({ originRunId: active.runId }),
        }),
      ]);
      expect(activeRun.run.attempts).toHaveLength(1);
      const pendingSlots = activeRun.run.value.expectedSlots.filter((slot) =>
        !activeRun.run.members.some((member) => member.slotId === slot.slotId)
      );
      expect(pendingSlots).toEqual([
        expect.objectContaining({ attemptOrdinal: 1 }),
      ]);

      const activeHumanRun = await niceeval.run(["show", "--run", active.runId]);
      expect(activeHumanRun.exitCode, activeHumanRun.diagnostic()).toBe(0);
      expect(activeHumanRun.stdout, activeHumanRun.diagnostic()).toContain(`Run ${active.runId}`);
      expect(activeHumanRun.stdout, activeHumanRun.diagnostic()).toMatch(/State\s+active/u);
      expect(activeHumanRun.stdout, activeHumanRun.diagnostic()).toContain("1/2 attempts observed");
      expect(activeHumanRun.stdout, activeHumanRun.diagnostic()).toContain("pending");
      expect(activeHumanRun.stdout, activeHumanRun.diagnostic()).not.toContain("Completed");

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

      const terminalRunReceipt = await niceeval.run(["query", "run", "--request", activeRunRequest]);
      expect(terminalRunReceipt.exitCode, terminalRunReceipt.diagnostic()).toBe(0);
      const terminalRun = terminalRunReceipt.querySuccess("run.get");
      expect(terminalRun.source.sealedCutoffIdentity).not.toBe(activeRun.source.sealedCutoffIdentity);
      expect(terminalRun.run.value).toMatchObject({
        runId: active.runId,
        experimentId: "run-journey",
        state: "interrupted",
        completedAt: expect.any(Number),
      });
      expect(terminalRun.run.value).toHaveProperty("context");
      expect(terminalRun.run.members).toEqual(expect.arrayContaining([
        expect.objectContaining({ slotId: published.slotId, action: "executed" }),
        expect.objectContaining({ action: "interrupted", attempt: null }),
      ]));

      const terminalHumanRun = await niceeval.run(["show", "--run", active.runId]);
      expect(terminalHumanRun.exitCode, terminalHumanRun.diagnostic()).toBe(0);
      expect(terminalHumanRun.stdout, terminalHumanRun.diagnostic()).toContain(`Run ${active.runId}`);
      expect(terminalHumanRun.stdout, terminalHumanRun.diagnostic()).toMatch(/State\s+interrupted/u);
      expect(terminalHumanRun.stdout, terminalHumanRun.diagnostic()).toContain("Completed");
      expect(terminalHumanRun.stdout, terminalHumanRun.diagnostic()).toContain("interrupted");

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

// @feature docs/feature/run/README.md

test.concurrent("用户 SIGINT 中断时保留已发布 Attempt 并解释未发布 slot", async () => {
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

// @feature docs/feature/run/README.md

test.concurrent("存在引用时拒绝删除 origin，删除依赖后可安全重试", async () => {
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

// @feature docs/feature/run/README.md
// @regression memory/active-attempt-publication-omitted-from-reuse.md
// @regression memory/run-recovery-absence-required-member.md

test.concurrent("SIGKILL 后自动沿用已发布 Attempt，只执行缺失 slot 并可显式收口旧 Run", async () => {
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

      const recoveredPlanReceipt = await niceeval.run(["exp", "run-journey", "--dry", "--json"], {
        env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: backend.endpoint },
      });
      expect(recoveredPlanReceipt.exitCode, recoveredPlanReceipt.diagnostic()).toBe(0);
      expect(decodeExpPlanDocument(recoveredPlanReceipt.json()), recoveredPlanReceipt.diagnostic()).toMatchObject({
        total: 2,
        reused: 2,
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

// @feature docs/feature/run/README.md
// @regression memory/public-run-host-requires-internal-database-service.md
// @regression memory/run-lifecycle-errors-thrown-as-effect-defects.md
// @regression memory/run-read-errors-thrown-as-effect-defects.md

test.concurrent("独立 Host consumer 可组合 Run 生命周期操作并捕获预期读取错误", async () => {
  await e2e.case("public-run-host-consumer", async ({ paths, commands: { niceeval }, run }) => {
    const compiled = await run([
      join(paths.projectRoot, "node_modules", ".bin", "tsc6"),
      "--project",
      "fixtures/public-run-host-consumer/tsconfig.json",
      "--outDir",
      ".e2e-run-host-consumer",
    ], { timeoutMs: 60_000 });
    expect(compiled.exitCode, compiled.diagnostic()).toBe(0);

    const consumer = (operation: string, activeCwd: string, activeRunId: string, terminalCwd: string, terminalRunId: string) => run([
      globalThis.process.execPath,
      ".e2e-run-host-consumer/public-run-host-consumer.mjs",
      operation,
      activeCwd,
      activeRunId,
      terminalCwd,
      terminalRunId,
    ], { timeoutMs: 30_000 });
    const backend = await createLoopbackBackend();
    const process = niceeval.start(
      ["exp", "run-journey", "--rerun", "all", "--json"],
      { env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: backend.endpoint }, timeoutMs: 90_000 },
    );
    try {
      await whileRunning(backend.waitForAttempt(0), process, "the first Attempt reached its backend");
      const activeRun = await niceeval.run(["run", "list", "--json"]);
      expect(activeRun.exitCode, activeRun.diagnostic()).toBe(0);
      const active = only(activeRun.runListDocument().runs, (run) => run.state === "active" && run.coverage.expected === 2, activeRun.diagnostic());

      await e2e.case("public-run-host-terminal-project", async ({ paths: terminalPaths, commands: { niceeval: terminalNiceeval } }) => {
        const terminalBackend = await createLoopbackBackend();
        const terminalProcess = terminalNiceeval.start(
          ["exp", "run-journey", "--rerun", "all", "--json"],
          { env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: terminalBackend.endpoint }, timeoutMs: 90_000 },
        );
        try {
          await whileRunning(terminalBackend.waitForAttempt(0), terminalProcess, "the terminal project's first Attempt reached its backend");
          terminalBackend.completeAttempt(0);
          await whileRunning(terminalBackend.waitForAttempt(1), terminalProcess, "the terminal project's second Attempt reached its backend");
          terminalBackend.completeAttempt(1);
          const terminalReceipt = await terminalProcess.done;
          expect(terminalReceipt.exitCode, terminalReceipt.diagnostic()).toBe(0);
          const terminalRunId = terminalReceipt.expReceipt().createdRunIds[0]!;

          const journey = await consumer("journey", paths.projectRoot, active.runId, terminalPaths.projectRoot, terminalRunId);
          expect(journey.exitCode, journey.diagnostic()).toBe(0);
        } finally {
          await terminalProcess.dispose();
          await terminalBackend.close();
        }
      });

      expect(process.signal("SIGKILL")).toBe(true);
      const killed = await process.done;
      expect(killed.signal, killed.diagnostic()).toBe("SIGKILL");

      const recoveredAndDeleted = await consumer("recover-delete-active", paths.projectRoot, active.runId, paths.projectRoot, active.runId);
      expect(recoveredAndDeleted.exitCode, recoveredAndDeleted.diagnostic()).toBe(0);
    } finally {
      await process.dispose();
      await backend.close();
    }
  });
});
