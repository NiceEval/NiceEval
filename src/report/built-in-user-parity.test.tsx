// Phase 4 验收:证明内置报告 ExperimentComparison 与一份普通用户 --report 文件走的是
// 完全同一套机制 —— 不是长得像,而是同一条 build → resolveReportTree → validate → render 管线。
//
// 证据链(plan/built-in-reports-user-parity.md「Phase 4」):
//   1. test/fixtures/report/experiment-comparison-public-copy.tsx 只从公开 barrel import,
//      与 built-in 逐节点同构(见文件头)。
//   2. 同一 ReportContext 下分别 build + resolveReportTree,深比较 resolved 树:组件类型 / 顺序 /
//      resolved data / props keys 全部结构化相等(不靠 definition 引用相等,两份是独立文件)。
//   3. 两份分别过 renderReportToText / renderReportToStaticHtml,比较事实(散点键 / 表格行 /
//      attempt 深链),不做 HTML 字面 snapshot。
//   4. 覆盖 plan 的 9 个必测场景。
//   5. 架构不变量:renderer 源码零 "ExperimentComparison" / "built-ins" 分支。
//   6. show / view 只在「无 --report」分支选内置报告,--report 只换 definition,不碰
//      Selection / resolve / validate / render。

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EvalResult, Verdict } from "../types.ts";
import type { AttemptHandle, Results, Selection, Snapshot } from "../results/index.ts";
import type { ExperimentListItem, ScatterData } from "./types.ts";
import { encodeAttemptLocator } from "../results/locator.ts";
import { Col, ExperimentList, defineReport } from "./index.ts";
import { ExperimentComparison } from "./built-ins/index.ts";
import publicCopy from "../../test/fixtures/report/experiment-comparison-public-copy.tsx";
import { renderReportToText } from "./report.ts";
import { renderReportToStaticHtml } from "./web.ts";
import {
  createTextContext,
  renderNodeToText,
  resolveReportTree,
  runWithWebContext,
  validateReportTree,
  type ReportNode,
} from "./tree.ts";
import * as compute from "./compute.ts";

// ───────────────────────── fake Selection / Snapshot(按 results 读取契约造)─────────────────────────

// 夹具刻意做成纯确定性:同一 spec 每次都产出逐字节相同的 Snapshot —— 每个场景的 ctx() 被
// built-in / public-copy 分别调用一次,只有两份快照的身份元组(experimentId / snapshot
// startedAt / evalId / attempt)完全一致,locatorOf() 兜底算出的 AttemptLocator 才会相同,
// 跨 definition 的 attempt 深链集合与 resolved data 才可能相等。所以不用任何全局自增计数器。
function res(id: string, verdict: Verdict, extra: Partial<EvalResult> = {}): EvalResult {
  return {
    id,
    agent: "agent-x",
    verdict,
    attempt: 0,
    startedAt: "2026-07-01T10:00:00Z",
    durationMs: 1000,
    assertions: [],
    ...extra,
  };
}

interface SnapSpec {
  experimentId: string;
  agent: string;
  model?: string;
  results: EvalResult[];
}

function snap(spec: SnapSpec): Snapshot {
  // 每个 experiment 在一次 Selection 里只出现一次,固定 snap-1 目录即可确定且不冲突。
  const dirSuffix = `${spec.experimentId.replace(/\//g, "_")}/snap-1`;
  const base = {
    experimentId: spec.experimentId,
    startedAt: "2026-07-01T10:00:00Z",
    completedAt: "2026-07-01T10:00:30Z",
    agent: spec.agent,
    model: spec.model,
    schemaVersion: 1,
    dir: `/results/${dirSuffix}`,
  };
  const attempts: AttemptHandle[] = spec.results.map((r) => ({
    evalId: r.id,
    experimentId: spec.experimentId,
    result: { ...r, agent: spec.agent },
    ref: { snapshot: dirSuffix, attempt: `${r.id}/a${r.attempt}` },
    snapshot: base as unknown as Snapshot,
    events: async () => null,
    trace: async () => null,
    o11y: async () => null,
    agentSetup: async () => null,
    diff: async () => null,
    sources: async () => null,
  }));
  const evals = new Map<string, AttemptHandle[]>();
  for (const a of attempts) {
    const list = evals.get(a.evalId);
    if (list) list.push(a);
    else evals.set(a.evalId, [a]);
  }
  return {
    ...base,
    evals: [...evals.entries()].map(([id, list]) => ({ id, attempts: list })),
    attempts,
  } as unknown as Snapshot;
}

