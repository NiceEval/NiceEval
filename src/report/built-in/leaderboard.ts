import { Either } from "effect";
import { classicDataPlan } from "../classic/define.ts";
import { classicSampleFromProjectedInputs } from "../classic/from-context.ts";
import { costUSD, passRate } from "../classic/aggregate.ts";
import type { Sample } from "../classic/sample.ts";
import {
  defineCalculation,
  definePage,
  defineReport,
  reportComponentId,
  reportId,
  reportRoute,
} from "../author/index.ts";
import { reportCodeBlock, reportDocument } from "../semantic/index.ts";

export interface LeaderboardShowRow {
  readonly experimentId: string;
  readonly passRate: number | null;
  readonly costUSD: number | null;
  readonly evals: number;
}

export interface LeaderboardShowJson {
  readonly experiments: readonly LeaderboardShowRow[];
  readonly passRate: number | null;
  readonly evals: number;
  readonly attempts: number;
}

const leaderboard = defineCalculation({
  id: Either.getOrThrow(reportComponentId("leaderboard")),
  inputs: classicDataPlan,
  completeness: "allow-partial",
  calculate: ({ sample, inputs }) => leaderboardShowJson(classicSampleFromProjectedInputs({
    sample,
    inputs,
  })),
});

export const publicLeaderboardReport = defineReport({
  id: Either.getOrThrow(reportId("show-leaderboard")),
  calculations: { leaderboard },
  pages: [
    definePage({
      id: Either.getOrThrow(reportComponentId("leaderboard-page")),
      route: Either.getOrThrow(reportRoute("/")),
      calculations: { leaderboard },
      render: ({ calculations }) => reportDocument({
        title: "Leaderboard",
        presentation: "evidence-text",
        children: [reportCodeBlock({
          value: calculations.leaderboard.state === "available"
            ? renderLeaderboardText(calculations.leaderboard.value)
            : "leaderboard unavailable",
        })],
      }),
    }),
  ],
});

function leaderboardShowJson(sample: Sample): LeaderboardShowJson {
  const groups = new Map<string, Sample["units"][number][]>();
  for (const unit of sample.units) {
    const existing = groups.get(unit.experimentId);
    if (existing === undefined) groups.set(unit.experimentId, [unit]);
    else existing.push(unit);
  }
  const experiments = [...groups.entries()]
    .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
    .map(([experimentId, units]) => Object.freeze({
      experimentId,
      passRate: passRate.compute(units).value,
      costUSD: costUSD.compute(units).value,
      evals: units.length,
    }));
  return Object.freeze({
    experiments: Object.freeze(experiments),
    passRate: passRate.compute(sample.units).value,
    evals: sample.units.length,
    attempts: sample.attempts.length,
  });
}

function renderLeaderboardText(value: LeaderboardShowJson): string {
  const lines = [
    `experiments ${value.experiments.length}`,
    `evals ${value.evals}`,
    `attempts ${value.attempts}`,
    ...value.experiments.map((row) =>
      `${row.experimentId}  passRate=${row.passRate ?? "—"}  costUSD=${row.costUSD ?? "—"}`
    ),
  ];
  return lines.join("\n");
}
