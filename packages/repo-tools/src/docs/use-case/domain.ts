import { lstatSync, readFileSync, type Stats } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import * as FileSystem from "effect/FileSystem";
import { Effect } from "effect";

import { compileTraceUnderLease } from "../trace/compiler.js";
import {
  mutateTraceFiles,
  traceDigest,
  withTraceReadLease,
  type TraceMultiFileChange,
} from "../trace/relation-mutation.js";
import type { TraceNode, TraceSnapshot } from "../trace/model.js";
import {
  UseCaseIndexInvalid,
  UseCaseInputInvalid,
  UseCaseIoError,
  UseCaseParentMissing,
  UseCaseTargetConflict,
  useCaseErrorMessage,
  type UseCaseDomainError,
} from "./errors.js";
import type { UseCaseCreateInput, UseCaseCreateReceipt } from "./model.js";
import { decodeUseCaseCreateInput } from "./schema.js";

const PROJECTION_START = "<!-- niceeval.docs-index/v1:start -->";
const PROJECTION_END = "<!-- niceeval.docs-index/v1:end -->";

interface UseCaseIndexItem {
  readonly path: string;
  readonly title: string;
}

interface UseCasePlan {
  readonly input: UseCaseCreateInput;
  readonly parent: TraceNode;
  readonly snapshot: TraceSnapshot;
  readonly indexPath: string;
  readonly targetPath: string;
  readonly changes: readonly TraceMultiFileChange[];
}

function pathMessage(cause: unknown): string {
  return useCaseErrorMessage(cause);
}

function safeLstat(path: string, displayPath: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") return undefined;
    throw new UseCaseIoError({ operation: "inspect", path: displayPath, message: pathMessage(cause) });
  }
}

function assertDirectoryChain(root: string, directory: string, displayPath: string): void {
  const repository = resolve(root);
  const resolved = resolve(directory);
  const relation = relative(repository, resolved);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || relation.startsWith("../")) {
    throw new UseCaseIndexInvalid({ path: displayPath, message: "Use Case paths must stay below the repository root" });
  }
  const rootStatus = safeLstat(repository, ".");
  if (rootStatus?.isSymbolicLink() === true) {
    throw new UseCaseIndexInvalid({ path: displayPath, message: "repository root must not be a symbolic link" });
  }
  let current = repository;
  for (const segment of relation.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    const status = safeLstat(current, displayPath);
    if (status === undefined) {
      throw new UseCaseIndexInvalid({ path: displayPath, message: "parent use-case directory must already exist" });
    }
    if (status.isSymbolicLink()) {
      throw new UseCaseIndexInvalid({ path: displayPath, message: "Use Case paths must not traverse a symbolic link" });
    }
    if (!status.isDirectory()) {
      throw new UseCaseIndexInvalid({ path: displayPath, message: "parent use-case path must be a directory" });
    }
  }
}

function readIndex(root: string, indexPath: string): string {
  const absolute = resolve(root, indexPath);
  assertDirectoryChain(root, dirname(absolute), indexPath);
  const status = safeLstat(absolute, indexPath);
  if (status === undefined) {
    throw new UseCaseIndexInvalid({ path: indexPath, message: "parent Feature must already contain use-case/README.md" });
  }
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new UseCaseIndexInvalid({ path: indexPath, message: "Use Case index must be a regular file, not a symlink or special file" });
  }
  try {
    return readFileSync(absolute, "utf8");
  } catch (cause) {
    throw new UseCaseIoError({ operation: "read", path: indexPath, message: pathMessage(cause) });
  }
}

function assertTargetAbsent(root: string, targetPath: string): void {
  const status = safeLstat(resolve(root, targetPath), targetPath);
  if (status !== undefined) {
    throw new UseCaseTargetConflict({ path: targetPath, message: "target already exists; choose another single-segment slug" });
  }
}

function validateBody(body: string, title: string): string {
  const normalized = body.trim();
  if (/^---(?:\r?\n|$)/u.test(normalized)) {
    throw new UseCaseInputInvalid({ source: "body", message: "body must not contain caller-owned frontmatter or metadata" });
  }
  if (normalized.includes(PROJECTION_START) || normalized.includes(PROJECTION_END)) {
    throw new UseCaseInputInvalid({ source: "body", message: "body must not contain a generated docs index region" });
  }
  const heading = /^#\s+(.+)$/mu.exec(normalized)?.[1]?.trim();
  if (heading === undefined) {
    throw new UseCaseInputInvalid({ source: "body", message: "complete Use Case body must contain a level-one Markdown title" });
  }
  if (heading !== title) {
    throw new UseCaseInputInvalid({ source: "body", message: `level-one Markdown title must equal --title ${JSON.stringify(title)}` });
  }
  return normalized;
}

function renderLeaf(body: string): string {
  return `---\nformat: niceeval.docs-node/v1\nkind: use-case\nrelations: {}\n---\n\n${body}\n`;
}

