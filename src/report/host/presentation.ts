import { Context, Effect } from "effect";
import type { AnalysisSelectionSummary } from "../../analysis/index.ts";
import type {
  ReportCalculationExecutionResult,
  ReportDownloadResult,
  ReportPageFamilyResult,
  ReportPageResult,
  ReportProjectionSummary,
} from "../execution/results.ts";
import type { ReportExecution } from "../execution/model.ts";
import type { ReportProblem, ReportProblemTableEntry } from "../execution/problems.ts";
import type {
  ReportBlock,
  ReportDocument,
  ReportInline,
  ReportScalar,
} from "../semantic/document.ts";
import type { ReportRoute } from "../author/identity.ts";

/** Failure to write a completed Report presentation to its host console. */
export interface ReportConsoleError {
  readonly code: "report-console-write-failed";
  readonly operation: "write";
}

/** The only capability terminal presentation needs after execution is fixed. */
export interface ReportConsoleService {
  readonly write: (text: string) => Effect.Effect<void, ReportConsoleError>;
}

export class ReportConsole extends Context.Tag("@niceeval/report/ReportConsole")<
  ReportConsole,
  ReportConsoleService
>() {}

export interface ReportShowRenderError {
  readonly code: "report-show-render-failed";
  readonly operation: "render" | "page-selection";
}

export type ReportShowError = ReportConsoleError | ReportShowRenderError;

export interface ShowReportInput {
  readonly execution: ReportExecution;
  readonly format?: "text" | "json";
  readonly page?: ReportRoute;
}

/**
 * Presents one already-completed execution. It never reaches back into a
 * Record, invokes Report callbacks, or starts a private Effect runtime.
 */
export function showReport(
  input: ShowReportInput,
): Effect.Effect<void, ReportShowError, ReportConsole> {
  return Effect.gen(function* () {
    const output = input.format === "json"
      ? yield* renderReportExecutionJson(input)
      : yield* renderText(input);
    const console = yield* ReportConsole;
    yield* console.write(output);
  });
}

/** A deterministic text projection shared by terminal callers and Node views. */
export function renderReportExecutionText(input: ShowReportInput): string {
  const { execution } = input;
  const pages = selectedPages(execution.pages, input.page);
  const lines = [
    `Report ${visibleText(execution.reportId)}`,
    `Sample: ${execution.sample.runs.length} run(s), ${execution.sample.denominator} slot(s)`,
  ];

  for (const page of pages) {
    lines.push("");
    lines.push(...renderPageText(page));
  }

  lines.push("");
  lines.push(...problemLines(execution));

  return `${lines.join("\n")}\n`;
}

/** A reserved host-owned surface; author pages cannot suppress these facts. */
export function renderReportExecutionProblemsText(execution: ReportExecution): string {
  return `${[
    `Report ${visibleText(execution.reportId)}`,
    "",
    ...problemLines(execution),
  ].join("\n")}\n`;
}

function renderText(input: ShowReportInput): Effect.Effect<string, ReportShowRenderError> {
  return Effect.try({
    try: () => renderReportExecutionText(input),
    catch: (error): ReportShowRenderError => ({
      code: "report-show-render-failed",
      operation: error instanceof PageSelectionError ? "page-selection" : "render",
    }),
  });
}

/**
 * The JSON envelope intentionally contains only execution-owned data. Download
 * bytes, reader capabilities, callbacks, and filesystem paths never cross it.
 */
export function renderReportExecutionJson(
  input: ShowReportInput,
): Effect.Effect<string, ReportShowRenderError> {
  return Effect.map(reportExecutionShowDocument(input), (document) => `${canonicalJson(document)}\n`);
}

