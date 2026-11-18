import { isBuiltin } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti, type Jiti } from "jiti";
import type { DiscoveredEval } from "../types.ts";
import { decodeJsonRecord } from "../shared/json-value.ts";
import {
  childNodes,
  isCodeSource,
  normalizeSource,
  normalizedIdentity,
  normalizedSourceParts,
  parseSource,
  sourceIdentity,
  sourcePosition,
  syntaxNode,
  walkSyntax,
  type SyntaxNode,
  type SourceComment,
  type SourceReplacement,
  SOURCE_PARSER_IDENTITY,
} from "./source-normalization.ts";
import { parseDeclaredId } from "./definition-id.ts";
import { managedInputNormalization, type ManagedInputFact } from "./managed-inputs.ts";

export interface ModuleEdge {
  readonly start: number;
  readonly end: number;
  readonly specifier: string;
  readonly kind: "import" | "export" | "import-call" | "require" | "module-require" | "import-equals";
  readonly timing: "static" | "runtime";
  readonly path: string | undefined;
  /** Physical identity for graph instance sharing; never serialized as a locator. */
  readonly externalPath?: string;
  readonly external?: { readonly entry: string; readonly content: string; readonly conditions: readonly string[] };
}
export interface UnresolvedModule {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
export interface ModuleFact {
  readonly path: string;
  readonly source: string;
  readonly normalized: string;
  readonly identity: string;
  readonly sourceType: string | undefined;
  readonly language?: string | undefined;
  readonly program?: SyntaxNode | undefined;
  readonly comments?: readonly SourceComment[];
  readonly locationObservations?: readonly SourceReplacement[];
  readonly managedInputs?: readonly ManagedInputFact[];
  readonly managedReplacements?: readonly SourceReplacement[];
  readonly edges: readonly ModuleEdge[];
  readonly unresolved: readonly UnresolvedModule[];
}
export interface EvalModuleProjection {
  readonly root: string;
  readonly entry?: string;
  readonly modules: readonly ModuleFact[];
  readonly unresolved: readonly UnresolvedModule[];
}
const projections = new WeakMap<DiscoveredEval, EvalModuleProjection>();
export function attachEvalModules(evalDef: DiscoveredEval, projection: EvalModuleProjection): DiscoveredEval {
  projections.set(evalDef, projection);
  return evalDef;
}
export const evalModules = (evalDef: DiscoveredEval): EvalModuleProjection | undefined => projections.get(evalDef);
export const dynamicModuleFacts = (evalDef: DiscoveredEval): readonly UnresolvedModule[] =>
  evalModules(evalDef)?.unresolved ?? [];
const idName = (node: unknown): string | undefined =>
  syntaxNode(node) && node.type === "Identifier" && typeof node.name === "string" ? node.name : undefined;
function literal(node: unknown): string | undefined {
  return syntaxNode(node) && node.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}
function bindingNames(node: unknown): string[] {
  if (!syntaxNode(node)) return [];
  if (node.type === "Identifier") return [String(node.name)];
  if (node.type === "AssignmentPattern") return bindingNames(node.left);
  if (node.type === "Property") return bindingNames(node.value);
  return childNodes(node).flatMap(bindingNames);
}
function declarations(scope: SyntaxNode): Set<string> {
  const names = new Set<string>();
  const scan = (node: SyntaxNode, root = false): void => {
    if (!root && /^(?:Function|Class)/u.test(node.type)) {
      if (node.type.endsWith("Declaration")) bindingNames(node.id).forEach((name) => names.add(name));
      return;
    }
    if (!root && (node.type === "BlockStatement" || node.type === "CatchClause")) return;
    if (node.type === "VariableDeclarator") bindingNames(node.id).forEach((name) => names.add(name));
    if (node.type === "ImportDeclaration")
      for (const spec of node.specifiers as SyntaxNode[]) bindingNames(spec.local).forEach((name) => names.add(name));
    if (node.type === "TSImportEqualsDeclaration") bindingNames(node.id).forEach((name) => names.add(name));
    for (const child of childNodes(node)) scan(child);
  };
  if (Array.isArray(scope.params)) scope.params.flatMap(bindingNames).forEach((name) => names.add(name));
  if (scope.type === "CatchClause") bindingNames(scope.param).forEach((name) => names.add(name));
  if (scope.type.endsWith("Expression")) bindingNames(scope.id).forEach((name) => names.add(name));
  scan(scope, true);
  // var is function-scoped even when declared inside a nested block.
  if (scope.type === "Program" || /Function/u.test(scope.type)) {
    const vars = (node: SyntaxNode): void => {
      if (node !== scope && /Function/u.test(node.type)) return;
      if (node.type === "VariableDeclaration" && node.kind === "var") {
        for (const declaration of node.declarations as SyntaxNode[])
          bindingNames(declaration.id).forEach((name) => names.add(name));
      }
      childNodes(node).forEach(vars);
    };
    vars(scope);
  }
  return names;
}
function moduleDependencies(
  file: string,
  source: string,
  program: SyntaxNode,
): { edges: ModuleEdge[]; unresolved: UnresolvedModule[]; locations: SourceReplacement[] } {
  const edges: ModuleEdge[] = [],
    unresolved: UnresolvedModule[] = [];
  const locations: SourceReplacement[] = [];
  const uncertain = (node: SyntaxNode): void => {
    unresolved.push({ file, ...sourcePosition(source, node.start) });
  };
  const edge = (node: SyntaxNode, specifier: unknown, kind: ModuleEdge["kind"], timing: ModuleEdge["timing"]): void => {
    const value = literal(specifier);
    if (value === undefined) uncertain(node);
    else
      edges.push({
        start: (specifier as SyntaxNode).start,
        end: (specifier as SyntaxNode).end,
        specifier: value,
        kind,
        timing,

        path: undefined,
      });
  };
  const visit = (node: SyntaxNode, parent: SyntaxNode | undefined, shadows: ReadonlySet<string>): void => {
    const isScope =
      node.type === "Program" ||
      node.type === "BlockStatement" ||
      node.type === "CatchClause" ||
      /Function/u.test(node.type) ||
      node.type === "ForStatement" ||
      node.type === "ForOfStatement" ||
      node.type === "ForInStatement";
    const local = isScope ? new Set([...shadows, ...declarations(node)]) : shadows;
    if (node.type === "MetaProperty" && idName(node.meta) === "import") {
      const key =
        parent?.type === "MemberExpression" && parent.object === node
          ? parent.computed === true
            ? literal(parent.property)
            : idName(parent.property)
          : undefined;
      const value =
        key === "url"
          ? pathToFileURL(file).href
          : key === "dirname"
            ? dirname(file)
            : key === "filename"
              ? file
              : undefined;
      if (value !== undefined && parent !== undefined) {
        locations.push({ start: parent.start, end: parent.end, value });
      } else uncertain(node);
    }
    if (
      node.type === "Identifier" &&
      (node.name === "__dirname" || node.name === "__filename") &&
      !local.has(node.name)
    ) {
      const property = parent?.type === "MemberExpression" && parent.property === node && parent.computed !== true;
      const key =
        parent?.type === "Property" && parent.key === node && parent.computed !== true && parent.shorthand !== true;
      if (!property && !key)
        locations.push({ start: node.start, end: node.end, value: node.name === "__dirname" ? dirname(file) : file });
    }
    if (
      node.type === "MemberExpression" &&
      idName(node.object) === "module" &&
      !local.has("module") &&
      (node.computed === true ? literal(node.property) : idName(node.property)) !== "require"
    )
      uncertain(node);
    if (node.type === "MemberExpression" && idName(node.object) === "require" && !local.has("require")) uncertain(node);
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      const kind = node.type === "ImportDeclaration" ? node.importKind : node.exportKind;
      const specs = Array.isArray(node.specifiers) ? node.specifiers.filter(syntaxNode) : [];
      if (specs.some((spec) => idName(spec.imported) === "createRequire")) uncertain(node);
      if (
        kind === "type" ||
        (specs.length > 0 && specs.every((spec) => spec.importKind === "type" || spec.exportKind === "type"))
      )
        return;
      if (node.source !== null && node.source !== undefined)
        edge(node, node.source, node.type === "ImportDeclaration" ? "import" : "export", "static");
      if (syntaxNode(node.declaration)) visit(node.declaration, node, local);
      return;
    }
    if (node.type === "TSImportEqualsDeclaration") {
      if (
        node.importKind !== "type" &&
        syntaxNode(node.moduleReference) &&
        node.moduleReference.type === "TSExternalModuleReference"
      )
        edge(node, node.moduleReference.expression, "import-equals", "runtime");
      return;
    }
    // Type-only trees do not execute dependency expressions. export = is executable.
    if (
      node.type.startsWith("TS") &&
      node.type !== "TSExportAssignment" &&
      ![
        "TSAsExpression",
        "TSSatisfiesExpression",
        "TSNonNullExpression",
        "TSInstantiationExpression",
        "TSEnumDeclaration",
        "TSEnumMember",
        "TSModuleDeclaration",
        "TSModuleBlock",
      ].includes(node.type)
    )
      return;
    if (node.type === "ImportExpression") edge(node, node.source, "import-call", "runtime");
    if (
      node.type === "MemberExpression" &&
      idName(node.object) === "module" &&
      !local.has("module") &&
      (idName(node.property) === "require" || literal(node.property) === "require") &&
      !(parent?.type === "CallExpression" && parent.callee === node)
    )
      uncertain(node);
    if (node.type === "CallExpression") {
      const callee = node.callee;
      const argument = Array.isArray(node.arguments) ? node.arguments[0] : undefined;
      if (idName(callee) === "eval" && !local.has("eval")) uncertain(node);
      if (idName(callee) === "require" && !local.has("require")) edge(node, argument, "require", "runtime");
      else if (
        syntaxNode(callee) &&
        callee.type === "MemberExpression" &&
        idName(callee.object) === "module" &&
        !local.has("module") &&
        (idName(callee.property) === "require" || literal(callee.property) === "require")
      )
        edge(node, argument, "module-require", "runtime");
      if (
        idName(callee) === "createRequire" ||
        (syntaxNode(callee) && callee.type === "MemberExpression" && idName(callee.property) === "createRequire")
      )
        uncertain(node);
    }
    if (node.type === "Identifier" && node.name === "createRequire") uncertain(node);
    if (node.type === "Identifier" && (node.name === "module" || node.name === "exports") && !local.has(node.name)) {
      const member = parent?.type === "MemberExpression" && parent.object === node;
      const property = parent?.type === "MemberExpression" && parent.property === node && parent.computed !== true;
      const key =
        parent?.type === "Property" && parent.key === node && parent.computed !== true && parent.shorthand !== true;
      if (!member && !property && !key) uncertain(node);
    }
    if (node.type === "Identifier" && node.name === "require" && !local.has("require")) {
      // Taking require as a value includes aliases, destructuring and createRequire-style indirection.
      const direct = parent?.type === "CallExpression" && parent.callee === node;
      const property = parent?.type === "MemberExpression" && parent.property === node && parent.computed === false;
      const key =
        parent?.type === "Property" && parent.key === node && parent.computed === false && parent.shorthand !== true;
      if (!direct && !property && !key) uncertain(node);
    }
    for (const child of childNodes(node)) visit(child, node, local);
  };
  visit(program, undefined, new Set());
  edges.sort((a, b) => a.start - b.start);
  return { edges, unresolved, locations };
}

