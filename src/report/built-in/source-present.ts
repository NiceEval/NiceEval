import { padDisplay } from "../model/text-layout.ts";
import type {
  AssertionSourceEntry,
  AttemptSourceAnnotation,
  AttemptSourceFileNode,
  AttemptSourceTree,
  AttemptSourceTreeLine,
  AttemptSourceTreeNode,
} from "../../sources/projection-model.ts";

export type SourcePresentMode = "default" | "full" | "file";

export interface SourceCallSummary {
  readonly checks: number;
  readonly passed: number;
  readonly failed: number;
  readonly unavailable: number;
}

export interface PresentedSourceLine {
  readonly line: number;
  readonly text: string;
  readonly glyph: " " | "✓" | "✗" | "◌";
}

export interface PresentedSourceFile {
  readonly file: string;
  readonly lines: readonly PresentedSourceLine[];
}

export interface PresentedSourceCall {
  readonly file: string;
  readonly summary: SourceCallSummary;
  readonly open: boolean;
  readonly body?: PresentedSourceFile;
}

export interface PresentedSource {
  readonly locator: string;
  readonly evalId: string;
  readonly experimentId: string;
  readonly verdict: string;
  readonly runId: string;
  readonly attempt: number;
  readonly artifactPath: string;
  readonly spine: PresentedSourceFile;
  readonly calls: readonly PresentedSourceCall[];
  readonly callsByLine: Readonly<Record<number, readonly PresentedSourceCall[]>>;
  readonly summary: SourceCallSummary;
}

export interface SourcePresentOptions {
  readonly mode: SourcePresentMode;
  readonly file?: string;
  readonly width?: number;
}

const emptySummary = (): SourceCallSummary =>
  Object.freeze({ checks: 0, passed: 0, failed: 0, unavailable: 0 });

export function presentAttemptSource(input: {
  readonly tree: AttemptSourceTree;
  readonly locator: string;
  readonly evalId: string;
  readonly experimentId: string;
  readonly verdict: string;
  readonly runId: string;
  readonly attempt: number;
  readonly options: SourcePresentOptions;
}): PresentedSource | { readonly state: "file-missing"; readonly file: string } {
  const mode = input.options.mode;
  const requested = input.options.file;
  const files = collectFileNodes(input.tree.roots);
  const spineNode = mode === "file" && requested !== undefined
    ? resolveSourceFile(files, requested)
    : firstFileNode(input.tree.roots);
  if (mode === "file" && requested !== undefined && spineNode === undefined) {
    return Object.freeze({ state: "file-missing" as const, file: requested });
  }
  if (spineNode === undefined) {
    return Object.freeze({ state: "file-missing" as const, file: requested ?? "(eval entry)" });
  }

  const entries = input.tree.entries.map((entry) => entry.entry);
  const spine = projectFile(spineNode, true, mode, entries);
  const callsByLine = new Map<number, readonly PresentedSourceCall[]>();
  if (mode !== "file") {
    for (const line of spineNode.lines) {
      const calls = line.calls.flatMap((node) => presentCalls(node, mode, entries));
      if (calls.length > 0) callsByLine.set(line.line, calls);
    }
  }
  const calls = [...callsByLine.values()].flat();
  const summary = addSummaries([
    summaryOfOwnAssertions(spineNode, entries),
    ...calls.map((call) => call.summary),
  ]);
  return Object.freeze({
    locator: input.locator,
    evalId: input.evalId,
    experimentId: input.experimentId,
    verdict: input.verdict,
    runId: input.runId,
    attempt: input.attempt,
    artifactPath: displaySourceArtifactPath(input.experimentId, input.runId, input.evalId, input.attempt),
    spine,
    calls,
    summary,
    callsByLine: Object.freeze(Object.fromEntries(callsByLine)),
  });
}

export function renderPresentedSource(
  presented: PresentedSource,
  width: number,
): string {
  const header = `${presented.locator} · ${presented.evalId} · ${presented.experimentId} · ${presented.verdict}`;
  const blocks = [
    header,
    renderSourceFile(presented.spine, presented.callsByLine, "", width),
    `${presented.summary.checks} checks · ${presented.summary.passed} passed · ${presented.summary.failed} failed` +
      (presented.summary.unavailable > 0 ? ` · ${presented.summary.unavailable} unavailable` : ""),
    `full eval source: ${presented.artifactPath}`,
  ];
  return blocks.join("\n\n");
}