function selection(snapshots: Snapshot[]): Selection {
  const self: Selection = {
    snapshots,
    warnings: [],
    filter: (predicate) => selection(snapshots.filter(predicate)),
  };
  return self;
}

function ctxOf(sel: Selection): { selection: Selection; results: Results } {
  return { selection: sel, results: {} as Results };
}

// ── 场景夹具 ──

/**
 * 场景 1 + 2 + 5 + 6:三个 experiment、两个 agent。
 *  - compare/bub-low(bub):algebra/x 两轮(fail→pass,多轮 attempt)、algebra/y 通过,都有成本 → 可画点。
 *  - compare/codex-mid(codex):errored + skipped + passed 混合,有估算/实测成本 → 可画点。
 *  - solo/no-cost(bub):通过 + 失败,无任何成本 → scatter 缺 x(不可画),表格仍出行。
 */
function richContext() {
  return ctxOf(
    selection([
      snap({
        experimentId: "compare/bub-low",
        agent: "bub",
        model: "gpt-bub",
        results: [
          res("algebra/x", "failed", { attempt: 0, usage: { inputTokens: 10, outputTokens: 5, costUSD: 0.1 } }),
          res("algebra/x", "passed", { attempt: 1, usage: { inputTokens: 20, outputTokens: 10, costUSD: 0.2 } }),
          res("algebra/y", "passed", { attempt: 0, usage: { inputTokens: 5, outputTokens: 5, costUSD: 0.05 } }),
        ],
      }),
      snap({
        experimentId: "compare/codex-mid",
        agent: "codex",
        model: "gpt-codex",
        results: [
          res("algebra/x", "errored", {
            error: { code: "unexpected-error", message: "adapter crashed", operation: "eval.run" },
            estimatedCostUSD: 0.3,
          }),
          res("algebra/y", "skipped"),
          res("algebra/z", "passed", { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.15 } }),
        ],
      }),
      snap({
        experimentId: "solo/no-cost",
        agent: "bub",
        results: [res("algebra/x", "passed"), res("algebra/y", "failed")],
      }),
    ]),
  );
}

/** 场景 3:恰好一个可画点(A 有成本 → 可画;B 无成本 → 不可画)。 */
function oneDrawableContext() {
  return ctxOf(
    selection([
      snap({
        experimentId: "only/priced",
        agent: "bub",
        results: [res("algebra/x", "passed", { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.2 } })],
      }),
      snap({
        experimentId: "only/free",
        agent: "codex",
        results: [res("algebra/x", "passed")],
      }),
    ]),
  );
}

/** 场景 4:空 Selection —— 无任何快照,散点 0 可画点走空态,表格无行。 */
function emptyContext() {
  return ctxOf(selection([]));
}

/** 场景 4 变体:全部 skipped —— 指标全不可测(x/y 全 null),同样走散点空态。 */
function allSkippedContext() {
  return ctxOf(
    selection([
      snap({ experimentId: "exp/a", agent: "bub", results: [res("algebra/x", "skipped"), res("algebra/y", "skipped")] }),
    ]),
  );
}

const SCENARIOS: { name: string; ctx: () => ReturnType<typeof ctxOf> }[] = [
  { name: "多 experiment/agent、成本与通过率都有值(≥2 可画点)", ctx: richContext },
  { name: "恰好一个可画点", ctx: oneDrawableContext },
  { name: "空 Selection", ctx: emptyContext },
  { name: "全部 skipped(指标全不可测)", ctx: allSkippedContext },
];

// ───────────────────────── 树遍历工具 ─────────────────────────

const FRAGMENT = Symbol.for("react.fragment");

function isEl(n: unknown): n is { type: unknown; props: Record<string, unknown> } {
  return typeof n === "object" && n !== null && !Array.isArray(n) && "type" in n && "props" in n;
}

