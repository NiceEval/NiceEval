import { Worker } from "node:worker_threads";
import { extname } from "node:path";
import { Effect } from "effect";
import type { TraceSpan } from "../../types.ts";

/** CPU decoding has its own scoped worker so collection cancellation can stop JSON/protobuf parsing. */
export function decodeSpanEnvelopes(bytes: Uint8Array): Effect.Effect<TraceSpan[], unknown> {
  return Effect.acquireUseRelease(
    Effect.sync(() => new Worker(new URL(`./decode-worker${extname(new URL(import.meta.url).pathname)}`, import.meta.url), { workerData: bytes })),
    (worker) => Effect.tryPromise({ try: () => new Promise<TraceSpan[]>((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => { if (code !== 0) reject(new Error(`Telemetry decoder exited with code ${code}`)); });
    }), catch: (cause) => cause }),
    (worker) => Effect.promise(() => worker.terminate()).pipe(Effect.asVoid),
  );
}