/** A reusable, closed data projection for JSON or a web shell. */
export function reportExecutionShowDocument(
  input: ShowReportInput,
): Effect.Effect<Readonly<Record<string, unknown>>, ReportShowRenderError> {
  return Effect.gen(function* () {
    const { execution } = input;
    const pages = yield* selectedPagesEffect(execution.pages, input.page);
    const downloads: Readonly<Record<string, unknown>>[] = [];
    for (const download of sortedDownloads(execution.downloads)) {
      downloads.push(yield* downloadShowValue(download));
    }
    return Object.freeze({
      format: "niceeval.report-show/v1",
      reportId: execution.reportId,
      pageSelection: input.page ?? null,
      sample: Object.freeze({
        selection: selectionShowValue(execution.sample.selection),
        runCount: execution.sample.runs.length,
        slotCount: execution.sample.slots.length,
        denominator: execution.sample.denominator,
      }),
      projections: sortedProjections(execution.projections).map((projection) =>
        Object.freeze({
          projectionId: projection.projectionId,
          inputKey: projection.inputKey,
          coverage: projection.coverage,
          problemIds: sortedProblemIds(projection.problemIds),
        })
      ),
      calculations: sortedCalculations(execution.calculations).map((calculation) =>
        Object.freeze({
          state: calculation.state,
          calculationId: calculation.calculationId,
          ...(calculation.state === "available"
            ? {
              inputState: calculation.inputState,
              value: calculation.value,
            }
            : {}),
          problemIds: sortedProblemIds(calculation.problemIds),
        })
      ),
      families: sortedFamilies(execution.families).map((family) =>
        Object.freeze({
          state: family.state,
          familyId: family.familyId,
          instanceCount: family.instanceCount,
          problemIds: sortedProblemIds(family.problemIds),
        })
      ),
      pages: pages.map((page) => pageShowValue(page)),
      downloads: Object.freeze(downloads),
      problemTable: [...execution.problemTable]
        .sort((left, right) => left.id - right.id)
        .map((entry) => problemShowValue(entry)),
    });
  });
}

function selectedPages(
  pages: readonly ReportPageResult[],
  page: ReportRoute | undefined,
): readonly ReportPageResult[] {
  if (page === undefined) {
    return Object.freeze([...pages].sort(comparePages));
  }
  const selected = pages.filter((candidate) => candidate.route === page);
  if (selected.length === 0) {
    throw new PageSelectionError();
  }
  return Object.freeze([...selected].sort(comparePages));
}

class PageSelectionError extends Error {}

function selectedPagesEffect(
  pages: readonly ReportPageResult[],
  page: ReportRoute | undefined,
): Effect.Effect<readonly ReportPageResult[], ReportShowRenderError> {
  return Effect.try({
    try: () => selectedPages(pages, page),
    catch: (error): ReportShowRenderError => ({
      code: "report-show-render-failed",
      operation: error instanceof PageSelectionError ? "page-selection" : "render",
    }),
  });
}

function pageShowValue(page: ReportPageResult): Readonly<Record<string, unknown>> {
  return Object.freeze({
    state: page.state,
    pageId: page.pageId,
    ...(page.route === undefined ? {} : { route: page.route }),
    ...(page.state === "rendered" ? { document: page.document } : {}),
    problemIds: sortedProblemIds(page.problemIds),
  });
}

function downloadShowValue(
  download: ReportDownloadResult,
): Effect.Effect<Readonly<Record<string, unknown>>, ReportShowRenderError> {
  return Effect.gen(function* () {
    const files: Readonly<Record<string, unknown>>[] = [];
    if (download.state === "built") {
      for (const file of [...download.files].sort((left, right) => compareUtf8(left.path, right.path))) {
        files.push(Object.freeze({
          path: file.path,
          mediaType: file.mediaType,
          byteLength: file.bytes.byteLength,
          sha256: yield* sha256Hex(file.bytes),
        }));
      }
    }
    return Object.freeze({
      state: download.state,
      downloadId: download.downloadId,
      ...(download.state === "built" ? { files: Object.freeze(files) } : {}),
      problemIds: sortedProblemIds(download.problemIds),
    });
  });
}

function problemShowValue(entry: ReportProblemTableEntry): Readonly<Record<string, unknown>> {
  return Object.freeze({ id: entry.id, problem: entry.problem });
}

function problemLines(execution: ReportExecution): readonly string[] {
  if (execution.problemTable.length === 0) {
    return Object.freeze(["Problems", "  none"]);
  }
  return Object.freeze([
    "Problems",
    ...[...execution.problemTable]
      .sort((left, right) => left.id - right.id)
      .map((entry) => `  [${entry.id}] ${problemText(entry.problem)}`),
  ]);
}

