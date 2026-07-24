// 官方双面组件的装配点:web 面(./MetricTable.tsx 等纯 React 组件)+ text 面(./faces.ts)
// + resolve 解析面(spec 形态由管线代调配套 ./compute.ts)。MetricBars 与 MetricMatrix
// 消费同一份矩阵数据(同一个 metricMatrixData)。

import type { ReportComponent } from "../../definition/tree.ts";
import type {
  DeltaData,
  LineData,
  MatrixData,
  ScatterData,
  ScoreboardData,
  StabilityMatrixData,
  TableData,
} from "../../model/types.ts";
import type { AttemptLocator } from "../../../results/locator.ts";
import {
  arrayProblem,
  cellProblem,
  isLocalizedText,
  isObject,
  makeDataComponent,
  hrefOf,
  type ChromeProps,
  type DataProps,
  type Validator,
} from "../shared.ts";
import {
  deltaTableData,
  metricLineData,
  metricMatrixData,
  metricScatterData,
  metricTableData,
  scoreboardData,
  stabilityMatrixData,
  type DeltaTableOptions,
  type MetricLineOptions,
  type MetricMatrixOptions,
  type MetricScatterOptions,
  type MetricTableOptions,
  type ScoreboardOptions,
  type StabilityMatrixOptions,
} from "./compute.ts";
import {
  barsText,
  deltaText,
  lineText,
  matrixText,
  scatterText,
  scoreboardText,
  stabilityMatrixText,
  tableText,
} from "./faces.ts";
import { MetricTable as MetricTableWeb } from "./MetricTable.tsx";
import { MetricMatrix as MetricMatrixWeb } from "./MetricMatrix.tsx";
import { MetricBars as MetricBarsWeb } from "./MetricBars.tsx";
import { Scoreboard as ScoreboardWeb } from "./Scoreboard.tsx";
import { MetricScatter as MetricScatterWeb } from "./MetricScatter.tsx";
import { MetricLine as MetricLineWeb } from "./MetricLine.tsx";
import { DeltaTable as DeltaTableWeb } from "./DeltaTable.tsx";
import { StabilityMatrix as StabilityMatrixWeb } from "./StabilityMatrix.tsx";

