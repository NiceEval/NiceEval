/** Runtime boundary checks for plain closed site-component DTOs. */

export type Validator = (value: unknown) => string | null;

function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localizedTextProblem(value: unknown, path: string): string | null {
  if (typeof value === "string") return null;
  if (!isObject(value) || !Object.values(value).every((item) => typeof item === "string")) {
    return `"${path}" must be a LocalizedText`;
  }
  return null;
}

function arrayProblem(
  value: unknown,
  path: string,
  item: (entry: unknown, itemPath: string) => string | null,
): string | null {
  if (!Array.isArray(value)) return `"${path}" must be an array`;
  for (let index = 0; index < value.length; index++) {
    const problem = item(value[index], `${path}[${index}]`);
    if (problem !== null) return problem;
  }
  return null;
}

export const validateHeroData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (data.latestStartedAt !== null && typeof data.latestStartedAt !== "string") {
    return '"latestStartedAt" must be a string or null';
  }
  if (!Number.isSafeInteger(data.runs) || (data.runs as number) < 0) {
    return '"runs" must be a non-negative safe integer';
  }
  return null;
};

function siteWarningProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a closed warning object`;
  if (typeof value.code !== "string") return `"${path}.code" must be a string`;
  const messageProblem = localizedTextProblem(value.message, `${path}.message`);
  if (messageProblem !== null) return messageProblem;
  if (value.level !== undefined && value.level !== "info" && value.level !== "warning" && value.level !== "error") {
    return `"${path}.level" must be info, warning, or error`;
  }
  for (const field of ["action", "experimentId"] as const) {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== "string") {
      return `"${path}.${field}" must be a string when supplied`;
    }
  }
  for (const field of ["title", "badge"] as const) {
    if (value[field] !== undefined) {
      const problem = localizedTextProblem(value[field], `${path}.${field}`);
      if (problem !== null) return problem;
    }
  }
  return null;
}

export const validateScopeWarningsData: Validator = (data) => arrayProblem(data, "data", siteWarningProblem);

function diagnosticProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a diagnostic object`;
  if (typeof value.code !== "string") return `"${path}.code" must be a string`;
  if (value.level !== "warning" && value.level !== "error") return `"${path}.level" must be warning or error`;
  if (typeof value.message !== "string") return `"${path}.message" must be a string`;
  if (typeof value.phase !== "string") return `"${path}.phase" must be a string`;
  if (value.count !== undefined && (!Number.isSafeInteger(value.count) || (value.count as number) < 1)) {
    return `"${path}.count" must be a positive safe integer when supplied`;
  }
  return null;
}

function diagnosticItemProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a Run diagnostic bundle`;
  if (typeof value.experimentId !== "string") return `"${path}.experimentId" must be a string`;
  if (typeof value.startedAt !== "string") return `"${path}.startedAt" must be a string`;
  return arrayProblem(value.diagnostics, `${path}.diagnostics`, diagnosticProblem);
}

export const validateSnapshotDiagnosticsData: Validator = (data) =>
  arrayProblem(data, "data", diagnosticItemProblem);

export const validateCopyFixPromptData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.prompt !== "string") return '"prompt" must be a string';
  if (!Number.isSafeInteger(data.failures) || (data.failures as number) < 0) {
    return '"failures" must be a non-negative safe integer';
  }
  return null;
};

function spanProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a trace span summary`;
  if (typeof value.name !== "string") return `"${path}.name" must be a string`;
  if (value.kind !== "agent" && value.kind !== "model" && value.kind !== "tool" && value.kind !== "other") {
    return `"${path}.kind" must be agent, model, tool, or other`;
  }
  if (!Number.isFinite(value.startOffsetMs)) return `"${path}.startOffsetMs" must be a finite number`;
  if (!Number.isFinite(value.durationMs) || (value.durationMs as number) < 0) {
    return `"${path}.durationMs" must be a non-negative finite number`;
  }
  if (typeof value.failed !== "boolean") return `"${path}.failed" must be a boolean`;
  return null;
}

export const validateTraceWaterfallData: Validator = (data) => arrayProblem(data, "data", (row, path) => {
  if (!isObject(row)) return `"${path}" must be an object`;
  if (typeof row.experimentId !== "string") return `"${path}.experimentId" must be a string`;
  if (typeof row.evalId !== "string") return `"${path}.evalId" must be a string`;
  if (typeof row.locator !== "string") return `"${path}.locator" must be a string`;
  if (row.durationMs !== null && (!Number.isFinite(row.durationMs) || (row.durationMs as number) < 0)) {
    return `"${path}.durationMs" must be a non-negative finite number or null`;
  }
  return arrayProblem(row.spans, `${path}.spans`, spanProblem);
});

/** One consistent error message for cross-package DTO drift. */
export function closedDataError(component: string, shape: string, problem: string): TypeError {
  return new TypeError(
    `<${component}> received data that does not match the current ${shape} shape: ${problem}. ` +
      "Recompute the closed display DTO with this NiceEval version before rendering it.",
  );
}
