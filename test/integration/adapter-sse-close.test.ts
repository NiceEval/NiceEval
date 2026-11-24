import fc from "fast-check";
import { sseJsonFrames, type SseFrameCursor } from "niceeval/adapter";
import { expect, test } from "vitest";

const end = { done: true, value: undefined };

// @feature docs/feature/adapters/README.md#transport-and-approval
// @spec docs/feature/adapters/statechart.md#NoFrameAfterClose
test("SSE cursor discards a pending result when closed after decoding", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.integer(), { minLength: 1, maxLength: 8 }), async (frames) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const chunk = frames.map((frame) => `data: ${frame}\n\n`).join("");
          controller.enqueue(new TextEncoder().encode(chunk));
        },
      });
      const cursor = sseJsonFrames(body);
      if (frames.length > 1) {
        expect(await cursor.next()).toEqual({ done: false, value: frames[0] });
      }
      const pending = cursor.next();
      if (frames.length === 1) {
        // Let the source read continuation decode the only frame before its cursor result settles.
        await Promise.resolve();
      }
      const closing = cursor.return();

      expect(await pending).toEqual(end);
      expect(await closing).toEqual(end);
      expect(await cursor.next()).toEqual(end);
    }),
    { examples: [[[0]], [[0, 0]]] },
  );
});

// @feature docs/feature/adapters/README.md#transport-and-approval
// @spec docs/feature/adapters/statechart.md#CancelAtMostOnce
test("SSE cursor shares its close receipt with synchronous reentry from transport cancellation", async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom("resolve", "reject"), async (outcome) => {
      const settlement = Promise.withResolvers<void>();
      const failure = new Error("transport cancellation failed");
      let reentered: ReturnType<SseFrameCursor<unknown>["return"]> | undefined;
      let cancelCalls = 0;
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelCalls += 1;
          reentered = cursor.return();
          return settlement.promise;
        },
      });
      const cursor = sseJsonFrames(body);
      const closing = cursor.return();
      const observed = closing.then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      if (outcome === "resolve") settlement.resolve();
      else settlement.reject(failure);

      expect(await observed).toEqual(outcome === "resolve" ? { result: end } : { error: failure });
      expect(reentered).toBe(closing);
      expect(cursor.return()).toBe(closing);
      expect(cancelCalls).toBe(1);
    }),
    { examples: [["resolve"]] },
  );
});
