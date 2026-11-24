import fc from "fast-check";
import { sseJsonFrames, type SseFrameCursor } from "niceeval/adapter";
import { expect, test } from "vitest";
import { createFixtureProject, readJson, runSingleAttempt } from "./fixtures/adapter-trace-usage-harness/harness.ts";

const end = { done: true, value: undefined };

// @feature docs/feature/adapters/README.md#transport-and-approval
test("SSE cursor discards a pending result when closed with buffered frames", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.integer(), { minLength: 2, maxLength: 8 }), async (frames) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const chunk = frames.map((frame) => `data: ${frame}\n\n`).join("");
          controller.enqueue(new TextEncoder().encode(chunk));
        },
      });
      const cursor = sseJsonFrames(body);
      expect(await cursor.next()).toEqual({ done: false, value: frames[0] });
      const pending = cursor.next();
      const closing = cursor.return();

      expect(await pending).toEqual(end);
      expect(await closing).toEqual(end);
      expect(await cursor.next()).toEqual(end);
    }),
    { examples: [[[0, 0]]] },
  );
});

// @feature docs/feature/adapters/README.md#transport-and-approval
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

// @feature docs/feature/adapters/README.md#transport-and-approval
test("Attempt-owned SSE closes the buffered read and shares its receipt with the transport abort listener", async () => {
  const fixture = await createFixtureProject("attempt-sse-close", {
    "agent.ts": `
      import { writeFile } from "node:fs/promises";
      import { completeEvidenceCoverage, defineAgent, openSseJsonFrames } from "niceeval/adapter";
      export default defineAgent({
        name: "attempt-sse-close",
        evidenceCoverage: completeEvidenceCoverage,
        async send(_input, ctx) {
          const cancel = Promise.withResolvers();
          let reentered;
          let cancelCalls = 0;
          const cursor = await openSseJsonFrames(ctx, async (signal) => {
            signal.addEventListener("abort", () => { reentered = cursor.return(); }, { once: true });
            return new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: 0\\n\\ndata: 1\\n\\n"));
              },
              cancel() {
                cancelCalls += 1;
                return cancel.promise;
              },
            });
          });
          const first = await cursor.next();
          const pending = cursor.next();
          const closing = cursor.return();
          cancel.resolve();
          const result = {
            first,
            pending: await pending,
            closing: await closing,
            sameReceipt: reentered === closing && cursor.return() === closing,
            cancelCalls,
          };
          await writeFile(new URL("./observation.json", import.meta.url), JSON.stringify(result));
          return { status: "completed", events: [] };
        },
      });
    `,
    "evals/one.eval.ts": `import { defineEval } from "niceeval";
      export default defineEval({ async test(t) { await t.send("start"); } });`,
    "experiments/one.ts": `import { defineExperiment } from "niceeval";
      import adapter from "../agent.ts";
      export default defineExperiment({ adapter, evals: ["one"] });`,
  });
  try {
    await runSingleAttempt(fixture.cwd, "one");
    expect(await readJson(fixture.cwd, "observation.json")).toEqual({
      first: { done: false, value: 0 },
      pending: { done: true },
      closing: { done: true },
      sameReceipt: true,
      cancelCalls: 1,
    });
  } finally {
    await fixture.dispose();
  }
});
