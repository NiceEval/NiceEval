// rerun: pnpm e2e test --candidate source --repo adapter/local-protocol -- --run test/frame-cursor.test.ts

import { Effect, Schema, SchemaGetter } from "effect";
import type { JsonValue } from "niceeval";
import { driveFrameStream, sseJsonFrames, type AgentContext, type SseFrameCursor } from "niceeval/adapter";
import { expectTypeOf, test } from "vitest";

function barrier() {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open: () => open() };
}

// A deadline bounds a broken candidate; ordering comes from barriers, never sleeps.
async function within<Value>(promise: Promise<Value>, label: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function source(payloads: readonly string[], options: { open?: boolean; cancel?: () => Promise<void> } = {}) {
  const readStarted = barrier();
  let finish = () => {};
  let ended = false;
  let cancelCalls = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        for (const payload of payloads) controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
        finish = () => {
          if (ended) return;
          ended = true;
          controller.close();
        };
        if (!options.open) finish();
      },
      pull() {
        readStarted.open();
      },
      cancel() {
        ended = true;
        cancelCalls += 1;
        return options.cancel?.();
      },
    },
    { highWaterMark: 0 },
  );
  return { body, finish: () => finish(), readStarted: readStarted.promise, cancelCalls: () => cancelCalls };
}

function context(signal: AbortSignal, diagnostics: Parameters<AgentContext["diagnostic"]>[0][]): AgentContext {
  return {
    signal,
    flags: {},
    // This public driver requires no Session; do not recreate NiceEval's slot implementation in the fixture.
    get session(): never {
      throw new Error("Driving a frame cursor must not require a Session");
    },
    progress() {},
    diagnostic(input) {
      diagnostics.push(input);
    },
    log() {},
  };
}

// Fixture teardown also works on the old red candidate, whose cursor has no return().
async function dispose<Frame>(input: ReturnType<typeof source>, cursor: SseFrameCursor<Frame>): Promise<void> {
  input.finish();
  if (typeof cursor.return === "function") await cursor.return().catch(() => undefined);
}

// @feature docs/feature/adapters/README.md
test.concurrent("SSE cursor keeps null and other JSON values separate from EOF", async ({ expect }) => {
  const input = source(["null", "false", "0", '""', "[DONE]", '{"after":"null"}']);
  const cursor = sseJsonFrames(input.body);
  expectTypeOf(cursor).toEqualTypeOf<SseFrameCursor<JsonValue>>();
  try {
    expect(await cursor.next()).toEqual({ done: false, value: null });
    expect(await cursor.next()).toEqual({ done: false, value: false });
    expect(await cursor.next()).toEqual({ done: false, value: 0 });
    expect(await cursor.next()).toEqual({ done: false, value: "" });
    expect(await cursor.next()).toEqual({ done: false, value: { after: "null" } });
    expect(await cursor.next()).toEqual({ done: true, value: undefined });
  } finally {
    await dispose(input, cursor);
  }
});

// @feature docs/feature/adapters/README.md
test.concurrent("SSE Schema decoding delivers the decoded value, including undefined", async ({ expect }) => {
  const NumberFromText = Schema.String.pipe(
    Schema.decodeTo(Schema.Number, {
      decode: SchemaGetter.transform((value) => Number(value)),
      encode: SchemaGetter.transform((value) => String(value)),
    }),
  );
  const AbsentFromText = Schema.String.pipe(
    Schema.decodeTo(Schema.Undefined, {
      decode: SchemaGetter.transform(() => undefined),
      encode: SchemaGetter.transform(() => "absent"),
    }),
  );
  const numericInput = source(['"42"']);
  const absentInput = source(['"absent"']);
  const numeric = sseJsonFrames(numericInput.body, NumberFromText);
  const absent = sseJsonFrames(absentInput.body, AbsentFromText);
  expectTypeOf(numeric).toEqualTypeOf<SseFrameCursor<number>>();
  expectTypeOf(absent).toEqualTypeOf<SseFrameCursor<undefined>>();
  try {
    expect(await numeric.next()).toEqual({ done: false, value: 42 });
    expect(await absent.next()).toEqual({ done: false, value: undefined });
    expect(await absent.next()).toEqual({ done: true, value: undefined });
  } finally {
    await dispose(numericInput, numeric);
    await dispose(absentInput, absent);
  }
});

