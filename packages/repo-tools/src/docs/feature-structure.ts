import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import * as FileSystem from "effect/FileSystem";
import { Data, Effect } from "effect";

import { compileTraceUnderLease } from "./trace/compiler.js";
import { mutateTraceOwner, traceDigest, type TraceDirectoryManifestEntry, type TraceMutationPreparation } from "./trace/relation-mutation.js";

const PAGES = ["library", "cli", "architecture", "lifecycle", "use-case"] as const;
type FeaturePage = typeof PAGES[number];
const PAGE_FILES: Readonly<Record<FeaturePage, string>> = {
  library: "library.md", cli: "cli.md", architecture: "architecture.md", lifecycle: "lifecycle.md", "use-case": "use-case/README.md",
};
const TEMPLATE = "docs/_template/feature-design";
const managedStart = "<!-- niceeval.docs-index/v1:start -->";
const managedEnd = "<!-- niceeval.docs-index/v1:end -->";

export class FeatureStructureError extends Data.TaggedError("FeatureStructureError")<{
  readonly operation: "create" | "page-add" | "page-set";
  readonly path: string;
  readonly message: string;
}> {}

export interface FeatureStructureReceipt {
  readonly format: "niceeval.docs-feature/structure-v1";
  readonly operation: "feature-create" | "feature-page-add" | "feature-page-set";
  readonly dryRun: boolean;
  readonly feature: { readonly slug: string; readonly ref: string; readonly title: string };
  readonly page?: FeaturePage;
  readonly snapshotDigest: string;
  readonly generation: number;
  readonly nextGeneration: number;
  readonly preimageDigest: string | null;
  readonly plannedBytesDigest: string;
  readonly changedPaths: readonly string[];
}

const slash = (path: string) => path.split(sep).join("/");
const fail = (operation: FeatureStructureError["operation"], path: string, message: string) =>
  new FeatureStructureError({ operation, path, message });
function slug(value: string, operation: FeatureStructureError["operation"]): Effect.Effect<string, FeatureStructureError> {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
    ? Effect.succeed(value)
    : Effect.fail(fail(operation, value, "slug must contain lowercase letters, digits, and single hyphens"));
}
function page(value: string, operation: FeatureStructureError["operation"]): Effect.Effect<FeaturePage, FeatureStructureError> {
  return (PAGES as readonly string[]).includes(value)
    ? Effect.succeed(value as FeaturePage)
    : Effect.fail(fail(operation, value, `page must be one of ${PAGES.join(", ")}`));
}
function read(root: string, path: string, operation: FeatureStructureError["operation"]): Effect.Effect<string, FeatureStructureError> {
  return Effect.try({ try: () => readFileSync(resolve(root, path), "utf8"), catch: (cause) => fail(operation, path, cause instanceof Error ? cause.message : String(cause)) });
}
function template(root: string, path: string, operation: FeatureStructureError["operation"]): Effect.Effect<string, FeatureStructureError> {
  return read(root, `${TEMPLATE}/${path}`, operation);
}
function frontmatter(): string { return "---\nformat: niceeval.docs-node/v1\nkind: feature\nrelations: {}\n---\n\n"; }
function render(source: string, title: string, root = false): string {
  const body = source.replaceAll("<功能或候选名>", title).trimEnd();
  return root ? `${frontmatter()}${body}\n` : `${body}\n`;
}
function manifest(root: string, stage: string, operation: FeatureStructureError["operation"]): readonly TraceDirectoryManifestEntry[] {
  const base = resolve(root, stage);
  const entries: TraceDirectoryManifestEntry[] = [];
  const visit = (directory: string, item: string) => {
    if (item !== "") entries.push({ kind: "directory", path: item, mode: 0o755 });
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name); const relativePath = item === "" ? name : `${item}/${name}`;
      const status = lstatSync(absolute);
      if (status.isDirectory()) visit(absolute, relativePath);
      else if (status.isFile()) {
        const source = readFileSync(absolute);
        entries.push({ kind: "file", path: relativePath, mode: 0o644, byteLength: source.byteLength, digest: traceDigest(source) });
      } else throw new Error(`${relativePath}: stage may only contain regular files and directories`);
    }
  };
  try { visit(base, ""); return entries.filter((entry) => entry.path !== ""); }
  catch (cause) { throw fail(operation, stage, cause instanceof Error ? cause.message : String(cause)); }
}
function stage(root: string, files: readonly { readonly path: string; readonly bytes: string }[], operation: FeatureStructureError["operation"]): Effect.Effect<{ readonly stagePath: string; readonly targetPath: string }, FeatureStructureError> {
  return Effect.try({ try: () => {
    const token = randomUUID(); const stagePath = `docs/feature/.stage-${token}`; const absolute = resolve(root, stagePath);
    mkdirSync(absolute, { recursive: true, mode: 0o700 }); chmodSync(absolute, 0o700);
    for (const file of files) { const target = resolve(absolute, file.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, file.bytes, { mode: 0o644 }); }
    return { stagePath, targetPath: `docs/feature/${files[0]!.path.split("/")[0]!}` };
  }, catch: (cause) => fail(operation, "docs/feature", cause instanceof Error ? cause.message : String(cause)) });
}
function removeStage(root: string, stagePath: string): Effect.Effect<void, FeatureStructureError> {
  return Effect.try({ try: () => rmSync(resolve(root, stagePath), { recursive: true, force: true }), catch: (cause) => fail("create", stagePath, cause instanceof Error ? cause.message : String(cause)) });
}
function featureFromSnapshot(snapshot: { readonly nodes: readonly { readonly kind: string; readonly path: string; readonly title: string; readonly relations: Readonly<Record<string, readonly string[]>> }[] }, selector: string, operation: FeatureStructureError["operation"]) {
  const node = snapshot.nodes.find((candidate) => candidate.kind === "feature" && (candidate.path === selector || candidate.path === `docs/feature/${selector}/README.md`));
  return node === undefined ? Effect.fail(fail(operation, selector, "Feature must already exist; use an exact Feature slug or canonical README path")) : Effect.succeed(node);
}
function authorAndManaged(source: string, operation: FeatureStructureError["operation"], path: string): Effect.Effect<{ readonly prefix: string; readonly managed: string }, FeatureStructureError> {
  const start = source.indexOf(managedStart); const end = source.indexOf(managedEnd);
  if (start < 0 && end < 0) return Effect.succeed({ prefix: source, managed: "" });
  if (start < 0 || end < start || source.indexOf(managedStart, start + 1) >= 0 || source.indexOf(managedEnd, end + 1) >= 0) {
    return Effect.fail(fail(operation, path, "managed projection markers are malformed"));
  }
  return Effect.succeed({ prefix: source.slice(0, start), managed: source.slice(start) });
}

