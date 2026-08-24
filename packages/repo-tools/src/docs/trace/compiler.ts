import { FileSystem } from "@effect/platform";
import { createHash } from "node:crypto";
import { join, posix, relative, sep } from "node:path";
import { Effect, Either, ParseResult, Schema } from "effect";
import { parse } from "yaml";

import { decodeFeedbackDocument } from "../../feedback/codec.js";
import { decodeMemoryDocument } from "../../memory/codec.js";
import {
  TraceFormatError,
  TraceInputChanged,
  TraceIoError,
  TraceMutationActive,
  TraceSnapshotChanged,
  type TraceError,
} from "./errors.js";
import { markdownAnchor, parseRepoRef, RepoRefSchema, validateRepoRefTarget } from "./ref.js";
import {
  readTraceGeneration,
  withTraceReadLease,
  TraceMutationError,
} from "./relation-mutation.js";
import type {
  DocsNodeKind,
  TraceFeedback,
  TraceMemory,
  TraceNode,
  TraceOwner,
  TracePage,
  TracePageRole,
  TraceSnapshot,
  TraceTest,
} from "./model.js";

const kinds = Schema.Literal("feature", "roadmap", "engineering", "design", "design-plan", "use-case");
const refSchema = RepoRefSchema;
const refsSchema = Schema.Array(refSchema).pipe(
  Schema.minItems(1),
  Schema.filter((value) => new Set(value).size === value.length, { message: () => "must be unique" }),
);
const NodeSchema = Schema.Struct({
  format: Schema.Literal("niceeval.docs-node/v1"),
  kind: kinds,
  relations: Schema.Record({ key: Schema.String, value: Schema.Union(refSchema, refsSchema) }),
});
const RepoMetadataSchema = Schema.Struct({
  name: Schema.String,
  targets: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
const E2eTargetSchema = Schema.Struct({
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
const NiceEvalMetadataSchema = Schema.Struct({
  lanes: Schema.Array(Schema.String),
  areas: Schema.Array(Schema.String),
  executor: Schema.Struct({ kind: Schema.String }),
});

const sorted = <A>(items: readonly A[], key: (item: A) => string): readonly A[] =>
  [...items].sort((a, b) => key(a).localeCompare(key(b)));
const slash = (path: string): string => path.split(sep).join("/");
const digest = (value: unknown): string => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
const pure = <A>(
  path: string,
  subject: string,
  thunk: () => A,
): Effect.Effect<A, TraceFormatError> => Effect.try({
  try: thunk,
  catch: (cause) => cause instanceof TraceFormatError
    ? cause
    : new TraceFormatError({ path, subject, message: message(cause) }),
});

function referenceParts(reference: string): { readonly path: string; readonly anchor?: string } {
  const parsed = parseRepoRef(reference);
  if (Either.isLeft(parsed)) throw new Error(parsed.left.message);
  return parsed.right.anchor === undefined
    ? { path: parsed.right.path }
    : { path: parsed.right.path, anchor: parsed.right.anchor };
}

function parseFrontmatter(path: string, text: string): { readonly value: unknown; readonly body: string } | undefined {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return undefined;
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(text);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new TraceFormatError({ path, subject: "frontmatter", message: "missing closing delimiter" });
  }
  try {
    return { value: parse(match[1]) as unknown, body: match[2] };
  } catch (cause) {
    throw new TraceFormatError({ path, subject: "frontmatter", message: message(cause) });
  }
}

function decodeNode(path: string, text: string): TraceNode | undefined {
  const parsed = parseFrontmatter(path, text);
  if (parsed === undefined) return undefined;
  if (
    typeof parsed.value !== "object" ||
    parsed.value === null ||
    !("format" in parsed.value) ||
    parsed.value.format !== "niceeval.docs-node/v1"
  ) return undefined;
  const decoded = Schema.decodeUnknownEither(NodeSchema, { errors: "all", onExcessProperty: "error" })(parsed.value);
  if (decoded._tag === "Left") {
    throw new TraceFormatError({
      path,
      subject: "frontmatter",
      message: ParseResult.TreeFormatter.formatErrorSync(decoded.left),
    });
  }
  const permitted: Record<DocsNodeKind, readonly string[]> = {
    feature: [],
    roadmap: ["buildsOn"],
    engineering: ["supports"],
    design: ["selectedPlan", "decides"],
    "design-plan": [],
    "use-case": ["composes"],
  };
  const relations: Record<string, readonly string[]> = {};
  for (const [name, value] of Object.entries(decoded.right.relations)
    .sort(([left], [right]) => left.localeCompare(right))) {
    if (!permitted[decoded.right.kind].includes(name)) {
      throw new TraceFormatError({
        path,
        subject: "relations",
        message: `${name} is not permitted for ${decoded.right.kind}`,
      });
    }
    if (name === "selectedPlan" && Array.isArray(value)) {
      throw new TraceFormatError({ path, subject: name, message: "must be a scalar ref" });
    }
    if (name !== "selectedPlan" && !Array.isArray(value)) {
      throw new TraceFormatError({ path, subject: name, message: "must be an array of refs" });
    }
    relations[name] = Array.isArray(value) ? sorted(value, (item) => item) : [value];
  }
  return {
    kind: decoded.right.kind,
    path,
    title: /^#\s+(.+)$/mu.exec(parsed.body)?.[1]?.trim() ?? path,
    relations,
  };
}

function validUseCasePlacement(path: string): boolean {
  const segments = path.split("/");
  const marker = segments.indexOf("use-case", 2);
  if (marker < 0) return false;
  const suffix = segments.slice(marker + 1);
  const filename = suffix.at(-1);
  if (filename === undefined || !filename.endsWith(".md")) return false;
  if (filename === "README.md" && suffix.length < 2) return false;
  if (segments[0] === "docs" && segments[1] === "feature") {
    if (marker === 2) return filename === "README.md" && suffix.length >= 2;
    return marker >= 3;
  }
  if (segments[0] === "docs" && segments[1] === "roadmap") return marker >= 3;
  return segments[0] === "docs" && segments[1] === "design" &&
    segments[2] !== undefined && /^PLAN-[1-9][0-9]*$/u.test(segments[3] ?? "") && marker === 4;
}

function validNodePlacement(node: TraceNode): boolean {
  switch (node.kind) {
    case "feature":
      return /^docs\/feature\/(?!README\.md$)(?!use-case(?:\/|$))(?!.*\/use-case\/).+\/README\.md$/u.test(node.path);
    case "roadmap":
      return /^docs\/roadmap\/(?!README\.md$)(?!use-case(?:\/|$))(?!.*\/use-case\/).+\/README\.md$/u.test(node.path);
    case "engineering":
      return /^docs\/engineering\/(?!README\.md$)(?!_template(?:\/|$)).+\/README\.md$/u.test(node.path);
    case "design":
      return /^docs\/design\/[^/]+\/README\.md$/u.test(node.path);
    case "design-plan":
      return /^docs\/design\/[^/]+\/PLAN-[1-9][0-9]*\/README\.md$/u.test(node.path);
    case "use-case":
      return validUseCasePlacement(node.path);
  }
}

function markdownTitle(path: string, source: string): string {
  const parsed = parseFrontmatter(path, source);
  const body = parsed?.body ?? source;
  return /^#\s+(.+)$/mu.exec(body)?.[1]?.trim() ?? path;
}

function featureForPath(nodes: readonly TraceNode[], path: string): TraceNode | undefined {
  return nodes
    .filter((node) => node.kind === "feature" &&
      path.startsWith(node.path.slice(0, -"README.md".length)))
    .sort((left, right) => right.path.length - left.path.length)[0];
}

function isInsideUseCaseBoundary(nodes: readonly TraceNode[], path: string): boolean {
  return nodes.some((node) => node.kind === "use-case" && node.path.endsWith("/README.md") &&
    path !== node.path && path.startsWith(node.path.slice(0, -"README.md".length)));
}

function pageRole(featurePath: string, pagePath: string): TracePageRole {
  const featureRoot = featurePath.slice(0, -"README.md".length);
  const placement = pagePath.slice(featureRoot.length);
  if (placement === "README.md") return "overview";
  if (placement === "library.md" || placement.startsWith("library/")) return "library";
  if (placement === "cli.md" || placement.startsWith("cli/")) return "cli";
  if (placement === "architecture.md" || placement.startsWith("architecture/")) return "architecture";
  if (placement === "lifecycle.md" || placement.startsWith("lifecycle/")) return "lifecycle";
  if (placement.startsWith("reference/")) return "reference";
  return "supporting";
}

function deriveFeaturePages(
  nodes: readonly TraceNode[],
  documents: readonly (readonly [string, string])[],
): readonly TracePage[] {
  const useCases = nodes.filter((node) => node.kind === "use-case");
  return sorted(nodes.flatMap((feature): TracePage[] => {
    if (feature.kind !== "feature") return [];
    return documents.flatMap(([path, source]): TracePage[] => {
      if (featureForPath(nodes, path)?.path !== feature.path) return [];
      const insideUseCase = useCases.some((useCase) => {
        if (path === useCase.path) return true;
        return useCase.path.endsWith("/README.md") &&
          path.startsWith(useCase.path.slice(0, -"README.md".length));
      });
      if (insideUseCase) return [];
      return [{
        path,
        title: markdownTitle(path, source),
        role: pageRole(feature.path, path),
        feature: feature.path,
      }];
    });
  }), (page) => page.path);
}

function hasHeading(source: string, anchor: string): boolean {
  return source.split(/\r?\n/u).some((line) => markdownAnchor(line) === anchor);
}
function parseOwner(ownerRef: string, ownerPath: string, text: string): TraceOwner {
  const hash = ownerRef.lastIndexOf("#");
  if (hash <= 0 || hash === ownerRef.length - 1) {
    throw new TraceFormatError({ path: ownerPath, subject: "owner", message: "must name an anchor" });
  }
  const anchor = ownerRef.slice(hash + 1);
  const lines = text.split(/\r?\n/u);
  const headingLines = lines.flatMap((item, index) => markdownAnchor(item) === anchor ? [index] : []);
  if (headingLines.length === 0) {
    throw new TraceFormatError({ path: ownerPath, subject: "owner", message: `anchor ${anchor} is missing` });
  }
  if (headingLines.length !== 1) {
    throw new TraceFormatError({ path: ownerPath, subject: "owner", message: `anchor ${anchor} is ambiguous` });
  }
  const line = headingLines[0];
  if (line === undefined) throw new TraceFormatError({ path: ownerPath, subject: "owner", message: `anchor ${anchor} is missing` });
  let cursor = line + 1;
  while (lines[cursor]?.trim() === "") cursor += 1;
  if (lines[cursor]?.trim() !== "<!-- niceeval.e2e-owner-contract/v1 -->") {
    throw new TraceFormatError({
      path: ownerPath,
      subject: "contract",
      message: "missing immediate versioned contract block",
    });
  }
  cursor += 1;
  while (lines[cursor]?.trim() === "") cursor += 1;
  const target = /^Contract:\s+\[[^\]]+\]\(([^)]+)\)\s*$/u.exec(lines[cursor] ?? "")?.[1];
  if (target === undefined || target.startsWith("#")) {
    throw new TraceFormatError({ path: ownerPath, subject: "contract", message: "must be one repo Markdown link" });
  }
  const contract = posix.normalize(posix.join(posix.dirname(ownerPath), target));
  if (contract.startsWith("../") || contract === "..") {
    throw new TraceFormatError({ path: ownerPath, subject: "contract", message: "escapes repository" });
  }
  return { ref: ownerRef, path: ownerPath, anchor, contract };
}

function ownerContracts(documents: readonly (readonly [string, string])[]): readonly TraceOwner[] {
  const owners: TraceOwner[] = [];
  const seen = new Set<string>();
  for (const [path, source] of documents) {
    const lines = source.split(/\r?\n/u);
    let fence: { readonly character: "`" | "~"; readonly length: number } | undefined;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
      if (fenceMatch !== undefined) {
        const character = fenceMatch[0] as "`" | "~";
        if (fence === undefined) fence = { character, length: fenceMatch.length };
        else if (character === fence.character && fenceMatch.length >= fence.length) fence = undefined;
        continue;
      }
      if (fence !== undefined || line.trim() !== "<!-- niceeval.e2e-owner-contract/v1 -->") continue;
      let heading = index - 1;
      while (heading >= 0 && lines[heading]?.trim() === "") heading -= 1;
      const anchor = markdownAnchor(lines[heading] ?? "");
      if (anchor === undefined) {
        throw new TraceFormatError({
          path,
          subject: "owner",
          message: "owner contract marker must be the first non-empty content after one Markdown heading",
        });
      }
      const ref = `${path}#${anchor}`;
      if (seen.has(ref)) throw new TraceFormatError({ path, subject: "owner", message: `duplicate owner anchor ${ref}` });
      seen.add(ref);
      owners.push(parseOwner(ref, path, source));
    }
  }
  return sorted(owners, (owner) => owner.ref);
}

