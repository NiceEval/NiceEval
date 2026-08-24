import { FileSystem } from "@effect/platform";
import { createHash } from "node:crypto";
import { join, posix, relative, sep } from "node:path";
import { Effect, ParseResult, Schema } from "effect";
import { parse } from "yaml";

import { decodeMemoryDocument } from "../../memory/codec.js";
import { TraceFormatError, TraceIoError, type TraceError } from "./errors.js";
import type { DocsNodeKind, TraceMemory, TraceNode, TraceOwner, TraceSnapshot, TraceTest } from "./model.js";

const kinds = Schema.Literal("feature", "roadmap", "engineering", "design", "design-plan", "use-case");
const refSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(
    (value) => !value.includes("\\") &&
      !value.startsWith("/") &&
      !value.split("/").some((part) => part === "." || part === ".."),
    { message: () => "must be a canonical repo-relative reference" },
  ),
);
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
  const hash = reference.lastIndexOf("#");
  return hash < 0
    ? { path: reference }
    : { path: reference.slice(0, hash), anchor: reference.slice(hash + 1) };
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
  for (const [name, value] of Object.entries(decoded.right.relations)) {
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

function heading(line: string): string | undefined {
  const value = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1];
  return value
    ?.toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s/gu, "-");
}

function hasHeading(source: string, anchor: string): boolean {
  return source.split(/\r?\n/u).some((line) => heading(line) === anchor);
}
function parseOwner(ownerRef: string, ownerPath: string, text: string): TraceOwner {
  const hash = ownerRef.lastIndexOf("#");
  if (hash <= 0 || hash === ownerRef.length - 1) {
    throw new TraceFormatError({ path: ownerPath, subject: "owner", message: "must name an anchor" });
  }
  const anchor = ownerRef.slice(hash + 1);
  const lines = text.split(/\r?\n/u);
  const line = lines.findIndex((item) => heading(item) === anchor);
  if (line < 0) {
    throw new TraceFormatError({ path: ownerPath, subject: "owner", message: `anchor ${anchor} is missing` });
  }
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

function testMetadata(path: string, source: string): { readonly owner: string; readonly regressions: readonly string[]; readonly issues: readonly string[] } | undefined {
  const values: Record<string, string[]> = { owner: [], regression: [], issue: [] };
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\/\/\s+(owner|regression|issue):\s*(\S.*?)\s*$/u.exec(line);
    if (match === null) break;
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
  nodes: readonly TraceNode[],
  documentIndex: ReadonlyMap<string, string>,
): void {
  const nodesByPath = new Map(nodes.map((node) => [node.path, node]));
  const targetKinds: Readonly<Record<string, readonly DocsNodeKind[]>> = {
    buildsOn: ["feature", "roadmap"],
    supports: ["feature", "roadmap", "engineering"],
    selectedPlan: ["design-plan"],
    decides: ["feature", "roadmap", "engineering"],
    composes: ["use-case", "feature"],
  };
  for (const node of nodes) {
    for (const [relation, references] of Object.entries(node.relations)) {
      for (const reference of references) {
        const targetPath = validateReferenceTarget(node.path, relation, reference, documentIndex);
        const target = nodesByPath.get(targetPath);
        const permitted = targetKinds[relation] ?? [];
        if (target === undefined || !permitted.includes(target.kind)) {
          throw new TraceFormatError({
            path: node.path,
            subject: relation,
            message: `target ${reference} must be a ${permitted.join(" or ")} node`,
          });
        }
        if (target.path === node.path) {
          throw new TraceFormatError({ path: node.path, subject: relation, message: "must not be a self-reference" });
        }
        if (
          relation === "selectedPlan" &&
          posix.dirname(posix.dirname(target.path)) !== posix.dirname(node.path)
        ) {
          throw new TraceFormatError({
            path: node.path,
            subject: relation,
            message: "must target a directly contained Design Plan",
          });
        }
      }
    }
  }
}

function featuresForContract(nodes: readonly TraceNode[], contractPath: string): readonly TraceNode[] {
  const nearest = nodes
    .filter((node) =>
      node.kind === "feature" && contractPath.startsWith(node.path.slice(0, -"README.md".length))
    )
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (nearest !== undefined) return [nearest];
  const useCase = nodes.find((node) => node.kind === "use-case" && node.path === contractPath);
  if (useCase === undefined) return [];
  return [
    ...new Map(
      (useCase.relations.composes ?? [])
        .map((reference) => referenceParts(reference).path)
        .map((path) => nodes
          .filter((node) =>
            node.kind === "feature" && path.startsWith(node.path.slice(0, -"README.md".length))
          )
          .sort((left, right) => right.path.length - left.path.length)[0])
        .filter((node): node is TraceNode => node !== undefined)
        .map((node) => [node.path, node]),
    ).values(),
  ];
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
      const path = join(directory, entry);
      return fs.stat(path).pipe(
        Effect.mapError((cause) => new TraceIoError({ operation: "scan", path, message: message(cause) })),
        Effect.flatMap((status) => status.type === "Directory" ? walk(path) : Effect.succeed([path])),
      );
    });
    return nested.flat();
  });
}

