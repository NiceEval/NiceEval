import { Effect, Layer } from "effect";
import { createRequire } from "node:module";
import { RunDeleteError, RunReadError, RunRecoverError, runHost } from "niceeval/run/host";

const [operation, activeCwd, activeRunId, terminalCwd, terminalRunId] = process.argv.slice(2);

if (operation === undefined || activeCwd === undefined || activeRunId === undefined || terminalCwd === undefined || terminalRunId === undefined) {
  throw new Error("Expected operation, active cwd/runId, and terminal cwd/runId.");
}

function expectTaggedFailure(value: unknown, tag: string, code: string): void {
  if (typeof value !== "object" || value === null || !("_tag" in value) || !("code" in value) ||
    value._tag !== tag || value.code !== code) {
    throw new Error(`Expected ${tag} ${code}.`);
  }
}

const missingRunId = "00000000-0000-4000-8000-000000000000";
const consumerLayer = Layer.empty;
const commonjsHost = createRequire(import.meta.url)("niceeval/run/host") as typeof import("niceeval/run/host");

if (!Object.isFrozen(runHost) || commonjsHost.runHost !== runHost ||
  commonjsHost.RunReadError !== RunReadError || commonjsHost.RunDeleteError !== RunDeleteError ||
  commonjsHost.RunRecoverError !== RunRecoverError) {
  throw new Error("ESM and CommonJS Run Host exports must share one frozen public identity.");
}

if (operation === "journey") {
  await Effect.runPromise(Effect.gen(function* () {
    const activeList = yield* runHost.list({ cwd: activeCwd });
    if (!activeList.runs.some((run) => run.runId === activeRunId)) {
      throw new Error("Active project list did not include its Run.");
    }
    const activeRun = yield* runHost.get({ cwd: activeCwd, runId: activeRunId });
    if (activeRun.run.runId !== activeRunId) throw new Error("Active project get returned another Run.");

    const activeDelete = yield* runHost.delete({ cwd: activeCwd, runId: activeRunId }).pipe(
      Effect.catchTag("RunDeleteError", (failure) => Effect.succeed(failure)),
    );
    expectTaggedFailure(activeDelete, "RunDeleteError", "run-active");

    const terminalList = yield* runHost.list({ cwd: terminalCwd });
    if (!terminalList.runs.some((run) => run.runId === terminalRunId)) {
      throw new Error("Terminal project list did not include its Run.");
    }
    const terminalRun = yield* runHost.get({ cwd: terminalCwd, runId: terminalRunId });
    if (terminalRun.run.runId !== terminalRunId) throw new Error("Terminal project get returned another Run.");

    const [concurrentActive, concurrentTerminal] = yield* Effect.all([
      runHost.get({ cwd: activeCwd, runId: activeRunId }),
      runHost.get({ cwd: terminalCwd, runId: terminalRunId }),
    ], { concurrency: "unbounded" });
    if (concurrentActive.run.runId !== activeRunId || concurrentTerminal.run.runId !== terminalRunId) {
      throw new Error("Concurrent cross-project reads crossed Run identities.");
    }

    const activeRecovery = yield* runHost.recover({ cwd: activeCwd, runId: activeRunId }).pipe(
      Effect.catchTag("RunRecoverError", (failure) => Effect.succeed(failure)),
    );
    expectTaggedFailure(activeRecovery, "RunRecoverError", "run-owner-active");

    const missingRead = yield* runHost.get({ cwd: terminalCwd, runId: missingRunId }).pipe(
      Effect.catchTag("RunReadError", (failure) => Effect.succeed(failure)),
    );
    expectTaggedFailure(missingRead, "RunReadError", "run-not-found");

    const invalidContinuation = yield* runHost.list({ cwd: terminalCwd, continuation: "not-a-continuation" }).pipe(
      Effect.catchTag("RunReadError", (failure) => Effect.succeed(failure)),
    );
    expectTaggedFailure(invalidContinuation, "RunReadError", "run-continuation-invalid");

    const missingDelete = yield* runHost.delete({ cwd: terminalCwd, runId: missingRunId }).pipe(
      Effect.catchTag("RunDeleteError", (failure) => Effect.succeed(failure)),
    );
    expectTaggedFailure(missingDelete, "RunDeleteError", "run-not-found");

    const missingRecovery = yield* runHost.recover({ cwd: terminalCwd, runId: missingRunId }).pipe(
      Effect.catchTag("RunRecoverError", (failure) => Effect.succeed(failure)),
    );
    expectTaggedFailure(missingRecovery, "RunRecoverError", "run-not-found");

    const terminalRecovery = yield* runHost.recover({ cwd: terminalCwd, runId: terminalRunId }).pipe(
      Effect.catchTag("RunRecoverError", (failure) => Effect.succeed(failure)),
    );
    expectTaggedFailure(terminalRecovery, "RunRecoverError", "run-terminal");
  }).pipe(Effect.provide(consumerLayer)));
} else if (operation === "recover-delete-active") {
  await Effect.runPromise(Effect.gen(function* () {
    yield* runHost.recover({ cwd: activeCwd, runId: activeRunId });
    const listBeforeDelete = runHost.list({ cwd: activeCwd });
    yield* runHost.delete({ cwd: activeCwd, runId: activeRunId });
    const listAfterDelete = yield* listBeforeDelete;
    if (listAfterDelete.runs.some((run) => run.runId === activeRunId)) {
      throw new Error("A preconstructed Run list observed stale state after delete.");
    }
  }).pipe(Effect.provide(consumerLayer)));
} else {
  throw new Error(`Unknown operation ${JSON.stringify(operation)}.`);
}
