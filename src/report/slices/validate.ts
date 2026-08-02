import { arrayProblem, cellProblem, isLocalizedText, isObject, type Validator } from "../components/shared.ts";

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
/** DeltaCell:同 MetricValue 家族但字段不同(verdict/totalScore/attempts/totalTokens/totalCostUSD/historical)。 */
function deltaCellProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object { evaluationKind, verdict, attempts, historical }`;
  if (value.evaluationKind !== "pass" && value.evaluationKind !== "points") return `"${path}.evaluationKind" must be "pass" or "points"`;
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
  if (!isObject(value)) return `"${path}" must be an object { evaluationKindComposition }`;
  const composition = value.evaluationKindComposition;
  if (composition !== "pass" && composition !== "points" && composition !== "mixed") {
    return `"${path}.evaluationKindComposition" must be one of ["pass","points","mixed"]`;
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
    if (!isObject(value.pass) || !Array.isArray(value.pass.knownEvalIds) || typeof value.pass.passRatePoints !== "number") {
      return `"${path}.pass" must be an object { knownEvalIds, passRatePoints }`;
    }
  }
  if (value.points !== undefined) {
    if (!isObject(value.points) || !Array.isArray(value.points.knownEvalIds) || typeof value.points.totalScore !== "number") {
      return `"${path}.points" must be an object { knownEvalIds, totalScore }`;
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
