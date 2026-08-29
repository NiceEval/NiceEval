import { Result } from "effect";

import {
  decodeInspectionOperation,
  type InspectionOperationFor,
} from "../../../../../inspection/public.ts";

export class RouteInputError extends Error {
  readonly classification = "route-input" as const;
  readonly translationKey = "report.unableToLoad" as const;
}

export class SelectionMissingError extends Error {
  readonly classification = "selection" as const;
  readonly translationKey = "report.unableToLoad" as const;
}

function decoded(input: unknown) {
  const result = decodeInspectionOperation(input);
  if (Result.isFailure(result)) throw new RouteInputError("Invalid Insight route input.");
  return result.success;
}

export function overviewOperation(): InspectionOperationFor<"overview.get"> {
  const operation = decoded({ kind: "overview.get" });
  if (operation.kind !== "overview.get") throw new RouteInputError("Invalid overview operation.");
  return operation;
}

export function runOperations(runId: string): readonly [
  InspectionOperationFor<"run.get">,
  InspectionOperationFor<"run.summary">,
] {
  const run = decoded({ kind: "run.get", runId });
  const summary = decoded({ kind: "run.summary", runId });
  if (run.kind !== "run.get" || summary.kind !== "run.summary") {
    throw new RouteInputError("Invalid run route.");
  }
  return [run, summary];
}

export function attemptOperations(locator: string): readonly [
  InspectionOperationFor<"attempt.get">,
  InspectionOperationFor<"attempt.trace">,
] {
  const attempt = decoded({ kind: "attempt.get", locator });
  const trace = decoded({ kind: "attempt.trace", locator });
  if (attempt.kind !== "attempt.get" || trace.kind !== "attempt.trace") {
    throw new RouteInputError("Invalid attempt route.");
  }
  return [attempt, trace];
}

export function detailOperation(input: unknown) {
  const operation = decoded(input);
  switch (operation.kind) {
    case "attempt.assertion.detail":
    case "attempt.trace.detail":
    case "attempt.timing":
    case "attempt.usage":
    case "attempt.sources":
    case "attempt.diff":
    case "attempt.artifacts":
      return operation;
    default:
      throw new RouteInputError("Invalid Attempt detail operation.");
  }
}
