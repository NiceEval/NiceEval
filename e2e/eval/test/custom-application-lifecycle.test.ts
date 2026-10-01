// rerun: pnpm e2e test --repo eval -- --run test/custom-application-lifecycle.test.ts

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { command, only } from "@niceeval/testkit";
import { defineAdapter } from "niceeval/adapter";
import { expect, test } from "vitest";
import { customLifecycleJournal } from "../fixtures/custom-applications.ts";
import { evalE2E } from "./context.ts";
import { inspectAttempt } from "./inspection.ts";

type JournalEntry = Readonly<{
  scenario: string;
  event: string;
  attempt: number;
}>;

async function journalEntries(projectRoot: string): Promise<readonly JournalEntry[]> {
  const text = await readFile(join(projectRoot, customLifecycleJournal), "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as JournalEntry);
}

// @use-case docs/feature/eval/use-case/eval-native-operations.md
// @regression memory/experiment-host-private-requirements.md

test.concurrent("Adapter 创建部分失败与 Attempt 取消均清理资源且拒绝迟到 Assertion", async () => {
  for (const cleanupTimeoutMs of [0, -1, 0.5, 300_001, NaN, Infinity]) {
    expect(() => defineAdapter({
      name: "invalid-cleanup-budget", cleanupTimeoutMs, create: () => ({}),
    })).toThrow(TypeError);
  }
  await evalE2E.case(
    "custom-application-lifecycle",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths: { projectRoot }, commands: { niceeval, tsc } }) => {
      // This is an ordinary installed SDK consumer process. Effect is run only
      // at its application boundary, with no private services or caller signal.
      await writeFile(join(projectRoot, "custom-host-consumer.ts"), `
        import assert from "node:assert/strict";
        import { readFile } from "node:fs/promises";
        import { connect } from "node:net";
        import { pollUntil } from "@niceeval/testkit";
        import { Cause, Effect, Exit, Fiber } from "effect";
        import {
          experimentHost, type ExperimentHostError, type ExperimentHostInvocationPlanResult,
          type ExperimentHostInvocationResult, type ExperimentHostInvocationRunRequest,
        } from "niceeval/experiment/host";

        const mode = process.argv[2];
        assert.ok(mode === "success" || mode === "interruption");
        const selection = {
          cwd: process.cwd(), experimentSelector: "custom-host-" + mode,
          config: { timeoutMs: 60_000, maxConcurrency: 1 }, overrides: { rerun: "all" as const },
        };
        // These explicit assignments also prove the public requirement is never.
        const planning: Effect.Effect<ExperimentHostInvocationPlanResult, ExperimentHostError> =
          experimentHost.invocation.plan(selection);
        const planned = await Effect.runPromise(planning);
        assert.equal(planned.status, "ready");
        if (planned.status !== "ready") throw new Error("Host did not produce a ready plan");
        assert.deepEqual(planned.experimentIds, ["custom-host-" + mode]);
        const request: ExperimentHostInvocationRunRequest = { plan: planned.plan };
        assert.equal(Object.hasOwn(request, "signal"), false);
        const running: Effect.Effect<ExperimentHostInvocationResult, ExperimentHostError> =
          experimentHost.invocation.run(request);

        if (mode === "success") {
          const result = await Effect.runPromise(running);
          assert.equal(result.status, "finished");
          assert.equal(result.receipt.completion, "completed");
          assert.equal(result.receipt.createdRunIds.length, 1);
          assert.equal(result.summary.total, 1);
          assert.equal(result.summary.passed, 1);
          assert.equal(result.summary.errored, 0);
        } else {
          const fiber = Effect.runFork(running);
          try {
            await pollUntil(async () => {
              const exit = fiber.pollUnsafe();
              if (exit !== undefined) throw new Error("Host exited before Adapter entry: " +
                (Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "succeeded"));
              try {
                return (await readFile("host-interruption.entered", "utf8")) === "ready" ? true : undefined;
              } catch { return undefined; }
            }, { timeoutMs: 10_000, intervalMs: 10, label: "actual Adapter test entry" });
            const port = Number(await readFile("host-interruption.port", "utf8"));
            const marker = await new Promise<string>((resolve, reject) => {
              const socket = connect({ host: "127.0.0.1", port });
              let response = "";
              socket.setEncoding("utf8");
              socket.on("data", (chunk: string) => { response += chunk; });
              socket.once("error", reject);
              socket.once("end", () => resolve(response));
            });
            assert.equal(marker, "host-resource\\n");
            // The number is the public Effect interruptor identity, independent
            // of Adapter reason. No AbortController participates in this call.
            await Effect.runPromise(Fiber.interruptAs(fiber, 73421));
            const exit = await Effect.runPromise(Fiber.await(fiber));
            assert.ok(Exit.isFailure(exit), "interruption must remain a failed Exit");
            if (!Exit.isFailure(exit)) throw new Error("Host swallowed interruption");
            assert.ok(Exit.hasInterrupts(exit));
            assert.equal(Exit.hasFails(exit), false, "interruption must not become a typed Host error");
            assert.equal(Exit.hasDies(exit), false, "cleanup must not replace interruption with a defect");
            assert.ok(Cause.interruptors(exit.cause).has(73421), "original interruptor Cause was lost");
          } finally {
            await Effect.runPromise(Fiber.interrupt(fiber));
          }
        }

        // The callback can finish immediately after the cleanup deadline race.
        // Wait for its external release evidence before testing the real port.
        await pollUntil(async () => {
          const journal = await readFile("custom-lifecycle.journal.jsonl", "utf8");
          return journal.includes('"scenario":"host-' + mode + '","event":"released"') ? true : undefined;
        }, { timeoutMs: 5_000, intervalMs: 10, label: "Adapter resource release" });
        const port = Number(await readFile("host-" + mode + ".port", "utf8"));
        assert.ok(Number.isInteger(port) && port > 0);
        await assert.rejects(new Promise<void>((resolve, reject) => {
          const socket = connect({ host: "127.0.0.1", port });
          socket.once("error", reject);
          socket.once("connect", () => { socket.destroy(); resolve(); });
        }), { code: "ECONNREFUSED" });
        for (let read = 0; read < 2; read += 1) {
          const catalog = await Effect.runPromise(experimentHost.catalog(selection));
          assert.equal(catalog.status, "listed");
          const sessions = await Effect.runPromise(experimentHost.invocationStatus.list({ cwd: process.cwd(), all: true }));
          assert.equal(sessions.sessions.some((session) => session.status === "active"), false);
        }
        // Natural process exit proves these completed operations leave no live
        // listener or database worker. The parent owns the bounded process wait.
      `);
      for (const mode of ["success", "interruption", "success"]) {
        const host = await command([process.execPath]).run(["custom-host-consumer.ts", mode], {
          cwd: projectRoot, timeoutMs: 30_000,
        });
        expect(host.timedOut, host.diagnostic()).toBe(false);
        expect(host.exitCode, host.diagnostic()).toBe(0);
      }
      const hostJournal = await journalEntries(projectRoot);
      expect(hostJournal.filter(({ scenario }) => scenario === "host-success")).toEqual([
        ...Array.from({ length: 2 }, () => [
          { scenario: "host-success", event: "acquired", attempt: 0 },
          { scenario: "host-success", event: "test-entered", attempt: 0 },
          { scenario: "host-success", event: "cleanup-independent-live-frozen", attempt: 0 },
          { scenario: "host-success", event: "released", attempt: 0 },
        ]).flat(),
      ]);
      expect(hostJournal.filter(({ scenario }) => scenario === "host-interruption")).toEqual([
        { scenario: "host-interruption", event: "acquired", attempt: 0 },
        { scenario: "host-interruption", event: "test-entered", attempt: 0 },
        { scenario: "host-interruption", event: "typed-attempt-cancelled", attempt: 0 },
        { scenario: "host-interruption", event: "abort-assertion-rejected", attempt: 0 },
        { scenario: "host-interruption", event: "cleanup-independent-live-frozen", attempt: 0 },
        { scenario: "host-interruption", event: "late-assertion-rejected", attempt: 0 },
        { scenario: "host-interruption", event: "cleanup-window-aborted", attempt: 0 },
        { scenario: "host-interruption", event: "released", attempt: 0 },
      ]);
      const hostTypes = await tsc.run([
        "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext",
        "--skipLibCheck", "--types", "node", "custom-host-consumer.ts",
      ]);
      expect(hostTypes.exitCode, hostTypes.diagnostic()).toBe(0);

      const createFailure = await niceeval.run([
        "exp", "custom-create-failure", "--rerun", "all", "--json",
      ]);
      expect(createFailure.exitCode, createFailure.diagnostic()).toBe(1);
      expect(createFailure.expReceipt(), createFailure.diagnostic()).toMatchObject({ completion: "completed" });
      const failedCreate = only(
        createFailure.expEvalEvents(),
        (event) => event.experimentId === "custom-create-failure" &&
          event.evalId === "custom-create-failure",
        createFailure.diagnostic(),
      );
      expect(failedCreate).toMatchObject({
        verdict: "errored",
        attempts: 1,
        passed: 0,
        locator: expect.any(String),
      });
      const afterCreateFailure = await journalEntries(projectRoot);
      expect(afterCreateFailure.filter(({ scenario }) => scenario === "create-failure")).toEqual([
        { scenario: "create-failure", event: "acquired", attempt: 0 },
        { scenario: "create-failure", event: "cleanup-inner-live-frozen", attempt: 0 },
        { scenario: "create-failure", event: "cleanup-outer-shared-live-frozen", attempt: 0 },
      ]);

      const lateCreate = await niceeval.run(["exp", "custom-late-cleanup", "--rerun", "all", "--json"]);
      expect(lateCreate.exitCode, lateCreate.diagnostic()).toBe(1);
      expect((await journalEntries(projectRoot)).filter(({ scenario }) => scenario === "late-create")).toEqual([
        { scenario: "late-create", event: "released", attempt: 0 },
        { scenario: "late-create", event: "create-settled", attempt: 0 },
      ]);

      const cancelled = await niceeval.run([
        "exp", "custom-timeout-cancel", "--rerun", "all", "--json",
      ]);
      expect(cancelled.exitCode, cancelled.diagnostic()).toBe(1);
      expect(cancelled.expReceipt(), cancelled.diagnostic()).toMatchObject({ completion: "completed" });
      const cancelledEvaluation = only(
        cancelled.expEvalEvents(),
        (event) => event.experimentId === "custom-timeout-cancel" &&
          event.evalId === "custom-timeout-cancel",
        cancelled.diagnostic(),
      );
      expect(cancelledEvaluation).toMatchObject({
        verdict: "errored",
        attempts: 1,
        passed: 0,
        locator: expect.any(String),
      });
      const locator = cancelledEvaluation.locator;
      if (locator === undefined) throw new Error("cancelled custom Attempt was not published");
      const attempt = await inspectAttempt(niceeval, projectRoot, locator, "attempt.get");
      expect(attempt.receipt.exitCode, attempt.receipt.diagnostic()).toBe(0);
      expect(attempt.document.attempt).toMatchObject({
        core: { outcome: "errored" },
        assertions: { state: "available" },
      });
      expect(attempt.document.attempt.assertions.entries.map(({ display }) => display.label)).toEqual([
        "取消前登记的 Assertion",
      ]);
      const timeoutTrace = await inspectAttempt(niceeval, projectRoot, locator, "attempt.trace");
      expect(timeoutTrace.receipt.exitCode, timeoutTrace.receipt.diagnostic()).toBe(0);
      const timeoutDiagnostics = timeoutTrace.document.trace.diagnostics.items;
      expect(timeoutDiagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
        "timeout",
        "adapter-cleanup-timeout",
      ]));
      expect(only(
        timeoutDiagnostics,
        ({ code }) => code === "timeout",
        timeoutTrace.receipt.diagnostic(),
      ).summary).toContain("attempt timed out (500ms, from experiment)");
      expect(timeoutDiagnostics.map(({ code }) => code)).not.toContain("unexpected-error");

      const afterCancellation = await journalEntries(projectRoot);
      expect(afterCancellation.filter(({ scenario }) => scenario === "timeout")).toEqual([
        { scenario: "timeout", event: "acquired", attempt: 0 },
        { scenario: "timeout", event: "typed-attempt-timeout", attempt: 0 },
        { scenario: "timeout", event: "abort-check-rejected", attempt: 0 },
        { scenario: "timeout", event: "abort-handle-rejected", attempt: 0 },
        { scenario: "timeout", event: "abort-method-rejected", attempt: 0 },
        { scenario: "timeout", event: "abort-assertion-method-rejected", attempt: 0 },
        { scenario: "timeout", event: "cleanup-inner-attempt-aborted-window-live-frozen", attempt: 0 },
        { scenario: "timeout", event: "cleanup-outer-shared-live-frozen", attempt: 0 },
        { scenario: "timeout", event: "late-assertion-rejected", attempt: 0 },
        { scenario: "timeout", event: "cleanup-window-aborted", attempt: 0 },
        { scenario: "timeout", event: "closed-registration-rejected", attempt: 0 },
      ]);

      const succeeded = await niceeval.run([
        "exp", "custom-success-cleanup", "--rerun", "all", "--json",
      ]);
      expect(succeeded.exitCode, succeeded.diagnostic()).toBe(0);
      const successfulEvaluation = only(succeeded.expEvalEvents(), (event) => event.evalId === "custom-success-cleanup", succeeded.diagnostic());
      expect(successfulEvaluation).toMatchObject({ verdict: "passed", attempts: 1, passed: 1 });
      expect((await journalEntries(projectRoot)).filter(({ scenario }) => scenario === "success")).toEqual([
        { scenario: "success", event: "cleanup-live-frozen", attempt: 0 },
        { scenario: "success", event: "cleanup-finished", attempt: 0 },
      ]);
      if (successfulEvaluation.locator === undefined) throw new Error("successful Adapter did not expose its locator");
      const successfulTrace = await inspectAttempt(niceeval, projectRoot, successfulEvaluation.locator, "attempt.trace");
      expect(successfulTrace.receipt.exitCode, successfulTrace.receipt.diagnostic()).toBe(0);
      expect(successfulTrace.document.trace.diagnostics.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "adapter-cleanup-failed" }),
      ]));
    },
  );
});
