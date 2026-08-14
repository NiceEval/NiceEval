/**
 * This is the acceptance contract for the deterministic classic profile.
 * It is deliberately written before reading a Record: the reader tests must
 * not derive their expectations from whatever the producer happened to emit.
 */
export const CLASSIC_TITLE = "MemoryBench Classic";
export const CLASSIC_COMPOSITION_RUNS = 3;
export const CLASSIC_HISTORY_RUNS = 4;
export const CLASSIC_HISTORY_ATTEMPTS = 36;

export const CLASSIC_SUMMARY = {
  experiments: 3,
  attempts: 27,
  passed: 19,
  failed: 8,
  totalCost: "$0.16",
  pricedAttempts: 24,
  costAttempts: 27,
  costDetail: "Cost available for 24/27 attempts",
} as const;

export const CLASSIC_EXPERIMENTS = [
  {
    id: "classic/baseline",
    shortName: "baseline",
    model: "gpt-5.6-luna",
    agent: "classic-memory",
    passRate: "33.3%",
    averageCost: "$0.0040",
    passed: 3,
    failed: 6,
    evals: [
      { id: "classic/recall-constraint", verdict: "failed" },
      { id: "classic/recall-date", verdict: "failed" },
      { id: "classic/recall-entity", verdict: "failed" },
      { id: "classic/recall-fact", verdict: "failed" },
      { id: "classic/recall-multi", verdict: "failed" },
      { id: "classic/recall-name", verdict: "passed" },
      { id: "classic/recall-procedure", verdict: "failed" },
      { id: "classic/tool-note", verdict: "passed" },
      { id: "source-snapshot", verdict: "passed" },
    ],
  },
  {
    id: "classic/memory-a",
    shortName: "memory-a",
    model: "gpt-5.6-luna",
    agent: "classic-memory",
    passRate: "77.8%",
    averageCost: "$0.0070",
    passed: 7,
    failed: 2,
    evals: [
      { id: "classic/recall-constraint", verdict: "passed" },
      { id: "classic/recall-date", verdict: "passed" },
      { id: "classic/recall-entity", verdict: "failed" },
      { id: "classic/recall-fact", verdict: "passed" },
      { id: "classic/recall-multi", verdict: "failed" },
      { id: "classic/recall-name", verdict: "passed" },
      { id: "classic/recall-procedure", verdict: "passed" },
      { id: "classic/tool-note", verdict: "passed" },
      { id: "source-snapshot", verdict: "passed" },
    ],
  },
  {
    id: "classic/memory-b",
    shortName: "memory-b",
    model: "gpt-5.6-luna",
    agent: "classic-memory",
    passRate: "100%",
    averageCost: "$0.0090",
    passed: 9,
    failed: 0,
    evals: [
      { id: "classic/recall-constraint", verdict: "passed" },
      { id: "classic/recall-date", verdict: "passed" },
      { id: "classic/recall-entity", verdict: "passed" },
      { id: "classic/recall-fact", verdict: "passed" },
      { id: "classic/recall-multi", verdict: "passed" },
      { id: "classic/recall-name", verdict: "passed" },
      { id: "classic/recall-procedure", verdict: "passed" },
      { id: "classic/tool-note", verdict: "passed" },
      { id: "source-snapshot", verdict: "passed" },
    ],
  },
] as const;

export const CLASSIC_BARS = [
  { experiment: "memory-b", passRate: "100%" },
  { experiment: "memory-a", passRate: "77.8%" },
  { experiment: "baseline", passRate: "33.3%" },
] as const;

export const CLASSIC_SCATTER = [
  { key: "A", experiment: "classic/baseline", cost: "$0.0040", passRate: "33.3%" },
  { key: "B", experiment: "classic/memory-a", cost: "$0.0070", passRate: "77.8%" },
  { key: "C", experiment: "classic/memory-b", cost: "$0.0090", passRate: "100%" },
] as const;

export const classicExperiment = (id: string) => {
  const experiment = CLASSIC_EXPERIMENTS.find((candidate) => candidate.id === id);
  if (experiment === undefined) {
    throw new Error(`unknown classic experiment in acceptance test: ${id}`);
  }
  return experiment;
};
