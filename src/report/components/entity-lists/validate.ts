// entity-lists *Data 形状校验(compute 产物;过渡期 data= 形态与测试仍依赖)。

import {
  arrayProblem,
  cellProblem,
  isObject,
  tallyProblem,
  type Validator,
} from "../shared.ts";

function evaluationKindProblem(value: unknown, path: string, allowMixed: boolean): string | null {
  if (value === "pass" || value === "points" || (allowMixed && value === "mixed")) return null;
  return `"${path}" must be ${allowMixed ? '"pass", "points", or "mixed"' : '"pass" or "points"'}`;
}

function attemptListItemProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object`;
  if (typeof value.experimentId !== "string") return `"${path}.experimentId" must be a string`;
  if (typeof value.evalId !== "string") return `"${path}.evalId" must be a string`;
  if (typeof value.attempt !== "number") return `"${path}.attempt" must be a number`;
  if (typeof value.agent !== "string") return `"${path}.agent" must be a string`;
  const evaluationKind = evaluationKindProblem(value.evaluationKind, `${path}.evaluationKind`, false);
  if (evaluationKind !== null) return evaluationKind;
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
    const evaluationKind = evaluationKindProblem(item.evaluationKind, `${path}.evaluationKind`, true);
    if (evaluationKind !== null) return evaluationKind;
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
      const rowEvaluationKind = evaluationKindProblem(row.evaluationKind, `${rowPath}.evaluationKind`, true);
      if (rowEvaluationKind !== null) return rowEvaluationKind;
      const rowPassRateProblem = cellProblem(row.endToEndPassRate, `${rowPath}.endToEndPassRate`);
      if (rowPassRateProblem !== null) return rowPassRateProblem;
      const rowTotalScoreProblem = cellProblem(row.totalScore, `${rowPath}.totalScore`);
      if (rowTotalScoreProblem !== null) return rowTotalScoreProblem;
      const rowDurationProblem = cellProblem(row.durationMs, `${rowPath}.durationMs`);
      if (rowDurationProblem !== null) return rowDurationProblem;
      const rowCostProblem = cellProblem(row.costUSD, `${rowPath}.costUSD`);
      if (rowCostProblem !== null) return rowCostProblem;
      const rowTokensProblem = cellProblem(row.tokens, `${rowPath}.tokens`);
      if (rowTokensProblem !== null) return rowTokensProblem;
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
