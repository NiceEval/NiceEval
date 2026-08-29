// owner: docs/engineering/testing/e2e/record.md#run-create-attempt-publication-interruption-and-lifecycle

import { writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

interface ProcessReceipt {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly diagnostic: () => string;
  readonly json: <T = unknown>() => T;
  readonly expReceipt: () => {
    readonly invocationId: string;
    readonly createdRunIds: readonly string[];
    readonly publicationCutoff: string;
    readonly completion: "completed" | "interrupted" | "failed";
  };
}

interface ProcessHandle {
  readonly done: Promise<ProcessReceipt>;
  readonly signal: (signal: NodeJS.Signals) => boolean;
}

interface NiceevalCommand {
  readonly run: (args: readonly string[]) => Promise<ProcessReceipt>;
  readonly start: (
    args: readonly string[],
    options?: { readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number },
  ) => ProcessHandle;
}

interface E2EContext {
  readonly case: <T>(
    name: string,
    options: { readonly artifacts?: readonly { readonly source: string; readonly target: string; readonly optional?: boolean }[] },
    body: (context: {
      readonly paths: { readonly projectRoot: string };
      readonly commands: { readonly niceeval: NiceevalCommand };
    }) => Promise<T>,
  ) => Promise<T>;
}

const testkitModule = "@niceeval/" + "testkit";
const { createE2EContext, pollUntil } = await import(testkitModule) as unknown as {
  readonly createE2EContext: (input: unknown) => E2EContext;
  readonly pollUntil: <T>(
    probe: () => Promise<T | undefined>,
    options: { readonly timeoutMs: number; readonly intervalMs: number; readonly label: string },
  ) => Promise<T>;
};

interface RunCoverage {
  readonly expected: number;
  readonly published: number;
  readonly missing: number;
}

interface RunSummary {
  readonly runId: string;
  readonly invocationId: string;
  readonly experimentId: string;
  readonly state: "active" | "completed" | "interrupted" | "failed";
  readonly coverage: RunCoverage;
}

interface RunListDocument {
  readonly protocol: "niceeval.run/v1";
  readonly operation: "run.list";
  readonly runs: readonly RunSummary[];
}

interface PublishedSlot {
  readonly slotId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly publication: {
    readonly state: "published";
    readonly action: "executed" | "carried" | "accepted";
    readonly attemptId: string;
    readonly attemptLocator: string;
    readonly originRunId: string;
    readonly originSlotId: string;
  };
}

interface EmptySlot {
  readonly slotId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly publication:
    | { readonly state: "pending" }
    | { readonly state: "absent"; readonly reason: string };
}

interface RunShowDocument {
  readonly protocol: "niceeval.run/v1";
  readonly operation: "run.get";
  readonly run: RunSummary & {
    readonly slots: readonly (PublishedSlot | EmptySlot)[];
  };
}

interface AttemptDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: "attempt.get";
  readonly issues: readonly unknown[];
  readonly attempt: {
    readonly locator: string;
    readonly core: { readonly outcome: string };
  };
}

interface LoopbackBackend {
  readonly endpoint: string;
  readonly waitForAttempt: (attemptIndex: number) => Promise<void>;
  readonly completeAttempt: (attemptIndex: number) => void;
  readonly close: () => Promise<void>;
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function createLoopbackBackend(): Promise<LoopbackBackend> {
  const arrivals = new Map<number, ReturnType<typeof deferred>>([
    [0, deferred()],
    [1, deferred()],
  ]);
  const responses = new Map<number, ServerResponse>();
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    request.resume();
    const match = request.method === "POST" ? /^\/attempt\/(0|1)$/u.exec(request.url ?? "") : null;
    if (match === null) {
      response.writeHead(404).end();
      return;
    }
    const attemptIndex = Number(match[1]);
    if (responses.has(attemptIndex)) {
      response.writeHead(409).end();
      return;
    }
    responses.set(attemptIndex, response);
    response.once("close", () => {
      if (responses.get(attemptIndex) === response) responses.delete(attemptIndex);
    });
    arrivals.get(attemptIndex)!.resolve();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    waitForAttempt: async (attemptIndex) => {
      const arrival = arrivals.get(attemptIndex);
      if (arrival === undefined) throw new Error(`Unexpected Attempt index ${attemptIndex}`);
      await arrival.promise;
    },
    completeAttempt: (attemptIndex) => {
      const response = responses.get(attemptIndex);
      if (response === undefined) throw new Error(`Attempt ${attemptIndex} has not reached the backend`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        status: "completed",
        events: [{ type: "message", role: "assistant", text: "run-journey-attempt-published" }],
      }));
    },
    close: async () => {
      for (const response of responses.values()) response.destroy();
      responses.clear();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
      });
    },
  };
}

