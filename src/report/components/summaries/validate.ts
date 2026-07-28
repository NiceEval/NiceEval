import { cellProblem, isObject, tallyProblem, type Validator } from "../shared.ts";
export const validateSampleSummaryContent: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!isObject(data.range)) return 'missing "range" ({ earliestStartedAt, latestStartedAt })';
  if (!(data.range.earliestStartedAt === null || typeof data.range.earliestStartedAt === "string")) {
    return '"range.earliestStartedAt" must be a string or null';
  }
  if (!(data.range.latestStartedAt === null || typeof data.range.latestStartedAt === "string")) {
    return '"range.latestStartedAt" must be a string or null';
  }
  if (typeof data.experiments !== "number") return '"experiments" must be a number';
  if (typeof data.evals !== "number") return '"evals" must be a number';
  if (typeof data.attempts !== "number") return '"attempts" must be a number';
  const evalVerdictsProblem = tallyProblem(data.evalVerdicts, "evalVerdicts");
  if (evalVerdictsProblem !== null) return evalVerdictsProblem;
  const attemptVerdictsProblem = tallyProblem(data.attemptVerdicts, "attemptVerdicts");
  if (attemptVerdictsProblem !== null) return attemptVerdictsProblem;
  const passRateProblem = cellProblem(data.endToEndPassRate, "endToEndPassRate");
  if (passRateProblem !== null) return passRateProblem;
  return cellProblem(data.totalCostUSD, "totalCostUSD");
};
