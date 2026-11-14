import { parentPort, workerData } from "node:worker_threads";
import { parseOtlpTraces } from "./parse.ts";

if (parentPort !== null) {
  const spans = [];
  for (const line of Buffer.from(workerData as Uint8Array).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value !== "object" || value === null || !("ct" in value) || !("b" in value) ||
        typeof value.ct !== "string" || typeof value.b !== "string") continue;
      for (const span of parseOtlpTraces(Buffer.from(value.b, "base64"), value.ct)) spans.push(span);
    } catch { /* A malformed envelope does not discard the valid prefix. */ }
  }
  parentPort.postMessage(spans);
}
