import { type ProcessReceipt, withTempDir } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

export type InspectionOperation =
  | { readonly kind: "run.summary"; readonly runId: string }
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

/** Asserts the fixed Sources projection by its stable item fields and closed text Content. */
export function expectAttemptSource(
  document: ReturnType<ProcessReceipt["attemptSources"]>,
  expected: { readonly path: string; readonly textIncludes: string },
): void {
  expect(document).toMatchObject({
    protocol: "niceeval.query/v1",
    operation: "attempt.sources",
  });
  const projection = document.sources;
  expect(projection).toMatchObject({
    state: "available",
    hasMore: expect.any(Boolean),
    omittedItemCount: expect.any(Number),
  });
  expect(Array.isArray(projection.items)).toBe(true);
  const source = projection.items.find(({ path }) => path === expected.path);
  expect(source, `missing projected source ${expected.path}`).toBeDefined();
  expect(source).toMatchObject({
    path: expected.path,
    sourceItemId: expect.any(String),
    byteLength: expect.any(Number),
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    content: { state: "available", text: expect.any(String) },
  });
  expect(source!.content.state).toBe("available");
  if (source!.content.state === "available") {
    expect(source!.content.text).toContain(expected.textIncludes);
  }
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
  },
): Promise<ProcessReceipt> {
  return await withTempDir("niceeval-query-", async (directory) => {
    const requestPath = join(directory, "request.json");
    await writeFile(
      requestPath,
      `${JSON.stringify({ protocol: "niceeval.query/v1", operation })}\n`,
      "utf8",
    );
    return await niceeval.run([
      "query",
      "run",
      "--request",
      requestPath,
    ], options);
  });
}
