import { defineExperiment } from "niceeval";
import { maxConcurrencyAgent } from "../agents/max-concurrency.ts";

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const barrierRoot = process.env.NICEEVAL_MAX_CONCURRENCY_BARRIER;

export default defineExperiment({
  description: "invocation-local experiment concurrency",
  agent: maxConcurrencyAgent,
  evals: ["max-concurrency/"],
  maxConcurrency: positiveIntegerFromEnv("NICEEVAL_MAX_CONCURRENCY_LIMIT", 3),
  ...(barrierRoot === undefined ? {} : { flags: { barrierRoot } }),
});
