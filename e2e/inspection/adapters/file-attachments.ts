import { defineAdapter } from "niceeval";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";

export const fileAttachmentAdapter = defineAdapter({
  name: "file-attachment",
  create(ctx) {
    ctx.onCleanup(async ({ signal }) => {
      const receipt = await ctx.attach({ name: "cleanup", mediaType: "text/plain", body: { stream: (transferSignal) => createReadStream("small.txt", { signal: transferSignal }) }, signal });
      await writeFile("cleanup-id.txt", receipt.artifactId);
    });
    return {
      async archive() {
        const baseline = process.memoryUsage().rss;
        let peak = baseline;
        const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
        try {
          const receipt = await ctx.attach({ name: "journal.ndjson", mediaType: "application/x-ndjson", body: { stream: (signal) => createReadStream("journal.ndjson", { signal, highWaterMark: 64 * 1024 }) } });
          peak = Math.max(peak, process.memoryUsage().rss);
          await writeFile("journal.ndjson", "replaced after acceptance");
          await writeFile("receipt.txt", [receipt.artifactId, receipt.sha256, receipt.byteLength, peak - baseline].join("\n"));
          return receipt.byteLength;
        } finally { clearInterval(sampler); }
      },
      async waitForCancellation() {
        await ctx.attach({ name: "interrupted", mediaType: "application/octet-stream", signal: ctx.signal,
          body: { stream: (signal) => ({ [Symbol.asyncIterator]() { return {
            next() { return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            }); },
            async return() { await writeFile("cancel-source-closed.txt", "closed"); return { done: true as const, value: undefined }; },
          }; } }) },
        });
      },
      async reject() {
        const retained = await ctx.attach({ name: "retained", mediaType: "text/plain", body: { stream: (signal) => createReadStream("small.txt", { signal }) } });
        await writeFile("retained-id.txt", retained.artifactId);
        const failures: string[] = [];
        let released = 0;
        const sources = [
          () => (async function* () { try { yield new Uint8Array([1]); throw new Error("source failed"); } finally { released++; } })(),
          () => (async function* () { try { yield "not bytes" as unknown as Uint8Array; } finally { released++; } })(),
          () => (async function* () { try { yield new Uint8Array(1024 * 1024 + 1); } finally { released++; } })(),
        ];
        for (const stream of sources) {
          try { await ctx.attach({ name: "rejected", mediaType: "application/octet-stream", body: { stream } }); }
          catch (error) { failures.push(String(Reflect.get(error as object, "code"))); }
        }
        const controller = new AbortController();
        let returned = false;
        let transferSignal: AbortSignal | undefined;
        try {
          await ctx.attach({
            name: "cancelled", mediaType: "application/octet-stream", signal: controller.signal,
            body: { stream: (signal) => {
              transferSignal = signal;
              return { [Symbol.asyncIterator]() { return {
                next() { queueMicrotask(() => controller.abort()); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
                return() { returned = true; return new Promise<IteratorResult<Uint8Array>>(() => {}); },
              }; } };
            } },
          });
        } catch (error) { failures.push(String(Reflect.get(error as object, "code"))); }
        await writeFile("failures.txt", failures.join("\n"));
        await writeFile("source-cleanup.txt", `${released},${returned},${transferSignal?.aborted}`);
        return failures.length;
      },
    };
  },
});
