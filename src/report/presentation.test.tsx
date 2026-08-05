// cases: docs/engineering/testing/unit/reports.md
// 页级呈现分配(两个 keyset、槽位分配、容量拒绝)、`dimensions` 必填与查询封闭性、text 面
// 降级、外壳 `dimensionPins` 的占位语义,以及公开 helper `presentDimension` 与页内分配同源。
//
// 断言面是映射本身(值 → 标签 / seriesSlot / 色板通道 / 可直接使用的 fill·stroke·marker)与
// 抛出的错误对象,不断言渲染出的像素色;需要证明「两个 renderer 都跑到」时才走
// renderReportToText / renderReportToStaticHtml,断言的仍是探针组件打印出的映射文本。

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
  type DimensionPresentation,
  type PresentedDimension,
} from "./presentation.ts";
import { seriesFill, seriesStrokeDasharray } from "./assets/series-encoding.tsx";
import { renderReportToText } from "./runtime/text.ts";
import { renderReportToStaticHtml } from "./runtime/web.ts";

// ───────────────────────── 探针组件 ─────────────────────────

const SERIES: DimensionEncoding = { kind: "series", mark: "line" };
const FILL: DimensionEncoding = { kind: "series", mark: "bar" };
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

/** 从呈现值还原槽位通道,便于探针打印与槽位断言同源。 */
function channelsOf(at: DimensionPresentation): { colorIndex: string; variant: string; detail: string } {
  if (at.kind === "label") return { colorIndex: "-", variant: "-", detail: "label" };
  if (at.kind === "color") {
    const m = /^var\(--niceeval-color-series-([1-6])\)$/.exec(at.color);
    return { colorIndex: m?.[1] ?? "?", variant: "1", detail: at.color };
  }
  if (at.kind === "series" && at.mark === "line") {
    // 反查 24 槽里哪个 (color, variant) 产出这份 stroke + dash
    for (let slot = 1; slot <= VISUAL_SLOT_COUNT; slot++) {
      const ch = seriesChannelsOf(slot);
      if (
        at.stroke === `var(--niceeval-color-series-${ch.colorIndex})` &&
        at.strokeDasharray === seriesStrokeDasharray(ch.variant)
      ) {
        return { colorIndex: String(ch.colorIndex), variant: String(ch.variant), detail: at.strokeDasharray || "solid" };
      }
    }
    return { colorIndex: "?", variant: "?", detail: at.stroke };
  }
  if (at.kind === "series" && (at.mark === "bar" || at.mark === "area")) {
    for (let slot = 1; slot <= VISUAL_SLOT_COUNT; slot++) {
      const ch = seriesChannelsOf(slot);
      if (at.fill === seriesFill(ch.colorIndex, ch.variant)) {
        return { colorIndex: String(ch.colorIndex), variant: String(ch.variant), detail: at.fill };
      }
    }
    return { colorIndex: "?", variant: "?", detail: at.fill };
  }
  if (at.kind === "series" && at.mark === "scatter") {
    for (let slot = 1; slot <= VISUAL_SLOT_COUNT; slot++) {
      const ch = seriesChannelsOf(slot);
      if (at.marker.fill === `var(--niceeval-color-series-${ch.colorIndex})`) {
        // scatter 同色四 variant 靠 path 区分;用 path 末段粗判
        return { colorIndex: String(ch.colorIndex), variant: String(ch.variant), detail: at.marker.path.slice(0, 12) };
      }
    }
  }
  return { colorIndex: "?", variant: "?", detail: "?" };
}

