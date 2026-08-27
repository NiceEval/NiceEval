import { Data, Result, Schema, SchemaIssue } from "effect";

import { posix } from "node:path";

import type { DocsNodeKind, TraceNode, TraceSnapshot } from "./model.js";

const REPO_REF_BRAND = "@niceeval/repo-tools/RepoRef";

function isCanonicalRepoRef(value: string): boolean {
  if (value.trim() !== value || value.length === 0 || value.includes("\\") || value.startsWith("/")) return false;
  const hashes = [...value.matchAll(/#/gu)];
  if (hashes.length > 1) return false;
  const hash = value.indexOf("#");
  const path = hash < 0 ? value : value.slice(0, hash);
  const anchor = hash < 0 ? undefined : value.slice(hash + 1);
  if (path.length === 0 || path.endsWith("/") || path.includes("//") || path.includes("\0")) return false;
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  return anchor === undefined || (
    anchor.length > 0 &&
    anchor.trim() === anchor &&
    !/[#/?\\\s]/u.test(anchor)
  );
}

export const RepoRefSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isCanonicalRepoRef, {
    message: "must be a canonical repo-relative path with at most one canonical #anchor",
  })),
  Schema.brand(REPO_REF_BRAND),
);
export type RepoRef = typeof RepoRefSchema.Type;

export interface ParsedRepoRef {
  readonly path: string;
  readonly anchor?: string;
  readonly ref: RepoRef;
}

export class RepoRefInvalid extends Data.TaggedError("RepoRefInvalid")<{
  readonly input: unknown;
  readonly message: string;
}> {}

export class RepoRefTargetInvalid extends Data.TaggedError("RepoRefTargetInvalid")<{
  readonly ref: string;
  readonly expectedKinds: readonly DocsNodeKind[];
  readonly actualKind?: DocsNodeKind;
  readonly message: string;
}> {}

export interface ValidatedRepoRefTarget extends ParsedRepoRef {
  readonly kind: DocsNodeKind;
  readonly owner: TraceNode;
  readonly directNode: boolean;
}

export function resolveRepoRefScope(
  snapshot: TraceSnapshot,
  input: unknown,
  targetSource?: string,
): Result.Result<ValidatedRepoRefTarget, RepoRefInvalid | RepoRefTargetInvalid> {
  const parsed = parseRepoRef(input);
  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
  const direct = snapshot.nodes.find((candidate) => candidate.path === parsed.success.path);
  if (direct !== undefined) {
    return Result.succeed({ ...parsed.success, kind: direct.kind, owner: direct, directNode: true });
  }
  if (!parsed.success.path.endsWith(".md") || targetSource === undefined) {
    return Result.fail(new RepoRefTargetInvalid({
      ref: parsed.success.ref,
      expectedKinds: [],
      message: "target is neither an exact docs node nor an existing Markdown page in a contract package",
    }));
  }
  const useCaseBoundary = snapshot.nodes.find((candidate) =>
    candidate.kind === "use-case" &&
    candidate.path.endsWith("/README.md") &&
    parsed.success.path.startsWith(`${posix.dirname(candidate.path)}/`)
  );
  if (useCaseBoundary !== undefined) {
    return Result.fail(new RepoRefTargetInvalid({
      ref: parsed.success.ref,
      expectedKinds: [],
      actualKind: "use-case",
      message: `supporting target is inside Use Case ${useCaseBoundary.path}; target the exact Use Case node`,
    }));
  }
  const owner = snapshot.nodes
    .filter((candidate) => candidate.kind === "roadmap" || candidate.kind === "feature" || candidate.kind === "engineering")
    .filter((candidate) => parsed.success.path.startsWith(`${posix.dirname(candidate.path)}/`))
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (owner === undefined) {
    return Result.fail(new RepoRefTargetInvalid({
      ref: parsed.success.ref,
      expectedKinds: [],
      message: "supporting target is outside a Roadmap, Feature, or Engineering package",
    }));
  }
  return Result.succeed({ ...parsed.success, kind: owner.kind, owner, directNode: false });
}

export function parseRepoRef(input: unknown): Result.Result<ParsedRepoRef, RepoRefInvalid> {
  const decoded = Schema.decodeUnknownResult(RepoRefSchema, { errors: "all" })(input);
  if (Result.isFailure(decoded)) {
    return Result.fail(new RepoRefInvalid({
      input,
      message: SchemaIssue.makeFormatterDefault()(decoded.failure.issue),
    }));
  }
  const ref = decoded.success;
  const hash = ref.indexOf("#");
  return Result.succeed(hash < 0
    ? { path: ref, ref }
    : { path: ref.slice(0, hash), anchor: ref.slice(hash + 1), ref });
}

export function formatRepoRef(path: string, anchor?: string): Result.Result<RepoRef, RepoRefInvalid> {
  const parsed = parseRepoRef(anchor === undefined ? path : `${path}#${anchor}`);
  return Result.map(parsed, ({ ref }) => ref);
}

export function markdownAnchor(line: string): string | undefined {
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1];
  return heading
    ?.toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s/gu, "-");
}

function collapsedMarkdownAnchor(anchor: string): string {
  return anchor.replace(/-+/gu, "-").replace(/^-+|-+$/gu, "");
}

export function validateRepoRefTarget(
  snapshot: TraceSnapshot,
  input: unknown,
  expectedKinds: readonly DocsNodeKind[],
  targetSource?: string,
): Result.Result<ValidatedRepoRefTarget, RepoRefInvalid | RepoRefTargetInvalid> {
  const resolved = resolveRepoRefScope(snapshot, input, targetSource);
  if (Result.isFailure(resolved)) {
    return Result.mapError(resolved, (error) => error instanceof RepoRefTargetInvalid
      ? new RepoRefTargetInvalid({ ...error, expectedKinds })
      : error);
  }
  if (!expectedKinds.includes(resolved.success.kind)) {
    return Result.fail(new RepoRefTargetInvalid({
      ref: resolved.success.ref,
      expectedKinds,
      actualKind: resolved.success.kind,
      message: `target kind ${resolved.success.kind} is not allowed`,
    }));
  }
  if (resolved.success.anchor !== undefined) {
    if (targetSource === undefined) {
      return Result.fail(new RepoRefTargetInvalid({
        ref: resolved.success.ref,
        expectedKinds,
        actualKind: resolved.success.kind,
        message: "target source is required to validate an exact anchor",
      }));
    }
    if (!targetSource.split(/\r?\n/u).some((line) => {
      const anchor = markdownAnchor(line);
      return anchor === resolved.success.anchor ||
        (anchor !== undefined && collapsedMarkdownAnchor(anchor) === resolved.success.anchor);
    })) {
      return Result.fail(new RepoRefTargetInvalid({
        ref: resolved.success.ref,
        expectedKinds,
        actualKind: resolved.success.kind,
        message: `anchor ${resolved.success.anchor} does not exist on the target page`,
      }));
    }
  }
  return resolved;
}