function testMetadata(path: string, source: string): { readonly owner: string; readonly regressions: readonly string[]; readonly issues: readonly string[] } | undefined {
  const values: Record<string, string[]> = { owner: [], regression: [], issue: [] };
  for (const line of source.split(/\r?\n/u)) {
    if (!/^\/\//u.test(line)) break;
    const match = /^\/\/\s+(owner|regression|issue):\s*(\S.*?)\s*$/u.exec(line);
    if (match === null) continue;
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) values[name]?.push(value);
  }
  const owners = values.owner ?? [];
  if (owners.length === 0) return undefined;
  if (owners.length !== 1 || !Schema.is(refSchema)(owners[0])) {
    throw new TraceFormatError({ path, subject: "owner", message: "must have exactly one canonical owner" });
  }
  const regressions = values.regression ?? [];
  const canonicalRegressions = regressions.filter((item) => /^memory\/[^\s]+\.md(?:#[^\s]+)?$/u.test(item));
  if (new Set(canonicalRegressions).size !== canonicalRegressions.length) {
    throw new TraceFormatError({ path, subject: "regression", message: "must be unique" });
  }
  return {
    owner: owners[0],
    regressions: sorted(canonicalRegressions, (item) => item),
    issues: sorted(values.issue ?? [], (item) => item),
  };
}

function metadata(value: unknown, path: string): { readonly repo: string; readonly lane: readonly string[]; readonly areas: readonly string[]; readonly executor: { readonly kind: string } } {
  const decoded = Schema.decodeUnknownEither(RepoMetadataSchema, { errors: "all" })(value);
  if (decoded._tag === "Left") {
    throw new TraceFormatError({
      path,
      subject: "repo metadata",
      message: ParseResult.TreeFormatter.formatErrorSync(decoded.left),
    });
  }
  const target = Schema.decodeUnknownEither(E2eTargetSchema, { errors: "all" })(decoded.right.targets.e2e);
  if (target._tag === "Left") {
    throw new TraceFormatError({
      path,
      subject: "repo metadata",
      message: ParseResult.TreeFormatter.formatErrorSync(target.left),
    });
  }
  const niceeval = Schema.decodeUnknownEither(NiceEvalMetadataSchema, { errors: "all" })(target.right.metadata.niceeval);
  if (niceeval._tag === "Left") {
    throw new TraceFormatError({
      path,
      subject: "repo metadata",
      message: ParseResult.TreeFormatter.formatErrorSync(niceeval.left),
    });
  }
  return {
    repo: decoded.right.name.replace(/^e2e-/u, ""),
    lane: sorted(niceeval.right.lanes, (item) => item),
    areas: sorted(niceeval.right.areas, (item) => item),
    executor: niceeval.right.executor,
  };
}

function validateReferenceTarget(
  sourcePath: string,
  subject: string,
  reference: string,
  documentIndex: ReadonlyMap<string, string>,
): string {
  const target = referenceParts(reference);
  const source = documentIndex.get(target.path);
  if (source === undefined) {
    throw new TraceFormatError({
      path: sourcePath,
      subject,
      message: `target file ${target.path} does not exist`,
    });
  }
  if (target.anchor !== undefined && (target.anchor.length === 0 || !hasHeading(source, target.anchor))) {
    throw new TraceFormatError({
      path: sourcePath,
      subject,
      message: `target anchor ${target.anchor || "<empty>"} does not exist`,
    });
  }
  return target.path;
}

function validateNodeRelations(
  snapshot: TraceSnapshot,
  documentIndex: ReadonlyMap<string, string>,
): void {
  const targetKinds: Readonly<Record<string, readonly DocsNodeKind[]>> = {
    buildsOn: ["feature", "roadmap"],
    supports: ["feature", "roadmap", "engineering"],
    selectedPlan: ["design-plan"],
    decides: ["feature", "roadmap", "engineering"],
    composes: ["use-case", "feature"],
  };
  const roadmapGraph = new Map<string, Set<string>>();
  for (const node of snapshot.nodes) {
    if (!validNodePlacement(node)) {
      throw new TraceFormatError({ path: node.path, subject: "placement", message: `${node.kind} is not valid at this path` });
    }
    if (node.kind === "design" && (node.relations.selectedPlan?.length ?? 0) !== 1) {
      throw new TraceFormatError({ path: node.path, subject: "selectedPlan", message: "strict Design must select exactly one direct Design Plan" });
    }
    if (node.kind === "use-case") {
      const composes = node.relations.composes ?? [];
      const crossFeature = node.path.startsWith("docs/feature/use-case/");
      if (crossFeature && composes.length === 0) {
        throw new TraceFormatError({ path: node.path, subject: "composes", message: "cross-Feature Use Case must compose at least one target" });
      }
      if (!crossFeature && composes.length > 0) {
        throw new TraceFormatError({ path: node.path, subject: "composes", message: "only a cross-Feature Use Case may own composes relations" });
      }
    }
    if (node.kind === "roadmap") roadmapGraph.set(node.path, new Set());
    for (const [relation, references] of Object.entries(node.relations)) {
      for (const reference of references) {
        const targetPath = referenceParts(reference).path;
        const permitted = targetKinds[relation] ?? [];
        const target = validateRepoRefTarget(
          snapshot,
          reference,
          permitted,
          documentIndex.get(targetPath),
        );
        if (Either.isLeft(target)) {
          throw new TraceFormatError({
            path: node.path,
            subject: relation,
            message: target.left.message,
          });
        }
        if (target.right.owner.path === node.path) {
          throw new TraceFormatError({ path: node.path, subject: relation, message: "must not be a self-reference" });
        }
        if (
          relation === "selectedPlan" &&
          posix.dirname(posix.dirname(target.right.path)) !== posix.dirname(node.path)
        ) {
          throw new TraceFormatError({
            path: node.path,
            subject: relation,
            message: "must target a directly contained Design Plan",
          });
        }
        if (relation === "composes") {
          if (target.right.kind === "feature" && referenceParts(reference).anchor === undefined) {
            throw new TraceFormatError({
              path: node.path,
              subject: relation,
              message: "Feature fallback must target an exact anchor",
            });
          }
          if (target.right.kind === "use-case" && (target.right.owner.relations.composes?.length ?? 0) > 0) {
            throw new TraceFormatError({ path: node.path, subject: relation, message: "must target a leaf Use Case" });
          }
        }
        if (node.kind === "roadmap" && relation === "buildsOn" && target.right.kind === "roadmap") {
          roadmapGraph.get(node.path)?.add(target.right.owner.path);
        }
      }
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (path: string): void => {
    if (active.has(path)) throw new TraceFormatError({ path, subject: "buildsOn", message: "Roadmap cycle" });
    if (visited.has(path)) return;
    active.add(path);
    for (const target of roadmapGraph.get(path) ?? []) visit(target);
    active.delete(path);
    visited.add(path);
  };
  for (const path of [...roadmapGraph.keys()].sort()) visit(path);
}

function featuresForContract(nodes: readonly TraceNode[], contractPath: string): readonly TraceNode[] {
  const useCase = nodes.find((node) => node.kind === "use-case" && node.path === contractPath);
  if (useCase !== undefined) {
    const composed = useCase.relations.composes ?? [];
    if (composed.length === 0) {
      const owner = featureForPath(nodes, contractPath);
      return owner === undefined ? [] : [owner];
    }
    return [
      ...new Map(
        composed
          .map((reference) => referenceParts(reference).path)
          .map((path) => featureForPath(nodes, path))
          .filter((node): node is TraceNode => node !== undefined)
          .map((node) => [node.path, node]),
      ).values(),
    ];
  }
  if (isInsideUseCaseBoundary(nodes, contractPath)) return [];
  const owner = featureForPath(nodes, contractPath);
  return owner === undefined ? [] : [owner];
}

function validateRegressions(
  tests: readonly TraceTest[],
  memory: readonly TraceMemory[],
  memorySources: ReadonlyMap<string, string>,
): void {
  const memoryByPath = new Map(memory.map((entry) => [entry.path, entry]));
  for (const test of tests) {
    for (const reference of test.regressions) {
      const targetPath = validateReferenceTarget(test.path, "regression", reference, memorySources);
      const target = memoryByPath.get(targetPath);
      if (target === undefined) {
        throw new TraceFormatError({
          path: test.path,
          subject: "regression",
          message: `target ${reference} is not a Memory document`,
        });
      }
      if (target.kind !== "legacy/unstructured" && target.kind !== "problem") {
        throw new TraceFormatError({
          path: test.path,
          subject: "regression",
          message: `structured target ${reference} must be a Problem Memory`,
        });
      }
    }
  }
}

function validateScopedRepoRef(
  sourcePath: string,
  subject: string,
  reference: string,
  snapshot: TraceSnapshot,
  documents: ReadonlyMap<string, string>,
  expectedKinds: readonly DocsNodeKind[],
): DocsNodeKind {
  const targetPath = referenceParts(reference).path;
  const validated = validateRepoRefTarget(snapshot, reference, expectedKinds, documents.get(targetPath));
  if (Either.isLeft(validated)) {
    throw new TraceFormatError({ path: sourcePath, subject, message: validated.left.message });
  }
  if (!validated.right.directNode && isInsideUseCaseBoundary(snapshot.nodes, targetPath)) {
    throw new TraceFormatError({
      path: sourcePath,
      subject,
      message: `supporting target ${reference} is inside a Use Case boundary; target the exact Use Case node`,
    });
  }
  return validated.right.kind;
}

function validateFeedbackRelations(
  feedback: readonly TraceFeedback[],
  snapshot: TraceSnapshot,
  documents: ReadonlyMap<string, string>,
  memory: readonly TraceMemory[],
): void {
  const memoryIds = new Set(memory.map((entry) => entry.id));
  for (const entry of feedback) {
    for (const target of entry.adoptions.current) {
      validateScopedRepoRef(
        entry.path,
        "adoption",
        target,
        snapshot,
        documents,
        ["roadmap", "feature", "use-case", "engineering"],
      );
    }
    for (const relation of entry.memoryRelations) {
      if (!memoryIds.has(relation.memory)) {
        throw new TraceFormatError({
          path: entry.path,
          subject: "memory relation",
          message: `Memory ${relation.memory} does not exist`,
        });
      }
    }
  }
}

function validateMemoryPromotions(
  memory: readonly TraceMemory[],
  snapshot: TraceSnapshot,
  documents: ReadonlyMap<string, string>,
): void {
  for (const entry of memory) {
    for (const promotion of entry.promotions) {
      for (const target of promotion.current) {
        validateScopedRepoRef(entry.path, "promotion", target, snapshot, documents, [promotion.kind]);
      }
    }
  }
}

function walk(directory: string): Effect.Effect<readonly string[], TraceIoError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(directory).pipe(
      Effect.mapError((cause) => new TraceIoError({
        operation: "scan",
        path: directory,
        message: message(cause),
      })),
    );
    const nested = yield* Effect.forEach(entries, (entry) => {
      if (entry.startsWith(".stage-")) return Effect.succeed([] as readonly string[]);
      const path = join(directory, entry);
      return fs.stat(path).pipe(
        Effect.mapError((cause) => new TraceIoError({ operation: "scan", path, message: message(cause) })),
        Effect.flatMap((status) => status.type === "Directory" ? walk(path) : Effect.succeed([path])),
      );
    });
    return nested.flat();
  });
}

function traceInputPaths(root: string, paths: readonly string[]): readonly string[] {
  return sorted(paths.filter((path) => {
    const file = slash(relative(root, path));
    if (/^docs\/.*\.md$/u.test(file)) return true;
    if (/^e2e\/.*\/(?:project\.json|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?)$/u.test(file)) return true;
    if (/^memory\/(?!INDEX\.md$).*\.md$/u.test(file)) return true;
    return /^feedback\/(?!\.)[^/]+\/README\.md$/u.test(file);
  }), (path) => slash(relative(root, path)));
}

function changedInputs(
  root: string,
  firstPaths: readonly string[],
  secondPaths: readonly string[],
  firstSources: ReadonlyMap<string, string>,
  secondSources: ReadonlyMap<string, string>,
): readonly string[] {
  const changed = new Set<string>();
  const firstRelative = new Set(firstPaths.map((path) => slash(relative(root, path))));
  const secondRelative = new Set(secondPaths.map((path) => slash(relative(root, path))));
  for (const path of firstRelative) if (!secondRelative.has(path)) changed.add(path);
  for (const path of secondRelative) if (!firstRelative.has(path)) changed.add(path);
  for (const path of firstPaths) {
    if (secondSources.get(path) !== firstSources.get(path)) changed.add(slash(relative(root, path)));
  }
  return [...changed].sort();
}

function compileTraceAtGeneration(
  root: string,
  generation: number,
  attempt: number,
): Effect.Effect<TraceSnapshot, TraceError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const scan = () => Effect.forEach(
      ["docs", "e2e", "feedback", "memory"],
      (directory) => walk(join(root, directory)),
    ).pipe(Effect.map((groups) => groups.flat()));
    const firstAll = yield* scan();
    const firstInputs = traceInputPaths(root, firstAll);
    const firstPairs = yield* Effect.forEach(firstInputs, (path) => fs.readFileString(path).pipe(
      Effect.map((source) => [path, source] as const),
      Effect.mapError((cause) => new TraceIoError({
        operation: "read",
        path: slash(relative(root, path)),
        message: message(cause),
      })),
    ));
    const secondAll = yield* scan();
    const secondInputs = traceInputPaths(root, secondAll);
    const secondPairs = yield* Effect.forEach(secondInputs, (path) => fs.readFileString(path).pipe(
      Effect.map((source) => [path, source] as const),
      Effect.mapError((cause) => new TraceIoError({
        operation: "read",
        path: slash(relative(root, path)),
        message: message(cause),
      })),
    ));
    const firstSources = new Map(firstPairs);
    const capturedSources = new Map(secondPairs);
    const changed = changedInputs(root, firstInputs, secondInputs, firstSources, capturedSources);
    if (changed.length > 0) {
      return yield* new TraceInputChanged({ path: root, attempts: attempt, changed });
    }
    const all = secondAll;
    const relativeFiles = new Set(all.map((path) => slash(relative(root, path))));
    const read = (path: string): Effect.Effect<string, TraceIoError> => {
      const source = capturedSources.get(path);
      return source === undefined
        ? Effect.fail(new TraceIoError({
            operation: "read",
            path: slash(relative(root, path)),
            message: "file was not part of the stable Trace input capture",
          }))
        : Effect.succeed(source);
    };

    const docFiles = all.filter((path) => path.startsWith(join(root, "docs")) && path.endsWith(".md"));
    const documentSources = yield* Effect.forEach(docFiles, (path) => read(path).pipe(
      Effect.map((source) => [slash(relative(root, path)), source] as const),
    ));
    const documentIndex = new Map(documentSources);
    const nodeValues = yield* Effect.forEach(
      documentSources,
      ([path, source]) => pure(path, "frontmatter", () => decodeNode(path, source)),
    );
    const nodes = sorted(
      nodeValues.filter((item): item is TraceNode => item !== undefined),
      (item) => item.path,
    );
    const pages = deriveFeaturePages(nodes, documentSources);
    const targetSnapshot: TraceSnapshot = {
      digest: "",
      generation,
      nodes,
      pages,
      owners: [],
      tests: [],
      feedback: [],
      memory: [],
    };
    yield* pure("docs", "relations", () => validateNodeRelations(targetSnapshot, documentIndex));

    const testFiles = all.filter((path) => path.startsWith(join(root, "e2e")) &&
      /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path));
    const candidateTests = yield* Effect.forEach(testFiles, (path) => read(path).pipe(
      Effect.map((source) => ({ path: slash(relative(root, path)), source })),
    ));
    const declaredOwners = yield* pure("docs", "owner", () => ownerContracts(documentSources));
    const declaredOwnerMap = new Map(declaredOwners.map((owner) => [owner.ref, owner]));
    for (const owner of declaredOwners) {
      const contractPath = yield* pure(owner.path, "contract", () => {
        const targetPath = referenceParts(owner.contract).path;
        const target = validateRepoRefTarget(
          targetSnapshot,
          owner.contract,
          ["feature", "use-case"],
          documentIndex.get(targetPath),
        );
        if (Either.isLeft(target)) {
          throw new TraceFormatError({ path: owner.path, subject: "contract", message: target.left.message });
        }
        return target.right.path;
      });
      if (featuresForContract(nodes, contractPath).length === 0) {
        return yield* Effect.fail(new TraceFormatError({
          path: owner.path,
          subject: "contract",
          message: `target ${owner.contract} is not a Feature contract or composed Use Case`,
        }));
      }
    }

    const metadataCache = new Map<string, ReturnType<typeof metadata>>();
    const usedOwnerRefs = new Set<string>();
    const tests: TraceTest[] = [];

    for (const candidate of candidateTests) {
      const header = yield* pure(
        candidate.path,
        "metadata",
        () => testMetadata(candidate.path, candidate.source),
      );
      if (header === undefined) {
        return yield* Effect.fail(new TraceFormatError({
          path: candidate.path,
          subject: "owner",
          message: "test/spec must start with exactly one owner",
        }));
      }

      const parsedOwner = declaredOwnerMap.get(header.owner);
      if (parsedOwner === undefined) {
        return yield* Effect.fail(new TraceFormatError({
          path: candidate.path,
          subject: "owner",
          message: `${header.owner} is not a declared owner contract anchor`,
        }));
      }
      if (usedOwnerRefs.has(header.owner)) {
        return yield* Effect.fail(new TraceFormatError({
          path: candidate.path,
          subject: "owner",
          message: `${header.owner} is referenced by more than one test`,
        }));
      }
      usedOwnerRefs.add(header.owner);

      let directory = posix.dirname(candidate.path);
      let found: string | undefined;
      while (directory === "e2e" || directory.startsWith("e2e/")) {
        if (relativeFiles.has(`${directory}/project.json`)) {
          found = directory;
          break;
        }
        directory = posix.dirname(directory);
      }
      if (found === undefined) {
        return yield* Effect.fail(new TraceFormatError({
          path: candidate.path,
          subject: "repo metadata",
          message: "no owning project.json",
        }));
      }
      let repo = metadataCache.get(found);
      if (repo === undefined) {
        const projectPath = `${found}/project.json`;
        const projectSource = yield* read(join(root, projectPath));
        repo = yield* pure(projectPath, "repo metadata", () => {
          const project: unknown = JSON.parse(projectSource);
          return metadata(project, projectPath);
        });
        metadataCache.set(found, repo);
      }
      tests.push({ path: candidate.path, owner: header.owner, regressions: header.regressions, issues: header.issues, ...repo });
    }
    const orphanOwner = declaredOwners.find((owner) => !usedOwnerRefs.has(owner.ref));
    if (orphanOwner !== undefined) {
      return yield* Effect.fail(new TraceFormatError({
        path: orphanOwner.path,
        subject: "owner",
        message: `${orphanOwner.ref} is not referenced by exactly one test/spec`,
      }));
    }

    const memoryIndex = join(root, "memory", "INDEX.md");
    const memoryFiles = all.filter((path) =>
      path.startsWith(join(root, "memory")) && path.endsWith(".md") && path !== memoryIndex
    );
    const memorySources = yield* Effect.forEach(memoryFiles, (path) => read(path).pipe(
      Effect.map((source) => [slash(relative(root, path)), source] as const),
    ));
    const memorySourceIndex = new Map(memorySources);
    const memory = yield* Effect.forEach(memorySources, ([relativePath, source]) => pure(
      relativePath,
      "memory",
      (): TraceMemory => {
        const decoded = decodeMemoryDocument(
          relativePath,
          relativePath.slice("memory/".length, -".md".length),
          source,
        );
        return "legacy" in decoded
          ? {
              path: relativePath,
              id: decoded.id,
              title: decoded.title,
              kind: "legacy/unstructured",
              promotions: [],
            }
          : {
              path: relativePath,
              id: decoded.metadata.id,
              title: decoded.metadata.title,
              kind: decoded.metadata.kind.type,
              state: decoded.metadata.kind.state,
              promotions: sorted(decoded.metadata.promotions.map((promotion) => ({
                kind: promotion.kind,
                current: sorted(promotion.current, (target) => target),
                history: sorted(promotion.history, (item) => `${item.target}\0${item.commit}`),
              })), (promotion) => promotion.kind),
              metadataDigest: digest({
                ...decoded.metadata,
                promotions: sorted(decoded.metadata.promotions.map((promotion) => ({
                  ...promotion,
                  current: sorted(promotion.current, (target) => target),
                  history: sorted(promotion.history, (item) => `${item.target}\0${item.commit}`),
                })), (promotion) => promotion.kind),
              }),
            };
      },
    ));
    yield* pure(
      "memory",
      "regression",
      () => validateRegressions(tests, memory, memorySourceIndex),
    );

    const feedbackFiles = all.filter((path) =>
      /^feedback\/(?!\.)[^/]+\/README\.md$/u.test(slash(relative(root, path)))
    );
    const feedback = yield* Effect.forEach(feedbackFiles, (path) => read(path).pipe(
      Effect.flatMap((source) => {
        const relativePath = slash(relative(root, path));
        return pure(relativePath, "feedback", (): TraceFeedback => {
          const { metadata } = decodeFeedbackDocument(relativePath, source);
          const current = sorted(metadata.adoptions.current, (target) => target);
          const history = sorted(metadata.adoptions.history, (item) => `${item.target}\0${item.commit}`);
          const memoryRelations = sorted(metadata.memoryRelations, (relation) => `${relation.kind}\0${relation.memory}`);
          return {
            path: relativePath,
            id: metadata.id,
            title: metadata.title,
            state: metadata.state,
            source: metadata.source,
            subject: metadata.subject,
            claim: metadata.claim,
            adoptions: { current, history },
            memoryRelations,
            metadataDigest: digest({
              ...metadata,
              adoptions: { current, history },
              memoryRelations,
            }),
          };
        });
      }),
    ));
    const raw = {
      generation,
      nodes,
      pages,
      owners: declaredOwners,
      tests: sorted(tests, (item) => item.path),
      feedback: sorted(feedback, (item) => item.path),
      memory: sorted(memory, (item) => item.path),
    };
    const snapshot: TraceSnapshot = { ...raw, digest: digest(raw) };
    yield* pure("memory", "promotion", () => validateMemoryPromotions(memory, snapshot, documentIndex));
    yield* pure(
      "feedback",
      "relations",
      () => validateFeedbackRelations(feedback, snapshot, documentIndex, memory),
    );
    return snapshot;
  });
}

