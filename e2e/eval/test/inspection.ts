import { createHash } from "node:crypto";
import * as Result from "effect/Result";
import { decodeInspectionOperation, type InspectionQuery } from "niceeval/inspection";
import { withInspectionQuery } from "niceeval/inspection/host";
import {
  decodeInspectionDocument,
  narrowInspectionSuccess,
  type E2ECommand,
  type ProcessReceipt,
  type InspectionSuccessDocumentFor,
  type RunProcessOptions,
} from "@niceeval/testkit";

export type AttemptInspectionOperation =
  | "attempt.get"
  | "attempt.trace"
  | "attempt.timing"
  | "attempt.usage"
  | "attempt.diff";

export type AssertionIndexEntry =
  InspectionSuccessDocumentFor<"attempt.get">["attempt"]["assertions"]["entries"][number];

/** Optional mechanical checkpoints; callers retain ownership of logs and deadlines. */
export type AssertionInspectionCheckpoint = (
  stage: "prepare" | "invoke" | "observe" | "outcome",
  entryId: string,
) => void | Promise<void>;

export function assertionEntry(document: InspectionSuccessDocumentFor<"attempt.assertion.detail">, diagnostic: string) {
  if (!("entry" in document.assertion)) {
    throw new Error(`Expected a recorded Assertion detail\n\n${diagnostic}`);
  }
  return document.assertion.entry;
}

export async function inspectAssertion(
  niceeval: E2ECommand,
  projectRoot: string,
  locator: string,
  entryId: string,
  options: RunProcessOptions = {},
  checkpoint?: AssertionInspectionCheckpoint,
  query?: InspectionQuery,
): Promise<{
  readonly receipt: ProcessReceipt;
  readonly document: InspectionSuccessDocumentFor<"attempt.assertion.detail">;
}> {
  if (checkpoint !== undefined) await checkpoint("prepare", entryId);

  if (checkpoint !== undefined) await checkpoint("invoke", entryId);
  const receipt = await niceeval.run(["show", locator, entryId, "--full", "--json"], options);
  if (checkpoint !== undefined) await checkpoint("observe", entryId);
  const first = receipt.attemptAssertionDetail();
  let document = first;
  if ("fields" in first.assertion) {
    const decoded = decodeInspectionOperation({
      kind: "attempt.assertion.detail",
      locator,
      entryId,
      projection: "full",
    });
    if (Result.isFailure(decoded)) throw new Error(decoded.failure.reason);
    const operation = decoded.success;
    if (operation.kind !== "attempt.assertion.detail") throw new Error("Expected an Assertion detail operation");
    const read = (reader: InspectionQuery) =>
      completeAssertionDetail(first, (continuation) =>
        reader.inspect<"attempt.assertion.detail">({ ...operation, continuation }),
      );
    document = query === undefined ? await withInspectionQuery({ cwd: projectRoot }, read) : await read(query);
  }
  if (checkpoint !== undefined) await checkpoint("outcome", entryId);
  return { receipt, document };
}

type AssertionDetailDocument = InspectionSuccessDocumentFor<"attempt.assertion.detail">;

