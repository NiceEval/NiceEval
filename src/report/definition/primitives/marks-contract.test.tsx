// cases: docs/engineering/testing/unit/reports.md
// 图表作者静态契约：points 推断字段键，refs 和拼写错误不能进入轴或排序。

import { describe, expect, it } from "vitest";

import { evidenceRow, metricValue } from "../../model/calculation.ts";
import { Bars, Scatter } from "./marks.tsx";

const points = [
  evidenceRow({
    agent: "codex",
    passed: true,
    passRate: metricValue({
      value: 0.8,
      samples: 4,
      total: 5,
      basis: "eval",
      evidence: ["exp@2026-07-01T00:00:00.000Z/e/a0" as never],
    }),
  }),
];

const externalPoints = [{ year: 2026, score: 0.8, agent: "codex" }];

describe("图表字段静态契约", () => {
  it("从 points 推断可绘制字段与 external 标量字段", () => {
    const sampleChart = <Scatter points={points} x="agent" y="passRate" color="passed" />;
    const externalChart = <Bars external points={externalPoints} x="year" y="score" sort={{ field: "score" }} />;
    expect(sampleChart).toBeTruthy();
    expect(externalChart).toBeTruthy();
  });
});

if (false) {
  // @ts-expect-error 拼错字段必须在 JSX 调用处拒绝
  <Scatter points={points} x="agent" y="passRat" />;
  // @ts-expect-error EvidenceRow.refs 不是可绘制字段
  <Scatter points={points} x="refs" y="passRate" />;
  // @ts-expect-error Sample 派生 Bars 不能拿 refs 排序
  <Bars points={points} x="agent" y="passRate" sort={{ field: "refs" }} />;
  // @ts-expect-error external 图表不支持 Sample 的下钻目标
  <Scatter external points={externalPoints} x="year" y="score" pointTarget={() => undefined} />;
}