export function createFeatureAt(root: string, input: { readonly slug: string; readonly title: string; readonly pages: readonly string[]; readonly dryRun: boolean }): Effect.Effect<FeatureStructureReceipt, FeatureStructureError | import("./trace/errors.js").TraceError | import("./trace/relation-mutation.js").TraceCoordinationError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const value = yield* slug(input.slug, "create");
    if (input.title.trim().length === 0) return yield* fail("create", value, "title must not be empty");
    const selected = yield* Effect.all(input.pages.map((item) => page(item, "create")));
    if (new Set(selected).size !== selected.length) return yield* fail("create", value, "pages must be unique");
    const rootSource = yield* template(root, "README.md", "create");
    const optional = yield* Effect.all(selected.map((item) => template(root, PAGE_FILES[item], "create").pipe(
      Effect.map((source) => ({ path: PAGE_FILES[item], source, bytes: render(source, input.title) })),
    )));
    const files = [{ path: "README.md", bytes: render(rootSource, input.title, true) }, ...optional];
    const ownerPath = `docs/feature/${value}/README.md`;
    const execute = (publication?: { readonly stagePath: string; readonly targetPath: string }) => mutateTraceOwner({ root, operation: "feature-create", ownerPath, dryRun: input.dryRun,
      prepareUnderLease: Effect.gen(function*() {
        const snapshot = yield* compileTraceUnderLease(root);
        if (snapshot.nodes.some((node) => node.path === ownerPath)) return yield* fail("create", ownerPath, "Feature package already exists");
        return { generation: snapshot.generation, snapshotDigest: snapshot.digest, preimages: [
          { path: resolve(root, `${TEMPLATE}/README.md`), digest: traceDigest(rootSource) },
          ...selected.map((item, index) => ({ path: resolve(root, `${TEMPLATE}/${PAGE_FILES[item]}`), digest: traceDigest(optional[index]!.source) })),
        ] } satisfies TraceMutationPreparation;
      }),
      plan: ({ source }) => source === undefined ? Effect.succeed({ bytes: files[0]!.bytes, value: files, changes: { created: true as const } }) : Effect.fail(fail("create", ownerPath, "Feature README already exists")),
      ...(publication === undefined ? {} : { publication: { kind: "new-docs-directory" as const, stagePath: publication.stagePath, targetPath: publication.targetPath, expectedManifest: manifest(root, publication.stagePath, "create") } }),
    });
    const mutation = input.dryRun ? yield* execute() : yield* Effect.acquireUseRelease(stage(root, files.map((file) => ({ path: `${value}/${file.path}`, bytes: file.bytes })), "create"), (item) => execute(item), (item) => removeStage(root, item.stagePath));
    return { format: "niceeval.docs-feature/structure-v1", operation: "feature-create", dryRun: input.dryRun, feature: { slug: value, ref: ownerPath, title: input.title }, snapshotDigest: mutation.snapshotDigest, generation: mutation.generation, nextGeneration: mutation.nextGeneration, preimageDigest: mutation.preimageDigest, plannedBytesDigest: mutation.plannedBytesDigest, changedPaths: mutation.changed ? files.map((file) => `docs/feature/${value}/${file.path}`) : [] };
  });
}