type ExternalPackageContent = { readonly content: string; readonly complete: boolean; readonly locator: string };
function externalContent(
  entry: string,
  specifier: string,
  importer: string,
  packages: Map<string, ExternalPackageContent>,
): {
  entry: string;
  content: string;
  complete: boolean;
} {
  const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
  const incomplete = { entry: specifier, content: "unresolved", complete: false };
  if (specifier.startsWith("#") || specifier.startsWith(".") || isAbsolute(specifier)) return incomplete;
  let directory = dirname(importer),
    candidate: string;
  for (;;) {
    candidate = join(directory, "node_modules", packageName);
    if (existsSync(candidate)) break;
    const parent = dirname(directory);
    if (parent === directory) return incomplete;
    directory = parent;
  }
  const root = realpathSync(candidate);
  const inside = (path: string): boolean => {
    const child = relative(root, path);
    return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
  };
  if (!inside(entry)) return incomplete;
  const manifestPath = join(root, "package.json");
  if (!existsSync(manifestPath) || !inside(realpathSync(manifestPath))) return incomplete;
  const cached = packages.get(root);
  if (cached !== undefined)
    return {
      entry: `${cached.locator}/${relative(root, entry).split(sep).join("/")}`,
      content: cached.content,
      complete: cached.complete,
    };
  const manifest = decodeJsonRecord(readFileSync(manifestPath, "utf8"));
  const locator = `${typeof manifest.name === "string" ? manifest.name : "anonymous"}@${typeof manifest.version === "string" ? manifest.version : "unversioned"}`;
  const hash = createHash("sha256");
  const seen = new Set<string>();
  // Dependencies outside this package have not been captured by this bounded
  // installation snapshot. Keep their consumers ineligible until proven.
  let complete = ![manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies].some(
      (dependencies) =>
        dependencies !== null && typeof dependencies === "object" && Object.keys(dependencies).length > 0,
    ),
    files = 0,
    bytes = 0;
  const visit = (file: string): void => {
    if (++files > 4096) {
      complete = false;
      return;
    }
    const actual = realpathSync(file);
    const child = relative(root, actual);
    if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      complete = false;
      return;
    }
    const stat = statSync(actual);
    hash.update(JSON.stringify([relative(root, file), stat.isDirectory() ? "directory" : "file"]));
    if (stat.isDirectory()) {
      if (seen.has(actual)) return;
      seen.add(actual);
      for (const child of readdirSync(file).sort()) {
        if (child !== "node_modules" && child !== ".git") visit(join(file, child));
      }
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > 64 * 1024 * 1024) {
        complete = false;
        return;
      }
      hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"));
    } else complete = false;
  };
  try {
    visit(root);
  } catch {
    complete = false;
  }
  const content = hash.digest("hex");
  packages.set(root, { locator, content, complete });
  return { entry: `${locator}/${relative(root, entry).split(sep).join("/")}`, content, complete };
}

