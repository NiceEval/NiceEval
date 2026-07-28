// 官方双面组件的装配点:web 面(./ExperimentList.tsx / EvalList.tsx / AttemptList.tsx 的纯
// React 组件)+ text 面(./faces.ts)+ resolve 解析面(spec 形态由管线代调配套 ./compute.ts)。
// FailureList 是组合组件,内部就是 attemptListData → 过滤 → AttemptList data 形态,不产生
// 自己的 data。

import { defineComponent, type ReportComponent } from "../../definition/tree.ts";
import type { AttemptListItem, EvalListItem, ExperimentListItem, ReportInput } from "../../model/types.ts";
import type { AttemptLocator } from "../../../record/locator.ts";
import { collectItems, locatorOf, resolveInput } from "../../model/aggregate.ts";
import type { ReportLocale } from "../../model/locale.ts";
import {
  arrayProblem,
  cellProblem,
  isObject,
  makeDataComponent,
  hrefOf,
  tallyProblem,
  type ChromeProps,
  type DataProps,
  type Validator,
} from "../shared.ts";
import { attemptListData, evalListData, experimentListData } from "./compute.ts";
import { attemptListText, evalListText, experimentListText } from "./faces.ts";
import { AttemptList as AttemptListWeb } from "./AttemptList.tsx";
import { EvalList as EvalListWeb } from "./EvalList.tsx";
import { ExperimentList as ExperimentListWeb } from "./ExperimentList.tsx";