// @feature docs/feature/adapters/README.md
test.concurrent("Malformed JSON and Schema rejection expose one safe fixed decode error", async ({ expect }) => {
  const messages: string[] = [];
  for (const secret of ["private-frame-alpha", "private-frame-beta"]) {
    for (const payload of [`{"secret":"${secret}"`, `{"secret":"${secret}"}`]) {
      const input = source([payload], { open: true });
      const cursor = sseJsonFrames(input.body, Schema.Struct({ count: Schema.Number }));
      try {
        const failure: unknown = await cursor.next().then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(Error);
        expect(failure).toMatchObject({ _tag: "SseFrameDecodeError" });
        if (!(failure instanceof Error)) throw new Error("Expected a public SSE decode error");
        expect.soft(failure.message.length).toBeLessThanOrEqual(120);
        expect.soft(failure.message).toMatch(/^[\x20-\x7e]+$/);
        expect.soft(failure.message).not.toContain(secret);
        expect.soft(JSON.stringify(failure)).not.toContain(secret);
        expect.soft(failure).not.toHaveProperty("cause");
        expect.soft(input.body.locked).toBe(false);
        expect.soft(input.cancelCalls()).toBe(1);
        messages.push(failure.message);
      } finally {
        await dispose(input, cursor);
      }
    }
  }
  expect(new Set(messages).size).toBe(1);
});

// @feature docs/feature/adapters/README.md
test.concurrent("An asynchronous or defective decoder exposes a safe decoder error", async ({ expect }) => {
  const AsyncNumber = Schema.String.pipe(
    Schema.decodeTo(Schema.Number, {
      decode: SchemaGetter.transformEffect((value) => Effect.promise(() => Promise.resolve(value.length))),
      encode: SchemaGetter.transform((value) => String(value)),
    }),
  );
  const DefectiveNumber = Schema.String.pipe(
    Schema.decodeTo(Schema.Number, {
      decode: SchemaGetter.transform(() => {
        throw new Error("private-decoder-defect");
      }),
      encode: SchemaGetter.transform((value) => String(value)),
    }),
  );
  const messages: string[] = [];
  for (const schema of [AsyncNumber, DefectiveNumber]) {
    const input = source(['"private-decoder-input"'], { open: true });
    const cursor = sseJsonFrames(input.body, schema);
    try {
      const failure: unknown = await cursor.next().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toMatchObject({ _tag: "SseFrameDecoderError" });
      if (!(failure instanceof Error)) throw new Error("Expected a public SSE decoder error");
      expect.soft(failure.message.length).toBeLessThanOrEqual(120);
      expect.soft(failure.message).toMatch(/^[\x20-\x7e]+$/);
      expect.soft(JSON.stringify(failure)).not.toContain("private-decoder");
      expect.soft(failure).not.toHaveProperty("cause");
      expect.soft(input.body.locked).toBe(false);
      expect.soft(input.cancelCalls()).toBe(1);
      messages.push(failure.message);
    } finally {
      await dispose(input, cursor);
    }
  }
  expect(new Set(messages).size).toBe(1);
});

// @feature docs/feature/adapters/README.md
test.concurrent("Natural EOF releases the reader without cancelling the completed source", async ({ expect }) => {
  const input = source(["1"]);
  const cursor = sseJsonFrames(input.body);
  try {
    await cursor.next();
    await cursor.next();
    expect(input.body.locked).toBe(false);
    expect(input.cancelCalls()).toBe(0);
    expect(await cursor.next()).toEqual({ done: true, value: undefined });
  } finally {
    await dispose(input, cursor);
  }
});

