// cases: docs/engineering/testing/unit/reports.md
// 页级呈现分配(两个 keyset、槽位分配、容量拒绝)、`dimensions` 必填与查询封闭性、text 面
// 降级、外壳 `dimensionPins` 的占位语义,以及公开 helper `presentDimension` 与页内分配同源。
//
// 断言面是映射本身(值 → 标签 / seriesSlot / 色板下标 / 形状变体)与抛出的错误对象,不断言
// 渲染出的颜色值;需要证明「两个 renderer 都跑到」时才走 renderReportToText /
// renderReportToStaticHtml,断言的仍是探针组件打印出的映射文本。

import { describe, expect, it } from "vitest";

import { emptyScopeAndResults } from "./components/scope.harness.ts";
import { defineReport } from "./definition/report.ts";
import { Col } from "./definition/primitives.tsx";
import {
  collectPageDimensions,
  defineComponent,
  type ReportElement,
  type ReportNode,
} from "./definition/tree.ts";
import {
  presentDimension,
  seriesChannelsOf,
  UndeclaredDimensionValueError,
  VISUAL_SLOT_COUNT,
  type DimensionEncoding,
  type DimensionPins,
  type PresentedDimension,
} from "./presentation.ts";
import { renderReportToText } from "./runtime/text.ts";
import { renderReportToStaticHtml } from "./runtime/web.ts";

// ───────────────────────── 探针组件 ─────────────────────────

const SERIES: DimensionEncoding = { kind: "series", mark: "line" };
const LABEL_ONLY: DimensionEncoding = { kind: "label" };

interface ProbeProps {
  dimension: string;
  values: readonly string[];
  encoding?: DimensionEncoding;
  /** 声明用的句柄名;默认 "keys"。 */
  handle?: string;
  /** renderer 实际查询的句柄名;与 handle 不同就是「查未声明的句柄」。 */
  query?: string;
}

/** `值|标签|槽|色板下标|形状变体`,槽面缺席时打 `-`——两个 renderer 打同一行,好逐字比。 */
function probeLine(props: ProbeProps, presented: PresentedDimension): string {
  return props.values
    .map((_value, index) => {
      const at = presented.at(index);
      return `${at.value}|${at.label}|${at.seriesSlot ?? "-"}|${at.colorIndex ?? "-"}|${at.variant ?? "-"}`;
    })
    .join(";");
}

const Probe = defineComponent<ProbeProps>({
  dimensions: (props) => ({
    [props.handle ?? "keys"]: {
      dimension: props.dimension,
      encoding: props.encoding ?? SERIES,
      values: props.values,
    },
  }),
  text: (props, ctx) => probeLine(props, ctx.dimension(props.query ?? props.handle ?? "keys")),
  web: (props, ctx) => <span data-probe={probeLine(props, ctx.dimension(props.query ?? props.handle ?? "keys"))} />,
});
Probe.displayName = "Probe";

function elementOf(node: unknown): ReportElement {
  return node as ReportElement;
}

/** 页级分配的直接观察面:句柄 → 值 → seriesSlot(未分配视觉槽的值不进 map)。 */
function slotsOf(node: ReportNode, element: ReportElement, pins: DimensionPins = {}): Map<string, number> {
  const plan = collectPageDimensions(node, pins, "web");
  const props = element.props as unknown as ProbeProps;
  const presented = plan.dimension(element.props, props.handle ?? "keys");
  const out = new Map<string, number>();
  props.values.forEach((value, index) => {
    const slot = presented.at(index).seriesSlot;
    if (slot !== undefined) out.set(value, slot);
  });
  return out;
}

const host = () => emptyScopeAndResults();

// ───────────────────────── 页级呈现分配 ─────────────────────────