/** AttemptListItem(src/report/model/types.ts):三个组件族共用的叶子形状(独立 data 或嵌套在 evalRows/attempts 里)。 */
function attemptListItemProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object`;
  if (typeof value.experimentId !== "string") return `"${path}.experimentId" must be a string`;
  if (typeof value.evalId !== "string") return `"${path}.evalId" must be a string`;
  if (typeof value.attempt !== "number") return `"${path}.attempt" must be a number`;
  if (typeof value.agent !== "string") return `"${path}.agent" must be a string`;
  if (typeof value.verdict !== "string") return `"${path}.verdict" must be a string`;
  if (!(value.failureSummary === null || typeof value.failureSummary === "string")) {
    return `"${path}.failureSummary" must be a string or null`;
  }
  if (typeof value.moreFailures !== "number") return `"${path}.moreFailures" must be a number`;
  const examScoreProblem = cellProblem(value.examScore, `${path}.examScore`);
  if (examScoreProblem !== null) return examScoreProblem;
  const totalScoreProblem = cellProblem(value.totalScore, `${path}.totalScore`);
  if (totalScoreProblem !== null) return totalScoreProblem;
  if (typeof value.durationMs !== "number") return `"${path}.durationMs" must be a number`;
  if (!(value.costUSD === null || typeof value.costUSD === "number")) return `"${path}.costUSD" must be a number or null`;
  if (typeof value.startedAt !== "string") return `"${path}.startedAt" must be a string`;
  if (typeof value.historical !== "boolean") return `"${path}.historical" must be a boolean`;
  if (typeof value.locator !== "string") return `"${path}.locator" must be a string`;
  return null;
}

export const validateExperimentListData: Validator = (data) =>
  arrayProblem(data, "data", (item, path) => {
    if (!isObject(item)) return `"${path}" must be an object`;
    if (typeof item.experimentId !== "string") return `"${path}.experimentId" must be a string`;
    if (typeof item.agent !== "string") return `"${path}.agent" must be a string`;
    if (typeof item.scoring !== "string") return `"${path}.scoring" must be a string`;
    const verdictsProblem = tallyProblem(item.evalVerdicts, `${path}.evalVerdicts`);
    if (verdictsProblem !== null) return verdictsProblem;
    const passRateProblem = cellProblem(item.endToEndPassRate, `${path}.endToEndPassRate`);
    if (passRateProblem !== null) return passRateProblem;
    const totalScoreProblem = cellProblem(item.totalScore, `${path}.totalScore`);
    if (totalScoreProblem !== null) return totalScoreProblem;
    const costProblem = cellProblem(item.costUSD, `${path}.costUSD`);
    if (costProblem !== null) return costProblem;
    const durationProblem = cellProblem(item.durationMs, `${path}.durationMs`);
    if (durationProblem !== null) return durationProblem;
    const tokensProblem = cellProblem(item.tokens, `${path}.tokens`);
    if (tokensProblem !== null) return tokensProblem;
    if (typeof item.evals !== "number") return `"${path}.evals" must be a number`;
    if (typeof item.attempts !== "number") return `"${path}.attempts" must be a number`;
    if (typeof item.historicalAttempts !== "number") return `"${path}.historicalAttempts" must be a number`;
    const missingProblem = arrayProblem(item.missingEvalIds, `${path}.missingEvalIds`, (id, idPath) =>
      typeof id === "string" ? null : `"${idPath}" must be a string`,
    );
    if (missingProblem !== null) return missingProblem;
    if (typeof item.lastRunAt !== "string") return `"${path}.lastRunAt" must be a string`;
    return arrayProblem(item.evalRows, `${path}.evalRows`, (row, rowPath) => {
      if (!isObject(row) || typeof row.evalId !== "string") {
        return `"${rowPath}" must be an object with a string "evalId"`;
      }
      const rowTotalScoreProblem = cellProblem(row.totalScore, `${rowPath}.totalScore`);
      if (rowTotalScoreProblem !== null) return rowTotalScoreProblem;
      const rowDurationProblem = cellProblem(row.durationMs, `${rowPath}.durationMs`);
      if (rowDurationProblem !== null) return rowDurationProblem;
      const rowCostProblem = cellProblem(row.costUSD, `${rowPath}.costUSD`);
      if (rowCostProblem !== null) return rowCostProblem;
      return arrayProblem(row.attempts, `${rowPath}.attempts`, attemptListItemProblem);
    });
  });
export const validateEvalListData: Validator = (data) =>
  arrayProblem(data, "data", (item, path) => {
    if (!isObject(item)) return `"${path}" must be an object`;
    if (typeof item.experimentId !== "string") return `"${path}.experimentId" must be a string`;
    if (typeof item.evalId !== "string") return `"${path}.evalId" must be a string`;
    if (typeof item.verdict !== "string") return `"${path}.verdict" must be a string`;
    const examScoreProblem = cellProblem(item.examScore, `${path}.examScore`);
    if (examScoreProblem !== null) return examScoreProblem;
    const totalScoreProblem = cellProblem(item.totalScore, `${path}.totalScore`);
    if (totalScoreProblem !== null) return totalScoreProblem;
    const durationProblem = cellProblem(item.durationMs, `${path}.durationMs`);
    if (durationProblem !== null) return durationProblem;
    const costProblem = cellProblem(item.costUSD, `${path}.costUSD`);
    if (costProblem !== null) return costProblem;
    return arrayProblem(item.attempts, `${path}.attempts`, attemptListItemProblem);
  });
export const validateAttemptListData: Validator = (data) => arrayProblem(data, "data", attemptListItemProblem);

// ───────────────────────── 实体列表 ─────────────────────────

interface EntityListChrome extends ChromeProps {
  attemptHref?: (locator: AttemptLocator) => string;
}

export type ExperimentListProps = DataProps<
  readonly ExperimentListItem[],
  globalThis.Record<never, never>,
  EntityListChrome & {
    /** web 面在比较表前显示实验过滤框;text 面忽略。 */
    filter?: boolean;
  }
>;

/**
 * 实验列表:每项一个 experiment,固定八列比较表 + 展开到 Eval / Attempt。行标签是
 * experiment id 在当前列表里的最短唯一后缀(与 MetricScatter 点标签同一算法,重名逐步
 * 加长到能区分为止);完整 id 不受影响,仍是排序 / 过滤 / 折叠的键。
 */
export const ExperimentList = makeDataComponent<
  readonly ExperimentListItem[],
  globalThis.Record<never, never>,
  EntityListChrome & { filter?: boolean }
>({
  name: "ExperimentList",
  dataFnName: "experimentListData",
  shapeName: "ExperimentListItem[]",
  dataFn: (input) => experimentListData(input),
  specKeys: [],
  validate: validateExperimentListData,
  web: (props, ctx) => (
    <ExperimentListWeb
      data={props.data}
      filter={props.filter}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => experimentListText(props.data, ctx),
}) as unknown as ReportComponent<ExperimentListProps>;

export type EvalListProps = DataProps<readonly EvalListItem[], globalThis.Record<never, never>, EntityListChrome>;

/** Eval 列表:每项一个 experimentId + evalId,展开到这道题的 Attempt。 */
export const EvalList = makeDataComponent<readonly EvalListItem[], globalThis.Record<never, never>, EntityListChrome>({
  name: "EvalList",
  dataFnName: "evalListData",
  shapeName: "EvalListItem[]",
  dataFn: (input) => evalListData(input),
  specKeys: [],
  validate: validateEvalListData,
  web: (props, ctx) => (
    <EvalListWeb
      data={props.data}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => evalListText(props.data, ctx),
}) as unknown as ReportComponent<EvalListProps>;

export type AttemptListProps = DataProps<
  readonly AttemptListItem[],
  globalThis.Record<never, never>,
  EntityListChrome & {
    /** 过滤 / 截断前的总数;省略时等于 data 长度。 */
    total?: number;
    /** web 面加过滤输入框(按 experiment、eval、agent、verdict 或摘要文本收窄行);渐进增强,不改变数据与 text 面。 */
    filter?: boolean;
  }
>;

/** Attempt 列表:实体列表的叶子层,每项一次 attempt 的判定、单行摘要与 locator。 */
export const AttemptList = makeDataComponent<
  readonly AttemptListItem[],
  globalThis.Record<never, never>,
  EntityListChrome & { total?: number; filter?: boolean }
>({
  name: "AttemptList",
  dataFnName: "attemptListData",
  shapeName: "AttemptListItem[]",
  dataFn: (input) => attemptListData(input),
  specKeys: [],
  validate: validateAttemptListData,
  web: (props, ctx) => (
    <AttemptListWeb
      data={props.data}
      total={props.total}
      filter={props.filter}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => attemptListText(props.data, props.total, ctx),
}) as unknown as ReportComponent<AttemptListProps>;

// ───────────────────────── FailureList(官方组合件)─────────────────────────

export interface FailureListProps {
  /** 显示的最大条数;默认 20。 */
  limit?: number;
  /** 默认宿主注入的 Sample。 */
  input?: ReportInput;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}

/**
 * 「现在有哪些失败要处理」的成品组合件:内部就是 attemptListData → 过滤 → AttemptList
 * data 形态,与手写组合严格等价、没有私有能力(docs/feature/reports/components/entity-lists/README.md)。
 * verdict ∈ failed / errored,按 attempt 开始时间降序(同刻按 locator 字典序),
 * 截断到 limit(默认 20),total 报告截断前总数。
 */
export const FailureList = defineComponent<FailureListProps>(async (props, ctx) => {
  const input = props.input ?? ctx.scope;
  const all = await attemptListData(input);
  // attempt 开始时间不在列表条目里(它不是列表展示字段);从同一 input 的读取面按 locator 对回。
  const startedAtByLocator = new Map<string, string>();
  const { runs, attempts } = resolveInput(input);
  for (const item of collectItems(runs, attempts)) {
    startedAtByLocator.set(locatorOf(item), item.attempt.result.startedAt ?? "");
  }
  const failures = all
    .filter((item) => item.verdict === "failed" || item.verdict === "errored")
    .sort((a, b) => {
      const ta = startedAtByLocator.get(a.locator) ?? "";
      const tb = startedAtByLocator.get(b.locator) ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1; // 最近的失败在前
      return a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0;
    });
  const limit = props.limit ?? 20;
  return (
    <AttemptList
      data={failures.slice(0, limit)}
      total={failures.length}
      attemptHref={props.attemptHref}
      locale={props.locale}
      className={props.className}
    />
  );
});
FailureList.displayName = "FailureList";