// @feature docs/feature/adapters/README.md
test.concurrent("Closing a pending read releases its lock before the shared cancellation receipt completes", async ({
  expect,
}) => {
  const cancellation = barrier();
  const input = source([], { open: true, cancel: () => cancellation.promise });
  const cursor = sseJsonFrames(input.body);
  const pending = cursor.next();
  try {
    await within(input.readStarted, "source read started");
    const closing = cursor.return();
    expect(cursor.return()).toBe(closing);
    expect(input.body.locked).toBe(false);
    expect(await within(pending, "pending next settled during cancellation")).toEqual({ done: true, value: undefined });
    expect(await within(cursor.next(), "next after close")).toEqual({ done: true, value: undefined });
    expect(input.cancelCalls()).toBe(1);
    let closed = false;
    const observed = closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    cancellation.open();
    await within(observed, "underlying cancellation completed");
    expect(await closing).toEqual({ done: true, value: undefined });
    expect(input.cancelCalls()).toBe(1);
  } finally {
    cancellation.open();
    input.finish();
    await Promise.allSettled([pending]);
    await dispose(input, cursor);
  }
});

// @feature docs/feature/adapters/README.md
test.concurrent("Explicit close discards buffered frames and keeps a failed close receipt idempotent", async ({
  expect,
}) => {
  const cancellationFailure = new Error("source cancellation refused");
  const input = source(["1", "2"], {
    open: true,
    cancel: async () => {
      throw cancellationFailure;
    },
  });
  const cursor = sseJsonFrames(input.body);
  try {
    await cursor.next();
    const closing = cursor.return();
    const rejection = expect(closing).rejects.toBe(cancellationFailure);
    expect(cursor.return()).toBe(closing);
    expect(input.body.locked).toBe(false);
    expect(await cursor.next()).toEqual({ done: true, value: undefined });
    await rejection;
    expect(input.cancelCalls()).toBe(1);
  } finally {
    await dispose(input, cursor);
  }
});

// @feature docs/feature/adapters/README.md
test.concurrent("A cursor rejects concurrent reads without losing the first pending read", async ({ expect }) => {
  const input = source([], { open: true });
  const cursor = sseJsonFrames(input.body);
  const first = cursor.next();
  try {
    await within(input.readStarted, "first read pending");
    const concurrent = cursor.next().then(
      () => ({ status: "fulfilled" }),
      (error: unknown) => ({ status: "rejected", error }),
    );
    expect(await within(concurrent, "concurrent next rejected")).toMatchObject({
      status: "rejected",
      error: expect.any(Error),
    });
    await cursor.return();
    expect(await first).toEqual({ done: true, value: undefined });
  } finally {
    input.finish();
    await Promise.allSettled([first]);
    await dispose(input, cursor);
  }
});

// @feature docs/feature/adapters/README.md
test.concurrent("The frame driver delivers data after raw null before completing", async ({ expect }) => {
  const input = source(["null", '{"tail":true}']);
  const cursor = sseJsonFrames(input.body);
  const seen: JsonValue[] = [];
  try {
    const turn = await driveFrameStream(
      cursor,
      {
        add(frame) {
          seen.push(frame);
          return [];
        },
      },
      context(new AbortController().signal, []),
    );
    expect(seen).toEqual([null, { tail: true }]);
    expect(turn.status).toBe("completed");
    expect(input.body.locked).toBe(false);
  } finally {
    await dispose(input, cursor);
  }
});

// @feature docs/feature/adapters/README.md
test.concurrent("Aborting a pending drive closes the source and rejects instead of completing", async ({ expect }) => {
  const controller = new AbortController();
  const reason = new Error("owning send cancelled");
  const input = source([], { open: true });
  const cursor = sseJsonFrames(input.body);
  const driving = driveFrameStream(cursor, { add: () => [] }, context(controller.signal, []));
  const outcome = driving.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    await within(input.readStarted, "driver read started");
    controller.abort(reason);
    expect(await within(outcome, "aborted drive rejected")).toEqual({ error: reason });
    expect(input.body.locked).toBe(false);
    expect(input.cancelCalls()).toBe(1);
  } finally {
    input.finish();
    await Promise.allSettled([driving]);
    await dispose(input, cursor);
  }
});

