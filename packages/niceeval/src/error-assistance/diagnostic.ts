import type { JsonValue } from "../shared/types.ts";
import type {
  ErrorAssistanceData,
  ErrorDiagnostic,
  ErrorAffectedAttempt,
  ErrorFeedbackDiagnostic,
  ErrorSource,
} from "./types.ts";

export const MAX_ERROR_ASSISTANCE_GROUPS = 32;
export const MAX_ERROR_ASSISTANCE_SOURCES = 32;
export const MAX_ERROR_ASSISTANCE_AFFECTED = 32;
export const ERROR_ASSISTANCE_OVERFLOW_KEY = "error-assistance:overflow";

const assistanceData = new WeakSet<object>();

function sourceJson(source: ErrorSource | undefined): JsonValue {
  if (source === undefined) return { state: "unavailable", reason: "not-recorded" };
  return source.state === "located"
    ? { state: "located", file: source.file, line: source.line, column: source.column }
    : { state: "unavailable", reason: source.reason };
}

function makeData(
  input: ErrorDiagnostic,
  sources: readonly JsonValue[],
  affected: readonly JsonValue[] = [],
  sourceLocationsOmitted = 0,
  affectedObjectsOmitted = 0,
): Readonly<Record<string, JsonValue>> & ErrorAssistanceData {
  const data = Object.freeze({
    __niceevalErrorAssistance: 1 as const,
    owner: input.owner,
    repairTarget: input.repairTarget,
    nextStep: input.nextStep,
    ...(input.service !== undefined ? { service: input.service } : {}),
    ...(input.guideId !== undefined ? { guideId: input.guideId } : {}),
    sources: Object.freeze([...sources]) as JsonValue[],
    affected: Object.freeze([...affected]) as JsonValue[],
    sourceLocationsOmitted,
    affectedObjectsOmitted,
  }) as Readonly<Record<string, JsonValue>> & ErrorAssistanceData;
  assistanceData.add(data);
  return data;
}

function groupIdentity(input: ErrorDiagnostic): readonly string[] {
  return [input.code, input.owner, input.repairTarget, input.guideId ?? ""];
}

export function errorDiagnosticGroupKey(input: ErrorDiagnostic): string {
  return `error-assistance:${JSON.stringify(groupIdentity(input))}`;
}

export function toFeedbackDiagnostic(input: ErrorDiagnostic): ErrorFeedbackDiagnostic {
  return Object.freeze({
    key: errorDiagnosticGroupKey(input),
    code: input.code,
    severity: "error" as const,
    message: input.summary,
    data: makeData(input, [sourceJson(input.source)], [input.affectedObject]),
  });
}

export function readErrorAssistanceData(
  data: Readonly<Record<string, JsonValue>> | undefined,
): ErrorAssistanceData | undefined {
  return data !== undefined && assistanceData.has(data) ? data as unknown as ErrorAssistanceData : undefined;
}

function sameSource(left: JsonValue, right: JsonValue): boolean {
  if (typeof left !== "object" || left === null || Array.isArray(left)) return false;
  if (typeof right !== "object" || right === null || Array.isArray(right)) return false;
  return left.state === right.state && left.file === right.file && left.line === right.line &&
    left.column === right.column && left.reason === right.reason;
}

function sameAffected(left: JsonValue, right: JsonValue): boolean {
  return typeof left === "string" && typeof right === "string" && left === right;
}

export function appendErrorAssistanceAffected(
  data: Readonly<Record<string, JsonValue>> | undefined,
  identity: ErrorAffectedAttempt | undefined,
): Readonly<Record<string, JsonValue>> | undefined {
  const assistance = readErrorAssistanceData(data);
  if (assistance === undefined || identity === undefined) return data;
  const encoded: JsonValue = `${identity.experimentId === undefined ? "" : `${identity.experimentId}/`}${identity.evalId} #${identity.attempt}`;
  return makeData({
    code: "affected",
    owner: assistance.owner,
    summary: "affected",
    repairTarget: assistance.repairTarget,
    nextStep: assistance.nextStep,
    affectedObject: "affected",
    ...(assistance.service !== undefined ? { service: assistance.service } : {}),
    ...(assistance.guideId !== undefined ? { guideId: assistance.guideId } : {}),
  }, assistance.sources, [encoded], assistance.sourceLocationsOmitted, 0);
}

function isLocatedSource(value: JsonValue): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && value.state === "located";
}

export function mergeErrorAssistanceData(
  previous: Readonly<Record<string, JsonValue>> | undefined,
  incoming: Readonly<Record<string, JsonValue>> | undefined,
): Readonly<Record<string, JsonValue>> | undefined {
  const before = readErrorAssistanceData(previous);
  const next = readErrorAssistanceData(incoming);
  if (before === undefined || next === undefined) return incoming;
  const sources = [...before.sources];
  let sourceLocationsOmitted = before.sourceLocationsOmitted + next.sourceLocationsOmitted;
  for (const source of next.sources) {
    if (sources.some((existing) => sameSource(existing, source))) continue;
    if (!isLocatedSource(source) && sources.some((existing) => !isLocatedSource(existing))) {
      continue;
    } else if (sources.length >= MAX_ERROR_ASSISTANCE_SOURCES) {
      sourceLocationsOmitted++;
    } else {
      sources.push(source);
    }
  }
  const affected = [...before.affected];
  let affectedObjectsOmitted = before.affectedObjectsOmitted + next.affectedObjectsOmitted;
  for (const identity of next.affected) {
    if (affected.some((existing) => sameAffected(existing, identity))) continue;
    if (affected.length >= MAX_ERROR_ASSISTANCE_AFFECTED) affectedObjectsOmitted++;
    else affected.push(identity);
  }
  return makeData({
    code: "merged",
    owner: next.owner,
    summary: "merged",
    repairTarget: next.repairTarget,
    nextStep: next.nextStep,
    affectedObject: "merged",
    ...(next.service !== undefined ? { service: next.service } : {}),
    ...(next.guideId !== undefined ? { guideId: next.guideId } : {}),
  }, sources, affected, sourceLocationsOmitted, affectedObjectsOmitted);
}