/** `值|标签|槽|色板下标|形状变体`,槽面缺席时打 `-`——两个 renderer 打同一行,好逐字比。 */
function probeLine(
  props: ProbeProps,
  presented: PresentedDimension,
  slots?: ReadonlyMap<string, number>,
): string {
  return props.values
    .map((value, index) => {
      const at = presented.at(index);
      const slot = slots?.get(value);
      const ch = channelsOf(at);
      return `${at.value}|${at.label}|${slot ?? "-"}|${ch.colorIndex}|${ch.variant}`;
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
  web: (props, ctx) => {
    // web 探针从页级 plan 拿槽位,呈现值本身不再暴露 seriesSlot。
    const presented = ctx.dimension(props.query ?? props.handle ?? "keys");
    // slots 只能从 at 反推的 color/variant 对不上唯一槽时(多值同通道不该发生)——
    // 这里用 channels 反查唯一槽:24 组 (color,variant) 两两不同。
    const slots = new Map<string, number>();
    props.values.forEach((value, index) => {
      const at = presented.at(index);
      if (at.kind === "label") return;
      for (let slot = 1; slot <= VISUAL_SLOT_COUNT; slot++) {
        const ch = seriesChannelsOf(slot);
        const recovered = channelsOf(at);
        if (recovered.colorIndex === String(ch.colorIndex) && recovered.variant === String(ch.variant)) {
          slots.set(value, slot);
          break;
        }
      }
    });
    return <span data-probe={probeLine(props, presented, slots)} />;
  },
});
Probe.displayName = "Probe";

function elementOf(node: unknown): ReportElement {
  return node as ReportElement;
}

/** 页级分配的直接观察面:句柄 → 值 → seriesSlot(未分配视觉槽的值不进 map)。 */
function slotsOf(node: ReportNode, element: ReportElement, pins: DimensionPins = {}): Map<string, number> {
  const plan = collectPageDimensions(node, pins, "web");
  const props = element.props as unknown as ProbeProps;
  const byValue = plan.slotsByDimension.get(props.dimension) ?? new Map();
  const out = new Map<string, number>();
  for (const value of props.values) {
    const slot = byValue.get(value);
    if (slot !== undefined) out.set(value, slot);
  }
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
    expect(tableKeys.at(0)).toEqual({ kind: "label", value: "alpha", label: "alpha" });
    expect(tableKeys.at(1).kind).toBe("label");

    const chartKeys = plan.dimension(chart.props, "keys");
    expect(chartKeys.at(0).kind).toBe("series");
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
    const slots = plan.slotsByDimension.get("agent")!;

    // visual keyset 只有 3 个成员:容量按 3 算,不按 30 算
    const slotList = chartValues.map((v) => slots.get(v)!);
    expect(new Set(slotList).size).toBe(3);
    expect(slotList.every((slot) => slot >= 1 && slot <= VISUAL_SLOT_COUNT)).toBe(true);

    // label keyset 是 30 个值:one / two / three 三处重名,标签被逼长到两段
    expect(chartValues.map((_v, i) => chartKeys.at(i).label)).toEqual(["alpha/one", "beta/two", "gamma/three"]);
    // 同一份声明单独成页时只会缩到最后一段——区分力在这里
    expect(presentDimension({ dimension: "agent", encoding: SERIES, values: chartValues }).at(0).label).toBe("one");
  });

  it("同一键在同页多个组件得到同一个槽,缩短后的显示名不参与取键", () => {
    const chart = elementOf(<Probe dimension="agent" values={["acme/codex", "acme/claude"]} />);
    const legend = elementOf(<Probe dimension="agent" handle="legend" values={["acme/claude"]} />);
    const plan = collectPageDimensions([chart, legend], {}, "web");
    const slots = plan.slotsByDimension.get("agent")!;

    expect(slots.get("acme/claude")).toBe(slots.get("acme/claude"));
    const fromChart = plan.dimension(chart.props, "keys").at(1);
    const fromLegend = plan.dimension(legend.props, "legend").at(0);
    expect(fromLegend.label).toBe("claude");
    // 取键用完整值:缩短后的 "claude" 不是另一个身份
    expect(fromLegend.value).toBe("acme/claude");
    // 两处呈现同一视觉身份(stroke 相等)
    expect(fromLegend).toEqual(fromChart);
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

  it("槽序表:1–6 第一变体、7–12 第二变体,与 docs 一致", () => {
    expect(seriesChannelsOf(1)).toEqual({ colorIndex: 1, variant: 1 });
    expect(seriesChannelsOf(6)).toEqual({ colorIndex: 6, variant: 1 });
    expect(seriesChannelsOf(7)).toEqual({ colorIndex: 1, variant: 2 });
    expect(seriesChannelsOf(14)).toEqual({ colorIndex: 2, variant: 3 });
    expect(seriesChannelsOf(20)).toEqual({ colorIndex: 2, variant: 4 });
    // baseline/obelisk 撞色根因:同 colorIndex 不同 variant,fill 必须可辨
    expect(seriesFill(2, 1)).toBe("var(--niceeval-color-series-2)");
    expect(seriesFill(2, 3)).toBe("url(#niceeval-series-pat-v3-c2)");
    expect(seriesFill(2, 4)).toBe("url(#niceeval-series-pat-v4-c2)");
    expect(seriesFill(2, 3)).not.toBe(seriesFill(2, 4));
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

  it("FillSeriesPresentation 按 mark 产出可直接用的 fill(含 pattern url)", () => {
    const chart = elementOf(
      <Probe dimension="memory" encoding={FILL} values={["baseline", "obelisk"]} />,
    );
    const plan = collectPageDimensions(chart, {}, "web");
    const presented = plan.dimension(chart.props, "keys");
    const slots = plan.slotsByDimension.get("memory")!;
    // 复现真实撞色对:同页散列后 baseline=14 / obelisk=20 时 color 同 variant 不同
    for (const value of ["baseline", "obelisk"] as const) {
      // 不强钉槽位,只断言呈现是 fill 支且 fill 可区分
      const at = presented.at(["baseline", "obelisk"].indexOf(value));
      expect(at.kind).toBe("series");
      if (at.kind === "series" && (at.mark === "bar" || at.mark === "area")) {
        expect(at.fill.startsWith("var(") || at.fill.startsWith("url(#niceeval-series-pat-")).toBe(true);
        expect(at.stroke).toMatch(/^var\(--niceeval-color-series-[1-6]\)$/);
      }
    }
    // 若两值恰好同色不同 variant,fill 字符串必须不同
    const a = presented.at(0);
    const b = presented.at(1);
    if (
      a.kind === "series" &&
      b.kind === "series" &&
      (a.mark === "bar" || a.mark === "area") &&
      (b.mark === "bar" || b.mark === "area")
    ) {
      const sa = slots.get("baseline")!;
      const sb = slots.get("obelisk")!;
      if (seriesChannelsOf(sa).colorIndex === seriesChannelsOf(sb).colorIndex) {
        expect(a.fill).not.toBe(b.fill);
      }
    }
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
    // standalone 没有暴露 seriesSlot,用 stroke/dash 与页内对照
    for (const [index, value] of values.entries()) {
      const pageSlot = inPage.get(value)!;
      const at = standalone.at(index);
      expect(at.kind).toBe("series");
      if (at.kind === "series" && at.mark === "line") {
        const ch = seriesChannelsOf(pageSlot);
        expect(at.stroke).toBe(`var(--niceeval-color-series-${ch.colorIndex})`);
        expect(at.strokeDasharray).toBe(seriesStrokeDasharray(ch.variant));
      }
    }
  });
});

// ───────────────────────── MemoryBench 可辨性自检 ─────────────────────────

describe("MemoryBench leaderboard 五条件可辨", () => {
  it("memory 五值拿到两两可辨的 fill 身份(baseline 与 obelisk 同色不同 variant)", () => {
    const values = ["baseline", "mempal", "nowledge", "obelisk", "remem"] as const;
    const chart = elementOf(<Probe dimension="memory" encoding={FILL} values={values} />);
    const slots = slotsOf(chart, chart);
    const presented = presentDimension({
      dimension: "memory",
      encoding: { kind: "series", mark: "bar" },
      values,
    });
    const fills = new Map<string, string>();
    for (const [index, value] of values.entries()) {
      const at = presented.at(index);
      expect(at.kind).toBe("series");
      if (at.kind === "series" && at.mark === "bar") {
        fills.set(value, at.fill);
      }
    }
    // 五个 fill 两两不同
    expect(new Set(fills.values()).size).toBe(5);
    // 与截图复算一致:baseline slot 14 → c2 v3 pattern;obelisk slot 20 → c2 v4 pattern
    expect(slots.get("baseline")).toBe(14);
    expect(slots.get("obelisk")).toBe(20);
    expect(seriesChannelsOf(14)).toEqual({ colorIndex: 2, variant: 3 });
    expect(seriesChannelsOf(20)).toEqual({ colorIndex: 2, variant: 4 });
    expect(fills.get("baseline")).toBe("url(#niceeval-series-pat-v3-c2)");
    expect(fills.get("obelisk")).toBe("url(#niceeval-series-pat-v4-c2)");
  });
});