/** One generation owns the only parse / resolution facts; consumers receive frozen projections. */
export class ProjectModuleGraph {
  private readonly facts = new Map<string, ModuleFact>();
  private readonly externalFacts = new Map<string, { entry: string; content: string; complete: boolean }>();
  private readonly externalPackages = new Map<string, ExternalPackageContent>();
  readonly root: string;
  constructor(
    root: string,
    private readonly loader: Jiti = createJiti(import.meta.url, {
      interopDefault: false,
      moduleCache: true,
      tsconfigPaths: true,
    }),
  ) {
    this.root = realpathSync(root);
  }
  module(file: string, captured?: string): ModuleFact {
    const path = realpathSync(file);
    const existing = this.facts.get(path);
    if (existing !== undefined) return existing;
    const bytes = captured === undefined ? readFileSync(path) : Buffer.from(captured);
    const source = bytes.toString("utf8");
    const parsed = isCodeSource(path) ? parseSource(path, source) : undefined;
    const normalized = parsed === undefined ? source : normalizeSource(source, parsed.program, parsed.comments);
    const dependencies =
      parsed === undefined
        ? { edges: [], unresolved: [], locations: [] }
        : moduleDependencies(path, source, parsed.program);
    const managed =
      parsed === undefined
        ? { inputs: [], replacements: [], unresolved: [] }
        : managedInputNormalization(path, source, parsed.program, this.root);
    const resolver = createJiti(path, this.loader.options);
    const edges = dependencies.edges.map((edge) => {
      if (isBuiltin(edge.specifier) || edge.specifier === "niceeval" || edge.specifier.startsWith("niceeval/"))
        return edge;
      let url: string;
      const requireMode = edge.kind === "require" || edge.kind === "module-require" || edge.kind === "import-equals";
      try {
        url = requireMode
          ? pathToFileURL(resolver.resolve(edge.specifier, { paths: [dirname(path)] })).href
          : resolver.esmResolve(edge.specifier, pathToFileURL(path).href);
      } catch (cause) {
        if (edge.specifier.startsWith(".") || edge.specifier.startsWith("/") || edge.specifier.startsWith("#"))
          throw cause;
        dependencies.unresolved.push({ file: path, ...sourcePosition(source, edge.start) });
        return edge;
      }
      if (!url.startsWith("file:")) return edge;
      const target = realpathSync(fileURLToPath(url));
      const ownerRelative = relative(this.root, target);
      const insideOwner = ownerRelative !== ".." && !ownerRelative.startsWith(`..${sep}`) && !isAbsolute(ownerRelative);
      if (!insideOwner && (edge.specifier.startsWith(".") || isAbsolute(edge.specifier))) {
        throw new Error(
          `SourceModuleBoundaryError: ${path}: ${edge.specifier} resolves outside owner ${this.root}: ${target}`,
        );
      }
      const local = insideOwner && !target.includes(`${sep}node_modules${sep}`);
      if (local) return { ...edge, path: target };
      let external = this.externalFacts.get(target);
      if (external === undefined) {
        external = externalContent(target, edge.specifier, path, this.externalPackages);
        this.externalFacts.set(target, external);
      }
      if (!external.complete) dependencies.unresolved.push({ file: path, ...sourcePosition(source, edge.start) });
      return {
        ...edge,
        externalPath: target,
        external: {
          entry: external.entry,
          content: external.content,
          conditions: requireMode ? ["node", "require", "import"] : ["node", "import", "require"],
        },
      };
    });
    const fact: ModuleFact = {
      path,
      source,
      normalized,
      identity: parsed === undefined ? sourceIdentity(path, bytes) : normalizedIdentity(normalized),
      sourceType: parsed?.mode,
      language: parsed?.language,
      program: parsed?.program,
      comments: parsed?.comments ?? [],
      locationObservations: dependencies.locations,
      managedInputs: managed.inputs,
      managedReplacements: managed.replacements,
      edges,
      unresolved: [...dependencies.unresolved, ...managed.unresolved],
    };
    this.facts.set(path, fact);
    return fact;
  }
  capture(
    entry: string,
    options: { readonly stopPaths: ReadonlySet<string> | undefined; readonly source: string | undefined } = {
      stopPaths: undefined,
      source: undefined,
    },
  ): EvalModuleProjection {
    const modules: ModuleFact[] = [],
      seen = new Set<string>();
    const visit = (path: string, first = false): void => {
      if (!first && options.stopPaths?.has(path)) return;
      const fact = this.module(path, first ? options.source : undefined);
      if (seen.has(fact.path)) return;
      seen.add(fact.path);
      modules.push(fact);
      fact.edges.forEach((edge) => {
        if (edge.path !== undefined) visit(edge.path);
      });
    };
    visit(entry, true);
    return {
      root: this.root,
      entry: modules[0]!.path,
      modules,
      unresolved: modules
        .flatMap((fact) => fact.unresolved)
        .map((fact) => ({ ...fact, file: relative(this.root, fact.file) })),
    };
  }
}