function labelOf(type: unknown): string {
  if (typeof type === "string") return `<${type}>`;
  if (type === FRAGMENT) return "<>";
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName ?? fn.name ?? "anonymous";
  }
  return String(type);
}

/** 把 resolved 树抹成可结构化比较的事实:组件标签 + props(去掉 children、函数值)+ children。 */
function factify(node: ReportNode): unknown {
  if (Array.isArray(node)) return node.map(factify);
  if (isEl(node)) {
    const { children, ...rest } = node.props;
    const props = JSON.parse(JSON.stringify(rest, (_k, v) => (typeof v === "function" ? "[fn]" : v)));
    return {
      component: labelOf(node.type),
      props,
      children: children === undefined ? null : factify(children as ReportNode),
    };
  }
  return node ?? null;
}

/** 前序遍历收集组件节点(标签 + 原始 props),用于按顺序 / 按类型取 resolved data。 */
function collect(node: ReportNode, acc: { label: string; props: Record<string, unknown> }[] = []) {
  if (Array.isArray(node)) {
    for (const c of node) collect(c, acc);
    return acc;
  }
  if (isEl(node)) {
    acc.push({ label: labelOf(node.type), props: node.props });
    collect(node.props.children as ReportNode, acc);
  }
  return acc;
}

async function resolvedTreeOf(def: { build: (c: never) => unknown }, ctx: ReturnType<typeof ctxOf>): Promise<ReportNode> {
  const node = (await (def as { build: (c: unknown) => ReportNode | Promise<ReportNode> }).build(ctx)) as ReportNode;
  return resolveReportTree(node);
}

function scatterOf(tree: ReportNode): ScatterData | undefined {
  return collect(tree).find((c) => c.label === "MetricScatter")?.props.data as ScatterData | undefined;
}
/** ExperimentList 没有 selection-form,树里的 props.items 就是 `await ExperimentList.data(selection)` 的产物。 */
function experimentListOf(tree: ReportNode): ExperimentListItem[] | undefined {
  return collect(tree).find((c) => c.label === "ExperimentList")?.props.items as ExperimentListItem[] | undefined;
}

/** HTML 里所有 attempt 深链,排序后便于集合比较。 */
function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="(#\/attempt\/[^"]+)"/g)].map((m) => m[1]).sort();
}
/** 散点 web 面每个点的 data-key。 */
function scatterKeysOf(html: string): string[] {
  return [...html.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]).sort();
}

/**
 * 这份夹具的 AttemptHandle 都不带 `.locator` 字段(snap() 手工构造,故意留白),
 * report 侧的 locatorOf() 按身份元组兜底算一份——这里复算同一个身份元组,验证深链确实
 * 指向 Selection 里真实存在的那个 attempt,而不是随便一个字符串。
 */
function expectedLocatorFor(attempt: AttemptHandle): string {
  return encodeAttemptLocator({
    experimentId: attempt.experimentId,
    snapshotStartedAt: attempt.snapshot.startedAt,
    evalId: attempt.evalId,
    attempt: attempt.result.attempt,
  });
}

// ═════════════════════════ 1. built-in 与 public-copy 逐节点同构 ═════════════════════════

describe("resolved 树结构化等价(built-in ≡ 包外 public-copy)", () => {
  it("两份是独立 ReportDefinition,不是同一引用", () => {
    expect(ExperimentComparison).not.toBe(publicCopy);
    expect(typeof ExperimentComparison.build).toBe("function");
    expect(typeof publicCopy.build).toBe("function");
  });

  for (const { name, ctx } of SCENARIOS) {
    it(`同一 ReportContext 下 resolved 树逐节点相等 — ${name}`, async () => {
      const c = ctx();
      const builtIn = await resolvedTreeOf(ExperimentComparison, c);
      const user = await resolvedTreeOf(publicCopy, ctx()); // 各用一份等价 ctx,证明不依赖共享状态

      // 组件类型与顺序:<Col> 包 [MetricScatter, ExperimentList],别无它物。
      const labels = collect(builtIn).map((n) => n.label);
      expect(labels).toEqual(["Col", "MetricScatter", "ExperimentList"]);
      expect(collect(user).map((n) => n.label)).toEqual(labels);

      // 逐节点结构化相等:组件类型、顺序、resolved data、props keys(pointHref/filter/…)全一致。
      expect(factify(user)).toEqual(factify(builtIn));

      // resolved data 本身也逐字段相等(不只是树同构)。
      expect(scatterOf(user)).toEqual(scatterOf(builtIn));
      expect(experimentListOf(user)).toEqual(experimentListOf(builtIn));
    });
  }
});