export function displaySourceArtifactPath(
  experimentId: string,
  runId: string,
  evalId: string,
  attempt: number,
): string {
  return `.niceeval/${experimentId.replaceAll("/", "_")}/${runId}/${evalId}/a${attempt}/sources.json`;
}

function presentCalls(
  node: AttemptSourceTreeNode,
  mode: SourcePresentMode,
  entries: readonly AssertionSourceEntry[],
): readonly PresentedSourceCall[] {
  if (node.kind === "package") {
    const children = node.calls.flatMap((child) => presentCalls(child, mode, entries));
    const summary = addSummaries(children.map((child) => child.summary));
    if (summary.checks === 0 && children.length === 0) {
      return [];
    }
    return [Object.freeze({
      file: `package: ${node.package.label}`,
      summary,
      open: false,
    })];
  }
  if (!isProjectSourcePath(node.file.path)) {
    return [];
  }
  const summary = summaryOfFile(node, entries);
  const open = mode === "full" || needsAttention(summary);
  return [Object.freeze({
    file: node.file.path,
    summary,
    open,
    ...(open ? { body: projectFile(node, false, mode, entries) } : {}),
  })];
}

function projectFile(
  node: AttemptSourceFileNode,
  isSpine: boolean,
  mode: SourcePresentMode,
  entries: readonly AssertionSourceEntry[],
): PresentedSourceFile {
  const selected = mode === "file"
    ? node.lines
    : selectSourceLines(node.lines, isSpine ? 3 : 2, isSpine ? 8 : 4);
  return Object.freeze({
    file: node.file.path,
    lines: selected.map((line) => Object.freeze({
      line: line.line,
      text: line.text,
      glyph: lineGlyph(line.annotations, entries),
    })),
  });
}

function renderSourceFile(
  file: PresentedSourceFile,
  callsByLine: Readonly<Record<number, readonly PresentedSourceCall[]>>,
  indent: string,
  width: number,
): string {
  const gutterWidth = String(file.lines.at(-1)?.line ?? 1).length;
  const lines: string[] = [`${indent}${file.file}`];
  let previous = 0;
  for (const line of file.lines) {
    if (previous > 0 && line.line > previous + 1) {
      lines.push(`${indent}... ${line.line - previous - 1} lines`);
    } else if (previous === 0 && line.line > 1) {
      lines.push(`${indent}... ${line.line - 1} lines`);
    }
    lines.push(renderSourceLine(line, gutterWidth, width, indent));
    for (const call of callsByLine[line.line] ?? []) {
      lines.push(`${indent}  ↳ ${call.file} · ${sourceCallSummaryLine(call.summary)}`);
      if (call.open && call.body !== undefined) {
        lines.push(renderSourceFile(call.body, {}, `${indent}  │ `, width));
      }
    }
    previous = line.line;
  }
  return lines.join("\n");
}

function renderSourceLine(
  line: PresentedSourceLine,
  gutterWidth: number,
  width: number,
  indent: string,
): string {
  const marginWidth = gutterWidth + 2;
  const prefix = `${indent}${padDisplay(String(line.line), gutterWidth)}${line.glyph} `;
  const available = Math.max(20, width - marginWidth - indent.length);
  return prefix + clip(line.text, available);
}

function sourceCallSummaryLine(summary: SourceCallSummary): string {
  return [
    `${summary.checks} checks`,
    `${summary.passed} ✓`,
    `${summary.failed} ✗`,
    ...(summary.unavailable > 0 ? [`${summary.unavailable} unavailable`] : []),
  ].join(" · ");
}

function lineGlyph(
  annotations: readonly AttemptSourceAnnotation[],
  entries: readonly AssertionSourceEntry[],
): PresentedSourceLine["glyph"] {
  const results = annotations.flatMap((annotation) => {
    if (annotation.kind !== "assertion") return [];
    const entry = entries.find((candidate) =>
      candidate.state === "available"
        ? candidate.entry.entryId === annotation.entryId
        : candidate.entry.entryId === annotation.entryId
    );
    return entry === undefined ? [] : [entry];
  });
  if (results.length === 0) return " ";
  if (results.some((entry) => entry.entry.result.state === "mismatched" || entry.entry.result.state === "errored")) {
    return "✗";
  }
  if (results.some((entry) => entry.entry.result.state === "unavailable")) {
    return "◌";
  }
  return "✓";
}

