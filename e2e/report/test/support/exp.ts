import { only } from "./testkit.ts";

export interface ExpEvalEvent {
  event: "eval";
  locator: string;
  evalId: string;
  experimentId: string;
  verdict: "passed" | "failed" | "errored" | "skipped";
  attempts: number;
}

export interface ExpResultEvent {
  event: "result";
  status: string;
  completion: string;
  snapshots?: string[];
}

interface ExpReceiptEvent {
  type: "receipt";
  receipt: {
    runIds: string[];
  };
}

export interface ClassicExpFacts {
  readonly evals: readonly ExpEvalEvent[];
  readonly result: ExpResultEvent | undefined;
  readonly runIds: readonly string[];
  locator(experimentId: string, evalId: string): string;
}

function parseObjects(stdout: string): unknown[] {
  const objects: unknown[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      objects.push(JSON.parse(trimmed));
    } catch {
      // 0.12 may print a trailing human line; ignore non-JSON.
    }
  }
  return objects;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvalEvent(value: unknown): value is ExpEvalEvent {
  return (
    isRecord(value) &&
    value.event === "eval" &&
    typeof value.locator === "string" &&
    typeof value.evalId === "string" &&
    typeof value.experimentId === "string" &&
    typeof value.verdict === "string"
  );
}

function isResultEvent(value: unknown): value is ExpResultEvent {
  return isRecord(value) && value.event === "result" && typeof value.status === "string";
}

function isReceiptEvent(value: unknown): value is ExpReceiptEvent {
  return (
    isRecord(value) &&
    value.type === "receipt" &&
    isRecord(value.receipt) &&
    Array.isArray(value.receipt.runIds) &&
    value.receipt.runIds.every((runId) => typeof runId === "string")
  );
}

/** Read locators and completion from public `niceeval exp --json` only. */
export function classicExpFacts(stdout: string): ClassicExpFacts {
  const events = parseObjects(stdout);
  const evals = events.filter(isEvalEvent);
  const result = events.find(isResultEvent);
  const receipt = events.find(isReceiptEvent);
  const runIds = receipt?.receipt.runIds ??
    (result?.snapshots ?? [])
      .map((snapshot) => snapshot.split("/").filter((part) => part.length > 0).at(-1))
      .filter((part): part is string => typeof part === "string" && part.length > 0);
  return {
    evals,
    result,
    runIds,
    locator(experimentId, evalId) {
      return only(
        evals,
        (event) => event.experimentId === experimentId && event.evalId === evalId,
        `expected one eval event for ${experimentId} ${evalId}`,
      ).locator;
    },
  };
}