/** columns / metric / x / y 共用的 MetricColumn 形状(src/report/model/types.ts)。 */
function metricColumnProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a MetricColumn { key, label }`;
  if (typeof value.key !== "string") return `"${path}.key" must be a string`;
  if (!isLocalizedText(value.label)) return `"${path}.label" must be a LocalizedText`;
  if (value.bounds !== undefined) {
    if (!isObject(value.bounds)) return `"${path}.bounds" must be an object { min?, max? }`;
    if (value.bounds.min !== undefined && typeof value.bounds.min !== "number") return `"${path}.bounds.min" must be a number`;
    if (value.bounds.max !== undefined && typeof value.bounds.max !== "number") return `"${path}.bounds.max" must be a number`;
  }
  return null;
}

export const validateTableData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.rowDimension !== "string") return 'missing "rowDimension" (string)';
  const columnsProblem = arrayProblem(data.columns, "columns", metricColumnProblem);
  if (columnsProblem !== null) return columnsProblem;
  return arrayProblem(data.rows, "rows", (row, path) => {
    if (!isObject(row)) return `"${path}" must be an object`;
    if (typeof row.key !== "string") return `"${path}.key" must be a string`;
    if (!isObject(row.cells)) return `"${path}.cells" must be an object`;
    for (const [metricKey, cell] of Object.entries(row.cells)) {
      const problem = cellProblem(cell, `${path}.cells.${metricKey}`);
      if (problem !== null) return problem;
    }
    return null;
  });
};
export const validateMatrixData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.rowDimension !== "string" || typeof data.columnDimension !== "string") {
    return 'missing "rowDimension" / "columnDimension" (string)';
  }
  const metricProblem = metricColumnProblem(data.metric, "metric");
  if (metricProblem !== null) return metricProblem;
  return arrayProblem(data.cells, "cells", (item, path) => {
    if (!isObject(item)) return `"${path}" must be an object`;
    if (typeof item.row !== "string" || typeof item.column !== "string") {
      return `"${path}.row" / "${path}.column" must be strings`;
    }
    return cellProblem(item.cell, `${path}.cell`);
  });
};
export const validateScatterData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.pointDimension !== "string") return 'missing "pointDimension" (string)';
  const xColumnProblem = metricColumnProblem(data.x, "x");
  if (xColumnProblem !== null) return xColumnProblem;
  const yColumnProblem = metricColumnProblem(data.y, "y");
  if (yColumnProblem !== null) return yColumnProblem;
  return arrayProblem(data.rows, "rows", (row, path) => {
    if (!isObject(row) || typeof row.key !== "string") return `"${path}" must be an object with a string "key"`;
    const xProblem = cellProblem(row.x, `${path}.x`);
    if (xProblem !== null) return xProblem;
    return cellProblem(row.y, `${path}.y`);
  });
};
export const validateLineData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!isObject(data.x) || typeof data.x.key !== "string" || !isLocalizedText(data.x.label)) {
    return '"x" must be an axis descriptor { key, label }';
  }
  const yColumnProblem = metricColumnProblem(data.y, "y");
  if (yColumnProblem !== null) return yColumnProblem;
  return arrayProblem(data.rows, "rows", (row, path) => {
    if (!isObject(row) || typeof row.key !== "string") return `"${path}" must be an object with a string "key"`;
    if (!(row.x === null || typeof row.x === "number")) return `"${path}.x" must be a number or null`;
    if (!isLocalizedText(row.xDisplay)) return `"${path}.xDisplay" must be a LocalizedText`;
    return cellProblem(row.y, `${path}.y`);
  });
};
function scoreTotalProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object { value, display, notRun, unscorable, refs }`;
  if (typeof value.value !== "number") return `"${path}.value" must be a number`;
  if (!isLocalizedText(value.display)) return `"${path}.display" must be a LocalizedText`;
  if (typeof value.notRun !== "number") return `"${path}.notRun" must be a number`;
  if (typeof value.unscorable !== "number") return `"${path}.unscorable" must be a number`;
  if (!Array.isArray(value.refs)) return `"${path}.refs" must be an array`;
  return null;
}
export const validateScoreboardData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.rowDimension !== "string") return 'missing "rowDimension" (string)';
  if (!Array.isArray(data.questions)) return 'missing "questions" (array)';
  if (typeof data.fullMarks !== "number") return 'missing "fullMarks" (number)';
  if (typeof data.ignoredEvals !== "number") return 'missing "ignoredEvals" (number)';
  return arrayProblem(data.rows, "rows", (row, path) => {
    if (!isObject(row) || typeof row.key !== "string") return `"${path}" must be an object with a string "key"`;
    const totalProblem = scoreTotalProblem(row.total, `${path}.total`);
    if (totalProblem !== null) return totalProblem;
    return arrayProblem(row.subjects, `${path}.subjects`, (subject, subjectPath) => {
      if (!isObject(subject) || typeof subject.key !== "string") {
        return `"${subjectPath}" must be an object with a string "key"`;
      }
      if (typeof subject.earned !== "number") return `"${subjectPath}.earned" must be a number`;
      if (typeof subject.possible !== "number") return `"${subjectPath}.possible" must be a number`;
      if (typeof subject.questions !== "number") return `"${subjectPath}.questions" must be a number`;
      if (typeof subject.notRun !== "number") return `"${subjectPath}.notRun" must be a number`;
      if (typeof subject.unscorable !== "number") return `"${subjectPath}.unscorable" must be a number`;
      if (!isLocalizedText(subject.display)) return `"${subjectPath}.display" must be a LocalizedText`;
      if (!Array.isArray(subject.refs)) return `"${subjectPath}.refs" must be an array`;
      return null;
    });
  });
};
const VERDICTS = ["passed", "failed", "errored", "skipped"];
/** DeltaCell:同 MetricCell 家族但字段不同(verdict/totalScore/attempts/totalTokens/totalCostUSD/historical)。 */
function deltaCellProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object { scoring, verdict, attempts, historical }`;
  if (value.scoring !== "pass" && value.scoring !== "points") return `"${path}.scoring" must be "pass" or "points"`;
  if (typeof value.verdict !== "string" || !VERDICTS.includes(value.verdict)) {
    return `"${path}.verdict" must be one of ${JSON.stringify(VERDICTS)}`;
  }
  if (value.totalScore !== undefined && typeof value.totalScore !== "number") return `"${path}.totalScore" must be a number`;
  if (!Array.isArray(value.attempts) || !value.attempts.every((a) => typeof a === "string")) {
    return `"${path}.attempts" must be an array of locator strings`;
  }
  if (value.totalTokens !== undefined && typeof value.totalTokens !== "number") return `"${path}.totalTokens" must be a number`;
  if (value.totalCostUSD !== undefined && typeof value.totalCostUSD !== "number") return `"${path}.totalCostUSD" must be a number`;
  if (typeof value.historical !== "boolean") return `"${path}.historical" must be a boolean`;
  return null;
}
function deltaTotalsProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object { scoringComposition }`;
  const composition = value.scoringComposition;
  if (composition !== "pass" && composition !== "points" && composition !== "mixed") {
    return `"${path}.scoringComposition" must be one of ["pass","points","mixed"]`;
  }
  if (value.passed !== undefined && typeof value.passed !== "number") return `"${path}.passed" must be a number`;
  if (value.denominator !== undefined && typeof value.denominator !== "number") return `"${path}.denominator" must be a number`;
  if (value.totalScore !== undefined && typeof value.totalScore !== "number") return `"${path}.totalScore" must be a number`;
  if (value.totalTokens !== undefined && typeof value.totalTokens !== "number") return `"${path}.totalTokens" must be a number`;
  if (value.totalCostUSD !== undefined && typeof value.totalCostUSD !== "number") return `"${path}.totalCostUSD" must be a number`;
  return null;
}
function pairedDeltaProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object { commonEvalIds }`;
  if (!Array.isArray(value.commonEvalIds) || !value.commonEvalIds.every((id) => typeof id === "string")) {
    return `"${path}.commonEvalIds" must be an array of strings`;
  }
  if (value.pass !== undefined) {
    if (!isObject(value.pass) || !Array.isArray(value.pass.evalIds) || typeof value.pass.passRatePoints !== "number") {
      return `"${path}.pass" must be an object { evalIds, passRatePoints }`;
    }
  }
  if (value.points !== undefined) {
    if (!isObject(value.points) || !Array.isArray(value.points.evalIds) || typeof value.points.totalScore !== "number") {
      return `"${path}.points" must be an object { evalIds, totalScore }`;
    }
  }
  if (value.tokens !== undefined && typeof value.tokens !== "number") return `"${path}.tokens" must be a number`;
  if (value.costUSD !== undefined && typeof value.costUSD !== "number") return `"${path}.costUSD" must be a number`;
  return null;
}
export const validateDeltaData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.byDimension !== "string") return 'missing "byDimension" (string)';
  if (!Array.isArray(data.conditions) || !data.conditions.every((c) => typeof c === "string")) {
    return '"conditions" must be an array of strings';
  }
  const rowsProblem = arrayProblem(data.rows, "rows", (row, path) => {
    if (!isObject(row) || typeof row.key !== "string") return `"${path}" must be an object with a string "key"`;
    if (typeof row.flipped !== "boolean") return `"${path}.flipped" must be a boolean`;
    if (!isObject(row.cells)) return `"${path}.cells" must be an object`;
    for (const [condition, cell] of Object.entries(row.cells)) {
      const problem = deltaCellProblem(cell, `${path}.cells.${condition}`);
      if (problem !== null) return problem;
    }
    if (row.delta !== undefined) {
      if (!isObject(row.delta)) return `"${path}.delta" must be an object`;
      for (const [condition, d] of Object.entries(row.delta)) {
        if (!isObject(d)) return `"${path}.delta.${condition}" must be an object`;
        if (d.score !== undefined && typeof d.score !== "number") return `"${path}.delta.${condition}.score" must be a number`;
        if (d.tokens !== undefined && typeof d.tokens !== "number") return `"${path}.delta.${condition}.tokens" must be a number`;
        if (d.costUSD !== undefined && typeof d.costUSD !== "number") return `"${path}.delta.${condition}.costUSD" must be a number`;
      }
    }
    return null;
  });
  if (rowsProblem !== null) return rowsProblem;
  if (!isObject(data.totals)) return '"totals" must be an object';
  for (const [condition, totals] of Object.entries(data.totals)) {
    const problem = deltaTotalsProblem(totals, `totals.${condition}`);
    if (problem !== null) return problem;
  }
  if (!isObject(data.pairedDelta)) return '"pairedDelta" must be an object';
  for (const [condition, pd] of Object.entries(data.pairedDelta)) {
    const problem = pairedDeltaProblem(pd, `pairedDelta.${condition}`);
    if (problem !== null) return problem;
  }
  return null;
};

function stabilityCellProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object { passed, failed, errored, executions }`;
  for (const key of ["passed", "failed", "errored", "executions"] as const) {
    if (typeof value[key] !== "number") return `"${path}.${key}" must be a number`;
  }
  return null;
}
export const validateStabilityMatrixData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.rowDimension !== "string" || typeof data.columnDimension !== "string") {
    return 'missing "rowDimension" / "columnDimension" (string)';
  }
  const rowsProblem = arrayProblem(data.rows, "rows", (row, path) => {
    if (!isObject(row) || typeof row.evalId !== "string") return `"${path}" must be an object with a string "evalId"`;
    if (typeof row.neverPassed !== "boolean") return `"${path}.neverPassed" must be a boolean`;
    return null;
  });
  if (rowsProblem !== null) return rowsProblem;
  if (!Array.isArray(data.columns) || !data.columns.every((c) => typeof c === "string")) {
    return '"columns" must be an array of strings';
  }
  const cellsProblem = arrayProblem(data.cells, "cells", (item, path) => {
    if (!isObject(item)) return `"${path}" must be an object`;
    if (typeof item.row !== "string" || typeof item.column !== "string") return `"${path}.row" / "${path}.column" must be strings`;
    return stabilityCellProblem(item.cell, `${path}.cell`);
  });
  if (cellsProblem !== null) return cellsProblem;
  if (!isObject(data.totals)) return '"totals" must be an object';
  for (const [column, cell] of Object.entries(data.totals)) {
    const problem = stabilityCellProblem(cell, `totals.${column}`);
    if (problem !== null) return problem;
  }
  return null;
};

