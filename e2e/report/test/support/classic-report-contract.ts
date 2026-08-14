export interface ReportStatExpectation {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}

export interface ReportBarExpectation {
  readonly label: string;
  readonly value: number;
  readonly display: string;
}

export interface ReportScatterPointExpectation {
  readonly label: string;
  readonly key: string;
  readonly xDisplay: string;
  readonly yDisplay: string;
  readonly href: string;
}

export interface ReportExperimentExpectation {
  readonly id: string;
  readonly model: string;
  readonly agent: string;
  readonly passRate: string;
  readonly tokens: string;
  readonly cost: string;
  readonly record: string;
}

export const CLASSIC_REPORT_CONTRACT = {
  title: "MemoryBench Classic",
  stats: [
    { label: "Pass rate", value: "70.4%" },
    { label: "Experiments", value: "3" },
    { label: "Evals", value: "27" },
    { label: "Attempts", value: "27" },
    { label: "Eval results", value: "19 passed 8 failed" },
    { label: "Total cost", value: "$0.16", detail: "Cost available for 24/27 attempts" },
  ] satisfies readonly ReportStatExpectation[],
  bars: {
    heading: "Pass rate(%)",
    rows: [
      { label: "memory-b", value: 1, display: "100%" },
      { label: "memory-a", value: 0.778, display: "77.8%" },
      { label: "baseline", value: 0.333, display: "33.3%" },
    ] satisfies readonly ReportBarExpectation[],
  },
  scatter: {
    accessibleName: "costUSD × passRate",
    xLabel: "Cost($)",
    yLabel: "Pass rate(%)",
    betterHint: "better → upper right",
    points: [
      {
        label: "memory-b",
        key: "classic/memory-b",
        xDisplay: "$0.0090",
        yDisplay: "100%",
        href: "experiment/classic%2Fmemory-b.html",
      },
      {
        label: "memory-a",
        key: "classic/memory-a",
        xDisplay: "$0.0070",
        yDisplay: "77.8%",
        href: "experiment/classic%2Fmemory-a.html",
      },
      {
        label: "baseline",
        key: "classic/baseline",
        xDisplay: "$0.0040",
        yDisplay: "33.3%",
        href: "experiment/classic%2Fbaseline.html",
      },
    ] satisfies readonly ReportScatterPointExpectation[],
    leftToRight: ["memory-b", "memory-a", "baseline"],
    topToBottom: ["memory-b", "memory-a", "baseline"],
  },
  experimentTable: {
    headers: ["Experiment", "Model", "Agent", "Avg. time", "Pass rate", "Tokens", "Cost", "Record"],
    experiments: [
      {
        id: "classic/memory-b",
        model: "gpt-5.6-luna",
        agent: "classic-memory",
        passRate: "100%",
        tokens: "238 tokens",
        cost: "$0.0090",
        record: "9 passed",
      },
      {
        id: "classic/memory-a",
        model: "gpt-5.6-luna",
        agent: "classic-memory",
        passRate: "77.8%",
        tokens: "176 tokens",
        cost: "$0.0070",
        record: "7 passed 2 failed",
      },
      {
        id: "classic/baseline",
        model: "gpt-5.6-luna",
        agent: "classic-memory",
        passRate: "33.3%",
        tokens: "100 tokens",
        cost: "$0.0040",
        record: "3 passed 6 failed",
      },
    ] satisfies readonly ReportExperimentExpectation[],
  },
} as const;