function selectionShowValue(selection: AnalysisSelectionSummary): Readonly<Record<string, unknown>> {
  if (selection.policy === "explicit-runs") {
    return Object.freeze({
      policy: selection.policy,
      runIds: Object.freeze([...selection.runIds].sort(compareUtf8)),
    });
  }
  return Object.freeze({
    policy: selection.policy,
    experimentIds: selection.experimentIds === "all"
      ? "all"
      : Object.freeze([...selection.experimentIds].sort(compareUtf8)),
    selectedRunIds: Object.freeze([...selection.selectedRunIds].sort(compareUtf8)),
  });
}

function sortedProblemIds(ids: readonly number[]): readonly number[] {
  return Object.freeze([...ids].sort((left, right) => left - right));
}

function sortedDownloads(values: readonly ReportDownloadResult[]): readonly ReportDownloadResult[] {
  return Object.freeze([...values].sort((left, right) => compareUtf8(left.downloadId, right.downloadId)));
}

function sortedProjections(values: readonly ReportProjectionSummary[]): readonly ReportProjectionSummary[] {
  return Object.freeze([...values].sort((left, right) => left.projectionId - right.projectionId));
}

function sortedCalculations(
  values: readonly ReportCalculationExecutionResult[],
): readonly ReportCalculationExecutionResult[] {
  return Object.freeze([...values].sort((left, right) => compareUtf8(left.calculationId, right.calculationId)));
}

function sortedFamilies(values: readonly ReportPageFamilyResult[]): readonly ReportPageFamilyResult[] {
  return Object.freeze([...values].sort((left, right) => compareUtf8(left.familyId, right.familyId)));
}

function comparePages(left: ReportPageResult, right: ReportPageResult): number {
  if (left.route !== undefined && right.route !== undefined) {
    const routeComparison = compareUtf8(left.route, right.route);
    return routeComparison === 0 ? compareUtf8(left.pageId, right.pageId) : routeComparison;
  }
  if (left.route !== undefined) return -1;
  if (right.route !== undefined) return 1;
  return compareUtf8(left.pageId, right.pageId);
}

function renderPageText(page: ReportPageResult): string[] {
  const route = page.route === undefined ? "(no route)" : page.route;
  if (page.state !== "rendered") {
    return [
      `Page ${visibleText(route)} · ${page.state}`,
      `  problems: ${page.problemIds.join(", ")}`,
    ];
  }
  return [
    `Page ${visibleText(route)}`,
    ...renderDocumentText(page.document),
  ];
}

function renderDocumentText(document: ReportDocument): string[] {
  const lines = [`  ${visibleText(document.title)}`];
  for (const block of document.children) {
    lines.push(...renderBlockText(block, "  "));
  }
  return lines;
}

function renderBlockText(block: ReportBlock, indent: string): string[] {
  switch (block.type) {
    case "section": {
      const lines = [`${indent}${visibleText(block.heading)}`];
      for (const child of block.children) {
        lines.push(...renderBlockText(child, `${indent}  `));
      }
      return lines;
    }
    case "paragraph":
      return [`${indent}${renderInlineText(block.children)}`];
    case "list": {
      const lines: string[] = [];
      for (const [index, item] of block.items.entries()) {
        const marker = block.ordered ? `${index + 1}. ` : "- ";
        const rendered = item.flatMap((child) => renderBlockText(child, `${indent}  `));
        if (rendered.length === 0) {
          lines.push(`${indent}${marker}`);
        } else {
          lines.push(`${indent}${marker}${rendered[0]!.trimStart()}`);
          lines.push(...rendered.slice(1));
        }
      }
      return lines;
    }
    case "table": {
      const headings = block.columns.map((column) => visibleText(column.label)).join(" | ");
      const rows = block.rows.map((row) =>
        block.columns.map((column) => scalarText(row[column.key]!)).join(" | ")
      );
      return [
        `${indent}${visibleText(block.caption)}`,
        `${indent}${headings}`,
        ...rows.map((row) => `${indent}${row}`),
      ];
    }
    case "metric":
      return [
        `${indent}${visibleText(block.label)}: ${scalarText(block.value)}${
          block.unit === undefined ? "" : ` ${visibleText(block.unit)}`
        }`,
      ];
    case "status":
      return [
        `${indent}[${block.tone}] ${visibleText(block.label)}${
          block.detail === undefined ? "" : `: ${renderInlineText(block.detail)}`
        }`,
      ];
    case "code-block":
      return block.value.split("\n").map((line) => `${indent}${visibleText(line)}`);
    case "chart": {
      const lines = [`${indent}${visibleText(block.title)} (${visibleText(block.categoryLabel)})`];
      for (const series of block.series) {
        const values = block.categories.map((category, index) =>
          `${visibleText(category)}=${scalarText(series.values[index] ?? null)}`
        );
        lines.push(`${indent}${visibleText(series.label)}: ${values.join(", ")}`);
      }
      return lines;
    }
  }
}