// ═════════════════════════ 2. 9 个必测场景的 resolved 事实 ═════════════════════════

describe("必测场景:resolved data 事实", () => {
  it("场景 1+2:多 experiment/agent,成本与通过率都有值;缺成本的点如实 x=null,实验列表仍出项", async () => {
    const tree = await resolvedTreeOf(ExperimentComparison, richContext());
    const scatter = scatterOf(tree)!;
    const experiments = experimentListOf(tree)!;

    // 散点:points=experiment、series=agent、x=cost、y=task-pass-rate
    expect(scatter.points).toBe("experiment");
    expect(scatter.series).toBe("agent");
    expect(scatter.x.key).toBe("cost");
    expect(scatter.y.key).toBe("task-pass-rate");
    expect(scatter.rows.map((r) => r.key).sort()).toEqual(["compare/bub-low", "compare/codex-mid", "solo/no-cost"]);

    const bub = scatter.rows.find((r) => r.key === "compare/bub-low")!;
    expect(bub.series).toBe("bub");
    // 两级聚合:algebra/x=(0.1,0.2)→0.15、algebra/y=0.05 → across mean 0.1;pass (0,1)→0.5、1 → 0.75
    expect(bub.x.value).toBeCloseTo(0.1, 10);
    expect(bub.y.value).toBeCloseTo(0.75, 10);
    const codex = scatter.rows.find((r) => r.key === "compare/codex-mid")!;
    expect(codex.series).toBe("codex");
    expect(codex.x.value).toBeCloseTo(0.225, 10); // errored 0.3 与 passed 0.15,skipped 不计
    // taskPassRate:errored / skipped 都是 null 不进分母,只有 algebra/z 真被答过(通过)→ 1
    expect(codex.y.value).toBeCloseTo(1, 10);

    // 场景 2:solo/no-cost 缺成本 → x 为 null(点在,不可画),y 仍有值
    const solo = scatter.rows.find((r) => r.key === "solo/no-cost")!;
    expect(solo.x.value).toBeNull();
    expect(solo.y.value).toBeCloseTo(0.5, 10);
    // ≥2 可画点
    expect(scatter.rows.filter((r) => r.x.value !== null && r.y.value !== null)).toHaveLength(2);

    // 实验列表仍为每个 experiment 出一项,包括缺成本的 solo
    expect(experiments.map((e) => e.experimentId).sort()).toEqual(["compare/bub-low", "compare/codex-mid", "solo/no-cost"]);
    expect(experiments.find((e) => e.experimentId === "solo/no-cost")!.cost.value).toBeNull();
  });

  it("场景 3:恰好一个可画点(另一实验缺成本)", async () => {
    const tree = await resolvedTreeOf(ExperimentComparison, oneDrawableContext());
    const scatter = scatterOf(tree)!;
    const drawable = scatter.rows.filter((r) => r.x.value !== null && r.y.value !== null);
    expect(drawable).toHaveLength(1);
    expect(drawable[0].key).toBe("only/priced");
  });

  it("场景 4:空 Selection —— 散点无 rows、实验列表为空数组", async () => {
    const tree = await resolvedTreeOf(ExperimentComparison, emptyContext());
    expect(scatterOf(tree)!.rows).toEqual([]);
    expect(experimentListOf(tree)).toEqual([]);
  });

  it("场景 4 变体:全 skipped —— 每个点 x/y 都不可测,0 可画点", async () => {
    const tree = await resolvedTreeOf(ExperimentComparison, allSkippedContext());
    const scatter = scatterOf(tree)!;
    expect(scatter.rows.every((r) => r.x.value === null && r.y.value === null)).toBe(true);
    expect(scatter.rows.filter((r) => r.x.value !== null && r.y.value !== null)).toHaveLength(0);
  });

  it("场景 5:failed/errored/skipped 混合 —— ExperimentList 展开区结果摘要正确(eval 级折叠计票)", async () => {
    const tree = await resolvedTreeOf(ExperimentComparison, richContext());
    const codex = experimentListOf(tree)!.find((e) => e.experimentId === "compare/codex-mid")!;
    // algebra/x errored、algebra/y skipped、algebra/z passed → eval 级折叠 {passed:1, errored:1, skipped:1}
    expect(codex.verdicts).toEqual({ passed: 1, failed: 0, errored: 1, skipped: 1 });
    const errored = codex.evalRows.find((e) => e.evalId === "algebra/x")!;
    expect(errored.verdict).toBe("errored");
    expect(errored.reason).toBe("adapter crashed");
    expect(codex.evalRows.find((e) => e.evalId === "algebra/y")!.verdict).toBe("skipped");
  });

  it("场景 6:同 experiment 多 eval、多 attempts —— 展开层与 attempt locator 正确", async () => {
    const tree = await resolvedTreeOf(ExperimentComparison, richContext());
    const bub = experimentListOf(tree)!.find((e) => e.experimentId === "compare/bub-low")!;
    expect(bub.evalRows.map((e) => e.evalId).sort()).toEqual(["algebra/x", "algebra/y"]);
    const multi = bub.evalRows.find((e) => e.evalId === "algebra/x")!;
    // 多轮 attempt 折成 passed(任一轮通过),两次 attempt 都在展开区的 attempts 里
    expect(multi.verdict).toBe("passed");
    expect(multi.attempts.map((a) => a.attempt)).toEqual([0, 1]);
    expect(multi.attempts.map((a) => a.verdict)).toEqual(["failed", "passed"]);
    // attempt locator 唯一、格式正确 —— 回到证据的引用不丢
    const locators = multi.attempts.map((a) => a.locator);
    expect(new Set(locators).size).toBe(2);
    for (const locator of locators) expect(locator).toMatch(/^@1[0-9a-z]{7}$/);
  });
});

