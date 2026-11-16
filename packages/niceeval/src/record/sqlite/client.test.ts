// cases: docs/engineering/testing/architecture/unit/record.md
import { beforeEach, describe, expect, it, vi } from "vitest";

const workerHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    readonly messages: unknown[];
    terminated: number;
    emit: (event: string, value: unknown) => void;
  }>,
  respond: (_message: Record<string, unknown>, _worker: { emit: (event: string, value: unknown) => void }): void =>
    undefined,
}));

vi.mock("node:worker_threads", () => ({
  Worker: class {
    readonly messages: unknown[] = [];
    terminated = 0;
    readonly listeners = new Map<string, Array<(value: unknown) => void>>();

    constructor() {
      workerHarness.instances.push(this);
    }

    on(event: string, listener: (value: unknown) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, value: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener(value);
    }

    postMessage(message: Record<string, unknown>): void {
      this.messages.push(message);
      queueMicrotask(() => workerHarness.respond(message, this));
    }

    terminate(): Promise<number> {
      this.terminated += 1;
      return Promise.resolve(0);
    }
  },
}));

import { SqliteRecordError } from "./errors.ts";
import { makeStorageWorkerClient } from "./client.ts";
import { RunStorageError } from "../../run/storage/errors.ts";
import { normalizeExternalCause } from "../../shared/external-cause.ts";
import { decodeStorageWorkerFailure, encodeStorageWorkerFailure, isStorageWorkerResponse } from "./worker-protocol.ts";

beforeEach(() => {
  workerHarness.instances.length = 0;
  workerHarness.respond = (message, worker) => {
    worker.emit("message", { id: message.id, state: "success", result: undefined });
  };
});

describe("Record storage worker protocol", () => {
  it("rejects incomplete worker responses", () => {
    for (const [response] of [
      [{ id: 1, state: "success" }],
      [{ id: 1, state: "success", result: null }],
      [{ id: 1, state: "failure" }],
      [{ id: 1, state: "failure", error: null }],
      [{ id: 1, state: "failure", error: { code: "x", operation: "y" } }],
      [{ id: 1, state: "failure", error: { code: "x", operation: "y", message: "z", stack: 1 } }],
      [{ id: 1, state: "failure", error: { code: "x", operation: "y", message: "z", details: [1] } }],
    ]) {
      expect(isStorageWorkerResponse(response), JSON.stringify(response)).toBe(false);
    }
  });

  it("accepts complete worker responses", () => {
    for (const response of [
      { id: 1, state: "success", result: undefined },
      { id: 2, state: "success", result: { value: true } },
      { id: 3, state: "success", result: [{ value: true }] },
      {
        id: 4,
        state: "failure",
        error: {
          _tag: "SqliteRecordError",
          code: "record-write-busy",
          operation: "write",
          message: "busy",
          stack: undefined,
          cause: undefined,
        },
      },
      {
        id: 5,
        state: "failure",
        error: {
          _tag: "SqliteRecordError",
          code: "record-sqlite-error",
          operation: "read",
          message: "bad",
          stack: "remote stack",
          cause: normalizeExternalCause(new Error("disk")),
        },
      },
      {
        id: 6,
        state: "failure",
        error: {
          code: "run-delete-reference-conflict",
          _tag: "RunStorageError",
          message: "referenced",
          stack: undefined,
          dependencies: [
            { dependentRunId: "dependent", dependentSlotId: "slot", attemptId: "attempt", attemptLocator: "@1" },
          ],
        },
      },
    ]) {
      expect(isStorageWorkerResponse(response), JSON.stringify(response)).toBe(true);
      if (isStorageWorkerResponse(response) && response.state === "failure") {
        const decoded = decodeStorageWorkerFailure(response.error);
        expect(decoded).toBeInstanceOf(response.error._tag === "RunStorageError" ? RunStorageError : SqliteRecordError);
        expect(encodeStorageWorkerFailure(decoded, "unused")).toEqual(response.error);
      }
    }
    const runFailure = new RunStorageError("run-id-collision", "same identity, different content", [
      {
        dependentRunId: "dependent",
        dependentSlotId: "slot",
        attemptId: "attempt",
        attemptLocator: "@1",
      },
    ]);
    const wire = structuredClone(encodeStorageWorkerFailure(runFailure, "run"));
    expect(isStorageWorkerResponse({ id: 7, state: "failure", error: wire })).toBe(true);
    expect(decodeStorageWorkerFailure(wire)).toMatchObject(runFailure);
    expect(
      isStorageWorkerResponse({
        id: 7,
        state: "failure",
        error: { ...wire, dependencies: [{ attemptLocator: "@1" }] },
      }),
    ).toBe(false);
  });
});

describe("Record storage worker client failure lifecycle", () => {
  it("terminates every worker whose initialization fails without accumulating live workers", async () => {
    workerHarness.respond = (message, worker) =>
      worker.emit("message", {
        id: message.id,
        state: "failure",
        error: {
          _tag: "SqliteRecordError",
          code: "record-database-invalid",
          operation: "initialize",
          message: "invalid",
          stack: "remote stack",
          cause: normalizeExternalCause(new Error("original failure")),
        },
      });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failure = await makeStorageWorkerClient("unused").catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(SqliteRecordError);
      expect(failure).toMatchObject({ stack: "remote stack", cause: { _tag: "Error", message: "original failure" } });
      expect(workerHarness.instances.at(-1)?.terminated).toBe(1);
    }
    expect(workerHarness.instances).toHaveLength(3);
    expect(workerHarness.instances.every((worker) => worker.terminated === 1)).toBe(true);
  });

  it("maps a malformed pending response to a protocol failure and terminates the worker", async () => {
    workerHarness.respond = (message, worker) => {
      if (message.operation === "initialize") {
        worker.emit("message", { id: message.id, state: "success", result: undefined });
      } else {
        worker.emit("message", { id: message.id, state: "failure", error: undefined });
      }
    };
    const client = await makeStorageWorkerClient("unused");

    await expect(client.validate()).rejects.toMatchObject({
      name: "SqliteRecordError",
      code: "record-sqlite-error",
      operation: "worker-protocol",
    });
    expect(workerHarness.instances[0]?.terminated).toBe(1);
    await expect(client.validate()).rejects.toThrow("Record storage worker returned an invalid response");
  });

  it("settles pending work when close wins the response race and terminates only once", async () => {
    workerHarness.respond = (message, worker) => {
      if (message.operation === "initialize" || message.operation === "close") {
        worker.emit("message", { id: message.id, state: "success", result: undefined });
      }
    };
    const client = await makeStorageWorkerClient("unused");
    const pending = client.validate();

    await client.close();
    await expect(pending).rejects.toThrow("closed");
    expect(workerHarness.instances[0]?.terminated).toBe(1);
  });
});