function escapeLinkTitle(title: string): string {
  return title.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function renderProjection(items: readonly UseCaseIndexItem[]): string {
  const links = items.map((item) => `- [${escapeLinkTitle(item.title)}](${item.path.slice(item.path.lastIndexOf("/") + 1)})`);
  return [
    PROJECTION_START,
    "## Use Case 索引（生成）",
    "",
    ...links,
    PROJECTION_END,
  ].join("\n");
}

function replaceProjection(indexPath: string, source: string, projection: string): string {
  const positions = (token: string): readonly number[] => {
    const found: number[] = [];
    let cursor = 0;
    while (cursor <= source.length) {
      const index = source.indexOf(token, cursor);
      if (index < 0) break;
      found.push(index);
      cursor = index + token.length;
    }
    return found;
  };
  const starts = positions(PROJECTION_START);
  const ends = positions(PROJECTION_END);
  if (starts.length === 0 && ends.length === 0) {
    const separator = source.endsWith("\n\n") ? "" : source.endsWith("\n") ? "\n" : "\n\n";
    return `${source}${separator}${projection}\n`;
  }
  const start = starts[0];
  const end = ends[0];
  if (starts.length !== 1 || ends.length !== 1 || start === undefined || end === undefined || end < start) {
    throw new UseCaseIndexInvalid({ path: indexPath, message: "generated docs index markers are missing, duplicated, or out of order" });
  }
  return `${source.slice(0, start)}${projection}${source.slice(end + PROJECTION_END.length)}`;
}

function selectParent(snapshot: TraceSnapshot, selector: string): TraceNode {
  const matches = snapshot.nodes.filter((node) => node.kind === "feature" && (
    node.path === selector || node.path.replace(/^docs\/feature\//u, "").replace(/\/README\.md$/u, "") === selector
  ));
  if (matches.length !== 1) {
    throw new UseCaseParentMissing({
      parent: selector,
      nextStep: "Run pnpm run repo docs feature list and pass one exact Feature ID or canonical README path.",
    });
  }
  return matches[0]!;
}

function directUseCases(snapshot: TraceSnapshot, indexPath: string): readonly UseCaseIndexItem[] {
  const directory = `${dirname(indexPath)}/`;
  return snapshot.nodes.flatMap((node): UseCaseIndexItem[] => {
    if (node.kind !== "use-case" || !node.path.startsWith(directory)) return [];
    const local = node.path.slice(directory.length);
    return local !== "README.md" && !local.includes("/") && local.endsWith(".md")
      ? [{ path: node.path, title: node.title }]
      : [];
  });
}

function makePlan(
  root: string,
  rawInput: UseCaseCreateInput,
): Effect.Effect<UseCasePlan, UseCaseDomainError | import("../trace/errors.js").TraceError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const input = yield* decodeUseCaseCreateInput(rawInput);
    const body = yield* Effect.try({
      try: () => validateBody(input.body, input.title),
      catch: (cause) => cause instanceof UseCaseInputInvalid
        ? cause
        : new UseCaseInputInvalid({ source: "body", message: pathMessage(cause) }),
    });
    const snapshot = yield* compileTraceUnderLease(root);
    const inspected = yield* Effect.try({
      try: () => {
        const parent = selectParent(snapshot, input.parent);
        const featureRoot = dirname(parent.path);
        const indexPath = `${featureRoot}/use-case/README.md`;
        const targetPath = `${featureRoot}/use-case/${input.slug}.md`;
        const indexSource = readIndex(root, indexPath);
        assertTargetAbsent(root, targetPath);
        if (snapshot.nodes.some((node) => node.path === targetPath)) {
          throw new UseCaseTargetConflict({ path: targetPath, message: "target is already a Trace node" });
        }
        const items = [...directUseCases(snapshot, indexPath), { path: targetPath, title: input.title }]
          .sort((left, right) => left.path.localeCompare(right.path));
        const leaf = renderLeaf(body);
        const index = replaceProjection(indexPath, indexSource, renderProjection(items));
        return {
          parent,
          indexPath,
          targetPath,
          changes: [
            { path: targetPath, bytes: leaf, expectedDigest: null },
            { path: indexPath, bytes: index, expectedDigest: traceDigest(indexSource) },
          ] satisfies readonly TraceMultiFileChange[],
        };
      },
      catch: (cause) => cause instanceof UseCaseParentMissing ||
        cause instanceof UseCaseIndexInvalid ||
        cause instanceof UseCaseTargetConflict ||
        cause instanceof UseCaseIoError
        ? cause
        : new UseCaseIoError({ operation: "inspect", path: input.parent, message: pathMessage(cause) }),
    });
    return { input, snapshot, ...inspected };
  });
}

function receipt(plan: UseCasePlan, committed: boolean): UseCaseCreateReceipt {
  return {
    format: "niceeval.docs-use-case/create-v1",
    operation: "use-case-create",
    dryRun: plan.input.dryRun,
    parent: { ref: plan.parent.path, title: plan.parent.title },
    useCase: { slug: plan.input.slug, ref: plan.targetPath, title: plan.input.title },
    snapshotDigest: plan.snapshot.digest,
    generation: plan.snapshot.generation,
    nextGeneration: plan.snapshot.generation + 1,
    preimages: plan.changes.map((change) => ({ path: change.path, digest: change.expectedDigest ?? null })),
    plannedDigests: plan.changes.map((change) => ({ path: change.path, digest: traceDigest(change.bytes) })),
    changedPaths: plan.changes.map((change) => change.path),
    committed,
  };
}

export function createUseCaseAt(
  root: string,
  input: UseCaseCreateInput,
): Effect.Effect<
  UseCaseCreateReceipt,
  UseCaseDomainError | import("../trace/errors.js").TraceError | import("../trace/relation-mutation.js").TraceCoordinationError,
  FileSystem.FileSystem
> {
  const prepare = makePlan(root, input);
  if (input.dryRun) return withTraceReadLease(root, () => prepare).pipe(Effect.map((plan) => receipt(plan, false)));
  let planned: UseCasePlan | undefined;
  return mutateTraceFiles({
    root,
    operation: "use-case-create",
    prepareUnderLease: prepare.pipe(
      Effect.tap((plan) => Effect.sync(() => { planned = plan; })),
      Effect.map((plan) => plan.changes),
    ),
  }).pipe(Effect.map(() => receipt(planned!, true)));
}