function summaryOfOwnAssertions(
  node: AttemptSourceFileNode,
  entries: readonly AssertionSourceEntry[],
): SourceCallSummary {
  const parts: SourceCallSummary[] = [];
  for (const line of node.lines) {
    for (const annotation of line.annotations) {
      if (annotation.kind !== "assertion") continue;
      const entry = entries.find((candidate) => candidate.entry.entryId === annotation.entryId);
      if (entry === undefined) continue;
      parts.push(summaryOfEntry(entry));
    }
  }
  return addSummaries(parts);
}

function summaryOfFile(
  node: AttemptSourceFileNode,
  entries: readonly AssertionSourceEntry[],
): SourceCallSummary {
  const parts: SourceCallSummary[] = [summaryOfOwnAssertions(node, entries)];
  for (const line of node.lines) {
    for (const call of line.calls) {
      if (call.kind === "file") parts.push(summaryOfFile(call, entries));
      else {
        for (const child of call.calls) {
          if (child.kind === "file") parts.push(summaryOfFile(child, entries));
        }
      }
    }
  }
  return addSummaries(parts);
}

function summaryOfEntry(entry: AssertionSourceEntry): SourceCallSummary {
  const state = entry.entry.result.state;
  return Object.freeze({
    checks: 1,
    passed: state === "matched" ? 1 : 0,
    failed: state === "mismatched" || state === "errored" ? 1 : 0,
    unavailable: state === "unavailable" ? 1 : 0,
  });
}

function addSummaries(items: readonly SourceCallSummary[]): SourceCallSummary {
  return Object.freeze(items.reduce(
    (sum, item) => ({
      checks: sum.checks + item.checks,
      passed: sum.passed + item.passed,
      failed: sum.failed + item.failed,
      unavailable: sum.unavailable + item.unavailable,
    }),
    emptySummary(),
  ));
}

function needsAttention(summary: SourceCallSummary): boolean {
  return summary.failed > 0 || summary.unavailable > 0;
}

function selectSourceLines(
  lines: readonly AttemptSourceTreeLine[],
  radius: number,
  foldThreshold: number,
): AttemptSourceTreeLine[] {
  if (lines.length === 0) return [];
  const keep = new Set<number>();
  const essentials = lines.flatMap((line, index) =>
    line.annotations.length > 0 || line.calls.length > 0 ? [index] : []
  );
  for (const index of essentials) {
    for (
      let candidate = Math.max(0, index - radius);
      candidate <= Math.min(lines.length - 1, index + radius);
      candidate++
    ) {
      keep.add(candidate);
    }
  }
  if (essentials.length === 0) {
    for (let index = 0; index < Math.min(lines.length, radius + 1); index++) keep.add(index);
  }
  let gapStart = 0;
  while (gapStart < lines.length) {
    while (gapStart < lines.length && keep.has(gapStart)) gapStart += 1;
    if (gapStart >= lines.length) break;
    let gapEnd = gapStart;
    while (gapEnd + 1 < lines.length && !keep.has(gapEnd + 1)) gapEnd += 1;
    if (gapEnd - gapStart + 1 < foldThreshold) {
      for (let index = gapStart; index <= gapEnd; index++) keep.add(index);
    }
    gapStart = gapEnd + 1;
  }
  return lines.filter((_line, index) => keep.has(index));
}

function collectFileNodes(nodes: readonly AttemptSourceTreeNode[]): AttemptSourceFileNode[] {
  const files: AttemptSourceFileNode[] = [];
  const visit = (node: AttemptSourceTreeNode): void => {
    if (node.kind === "file") {
      files.push(node);
      for (const line of node.lines) for (const call of line.calls) visit(call);
      return;
    }
    for (const call of node.calls) visit(call);
  };
  for (const node of nodes) visit(node);
  return files;
}

function firstFileNode(nodes: readonly AttemptSourceTreeNode[]): AttemptSourceFileNode | undefined {
  for (const node of nodes) {
    if (node.kind === "file") return node;
    const nested = firstFileNode(node.calls);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function resolveSourceFile(
  files: readonly AttemptSourceFileNode[],
  requested: string,
): AttemptSourceFileNode | undefined {
  const suffix = requested.replaceAll("\\", "/").replace(/^\.\//, "");
  const matches = files.filter((file) =>
    file.file.path === suffix || file.file.path.endsWith(`/${suffix}`)
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function isProjectSourcePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return !normalized.includes("/node_modules/")
    && !normalized.startsWith("node_modules/")
    && !normalized.includes("/dist/")
    && normalized !== "package.json";
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (+${text.length - max} more chars)`;
}