// ───────────────────────── 指标组件 ─────────────────────────

export type MetricTableProps = DataProps<
  TableData,
  MetricTableOptions,
  ChromeProps & {
    /** web 面在表格前渲染过滤输入框(enhance.js 接管);无 JS 时表格内容依旧完整。 */
    filter?: boolean;
    attemptHref?: (locator: AttemptLocator) => string;
  }
>;

/** 榜单:一行一个维度值、一列一个指标,回答「谁整体更好」。 */
export const MetricTable = makeDataComponent<
  TableData,
  MetricTableOptions,
  ChromeProps & { filter?: boolean; attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "MetricTable",
  dataFnName: "metricTableData",
  shapeName: "TableData",
  dataFn: metricTableData,
  specKeys: ["rows", "columns", "sort", "evals"],
  validate: validateTableData,
  web: (props, ctx) => (
    <MetricTableWeb
      data={props.data}
      filter={props.filter}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => tableText(props.data, ctx),
}) as unknown as ReportComponent<MetricTableProps>;

export type MetricMatrixProps = DataProps<
  MatrixData,
  MetricMatrixOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;
export type MetricBarsProps = MetricMatrixProps;

/** 逐题格子:行 × 列两个维度、格子里一个指标,回答「哪道题谁挂了」。 */
export const MetricMatrix = makeDataComponent<
  MatrixData,
  MetricMatrixOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "MetricMatrix",
  dataFnName: "metricMatrixData",
  shapeName: "MatrixData",
  dataFn: metricMatrixData,
  specKeys: ["rows", "columns", "cell", "evals"],
  validate: validateMatrixData,
  web: (props, ctx) => (
    <MetricMatrixWeb data={props.data} locale={props.locale ?? ctx.locale} attemptHref={hrefOf(props, ctx)} className={props.className} />
  ),
  text: (props, ctx) => matrixText(props.data, ctx),
}) as unknown as ReportComponent<MetricMatrixProps>;

