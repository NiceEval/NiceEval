// 实体列表的闭合数据形状与纯字符串布局函数。
// 旧源中的 Sample / Analysis 读取、aggregate、证据折叠和 detail target wrappers 已删除；
// 当前文件只接受 integrator 已经闭合的 old-shape ExperimentListItem[]。

import type {
  AttemptLocator,
  MetricValue,
  Verdict,
} from "../../components/cell.tsx";

export type EvaluationKindComposition = "pass" | "points" | "mixed";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** 一个层级共用的四枚闭合读数。 */
export interface ExperimentMetrics {
  readonly passRate?: MetricValue<number>;
  readonly score?: MetricValue<number>;
  readonly durationMs?: MetricValue<number>;
  readonly costUSD?: MetricValue<number>;
  readonly tokens?: MetricValue<number>;
}

/** 一次 attempt 的闭合行。 */
export interface AttemptListItem {
  readonly locator: AttemptLocator;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  /** 证据读取失败时为 null(不伪造判定)。 */
  readonly verdict: Verdict | null;
  /** closed 数据没有可读摘录时为 null(渲染成 "—",不发明文案)。 */
  readonly failureSummary: string | null;
  readonly evaluationKind: "pass" | "points";
  readonly score?: MetricValue<number>;
  readonly passRate?: MetricValue<number>;
  readonly durationMs?: MetricValue<number>;
  readonly costUSD?: MetricValue<number>;
  readonly tokens?: MetricValue<number>;
  /** 所属 selected Run 的 startedAt；只用于旧 FailureList 排序语义。 */
  readonly startedAt: number | null;
  /** 闭合详情 href；presentation 按当前固定 hash route 从 locator 建链。 */
  readonly href: string;
}

/** experiment 层级表里一道 Eval 的闭合行;attempts 是它的可见子行。 */
export interface ExperimentListEvalRow {
  readonly evalId: string;
  readonly evaluationKind: "pass" | "points";
  readonly score?: MetricValue<number>;
  readonly endToEndPassRate?: MetricValue<number>;
  readonly durationMs?: MetricValue<number>;
  readonly costUSD?: MetricValue<number>;
  readonly tokens?: MetricValue<number>;
  readonly attempts: readonly AttemptListItem[];
}

/** 一个 experiment 的闭合行。 */
export interface ExperimentListItem {
  readonly experimentId: string;
  readonly agent: string | null;
  readonly model: string | null;
  readonly flags: Readonly<globalThis.Record<string, JsonValue>> | null;
  readonly evaluationKind: EvaluationKindComposition;
  readonly score?: MetricValue<number>;
  readonly endToEndPassRate?: MetricValue<number>;
  readonly durationMs?: MetricValue<number>;
  readonly costUSD?: MetricValue<number>;
  readonly tokens?: MetricValue<number>;
  readonly missingEvalIds: readonly string[];
  /** key 是完整组前缀(如 "downshift/basic")。 */
  readonly groupMetrics: ReadonlyMap<string, ExperimentMetrics>;
  readonly evalRows: readonly ExperimentListEvalRow[];
  readonly href: string;
}

/** Eval 路径层级布局：叶子 / 路径段组。 */
export type EvalLayoutNode =
  | { readonly kind: "leaf"; readonly evalId: string }
  | {
      readonly kind: "group";
      readonly segment: string;
      readonly prefix: string;
      readonly children: readonly EvalLayoutNode[];
    };

/** 相对已表达前缀的剩余路径;无前缀时是完整 evalId。 */
export function relativeEvalLabel(evalIdValue: string, labelPrefix: string): string {
  if (!labelPrefix) return evalIdValue;
  const prefix = `${labelPrefix}/`;
  return evalIdValue.startsWith(prefix) ? evalIdValue.slice(prefix.length) : evalIdValue;
}

function joinEvalPath(prefix: string, segment: string): string {
  return prefix ? `${prefix}/${segment}` : segment;
}

/**
 * Eval 路径段 → 层级布局。两条收起条件在每一层兄弟之间各自判定：
 * 唯一组且无叶时剥壳前进,不插组行;组全为单成员或本层只有叶时全部放平。
 * 纯字符串投影,不读任何指标。
 */
export function experimentEvalLayout(evalIdValues: readonly string[]): readonly EvalLayoutNode[] {
  return layoutLevel(evalIdValues, "");
}

function layoutLevel(members: readonly string[], dirPrefix: string): readonly EvalLayoutNode[] {
  if (members.length === 0) return [];
  const leaves: string[] = [];
  const groups = new Map<string, string[]>();
  for (const member of members) {
    const remaining = relativeEvalLabel(member, dirPrefix).split("/").filter(Boolean);
    if (remaining.length <= 1) {
      leaves.push(member);
      continue;
    }
    const head = remaining[0]!;
    const list = groups.get(head);
    if (list) list.push(member);
    else groups.set(head, [member]);
  }
  const collapse =
    groups.size === 0 ||
    (groups.size === 1 && leaves.length === 0) ||
    [...groups.values()].every((group) => group.length === 1);
  if (collapse) {
    if (groups.size === 1 && leaves.length === 0) {
      const head = [...groups.keys()][0]!;
      return layoutLevel(members, joinEvalPath(dirPrefix, head));
    }
    return [...leaves]
      .sort((left, right) => left.localeCompare(right))
      .map((member): EvalLayoutNode => ({ kind: "leaf", evalId: member }));
  }
  const groupNodes: EvalLayoutNode[] = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([segment, groupMembers]) => ({
      kind: "group" as const,
      segment,
      prefix: joinEvalPath(dirPrefix, segment),
      children: layoutLevel(groupMembers, joinEvalPath(dirPrefix, segment)),
    }));
  const leafNodes: EvalLayoutNode[] = [...leaves]
    .sort((left, right) => left.localeCompare(right))
    .map((member): EvalLayoutNode => ({ kind: "leaf", evalId: member }));
  return [...groupNodes, ...leafNodes];
}

/** 一份旧 Experiment 列表的题型构成；与默认排序选择同源。 */
export function experimentListEvaluationKindComposition(
  items: readonly ExperimentListItem[],
): EvaluationKindComposition {
  const hasPoints = items.some((item) => item.evaluationKind !== "pass");
  if (!hasPoints) return "pass";
  return items.some((item) => item.evaluationKind !== "points") ? "mixed" : "points";
}

/**
 * 旧列表初始排序：纯通过制按 endToEndPassRate；含分数制时按 Inspection score 降序。
 * 缺数据沉底，同值按 experimentId 字典序收口。输入数组不原地修改。
 */
export function sortExperimentListItems(
  items: readonly ExperimentListItem[],
): readonly ExperimentListItem[] {
  const composition = experimentListEvaluationKindComposition(items);
  return [...items].sort(byMetricDescThenId((item) =>
    composition !== "pass" ? item.score?.value ?? null : item.endToEndPassRate?.value ?? null
  ));
}

function byMetricDescThenId(
  valueOf: (item: ExperimentListItem) => number | null,
): (left: ExperimentListItem, right: ExperimentListItem) => number {
  return (left, right) => {
    const leftValue = valueOf(left);
    const rightValue = valueOf(right);
    if (leftValue === null && rightValue === null) {
      return left.experimentId.localeCompare(right.experimentId);
    }
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return rightValue - leftValue || left.experimentId.localeCompare(right.experimentId);
  };
}