// ═════════════════════════ 3. text / web 渲染的事实相同 ═════════════════════════

describe("built-in 与 public-copy 渲染出的事实相同", () => {
  for (const { name, ctx } of SCENARIOS) {
    it(`text / web 事实一致 — ${name}`, async () => {
      const builtinText = await renderReportToText(ExperimentComparison, ctx(), { width: 100 });
      const userText = await renderReportToText(publicCopy, ctx(), { width: 100 });
      // 同一机制、同一 options:text 输出逐字相等(最强的事实级证据)。
      expect(userText).toBe(builtinText);

      const builtinHtml = await renderReportToStaticHtml(ExperimentComparison, ctx());
      const userHtml = await renderReportToStaticHtml(publicCopy, ctx());
      // 事实比较(不做整段 HTML snapshot):散点点键、attempt 深链集合相同。
      expect(scatterKeysOf(userHtml)).toEqual(scatterKeysOf(builtinHtml));
      expect(hrefsOf(userHtml)).toEqual(hrefsOf(builtinHtml));
    });
  }

  it("场景 8:view 的 attemptHref 深链格式与用户 --report 完全一致", async () => {
    const ctx = richContext();
    // renderReportToStaticHtml 默认 attemptHref = view 的 `#/attempt/@<locator>`(不透明单段路由,
    // 与 view/data.ts renderReportSlot 不传 attemptHref 时同一条默认路径)。
    const builtinHtml = await renderReportToStaticHtml(ExperimentComparison, ctx);
    const userHtml = await renderReportToStaticHtml(publicCopy, richContext());
    const builtinHrefs = hrefsOf(builtinHtml);
    const userHrefs = hrefsOf(userHtml);
    expect(userHrefs).toEqual(builtinHrefs);
    expect(builtinHrefs.length).toBeGreaterThan(0);
    for (const href of builtinHrefs) {
      expect(href).toMatch(/^#\/attempt\/@[0-9a-z]+$/);
    }
    // 每个深链都指向 Selection 里真实存在的 attempt(身份元组确定性派生同一个 locator)。
    const realDeepLinks = new Set(
      ctx.selection.snapshots.flatMap((s) => s.attempts.map((a) => `#/attempt/${expectedLocatorFor(a)}`)),
    );
    for (const href of builtinHrefs) expect(realDeepLinks.has(href)).toBe(true);
    // errored eval 一定被深链(codex-mid 的 algebra/x)
    const erroredAttempt = ctx.selection.snapshots
      .flatMap((s) => s.attempts)
      .find((a) => a.experimentId === "compare/codex-mid" && a.evalId === "algebra/x")!;
    expect(builtinHrefs).toContain(`#/attempt/${expectedLocatorFor(erroredAttempt)}`);
  });
});

// ═════════════════════════ 4. 散点空 / 单点 / 多点行为(text + web 同一事实)═════════════════════════

describe("散点空态 / 单点 / 多点行为", () => {
  it("0 可画点(空 Selection):text 说 No data、web 走 nre-scatter-empty nre-missing", async () => {
    const text = await renderReportToText(ExperimentComparison, emptyContext(), { width: 100 });
    expect(text).toContain("No data to plot");
    expect(text).not.toContain("better → upper right");
    const html = await renderReportToStaticHtml(ExperimentComparison, emptyContext());
    expect(html).toContain("nre-scatter-empty");
    expect(html).toContain("nre-missing");
  });

  it("恰好 1 可画点:text/web 都正常画单点", async () => {
    const text = await renderReportToText(ExperimentComparison, oneDrawableContext(), { width: 100 });
    expect(text).toContain("better → upper right");
    const html = await renderReportToStaticHtml(ExperimentComparison, oneDrawableContext());
    expect(html).toContain("nre-scatter-point");
    expect(html).not.toContain("nre-scatter-empty");
    expect(html).not.toContain("nre-scatter-empty nre-missing");
    expect(html).toContain("<svg");
  });

  it("≥2 可画点:正常绘图(text 有 better → upper right,web 有 svg)", async () => {
    const text = await renderReportToText(ExperimentComparison, richContext(), { width: 100 });
    expect(text).toContain("better → upper right");
    const html = await renderReportToStaticHtml(ExperimentComparison, richContext());
    expect(html).toContain("<svg");
    expect(html).not.toContain("nre-scatter-empty");
  });
});

// ═════════════════════════ 5. 场景 7:数据只 resolve 一次,locale 只改 chrome ═════════════════════════

describe("场景 7:en / zh-CN 数据 resolve 一次、chrome 分别本地化", () => {
  it("resolve 一次的同一棵树,en / zh-CN 各渲染一遍:data 事实相同,只有 chrome 文案不同", async () => {
    // 关键:build + resolveReportTree 只做一次,拿到唯一的 resolved 树;两个 locale 复用它。
    const node = (await ExperimentComparison.build(richContext())) as ReportNode;
    const resolved = await resolveReportTree(node);
    validateReportTree(resolved);

    // 同一棵 resolved 树 → data 只算了一次(下方 spy 版另证调用次数)。
    const scatter = scatterOf(resolved)!;
    const experiments = experimentListOf(resolved)!;

    const enText = renderNodeToText(resolved, createTextContext({ width: 100, locale: "en" }));
    const zhText = renderNodeToText(resolved, createTextContext({ width: 100, locale: "zh-CN" }));
    const enHtml = runWithWebContext(
      { attemptHref: (locator) => `#/attempt/${locator}`, locale: "en" },
      () => renderToStaticMarkup(resolved as never),
    );
    const zhHtml = runWithWebContext(
      { attemptHref: (locator) => `#/attempt/${locator}`, locale: "zh-CN" },
      () => renderToStaticMarkup(resolved as never),
    );

    // chrome 分语言
    expect(enText).toContain("Pass rate");
    expect(zhText).toContain("成功率");
    expect(enHtml).toContain("Pass rate");
    expect(zhHtml).toContain("成功率");
    expect(enText).not.toEqual(zhText);

    // 但两语言下的事实(散点键 / x / y、attempt 深链)完全相同 —— 数据没被重算成不同结果。
    expect(scatterKeysOf(zhHtml)).toEqual(scatterKeysOf(enHtml));
    expect(hrefsOf(zhHtml)).toEqual(hrefsOf(enHtml));
    // 从同一棵 resolved 树取的 data,en/zh 渲染不改变它
    expect(scatter.rows.map((r) => r.key)).toEqual(["compare/bub-low", "compare/codex-mid", "solo/no-cost"]);
    const [bub, codex, solo] = scatter.rows;
    expect(bub.x.value).toBeCloseTo(0.1, 10);
    expect(bub.y.value).toBeCloseTo(0.75, 10);
    expect(codex.x.value).toBeCloseTo(0.225, 10);
    expect(codex.y.value).toBeCloseTo(1, 10); // taskPassRate:errored/skipped → null,只剩通过的 algebra/z
    expect(solo.x.value).toBeNull();
    expect(solo.y.value).toBeCloseTo(0.5, 10);
    // ExperimentList 按 taskPassRate 从高到低:codex-mid(1)> bub-low(0.75)> solo(0.5)
    expect(experiments.map((e) => e.experimentId)).toEqual(["compare/codex-mid", "compare/bub-low", "solo/no-cost"]);
  });

  it("spy 佐证:build() 里各计算函数恰好调用一次,随后两 locale 渲染不再重算", async () => {
    const scatterSpy = vi.spyOn(compute, "scatterData");
    // 注意:spy 挂在 ExperimentList.data 本身,不是 compute.experimentListData —— components.tsx
    // 用 `Object.assign(component, { data: experimentListData })` 把函数值复制成一个普通属性,
    // 那份拷贝在 components.tsx 求值时(模块加载期)就定死了,晚于此的 vi.spyOn(compute, …) патch
    // 不到已经复制走的引用。直接调用方(built-ins/experiment-comparison.tsx)读的是
    // `ExperimentList.data` 这个属性,所以要在这个属性上打桩。MetricScatter 不受影响:它的
    // resolve() 住在 components.tsx 里,调用的是 scatterData 这个 import 绑定本身(ESM 实时绑定),
    // vi.spyOn(compute, "scatterData") 打得中。
    const experimentListSpy = vi.spyOn(ExperimentList, "data");
    try {
      // ExperimentList 没有 resolve 面,.data() 直接在 build() 里 await——计算发生在 build,
      // 不是 resolveReportTree;MetricScatter 仍是 selection-form,resolve 阶段才调它的 .data()。
      const node = (await ExperimentComparison.build(richContext())) as ReportNode;
      expect(experimentListSpy).toHaveBeenCalledTimes(1);
      const resolved = await resolveReportTree(node);
      expect(scatterSpy).toHaveBeenCalledTimes(1);
      expect(experimentListSpy).toHaveBeenCalledTimes(1);

      // 渲染面纯同步、零 IO:两 locale 渲染同一棵 resolved 树,不再触发任何计算。
      renderNodeToText(resolved, createTextContext({ locale: "en" }));
      renderNodeToText(resolved, createTextContext({ locale: "zh-CN" }));
      expect(scatterSpy).toHaveBeenCalledTimes(1);
      expect(experimentListSpy).toHaveBeenCalledTimes(1);
    } finally {
      scatterSpy.mockRestore();
      experimentListSpy.mockRestore();
    }
  });
});

// ═════════════════════════ 6. 场景 9:只放 ExperimentList 的最小报告不触发散点计算 ═════════════════════════

describe("场景 9:最小用户报告只放 <ExperimentList> —— 不计算散点", () => {
  const minimal = defineReport(async ({ selection }) => {
    const experiments = await ExperimentList.data(selection);
    return (
      <Col>
        <ExperimentList items={experiments} />
      </Col>
    );
  });

  it("结构性缺席:resolved 树里没有 MetricScatter 节点", async () => {
    const tree = await resolvedTreeOf(minimal, richContext());
    expect(collect(tree).map((n) => n.label)).toEqual(["Col", "ExperimentList"]);
    expect(scatterOf(tree)).toBeUndefined();
    expect(experimentListOf(tree)).toBeDefined();
  });

  it("spy 佐证:scatterData 从未被调用,experimentListData 调一次", async () => {
    const scatterSpy = vi.spyOn(compute, "scatterData");
    // 见上一个 describe 块的注释:直接调用方读的是 ExperimentList.data 属性,打桩要打在这上面。
    const experimentListSpy = vi.spyOn(ExperimentList, "data");
    try {
      await resolvedTreeOf(minimal, richContext());
      expect(scatterSpy).not.toHaveBeenCalled();
      expect(experimentListSpy).toHaveBeenCalledTimes(1);
    } finally {
      scatterSpy.mockRestore();
      experimentListSpy.mockRestore();
    }
  });

  it("用户换指标/维度无需框架新增分支:改 points/series 只改 resolved data,不改机制", async () => {
    // 一份「用户自定义」报告:同一 MetricScatter 组件,换成 model 维度 + 只画一个指标轴组合。
    const custom = defineReport(async ({ selection }) => {
      const { MetricScatter, costUSD, tokens } = await import("./index.ts");
      return (
        <Col>
          <MetricScatter selection={selection} points="agent" series="model" x={tokens} y={costUSD} />
        </Col>
      );
    });
    const tree = await resolvedTreeOf(custom, richContext());
    const scatter = scatterOf(tree)!;
    expect(scatter.points).toBe("agent");
    expect(scatter.series).toBe("model");
    expect(scatter.x.key).toBe("tokens");
    expect(scatter.y.key).toBe("cost");
    // 走的仍是同一条 resolve 管线,不需要任何 built-in 专属处理。
    expect(collect(tree).map((n) => n.label)).toEqual(["Col", "MetricScatter"]);
  });
});

// ═════════════════════════ 7. 架构不变量:renderer 无 built-in 分支 ═════════════════════════

describe("架构不变量:renderer 不认识 built-in", () => {
  const RENDERER_FILES = ["./report.ts", "./web.ts", "./tree.ts"];
  for (const rel of RENDERER_FILES) {
    it(`${rel} 源码里没有 "ExperimentComparison" / "built-ins" 分支`, () => {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      expect(src).not.toContain("ExperimentComparison");
      expect(src).not.toContain("built-ins");
    });
  }
});

// ═════════════════════════ 8. 宿主选择:show / view 共用默认 definition ═════════════════════════

describe("宿主选择:裸 show / view 共用 ExperimentComparison,--report 替换 definition", () => {
  it("show / view 源码:Selection 先合成,随后选择内置或用户 definition", () => {
    const showSrc = readFileSync(new URL("../show/index.ts", import.meta.url), "utf8");
    expect(showSrc).toMatch(/import \{ ExperimentComparison \} from "\.\.\/\.\.\/dist\/report\/built-ins\/index\.js"/);
    expect(showSrc).toMatch(/flags\.report === undefined \? ExperimentComparison : await loadReportFile\(cwd, flags\.report\)/);
    expect(showSrc).not.toContain("showIndexText(selection");
    // Selection 在报告槽之前、与 report 无关地由 selectCurrentResults 合成。
    expect(showSrc).toMatch(/selectCurrentResults\(results, \{ experiment: flags\.experiment, patterns \}\)/);

    const viewSrc = readFileSync(new URL("../view/data.ts", import.meta.url), "utf8");
    // view 的报告槽:report 有值走 loadReportFile,否则 ExperimentComparison;Selection 同样先于报告槽合成。
    expect(viewSrc).toMatch(/report\s*\?[\s\S]*loadReportFile[\s\S]*:\s*\(await import\([^)]*built-ins[^)]*\)\)\.ExperimentComparison/);
    expect(viewSrc).toMatch(/selectCurrentResults\(results, \{ experiment: opts\.experiment, patterns \}\)/);
  });

  it("ExperimentComparison 与 public-copy 作为显式报告时事实完全相同", async () => {
    for (const { ctx } of SCENARIOS) {
      const bareText = await renderReportToText(ExperimentComparison, ctx(), { width: 100 });
      const reportText = await renderReportToText(publicCopy, ctx(), { width: 100 });
      expect(reportText).toBe(bareText);

      const bareHtml = await renderReportToStaticHtml(ExperimentComparison, ctx());
      const reportHtml = await renderReportToStaticHtml(publicCopy, ctx());
      expect(scatterKeysOf(reportHtml)).toEqual(scatterKeysOf(bareHtml));
      expect(hrefsOf(reportHtml)).toEqual(hrefsOf(bareHtml));
    }
  });
});