/** 分组条形:同一份矩阵数据的另一种摆法;与 MetricMatrix 写同一份 spec 时只计算一次。 */
export const MetricBars = makeDataComponent<
  MatrixData,
  MetricMatrixOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "MetricBars",
  dataFnName: "metricMatrixData",
  shapeName: "MatrixData",
  dataFn: metricMatrixData,
  specKeys: ["rows", "columns", "cell", "evals"],
  validate: validateMatrixData,
  web: (props, ctx) => (
    <MetricBarsWeb data={props.data} locale={props.locale ?? ctx.locale} attemptHref={hrefOf(props, ctx)} className={props.className} />
  ),
  text: (props, ctx) => barsText(props.data, ctx),
}) as unknown as ReportComponent<MetricBarsProps>;

export type ScoreboardProps = DataProps<
  ScoreboardData,
  ScoreboardOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;

/** 考试成绩单:总分 + 分科小计,固定分母、notRun / unscorable 分开如实报。 */
export const Scoreboard = makeDataComponent<
  ScoreboardData,
  ScoreboardOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "Scoreboard",
  dataFnName: "scoreboardData",
  shapeName: "ScoreboardData",
  dataFn: scoreboardData,
  specKeys: ["rows", "questions", "subject", "weights", "fullMarks", "score"],
  validate: validateScoreboardData,
  web: (props, ctx) => <ScoreboardWeb data={props.data} locale={props.locale ?? ctx.locale} className={props.className} />,
  text: (props, ctx) => scoreboardText(props.data, ctx),
}) as unknown as ReportComponent<ScoreboardProps>;