function renderInlineText(children: readonly ReportInline[]): string {
  return children.map((child) => {
    switch (child.type) {
      case "text":
        return visibleText(child.value);
      case "code":
        return `\`${visibleText(child.value)}\``;
      case "emphasis":
        return `*${renderInlineText(child.children)}*`;
      case "link":
        return `${renderInlineText(child.label)} (${visibleText(
          child.target.kind === "route" ? child.target.route : child.target.path,
        )})`;
    }
  }).join("");
}

function scalarText(value: ReportScalar): string {
  return typeof value === "string" ? visibleText(value) : String(value);
}

function problemText(problem: ReportProblem): string {
  if (problem.category === "execution") {
    return `${problem.code} in ${visibleText(problem.consumerId)}: ${visibleText(problem.summary)}`;
  }
  const owner = problem.slotId ?? problem.runId;
  const input = problem.inputKey === undefined ? "" : ` input ${visibleText(problem.inputKey)}`;
  const target = owner === undefined ? "" : ` (${visibleText(owner)})`;
  if (problem.code === "migration-required") {
    return `${problem.code}${input}${target}; run niceeval migrate`;
  }
  return `${problem.code}${input}${target}`;
}

/**
 * Hashing stays in the Effect graph so callers never need an ad-hoc Promise
 * runtime just to render show JSON. Web Crypto keeps this host projection
 * platform-neutral while emitting the required lowercase hexadecimal digest.
 */
function sha256Hex(bytes: Uint8Array): Effect.Effect<string, ReportShowRenderError> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    return Effect.fail({
      code: "report-show-render-failed",
      operation: "render",
    });
  }
  // Copy into an owned ArrayBuffer-backed view: a Report file may originate
  // from a wider ArrayBufferLike view, while Web Crypto accepts BufferSource.
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  return Effect.map(
    Effect.tryPromise({
      try: () => subtle.digest("SHA-256", input),
      catch: (): ReportShowRenderError => ({
        code: "report-show-render-failed",
        operation: "render",
      }),
    }),
    (digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

/** Terminal controls remain visible instead of affecting the user's terminal. */
function visibleText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) =>
    `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`
  );
}

/**
 * Canonical JSON avoids object iteration order and declines values that cannot
 * be represented in JSON. A Calculation is intentionally allowed to carry an
 * arbitrary in-process value, so non-JSON values are represented explicitly
 * rather than changing the execution or throwing during a normal show.
 */
function canonicalJson(value: unknown): string {
  return writeJson(value, new Set<object>());
}

function writeJson(value: unknown, stack: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify("[non-finite number]");
    case "undefined":
    case "bigint":
    case "symbol":
    case "function":
      return JSON.stringify("[non-json value]");
    case "object":
      break;
  }

  if (stack.has(value)) return JSON.stringify("[cyclic value]");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => writeJson(entry, stack)).join(",")}]`;
    }
    if (!isPlainDataObject(value)) return JSON.stringify("[non-json value]");
    const keys = Object.keys(value).sort(compareUtf8);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${writeJson(value[key], stack)}`).join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

function isPlainDataObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return false;
  }
  return true;
}

const textEncoder = new TextEncoder();

function compareUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