async function completeAssertionDetail(
  first: AssertionDetailDocument,
  readNext: (continuation: string) => Promise<AssertionDetailDocument>,
): Promise<AssertionDetailDocument> {
  if (!("fields" in first.assertion)) return first;

  const assertion: Record<string, unknown> = Object.create(null);
  const seenTokens = new Set<string>();
  let current = first;
  let pending:
    | {
        path: string;
        byteLength: number;
        sha256: string | undefined;
        encoding: "json" | "content-base64";
        offset: number;
        chunks: Buffer[];
      }
    | undefined;
  for (;;) {
    const page = current.assertion;
    if (
      !("fields" in page) ||
      page.entryId !== first.assertion.entryId ||
      current.source.publicationCutoffIdentity !== first.source.publicationCutoffIdentity ||
      current.source.kind !== first.source.kind ||
      page.fields.length === 0
    )
      throw new Error("Assertion detail page changed its identity or contained no fields");

    for (const field of page.fields) {
      pending ??= {
        path: field.path,
        byteLength: field.byteLength,
        sha256: "sha256" in field ? field.sha256 : undefined,
        encoding: field.encoding,
        offset: 0,
        chunks: [],
      };
      if (
        pending.path !== field.path ||
        pending.byteLength !== field.byteLength ||
        pending.sha256 !== ("sha256" in field ? field.sha256 : undefined) ||
        pending.encoding !== field.encoding ||
        pending.offset !== field.offset
      )
        throw new Error(`Assertion detail byte range is inconsistent for ${field.path}`);

      const chunk = Buffer.from(field.base64, "base64");
      pending.chunks.push(chunk);
      pending.offset += chunk.byteLength;
      if (field.nextOffset !== null) {
        if (chunk.byteLength === 0 || field.nextOffset !== pending.offset || pending.offset >= pending.byteLength)
          throw new Error(`Assertion detail continuation did not advance for ${field.path}`);
        continue;
      }

      const bytes = Buffer.concat(pending.chunks);
      if (
        bytes.byteLength !== pending.byteLength ||
        (pending.sha256 !== undefined && createHash("sha256").update(bytes).digest("hex") !== pending.sha256)
      )
        throw new Error(`Assertion detail digest did not match for ${field.path}`);

      const keys = field.path
        .split("/")
        .slice(1)
        .map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
      const key = keys.pop();
      if (key === undefined || !field.path.startsWith("/")) throw new Error("Invalid Assertion detail field path");
      let parent = assertion;
      for (const [index, ancestor] of keys.entries()) {
        const next = keys[index + 1] ?? key;
        parent[ancestor] ??= /^(0|[1-9]\d*)$/u.test(next) ? [] : Object.create(null);
        const branch = parent[ancestor];
        if (
          typeof branch !== "object" ||
          branch === null ||
          (!Array.isArray(branch) && Object.getPrototypeOf(branch) !== null)
        )
          throw new Error("Overlapping Assertion detail fields");
        parent = branch as Record<string, unknown>;
      }
      if (Object.hasOwn(parent, key)) throw new Error(`Duplicate Assertion detail field ${field.path}`);
      parent[key] =
        field.encoding === "content-base64"
          ? bytes.toString("base64")
          : JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      pending = undefined;
    }

    if (page.continuation === undefined) break;
    if (seenTokens.has(page.continuation)) throw new Error("Assertion detail continuation repeated");
    seenTokens.add(page.continuation);
    current = await readNext(page.continuation);
  }
  if (pending !== undefined) throw new Error(`Assertion detail ended early for ${pending.path}`);

  const reconstructed = decodeInspectionDocument({
    ...first,
    assertion,
    links: first.links.filter(({ rel }) => rel !== "next-page"),
  });
  if (!reconstructed.success) throw new Error(reconstructed.reason);
  const detail = narrowInspectionSuccess(reconstructed.value, "attempt.assertion.detail");
  if (!detail.success) throw new Error(detail.reason);
  return detail.value;
}

/** Keeps the first CLI receipt for each assertion and reads later pages in one Library scope. */
export async function inspectAssertionEntries(
  niceeval: E2ECommand,
  projectRoot: string,
  locator: string,
  entries: readonly AssertionIndexEntry[],
  options: RunProcessOptions = {},
  checkpoint?: AssertionInspectionCheckpoint,
): Promise<
  readonly {
    readonly entry: AssertionIndexEntry;
    readonly receipt: ProcessReceipt;
    readonly document: InspectionSuccessDocumentFor<"attempt.assertion.detail">;
  }[]
> {
  return withInspectionQuery({ cwd: projectRoot }, async (query) => {
    const details = [];
    for (const entry of entries) {
      const detail = await inspectAssertion(niceeval, projectRoot, locator, entry.entryId, options, checkpoint, query);
      details.push({ entry, ...detail });
    }
    return details;
  });
}

/** Write an explicit fixed-operation request; never read the operational Record directly. */
export async function inspectAttempt<Kind extends AttemptInspectionOperation>(
  niceeval: E2ECommand,
  projectRoot: string,
  locator: string,
  operation: Kind,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: InspectionSuccessDocumentFor<Kind> }> {
  const receipt = await niceeval.run(
    [
      "show",
      locator,
      ...{
        "attempt.get": [],
        "attempt.trace": ["execution"],
        "attempt.timing": ["timing"],
        "attempt.usage": ["usage"],
        "attempt.diff": ["diff"],
      }[operation],
      "--json",
    ],
    options,
  );
  return { receipt, document: receipt.inspectionSuccess(operation) };
}

export async function inspectRunSummary(
  niceeval: E2ECommand,
  projectRoot: string,
  runId: string,
  options: RunProcessOptions = {},
): Promise<{ readonly receipt: ProcessReceipt; readonly document: InspectionSuccessDocumentFor<"run.get"> }> {
  const receipt = await niceeval.run(["show", `run:${runId}`, "--json"], options);
  return { receipt, document: receipt.run() };
}