type ScatterChrome = ChromeProps & {
  /** series 内按 x 升序成线(呈现,不改变 ScatterData):web 面画折线,text 面在图例给逐段位移摘要;默认 false。 */
  connect?: boolean;
  pointHref?: (row: ScatterData["rows"][number]) => string;
};

export type MetricScatterProps = DataProps<ScatterData, MetricScatterOptions, ScatterChrome>;

/** 两个指标之间的取舍:每个点一个维度值,x / y 各一个指标,series 决定颜色和图例归类。 */
export const MetricScatter = makeDataComponent<ScatterData, MetricScatterOptions, ScatterChrome>({
  name: "MetricScatter",
  dataFnName: "metricScatterData",
  shapeName: "ScatterData",
  dataFn: metricScatterData,
  specKeys: ["points", "series", "x", "y", "evals"],
  validate: validateScatterData,
  web: (props, ctx) => (
    <MetricScatterWeb
      data={props.data}
      connect={props.connect}
      pointHref={props.pointHref}
      locale={props.locale ?? ctx.locale}
      className={props.className}
    />
  ),
  text: (props, ctx) => scatterText(props.data, ctx, { connect: props.connect }),
}) as unknown as ReportComponent<MetricScatterProps>;

export type MetricLineProps = DataProps<
  LineData,
  MetricLineOptions,
  ChromeProps & { pointHref?: (row: LineData["rows"][number]) => string }
>;

/** 趋势线:x 是 NumericAxis(参数轴),点身份 = (series, x)。 */
export const MetricLine = makeDataComponent<
  LineData,
  MetricLineOptions,
  ChromeProps & { pointHref?: (row: LineData["rows"][number]) => string }
>({
  name: "MetricLine",
  dataFnName: "metricLineData",
  shapeName: "LineData",
  dataFn: metricLineData,
  specKeys: ["x", "series", "y", "evals"],
  validate: validateLineData,
  web: (props, ctx) => (
    <MetricLineWeb data={props.data} pointHref={props.pointHref} locale={props.locale ?? ctx.locale} className={props.className} />
  ),
  text: (props, ctx) => lineText(props.data, ctx),
}) as unknown as ReportComponent<MetricLineProps>;

export type DeltaTableProps = DataProps<
  DeltaData,
  DeltaTableOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;

/** 对照矩阵:每行一道 eval,每组列一个条件(字面声明或 conditionsByFlag 派生),首个条件是基准。 */
export const DeltaTable = makeDataComponent<
  DeltaData,
  DeltaTableOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "DeltaTable",
  dataFnName: "deltaTableData",
  shapeName: "DeltaData",
  dataFn: deltaTableData,
  specKeys: ["by", "conditions", "evals"],
  validate: validateDeltaData,
  web: (props, ctx) => (
    <DeltaTableWeb data={props.data} attemptHref={hrefOf(props, ctx)} locale={props.locale ?? ctx.locale} className={props.className} />
  ),
  text: (props, ctx) => deltaText(props.data, ctx),
}) as unknown as ReportComponent<DeltaTableProps>;

export type StabilityMatrixProps = DataProps<
  StabilityMatrixData,
  StabilityMatrixOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;

/** 稳定性矩阵:行 = eval,列 = by 维度取值,格 = 全部历史执行的判定计数;回答「哪些题从来没通过过」。 */
export const StabilityMatrix = makeDataComponent<
  StabilityMatrixData,
  StabilityMatrixOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "StabilityMatrix",
  dataFnName: "stabilityMatrixData",
  shapeName: "StabilityMatrixData",
  dataFn: (input, options) => stabilityMatrixData(input, options),
  specKeys: ["by", "evals"],
  validate: validateStabilityMatrixData,
  web: (props, ctx) =>
    props.data.rows.length === 0 ? null : (
      <StabilityMatrixWeb
        data={props.data}
        attemptHref={hrefOf(props, ctx)}
        locale={props.locale ?? ctx.locale}
        className={props.className}
      />
    ),
  text: (props, ctx) => stabilityMatrixText(props.data, ctx),
}) as unknown as ReportComponent<StabilityMatrixProps>;