export function compileTrace(root: string, generation = 0): Effect.Effect<TraceSnapshot, TraceError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const all = yield* Effect.forEach(
      ["docs", "e2e", "memory"],
      (directory) => walk(join(root, directory)),
    ).pipe(Effect.map((groups) => groups.flat()));
    const relativeFiles = new Set(all.map((path) => slash(relative(root, path))));
    const read = (path: string) => fs.readFileString(path).pipe(
      Effect.mapError((cause) => new TraceIoError({
        operation: "read",
        path: slash(relative(root, path)),
        message: message(cause),
      })),
    );

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
    yield* pure("docs", "relations", () => validateNodeRelations(nodes, documentIndex));

    const testFiles = all.filter((path) => /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path));
    const candidateTests = yield* Effect.forEach(testFiles, (path) => read(path).pipe(
      Effect.map((source) => ({ path: slash(relative(root, path)), source })),
    ));
    const metadataCache = new Map<string, ReturnType<typeof metadata>>();
    const ownerMap = new Map<string, TraceOwner>();
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

      const ownerPath = referenceParts(header.owner).path;
      const ownerSource = documentIndex.get(ownerPath);
      if (ownerSource === undefined) {
        return yield* Effect.fail(new TraceFormatError({
          path: candidate.path,
          subject: "owner",
          message: `target file ${ownerPath} does not exist`,
        }));
      }
      const parsedOwner = yield* pure(
        ownerPath,
        "owner",
        () => parseOwner(header.owner, ownerPath, ownerSource),
      );
      const contractPath = yield* pure(ownerPath, "contract", () =>
        validateReferenceTarget(ownerPath, "contract", parsedOwner.contract, documentIndex)
      );
      if (featuresForContract(nodes, contractPath).length === 0) {
        return yield* Effect.fail(new TraceFormatError({
          path: ownerPath,
          subject: "contract",
          message: `target ${parsedOwner.contract} is not a Feature contract or composed Use Case`,
        }));
      }
      if (ownerMap.has(header.owner)) {
        return yield* Effect.fail(new TraceFormatError({
          path: candidate.path,
          subject: "owner",
          message: `${header.owner} is referenced by more than one test`,
        }));
      }
      ownerMap.set(header.owner, parsedOwner);

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
          ? { path: relativePath, kind: "legacy/unstructured", currentPromotions: [] }
          : {
              path: relativePath,
              kind: decoded.metadata.kind.type,
              currentPromotions: sorted(
                decoded.metadata.promotions.flatMap((promotion) => promotion.current === undefined
                  ? []
                  : [`${promotion.current.path}#${promotion.current.anchor}`]),
                (item) => item,
              ),
            };
      },
    ));
    yield* pure(
      "memory",
      "regression",
      () => validateRegressions(tests, memory, memorySourceIndex),
    );

    const raw = {
      generation,
      nodes,
      owners: sorted([...ownerMap.values()], (item) => item.ref),
      tests: sorted(tests, (item) => item.path),
      memory: sorted(memory, (item) => item.path),
    };
    return { ...raw, digest: digest(raw) };
  });
}