describe("页级呈现分配", () => {
  it("两个 keyset 分开:label 编码的值只拿标签,color / series 的值才占视觉槽", () => {
    const table = elementOf(<Probe dimension="agent" encoding={LABEL_ONLY} values={["alpha", "beta"]} />);
    const chart = elementOf(<Probe dimension="agent" values={["gamma"]} />);
    const plan = collectPageDimensions([table, chart], {}, "web");

    const tableKeys = plan.dimension(table.props, "keys");
    expect(tableKeys.at(0)).toEqual({ value: "alpha", label: "alpha" });
    expect(tableKeys.at(1).seriesSlot).toBeUndefined();

    const chartKeys = plan.dimension(chart.props, "keys");
    expect(chartKeys.at(0).seriesSlot).toBeGreaterThanOrEqual(1);
    // label keyset 收了三个值,visual keyset 只有 gamma —— 标签面两组都在
    expect([...chartKeys.labels.keys()].sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("27 值的 label-only 表加 3 值的图:三个值照常拿到槽,标签按 30 值的 keyset 算最短唯一后缀", () => {
    const chartValues = ["alpha/one", "beta/two", "gamma/three"];
    const tableValues = [
      "delta/one",
      "epsilon/two",
      "zeta/three",
      ...Array.from({ length: 24 }, (_, i) => `suite/x${i}`),
    ];
    const table = elementOf(<Probe dimension="agent" encoding={LABEL_ONLY} values={tableValues} />);
    const chart = elementOf(<Probe dimension="agent" values={chartValues} />);
    const plan = collectPageDimensions([table, chart], {}, "web");
    const chartKeys = plan.dimension(chart.props, "keys");

    // visual keyset 只有 3 个成员:容量按 3 算,不按 30 算
    const slots = chartValues.map((_v, i) => chartKeys.at(i).seriesSlot!);
    expect(new Set(slots).size).toBe(3);
    expect(slots.every((slot) => slot >= 1 && slot <= VISUAL_SLOT_COUNT)).toBe(true);

    // label keyset 是 30 个值:one / two / three 三处重名,标签被逼长到两段
    expect(chartValues.map((_v, i) => chartKeys.at(i).label)).toEqual(["alpha/one", "beta/two", "gamma/three"]);
    // 同一份声明单独成页时只会缩到最后一段——区分力在这里
    expect(presentDimension({ dimension: "agent", encoding: SERIES, values: chartValues }).at(0).label).toBe("one");
  });

  it("同一键在同页多个组件得到同一个槽,缩短后的显示名不参与取键", () => {
    const chart = elementOf(<Probe dimension="agent" values={["acme/codex", "acme/claude"]} />);
    const legend = elementOf(<Probe dimension="agent" handle="legend" values={["acme/claude"]} />);
    const plan = collectPageDimensions([chart, legend], {}, "web");

    const fromChart = plan.dimension(chart.props, "keys").at(1);
    const fromLegend = plan.dimension(legend.props, "legend").at(0);
    expect(fromLegend.seriesSlot).toBe(fromChart.seriesSlot);
    expect(fromLegend.label).toBe("claude");
    // 取键用完整值:缩短后的 "claude" 不是另一个身份
    expect(fromLegend.value).toBe("acme/claude");
  });

  it("24 个值全部落槽且两两不同,24 个 (色, variant) 组合也两两不同", () => {
    const values = Array.from({ length: VISUAL_SLOT_COUNT }, (_, i) => `agent-${i}`);
    const chart = elementOf(<Probe dimension="agent" values={values} />);
    const slots = slotsOf(chart, chart);
    expect([...slots.values()].sort((a, b) => a - b)).toEqual(
      Array.from({ length: VISUAL_SLOT_COUNT }, (_, i) => i + 1),
    );

    const channels = new Set(
      Array.from({ length: VISUAL_SLOT_COUNT }, (_, i) => {
        const { colorIndex, variant } = seriesChannelsOf(i + 1);
        return `${colorIndex}/${variant}`;
      }),
    );
    expect(channels.size).toBe(VISUAL_SLOT_COUNT);
  });

  it("visual keyset 超过 24 按完整用户反馈拒绝该页,fix 行不提 dimensionPins", () => {
    const values = Array.from({ length: 27 }, (_, i) => `agent-${i}`);
    const chart = elementOf(<Probe dimension="agent" values={values} />);
    let error: unknown;
    try {
      collectPageDimensions(chart, {}, "web");
    } catch (e) {
      error = e;
    }
    const message = (error as Error).message;
    expect(message).toContain('dimension "agent" has 27 series, but the built-in encoding supports 24');
    expect(message).toContain("fix: filter the series, or split them into facets/pages");
    expect(message).not.toContain("dimensionPins");
  });
});

// ───────────────────────── dimensions 必填与查询封闭性 ─────────────────────────

describe("dimensions 必填与查询封闭性", () => {
  it("缺 dimensions 的组件定义按完整用户反馈拒绝,dimensions: () => ({}) 合法", () => {
    expect(() => defineComponent({ web: () => null, text: () => "" } as never)).toThrow(
      /requires dimensions\(data, options\)/,
    );
    expect(() => defineComponent({ web: () => null, text: () => "" } as never)).toThrow(
      /dimensions: \(\) => \(\{\}\)/,
    );
    expect(() => defineComponent({ dimensions: () => ({}), web: () => null, text: () => "" })).not.toThrow();
  });

  it("查询未声明的句柄在 text 与 web 两面都抛 UndeclaredDimensionValueError", async () => {
    const definition = defineReport(() => (
      <Col>
        <Probe dimension="agent" values={["a", "b"]} query="nope" />
      </Col>
    ));
    await expect(renderReportToText(definition, host())).rejects.toBeInstanceOf(UndeclaredDimensionValueError);
    await expect(renderReportToStaticHtml(definition, host())).rejects.toBeInstanceOf(
      UndeclaredDimensionValueError,
    );
    await expect(renderReportToText(definition, host())).rejects.toThrow(/its dimensions\(\) did not declare/);
  });

  it("组件查不到别的组件声明的句柄:句柄按组件封闭,不按页共享", () => {
    const chart = elementOf(<Probe dimension="agent" values={["a"]} />);
    const legend = elementOf(<Probe dimension="agent" handle="legend" values={["a"]} />);
    const plan = collectPageDimensions([chart, legend], {}, "web");
    expect(() => plan.dimension(chart.props, "legend")).toThrow(UndeclaredDimensionValueError);
    expect(() => plan.dimension(legend.props, "keys")).toThrow(UndeclaredDimensionValueError);
  });

  it("越界下标抛 UndeclaredDimensionValueError,不临时分配", () => {
    const chart = elementOf(<Probe dimension="agent" values={["a"]} />);
    const plan = collectPageDimensions(chart, {}, "web");
    expect(() => plan.dimension(chart.props, "keys").at(1)).toThrow(UndeclaredDimensionValueError);
  });
});

// ───────────────────────── text 面降级 ─────────────────────────

describe("text 面的呈现降级", () => {
  it("text renderer 的 ctx.dimension() 恒返回 label 面,拿不到槽与颜色", async () => {
    const definition = defineReport(() => (
      <Col>
        <Probe dimension="agent" values={["acme/codex", "acme/claude"]} />
      </Col>
    ));
    const text = await renderReportToText(definition, host());
    expect(text).toContain("acme/codex|codex|-|-|-");
    expect(text).toContain("acme/claude|claude|-|-|-");
  });

  it("容量拒绝只发生在 web 编码规划:同一份 27 series 的报告 text 面照常输出", async () => {
    const values = Array.from({ length: 27 }, (_, i) => `agent-${i}`);
    const definition = defineReport(() => (
      <Col>
        <Probe dimension="agent" values={values} />
      </Col>
    ));
    await expect(renderReportToText(definition, host())).resolves.toContain("agent-26|agent-26|-|-|-");
    await expect(renderReportToStaticHtml(definition, host())).rejects.toThrow(
      /has 27 series, but the built-in encoding supports 24/,
    );
  });
});

// ───────────────────────── 外壳钉色 ─────────────────────────

describe("dimensionPins", () => {
  const pinned = ["baseline", "mempal", "nowledge", "candidate"];

  it("钉住的键原样占位,其余键只在剩下的槽里探测", () => {
    const chart = elementOf(<Probe dimension="memory" values={pinned} />);
    const slots = slotsOf(chart, chart, { memory: { baseline: 4, mempal: 1 } });
    expect(slots.get("baseline")).toBe(4);
    expect(slots.get("mempal")).toBe(1);
    expect([slots.get("nowledge"), slots.get("candidate")]).not.toContain(4);
    expect([slots.get("nowledge"), slots.get("candidate")]).not.toContain(1);
  });

  it("多个值钉同一个下标合法,不触发探测", () => {
    const chart = elementOf(<Probe dimension="memory" values={pinned} />);
    const slots = slotsOf(chart, chart, { memory: { baseline: 6, mempal: 6 } });
    expect(slots.get("baseline")).toBe(6);
    expect(slots.get("mempal")).toBe(6);
  });

  it("钉了但这一页没出现的键不占槽:分配结果与不加这条钉完全相同", () => {
    const chart = elementOf(<Probe dimension="memory" values={pinned} />);
    const withGhost = slotsOf(chart, chart, { memory: { ghost: 7 } });
    const without = slotsOf(chart, chart, {});
    expect([...withGhost]).toEqual([...without]);
  });

  it("外壳声明的钉色透传到宿主渲染,非法下标在 defineReport 就按完整用户反馈拒绝", async () => {
    const definition = defineReport({
      dimensionPins: { memory: { baseline: 4 } },
      pages: [
        {
          id: "report",
          title: "Report",
          render: () => (
            <Col>
              <Probe dimension="memory" values={["baseline", "mempal"]} />
            </Col>
          ),
        },
      ],
    });
    const html = await renderReportToStaticHtml(definition, host());
    const { colorIndex, variant } = seriesChannelsOf(4);
    expect(html).toContain(`baseline|baseline|4|${colorIndex}|${variant}`);

    expect(() =>
      defineReport({
        pages: [{ id: "report", title: "R", render: () => null }],
        dimensionPins: { memory: { baseline: 99 } },
      }),
    ).toThrow(/dimensionPins\.memory\.baseline/);
  });
});

// ───────────────────────── 公开呈现 helper ─────────────────────────

describe("presentDimension", () => {
  it("与页内 ctx.dimension(handle) 对同一份声明返回相同槽位", () => {
    const values = ["acme/codex", "acme/claude", "acme/hermes"];
    const chart = elementOf(<Probe dimension="agent" values={values} />);
    const inPage = slotsOf(chart, chart);
    const standalone = presentDimension({ dimension: "agent", encoding: SERIES, values });
    for (const [index, value] of values.entries()) {
      expect(standalone.at(index).seriesSlot).toBe(inPage.get(value));
    }
  });
});