const e2e = createE2EContext({
  repoId: "record",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-run-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});

function only<T>(values: readonly T[], predicate: (value: T) => boolean, diagnostic: string): T {
  const matches = values.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one matching value, received ${matches.length}.\n${diagnostic}`);
  }
  return matches[0]!;
}

async function whileRunning<T>(
  action: Promise<T>,
  process: ProcessHandle,
  label: string,
): Promise<T> {
  return await Promise.race([
    action,
    process.done.then((receipt) => {
      throw new Error(`niceeval exp exited before ${label}\n${receipt.diagnostic()}`);
    }),
  ]);
}

async function listRuns(
  niceeval: { readonly run: (args: readonly string[]) => Promise<ProcessReceipt> },
): Promise<{ readonly receipt: ProcessReceipt; readonly document: RunListDocument }> {
  const receipt = await niceeval.run(["run", "list", "--json"]);
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  const document = receipt.json<RunListDocument>();
  expect(document).toMatchObject({
    protocol: "niceeval.run/v1",
    operation: "run.list",
  });
  expect(Array.isArray(document.runs), receipt.diagnostic()).toBe(true);
  return { receipt, document };
}

async function showRun(
  niceeval: { readonly run: (args: readonly string[]) => Promise<ProcessReceipt> },
  runId: string,
): Promise<{ readonly receipt: ProcessReceipt; readonly document: RunShowDocument }> {
  const receipt = await niceeval.run(["run", "show", runId, "--json"]);
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  const document = receipt.json<RunShowDocument>();
  expect(document).toMatchObject({
    protocol: "niceeval.run/v1",
    operation: "run.get",
    run: { runId },
  });
  return { receipt, document };
}

async function inspectAttempt(
  niceeval: { readonly run: (args: readonly string[]) => Promise<ProcessReceipt> },
  projectRoot: string,
  locator: string,
): Promise<AttemptDocument> {
  const request = join(projectRoot, `attempt-${locator.slice(1)}.query.json`);
  await writeFile(request, `${JSON.stringify({
    protocol: "niceeval.query/v1",
    operation: { kind: "attempt.get", locator },
  })}\n`, "utf8");
  const receipt = await niceeval.run(["query", "run", "--request", request]);
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  return receipt.json<AttemptDocument>();
}

function publishedSlot(document: RunShowDocument): PublishedSlot {
  return only(
    document.run.slots,
    (slot) => slot.publication.state === "published",
    JSON.stringify(document),
  ) as PublishedSlot;
}

function emptySlot(document: RunShowDocument): EmptySlot {
  return only(
    document.run.slots,
    (slot) => slot.publication.state !== "published",
    JSON.stringify(document),
  ) as EmptySlot;
}

async function startBlockedRun(input: {
  readonly niceeval: NiceevalCommand;
  readonly backend: LoopbackBackend;
}): Promise<{
  readonly process: ProcessHandle;
  readonly active: RunSummary;
}> {
  const process = input.niceeval.start(
    ["exp", "run-journey", "--rerun", "all", "--json"],
    {
      env: { NICEEVAL_RUN_JOURNEY_ENDPOINT: input.backend.endpoint },
      timeoutMs: 90_000,
    },
  );

  await whileRunning(input.backend.waitForAttempt(0), process, "the first Attempt reached its backend");

  const active = await whileRunning(
    pollUntil(async () => {
      const { document } = await listRuns(input.niceeval);
      const found = document.runs.find((run) => run.state === "active");
      return found?.coverage.expected === 2 && found.coverage.published === 0
        ? found
        : undefined;
    }, {
      timeoutMs: 20_000,
      intervalMs: 50,
      label: "the created Run to be listed before any Attempt publication",
    }),
    process,
    "the created Run became visible",
  );

  expect(active).toMatchObject({
    experimentId: "run-journey",
    state: "active",
    coverage: { expected: 2, published: 0, missing: 2 },
  });
  expect(active.runId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(active.invocationId).toEqual(expect.any(String));

  const beforePublication = await showRun(input.niceeval, active.runId);
  expect(beforePublication.document.run).toMatchObject({
    state: "active",
    coverage: { expected: 2, published: 0, missing: 2 },
  });
  expect(beforePublication.document.run.slots).toHaveLength(2);
  expect(beforePublication.document.run.slots.every((slot) => slot.publication.state === "pending")).toBe(true);

  input.backend.completeAttempt(0);
  await whileRunning(input.backend.waitForAttempt(1), process, "the second Attempt reached its backend");

  return { process, active };
}

test("Run create、独立 Attempt publication、interrupt/recover 与引用安全删除形成公开 Journey", async () => {
  await e2e.case(
    "run-create-publication-lifecycle",
    {},
    async ({ paths, commands: { niceeval } }) => {
      const backends: LoopbackBackend[] = [];
      try {
        const firstBackend = await createLoopbackBackend();
        backends.push(firstBackend);
        const first = await startBlockedRun({ niceeval, backend: firstBackend });

      const active = await whileRunning(
        pollUntil(async () => {
          const shown = await showRun(niceeval, first.active.runId);
          return shown.document.run.coverage.published === 1 ? shown : undefined;
        }, {
          timeoutMs: 20_000,
          intervalMs: 50,
          label: "the first Attempt publication to become visible while its Run stayed active",
        }),
        first.process,
        "the first Attempt publication became visible",
      );
      expect(active.document.run).toMatchObject({
        state: "active",
        coverage: { expected: 2, published: 1, missing: 1 },
      });
      expect(active.document.run.slots).toHaveLength(2);
      const published = publishedSlot(active.document);
      const pending = emptySlot(active.document);
      expect(published).toMatchObject({
        evalId: "run-journey",
        attemptOrdinal: 0,
        publication: {
          state: "published",
          action: "executed",
          attemptLocator: expect.stringMatching(/^@1[0-9A-HJKMNP-TV-Z]{12}$/u),
          originRunId: first.active.runId,
          originSlotId: published.slotId,
        },
      });
      expect(pending).toMatchObject({
        evalId: "run-journey",
        attemptOrdinal: 1,
        publication: { state: "pending" },
      });

      const readableWhileActive = await inspectAttempt(
        niceeval,
        paths.projectRoot,
        published.publication.attemptLocator,
      );
      expect(readableWhileActive).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.get",
        issues: [],
        attempt: {
          locator: published.publication.attemptLocator,
          core: { outcome: "completed" },
        },
      });

      expect(first.process.signal("SIGINT")).toBe(true);
      const interruptedReceipt = await first.process.done;
      expect(interruptedReceipt.exitCode, interruptedReceipt.diagnostic()).toBe(130);
      expect(interruptedReceipt.expReceipt(), interruptedReceipt.diagnostic()).toMatchObject({
        completion: "interrupted",
        createdRunIds: [first.active.runId],
      });

      const interrupted = await showRun(niceeval, first.active.runId);
      expect(interrupted.document.run).toMatchObject({
        state: "interrupted",
        coverage: { expected: 2, published: 1, missing: 1 },
      });
      expect(publishedSlot(interrupted.document).publication).toMatchObject({
        attemptId: published.publication.attemptId,
        attemptLocator: published.publication.attemptLocator,
      });
      expect(emptySlot(interrupted.document)).toMatchObject({
        attemptOrdinal: 1,
        publication: { state: "absent", reason: "interrupted-before-publication" },
      });

      const beforeAccept = await listRuns(niceeval);
      const accepted = await niceeval.run(["accept", published.publication.attemptLocator]);
      expect(accepted.exitCode, accepted.diagnostic()).toBe(0);
      const afterAccept = await listRuns(niceeval);
      const knownRunIds = new Set(beforeAccept.document.runs.map((run) => run.runId));
      const referenceRun = only(
        afterAccept.document.runs,
        (run) => !knownRunIds.has(run.runId),
        afterAccept.receipt.diagnostic(),
      );
      expect(referenceRun).toMatchObject({
        state: "completed",
        coverage: { expected: 1, published: 1, missing: 0 },
      });
      const reference = publishedSlot((await showRun(niceeval, referenceRun.runId)).document);
      expect(reference).toMatchObject({
        publication: {
          state: "published",
          action: "accepted",
          attemptId: published.publication.attemptId,
          attemptLocator: published.publication.attemptLocator,
          originRunId: first.active.runId,
          originSlotId: published.slotId,
        },
      });

      const refused = await niceeval.run(["run", "delete", first.active.runId, "--yes", "--json"]);
      expect(refused.exitCode, refused.diagnostic()).not.toBe(0);
      expect(`${refused.stdout}\n${refused.stderr}`).toContain("run-referenced");
      expect(`${refused.stdout}\n${refused.stderr}`).toContain(referenceRun.runId);
      expect(`${refused.stdout}\n${refused.stderr}`).toContain(published.publication.attemptLocator);
      expect((await listRuns(niceeval)).document.runs.map((run) => run.runId)).toContain(first.active.runId);

      const deleteReference = await niceeval.run(["run", "delete", referenceRun.runId, "--yes", "--json"]);
      expect(deleteReference.exitCode, deleteReference.diagnostic()).toBe(0);
      const deleteOrigin = await niceeval.run(["run", "delete", first.active.runId, "--yes", "--json"]);
      expect(deleteOrigin.exitCode, deleteOrigin.diagnostic()).toBe(0);
      expect((await listRuns(niceeval)).document.runs.map((run) => run.runId)).not.toContain(first.active.runId);

        const crashedBackend = await createLoopbackBackend();
        backends.push(crashedBackend);
        const crashed = await startBlockedRun({ niceeval, backend: crashedBackend });
      const beforeCrash = await whileRunning(
        pollUntil(async () => {
          const shown = await showRun(niceeval, crashed.active.runId);
          return shown.document.run.coverage.published === 1 ? shown : undefined;
        }, {
          timeoutMs: 20_000,
          intervalMs: 50,
          label: "the recover scenario's first Attempt publication",
        }),
        crashed.process,
        "the recover scenario's first Attempt publication became visible",
      );
      const publishedBeforeCrash = publishedSlot(beforeCrash.document);
      expect(crashed.process.signal("SIGKILL")).toBe(true);
      const killed = await crashed.process.done;
      expect(killed.signal, killed.diagnostic()).toBe("SIGKILL");

      const stillActive = await showRun(niceeval, crashed.active.runId);
      expect(stillActive.document.run).toMatchObject({
        state: "active",
        coverage: { expected: 2, published: 1, missing: 1 },
      });
      expect(publishedSlot(stillActive.document).publication.attemptLocator).toBe(publishedBeforeCrash.publication.attemptLocator);

      const recovered = await niceeval.run(["run", "recover", crashed.active.runId, "--yes", "--json"]);
      expect(recovered.exitCode, recovered.diagnostic()).toBe(0);
      const recoveredRun = await showRun(niceeval, crashed.active.runId);
      expect(recoveredRun.document.run).toMatchObject({
        state: "interrupted",
        coverage: { expected: 2, published: 1, missing: 1 },
      });
      expect(publishedSlot(recoveredRun.document).publication.attemptLocator).toBe(publishedBeforeCrash.publication.attemptLocator);
      expect(emptySlot(recoveredRun.document)).toMatchObject({
        publication: { state: "absent", reason: "interrupted-before-publication" },
      });

      const deleteRecovered = await niceeval.run(["run", "delete", crashed.active.runId, "--yes", "--json"]);
      expect(deleteRecovered.exitCode, deleteRecovered.diagnostic()).toBe(0);
        expect((await listRuns(niceeval)).document.runs).toEqual([]);
      } finally {
        await Promise.all(backends.map((backend) => backend.close()));
      }
    },
  );
});