export function addFeaturePageAt(root: string, input: { readonly feature: string; readonly page: string; readonly dryRun: boolean }): Effect.Effect<FeatureStructureReceipt, FeatureStructureError | import("./trace/errors.js").TraceError | import("./trace/relation-mutation.js").TraceCoordinationError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const requested = yield* page(input.page, "page-add"); const templateSource = yield* template(root, PAGE_FILES[requested], "page-add");
    let selected: { readonly path: string; readonly title: string } | undefined;
    const prepare = Effect.gen(function*() {
      const snapshot = yield* compileTraceUnderLease(root); const feature = yield* featureFromSnapshot(snapshot, input.feature, "page-add"); selected = feature;
      return { generation: snapshot.generation, snapshotDigest: snapshot.digest, preimages: [{ path: resolve(root, feature.path), digest: traceDigest(yield* read(root, feature.path, "page-add")) }] } satisfies TraceMutationPreparation;
    });
    const initial = yield* compileTraceUnderLease(root).pipe(Effect.flatMap((snapshot) => featureFromSnapshot(snapshot, input.feature, "page-add")));
    const ownerPath = `${dirname(initial.path)}/${PAGE_FILES[requested]}`;
    const mutation = yield* mutateTraceOwner({ root, operation: "feature-page-add", ownerPath, dryRun: input.dryRun, prepareUnderLease: prepare,
      plan: ({ source }) => source === undefined
        ? Effect.succeed({ bytes: render(templateSource, selected?.title ?? initial.title), value: undefined, changes: { added: requested } })
        : Effect.fail(fail("page-add", ownerPath, "page already exists")),
    });
    return { format: "niceeval.docs-feature/structure-v1", operation: "feature-page-add", dryRun: input.dryRun, feature: { slug: dirname(initial.path).split("/").at(-1)!, ref: initial.path, title: initial.title }, page: requested, snapshotDigest: mutation.snapshotDigest, generation: mutation.generation, nextGeneration: mutation.nextGeneration, preimageDigest: mutation.preimageDigest, plannedBytesDigest: mutation.plannedBytesDigest, changedPaths: mutation.changed ? [ownerPath] : [] };
  });
}

export function setFeaturePageAt(root: string, input: { readonly feature: string; readonly page: string; readonly body: string; readonly expectedPreimageDigest: string; readonly dryRun: boolean }): Effect.Effect<FeatureStructureReceipt, FeatureStructureError | import("./trace/errors.js").TraceError | import("./trace/relation-mutation.js").TraceCoordinationError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const requested = yield* page(input.page, "page-set");
    const initial = yield* compileTraceUnderLease(root).pipe(Effect.flatMap((snapshot) => featureFromSnapshot(snapshot, input.feature, "page-set")));
    const ownerPath = `${dirname(initial.path)}/${PAGE_FILES[requested]}`;
    const mutation = yield* mutateTraceOwner({ root, operation: "feature-page-set", ownerPath, dryRun: input.dryRun,
      prepareUnderLease: Effect.gen(function*() { const snapshot = yield* compileTraceUnderLease(root); const feature = yield* featureFromSnapshot(snapshot, input.feature, "page-set"); return { generation: snapshot.generation, snapshotDigest: snapshot.digest, preimages: [{ path: resolve(root, feature.path), digest: traceDigest(yield* read(root, feature.path, "page-set")) }] }; }),
      plan: ({ source }) => Effect.gen(function*() {
        if (source === undefined) return yield* fail("page-set", ownerPath, "page does not exist; add an allowed page first");
        if (traceDigest(source) !== input.expectedPreimageDigest) return yield* fail("page-set", ownerPath, "page preimage digest changed; read the page again before updating it");
        const regions = yield* authorAndManaged(source, "page-set", ownerPath);
        const frontmatterEnd = regions.prefix.startsWith("---\n") ? regions.prefix.indexOf("\n---\n") + "\n---\n".length : 0;
        const protectedPrefix = frontmatterEnd > 0 ? `${regions.prefix.slice(0, frontmatterEnd)}\n` : "";
        return { bytes: `${protectedPrefix}${input.body.trimEnd()}\n${regions.managed}`, value: undefined, changes: { updated: requested } };
      }),
    });
    return { format: "niceeval.docs-feature/structure-v1", operation: "feature-page-set", dryRun: input.dryRun, feature: { slug: dirname(initial.path).split("/").at(-1)!, ref: initial.path, title: initial.title }, page: requested, snapshotDigest: mutation.snapshotDigest, generation: mutation.generation, nextGeneration: mutation.nextGeneration, preimageDigest: mutation.preimageDigest, plannedBytesDigest: mutation.plannedBytesDigest, changedPaths: mutation.changed ? [ownerPath] : [] };
  });
}
