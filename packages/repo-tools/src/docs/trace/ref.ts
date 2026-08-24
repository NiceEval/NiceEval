import { Data, Either, ParseResult, Schema } from "effect";

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
  Schema.filter(isCanonicalRepoRef, {
    message: () => "must be a canonical repo-relative path with at most one canonical #anchor",
  }),
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
): Either.Either<ValidatedRepoRefTarget, RepoRefInvalid | RepoRefTargetInvalid> {
  const parsed = parseRepoRef(input);
  if (Either.isLeft(parsed)) return Either.left(parsed.left);
  const direct = snapshot.nodes.find((candidate) => candidate.path === parsed.right.path);
  if (direct !== undefined) {
    return Either.right({ ...parsed.right, kind: direct.kind, owner: direct, directNode: true });
  }
  if (!parsed.right.path.endsWith(".md") || targetSource === undefined) {
    return Either.left(new RepoRefTargetInvalid({
      ref: parsed.right.ref,
      expectedKinds: [],
      message: "target is neither an exact docs node nor an existing Markdown page in a contract package",
    }));
  }
  const useCaseBoundary = snapshot.nodes.find((candidate) =>
    candidate.kind === "use-case" &&
    candidate.path.endsWith("/README.md") &&
    parsed.right.path.startsWith(`${posix.dirname(candidate.path)}/`)
  );
  if (useCaseBoundary !== undefined) {
    return Either.left(new RepoRefTargetInvalid({
      ref: parsed.right.ref,
      expectedKinds: [],
      actualKind: "use-case",
      message: `supporting target is inside Use Case ${useCaseBoundary.path}; target the exact Use Case node`,
    }));
  }
  const owner = snapshot.nodes
    .filter((candidate) => candidate.kind === "roadmap" || candidate.kind === "feature" || candidate.kind === "engineering")
    .filter((candidate) => parsed.right.path.startsWith(`${posix.dirname(candidate.path)}/`))
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (owner === undefined) {
    return Either.left(new RepoRefTargetInvalid({
      ref: parsed.right.ref,
      expectedKinds: [],
      message: "supporting target is outside a Roadmap, Feature, or Engineering package",
    }));
  }
  return Either.right({ ...parsed.right, kind: owner.kind, owner, directNode: false });
}

export function parseRepoRef(input: unknown): Either.Either<ParsedRepoRef, RepoRefInvalid> {
  const decoded = Schema.decodeUnknownEither(RepoRefSchema, { errors: "all" })(input);
  if (Either.isLeft(decoded)) {
    return Either.left(new RepoRefInvalid({
      input,
      message: ParseResult.TreeFormatter.formatErrorSync(decoded.left),
    }));
  }
  const ref = decoded.right;
  const hash = ref.indexOf("#");
  return Either.right(hash < 0
    ? { path: ref, ref }
    : { path: ref.slice(0, hash), anchor: ref.slice(hash + 1), ref });
}

export function formatRepoRef(path: string, anchor?: string): Either.Either<RepoRef, RepoRefInvalid> {
  const parsed = parseRepoRef(anchor === undefined ? path : `${path}#${anchor}`);
  return Either.map(parsed, ({ ref }) => ref);
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
): Either.Either<ValidatedRepoRefTarget, RepoRefInvalid | RepoRefTargetInvalid> {
  const resolved = resolveRepoRefScope(snapshot, input, targetSource);
  if (Either.isLeft(resolved)) {
    return Either.mapLeft(resolved, (error) => error instanceof RepoRefTargetInvalid
      ? new RepoRefTargetInvalid({ ...error, expectedKinds })
      : error);
  }
  if (!expectedKinds.includes(resolved.right.kind)) {
    return Either.left(new RepoRefTargetInvalid({
      ref: resolved.right.ref,
      expectedKinds,
      actualKind: resolved.right.kind,
      message: `target kind ${resolved.right.kind} is not allowed`,
    }));
  }
  if (resolved.right.anchor !== undefined) {
    if (targetSource === undefined) {
      return Either.left(new RepoRefTargetInvalid({
        ref: resolved.right.ref,
        expectedKinds,
        actualKind: resolved.right.kind,
        message: "target source is required to validate an exact anchor",
      }));
    }
    if (!targetSource.split(/\r?\n/u).some((line) => {
      const anchor = markdownAnchor(line);
      return anchor === resolved.right.anchor ||
        (anchor !== undefined && collapsedMarkdownAnchor(anchor) === resolved.right.anchor);
    })) {
      return Either.left(new RepoRefTargetInvalid({
        ref: resolved.right.ref,
        expectedKinds,
        actualKind: resolved.right.kind,
        message: `anchor ${resolved.right.anchor} does not exist on the target page`,
      }));
    }
  }
  return resolved;
}