export interface RootedModuleIdentityOptions {
  readonly role: string;
  readonly normalize?: (content: string, fact: ModuleFact) => string;
  readonly replacements?: (fact: ModuleFact) => readonly SourceReplacement[];
  readonly terminals?: ReadonlyMap<string, string>;
}

/** Number real modules by first encounter; typed replacements cannot collide with author strings. */
// @concord-code
// @concord-implements docs/feature/experiments/architecture/source-identity.md
// @concord-implements docs/feature/experiments/use-case/move-files.md
export function rootedModuleIdentity(projection: EvalModuleProjection, options: RootedModuleIdentityOptions): string {
  const byPath = new Map(projection.modules.map((fact) => [fact.path, fact]));
  const indices = new Map<string, number>();
  const nodes: unknown[] = [];
  const entryPath = projection.entry ?? projection.modules[0]?.path;
  if (entryPath === undefined) throw new Error("A source identity requires a root module.");
  const visit = (path: string): number => {
    const existing = indices.get(path);
    if (existing !== undefined) return existing;
    const fact = byPath.get(path);
    if (fact === undefined) throw new Error(`Missing frozen source module: ${path}`);
    const index = indices.size;
    indices.set(path, index);
    nodes.push(undefined);
    const replacements = [...(fact.managedReplacements ?? []), ...(options.replacements?.(fact) ?? [])];
    const edgeInputs = fact.edges.map((edge) => {
      const terminal = edge.path === undefined ? undefined : options.terminals?.get(edge.path);
      if (terminal !== undefined) {
        replacements.push({ start: edge.start, end: edge.end, value: { terminal } });
        return { kind: edge.kind, timing: edge.timing, terminal };
      }
      if (edge.path !== undefined && byPath.has(edge.path)) {
        const target = visit(edge.path);
        replacements.push({ start: edge.start, end: edge.end, value: { module: target } });
        return { kind: edge.kind, timing: edge.timing, target };
      }
      if (edge.external !== undefined && edge.externalPath !== undefined) {
        let target = indices.get(edge.externalPath);
        if (target === undefined) {
          target = indices.size;
          indices.set(edge.externalPath, target);
          nodes.push({ external: edge.external });
        }
        return { kind: edge.kind, timing: edge.timing, specifier: edge.specifier, target };
      }
      return { kind: edge.kind, timing: edge.timing, specifier: edge.specifier, external: edge.external ?? null };
    });
    const omitted: { start: number; end: number }[] = [];
    if (
      path === entryPath &&
      (options.role === "eval" || options.role === "experiment") &&
      fact.program !== undefined
    ) {
      const declared = parseDeclaredId(fact.program);
      if (declared !== undefined) {
        let observed = projection.modules.some((module) => module.edges.some((edge) => edge.path === path));
        const observeId = (node: SyntaxNode, parent?: SyntaxNode): void => {
          if (node.start >= declared.start && node.end <= declared.end) return;
          if (node.type === "Identifier" && node.name === "id") {
            const property =
              parent?.type === "MemberExpression" && parent.property === node && parent.computed !== true;
            const key =
              parent?.key === node &&
              parent.computed !== true &&
              parent.shorthand !== true &&
              ["Property", "MethodDefinition", "PropertyDefinition", "AccessorProperty"].includes(parent.type);
            const imported = parent?.type === "ImportSpecifier" && parent.imported === node && parent.local !== node;
            if (!property && !key && !imported) observed = true;
          }
          for (const child of childNodes(node)) observeId(child, node);
        };
        observeId(fact.program);
        if (!observed) omitted.push(declared);
      }
    }
    const covered = (location: SourceReplacement): boolean =>
      replacements.some((replacement) => replacement.start <= location.start && replacement.end >= location.end);
    const locations = (fact.locationObservations ?? []).filter((location) => !covered(location));
    const content =
      fact.program === undefined
        ? { bytes: fact.identity }
        : normalizedSourceParts(fact.source, fact.program, fact.comments ?? [], replacements, omitted).map((part) =>
            typeof part === "string" ? (options.normalize?.(part, fact) ?? part) : part,
          );
    nodes[index] = {
      language: fact.language ?? null,
      mode: fact.sourceType ?? null,
      content,
      edges: edgeInputs,
      locations: locations.map((location) => location.value),
      managed: (fact.managedInputs ?? []).map((input) => ({ kind: input.kind, identity: input.identity })),
    };
    return index;
  };
  const entry = visit(entryPath);
  return normalizedIdentity(JSON.stringify({ parser: SOURCE_PARSER_IDENTITY, role: options.role, entry, nodes }));
}
/** Inspect transformed imports with the same parser, without a second regex scanner. */
export function transformedImportSpecifiers(file: string, source: string): ReadonlySet<string> {
  const specs = new Set<string>();
  walkSyntax(parseSource(file, `async function __jitiModule(){\n${source}\n}`, true).program, (node) => {
    if (node.type === "CallExpression" && idName(node.callee) === "jitiImport" && Array.isArray(node.arguments)) {
      const spec = literal(node.arguments[0]);
      if (spec !== undefined) specs.add(spec);
    }
  });
  return specs;
}

export type ModuleReuseEligibility =
  | { readonly kind: "eligible" }
  | { readonly kind: "dynamic-module-unresolved"; readonly facts: readonly UnresolvedModule[] };

export function moduleReuseEligibility(
  evalDef: DiscoveredEval,
  experimentFacts: readonly UnresolvedModule[] = [],
): ModuleReuseEligibility {
  const facts = [...dynamicModuleFacts(evalDef), ...experimentFacts];
  return facts.length === 0
    ? {
        kind: "eligible",
      }
    : {
        kind: "dynamic-module-unresolved",
        facts: facts.slice(0, 20).map((fact) => ({ ...fact, file: fact.file.slice(0, 1024) })),
      };
}