const maximumStableReadAttempts = 3;

function readTraceConsistency<A>(
  root: string,
  read: Effect.Effect<A, TraceMutationError>,
): Effect.Effect<A, TraceIoError> {
  return read.pipe(Effect.mapError((cause) => new TraceIoError({
    operation: "read",
    path: cause.path ?? root,
    message: `${cause.phase}: ${cause.message}`,
  })));
}

function compileStableTrace(
  root: string,
  attempt: number,
): Effect.Effect<TraceSnapshot, TraceError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const before = yield* readTraceConsistency(root, readTraceGeneration(root));
    const compiled = yield* Effect.either(compileTraceAtGeneration(root, before, attempt));
    const after = yield* readTraceConsistency(root, readTraceGeneration(root));
    if (after !== before) {
      if (attempt < maximumStableReadAttempts) {
        yield* Effect.yieldNow();
        return yield* compileStableTrace(root, attempt + 1);
      }
      return yield* new TraceSnapshotChanged({
        path: root,
        before,
        after,
        attempts: attempt,
      });
    }
    if (Either.isLeft(compiled)) {
      if (compiled.left instanceof TraceInputChanged && attempt < maximumStableReadAttempts) {
        yield* Effect.yieldNow();
        return yield* compileStableTrace(root, attempt + 1);
      }
      return yield* compiled.left;
    }
    return compiled.right;
  });
}

export function compileTrace(root: string): Effect.Effect<TraceSnapshot, TraceError, FileSystem.FileSystem> {
  return withTraceReadLease(root, () => compileStableTrace(root, 1)).pipe(
    Effect.mapError((error) => {
      if (!(error instanceof TraceMutationError)) return error;
      if (error.phase === "lock" && error.message.includes("busy")) {
        return new TraceMutationActive({ path: error.path ?? root, attempts: 1 });
      }
      return new TraceIoError({ operation: "read", path: error.path ?? root, message: error.message });
    }),
  );
}

/** Internal entry for a caller already holding the repo-wide shared/exclusive Trace lease. */
export function compileTraceUnderLease(root: string): Effect.Effect<TraceSnapshot, TraceError, FileSystem.FileSystem> {
  return compileStableTrace(root, 1);
}
