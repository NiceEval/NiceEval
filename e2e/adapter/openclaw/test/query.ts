import { type ProcessReceipt, withTempDir } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export type InspectionOperation =
  | { readonly kind: "run.get"; readonly runId: string }
  | {
      readonly kind: "attempt.get" | "attempt.trace" | "attempt.sources";
      readonly locator: string;
    };

interface QueryCommand {
  run(
    args: readonly string[],
    options?: { readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number },
  ): Promise<ProcessReceipt>;
}

export interface InspectionDocument {
  readonly protocol: "niceeval.query/v1";
  readonly operation: InspectionOperation["kind"];
  readonly behaviorVersion: string;
  readonly selection: unknown;
  readonly issues: readonly unknown[];
  readonly evidence: unknown;
  readonly summary?: unknown;
  readonly attempt?: unknown;
  readonly trace?: unknown;
  readonly sources?: unknown;
}

/** Flattens JSON objects without interpreting any product field. */
export function inspectionRecords(value: unknown): readonly Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (current === null || typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    records.push(record);
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(value);
  return records;
}

/** Writes one complete machine-protocol request, then invokes the installed candidate CLI. */
export async function runInspectionQuery(
  niceeval: QueryCommand,
  operation: InspectionOperation,
  options?: {
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
    readonly recordPath?: string;
  },
): Promise<ProcessReceipt> {
  return await withTempDir("niceeval-query-", async (directory) => {
    const requestPath = join(directory, "request.json");
    await writeFile(
      requestPath,
      `${JSON.stringify({ protocol: "niceeval.query/v1", operation })}\n`,
      "utf8",
    );
    const { recordPath, ...runOptions } = options ?? {};
    return await niceeval.run([
      "query",
      "run",
      ...(recordPath === undefined ? [] : ["--record", recordPath]),
      "--request",
      requestPath,
    ], runOptions);
  });
}