// @feature docs/feature/adapters/README.md
test.concurrent("A signal cancelled before driving prevents delivery of buffered data", async ({ expect }) => {
  const controller = new AbortController();
  const reason = new Error("send already cancelled");
  controller.abort(reason);
  const input = source(["1"]);
  const cursor = sseJsonFrames(input.body);
  let delivered = 0;
  try {
    await expect(
      driveFrameStream(
        cursor,
        {
          add() {
            delivered += 1;
            return [];
          },
        },
        context(controller.signal, []),
      ),
    ).rejects.toBe(reason);
    expect(delivered).toBe(0);
    expect(input.body.locked).toBe(false);
  } finally {
    await dispose(input, cursor);
  }
});

// @feature docs/feature/adapters/README.md
test.concurrent("Cancellation observed at a pause barrier wins over a waiting Turn", async ({ expect }) => {
  const controller = new AbortController();
  const reason = new Error("cancelled at approval");
  const input = source(["1"], { open: true });
  const cursor = sseJsonFrames(input.body);
  try {
    await expect(
      driveFrameStream(cursor, { add: () => [] }, context(controller.signal, []), () => {
        controller.abort(reason);
        return { pause: { id: "approval", prompt: "Continue?" } };
      }),
    ).rejects.toBe(reason);
    expect(input.body.locked).toBe(false);
    expect(input.cancelCalls()).toBe(1);
  } finally {
    await dispose(input, cursor);
  }
});

for (const stage of ["reducer", "hook"]) {
  // @feature docs/feature/adapters/README.md
  test.concurrent(`A ${stage} error survives cancellation failure and reports safe cleanup diagnostics`, async ({
    expect,
  }) => {
    const primary = new Error(`${stage} failed`);
    const cleanup = new Error("private-cancellation-detail");
    const diagnostics: Parameters<AgentContext["diagnostic"]>[0][] = [];
    const input = source(["1"], {
      open: true,
      cancel: async () => {
        throw cleanup;
      },
    });
    const cursor = sseJsonFrames(input.body);
    try {
      await expect(
        driveFrameStream(
          cursor,
          {
            add() {
              if (stage === "reducer") throw primary;
              return [];
            },
          },
          context(new AbortController().signal, diagnostics),
          () => {
            if (stage === "hook") throw primary;
          },
        ),
      ).rejects.toBe(primary);
      expect(input.body.locked).toBe(false);
      expect(input.cancelCalls()).toBe(1);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ code: "stream-cleanup-failed" });
      expect(JSON.stringify(diagnostics)).not.toContain("private-cancellation-detail");
    } finally {
      await dispose(input, cursor);
    }
  });
}

// @feature docs/feature/adapters/README.md
test.concurrent("A reader failure remains primary when its transport close also fails", async ({ expect }) => {
  const primary = new Error("reader failed");
  const cleanup = new Error("private-reader-close-detail");
  const diagnostics: Parameters<AgentContext["diagnostic"]>[0][] = [];
  // A consumer-owned cursor is the public transport seam, not a replacement for the driver.
  let closeCalls = 0;
  const cursor: SseFrameCursor<number> = {
    async next() {
      throw primary;
    },
    async return() {
      closeCalls += 1;
      throw cleanup;
    },
  };
  await expect(
    driveFrameStream(cursor, { add: () => [] }, context(new AbortController().signal, diagnostics)),
  ).rejects.toBe(primary);
  expect(closeCalls).toBe(1);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatchObject({ code: "stream-cleanup-failed" });
  expect(JSON.stringify(diagnostics)).not.toContain("private-reader-close-detail");
});
