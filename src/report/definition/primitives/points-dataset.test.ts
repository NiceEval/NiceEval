// cases: docs/engineering/testing/unit/reports.md
// Scatter/Line/Bars/Area：points → Dataset 证据校验与 external 退出。

import { describe, expect, it } from "vitest";

import { evidenceRow, metricValue } from "../../model/calculation.ts";
import { applyBarsSortLimit } from "./marks.tsx";
import { pointsToDataset } from "./points-dataset.ts";

describe("pointsToDataset", () => {
  it("Sample 派生路径要求 EvidenceRow.refs 与 MetricValue；裸数字失败", () => {
    const points = [
      evidenceRow({
        agent: "a",
        costUSD: metricValue({
          value: 0.1,
          samples: 1,
          total: 1,
          basis: "eval",
          evidence: ["exp@2026-01-01T00:00:00.000Z/e/a0" as never],
          unit: "$",
          better: "lower",
        }),
        passRate: metricValue({
          value: 0.5,
          samples: 1,
          total: 1,
          basis: "eval",
          evidence: ["exp@2026-01-01T00:00:00.000Z/e/a0" as never],
          unit: "%",
          better: "higher",
        }),
      }),
    ];
    const dataset = pointsToDataset(points, { x: "costUSD", y: "passRate", point: "agent" });
    expect(dataset.fields.map((f) => f.name).sort()).toEqual(["agent", "costUSD", "passRate"]);
    expect(dataset.rows).toHaveLength(1);
    expect(dataset.rows[0]!.key).toBe("a");

    expect(() =>
      pointsToDataset([{ agent: "a", costUSD: 0.1, passRate: 0.5, refs: ["x" as never] }], {
        x: "costUSD",
        y: "passRate",
      }),
    ).toThrow(/bare number/);
  });

  it("external: true 接受标量并跳过 EvidenceRow 校验；不接受 MetricValue", () => {
    const dataset = pointsToDataset(
      [
        { agent: "a", costUSD: 0.2, passRate: 0.8 },
        { agent: "b", costUSD: 0.4, passRate: 0.6 },
      ],
      { x: "costUSD", y: "passRate", series: "agent", external: true },
    );
    expect(dataset.rows).toHaveLength(2);
    expect(dataset.fields.find((f) => f.name === "agent")?.kind).toBe("dimension");

    const mv = metricValue({
      value: 1,
      samples: 1,
      total: 1,
      basis: "eval",
      evidence: [],
    });
    expect(() =>
      pointsToDataset([{ costUSD: mv, passRate: 1 }], {
        x: "costUSD",
        y: "passRate",
        external: true,
      }),
    ).toThrow(/external: true/);
  });

  it("缺 refs 时指向路径并提示 external", () => {
    expect(() =>
      pointsToDataset([{ costUSD: 1, passRate: 1 } as never], { x: "costUSD", y: "passRate" }),
    ).toThrow(/points\[0\].*EvidenceRow\.refs/);
  });
});

describe("applyBarsSortLimit", () => {
  const loc = "e@2026-01-01T00:00:00.000Z/q/a0" as never;
  const mv = (value: number | null) =>
    metricValue({ value, samples: value === null ? 0 : 1, total: 1, basis: "eval", evidence: [loc] });

  it("按 MetricValue 降序排序，null 沉底；limit 只截断不造其他桶", () => {
    const points = [
      evidenceRow({ agent: "b", passRate: mv(0.2) }),
      evidenceRow({ agent: "a", passRate: mv(0.9) }),
      evidenceRow({ agent: "c", passRate: mv(null) }),
      evidenceRow({ agent: "d", passRate: mv(0.5) }),
    ];
    const sorted = applyBarsSortLimit(points, { sort: { field: "passRate", direction: "desc" } });
    expect(sorted.map((r) => (r as { agent: string }).agent)).toEqual(["a", "d", "b", "c"]);

    const limited = applyBarsSortLimit(points, {
      sort: { field: "passRate", direction: "desc" },
      limit: 2,
    });
    expect(limited.map((r) => (r as { agent: string }).agent)).toEqual(["a", "d"]);
    expect(limited).toHaveLength(2);
  });

  it("external 路径接受标量排序；非法 limit 失败", () => {
    const points = [
      { agent: "b", passRate: 0.2 },
      { agent: "a", passRate: 0.8 },
    ];
    expect(
      applyBarsSortLimit(points, { sort: { field: "passRate", direction: "asc" }, external: true }).map(
        (r) => (r as { agent: string }).agent,
      ),
    ).toEqual(["b", "a"]);
    expect(() => applyBarsSortLimit(points, { limit: -1, external: true })).toThrow(/non-negative integer/);
  });
});
