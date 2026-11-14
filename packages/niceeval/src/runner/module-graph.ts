import { isBuiltin } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti, type Jiti } from "jiti";
import type { DiscoveredEval } from "../types.ts";
import {
  childNodes,
  isCodeSource,
  normalizeSource,
  normalizedIdentity,
  parseSource,
  sourceIdentity,
  sourcePosition,
  syntaxNode,
  walkSyntax,
  type SyntaxNode,
} from "./source-normalization.ts";

export interface ModuleEdge {
  readonly specifier: string;
  readonly kind: "import" | "export" | "import-call" | "require" | "module-require" | "import-equals";
  readonly timing: "static" | "runtime";
  readonly path?: string;
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
  readonly sourceType?: string;
  readonly edges: readonly ModuleEdge[];
  readonly unresolved: readonly UnresolvedModule[];
}
export interface EvalModuleProjection {
  readonly root: string;
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
): { edges: ModuleEdge[]; unresolved: UnresolvedModule[] } {
  const edges: ModuleEdge[] = [],
    unresolved: UnresolvedModule[] = [];
  const uncertain = (node: SyntaxNode): void => {
    unresolved.push(Object.freeze({ file, ...sourcePosition(source, node.start) }));
  };
  const edge = (node: SyntaxNode, specifier: unknown, kind: ModuleEdge["kind"], timing: ModuleEdge["timing"]): void => {
    const value = literal(specifier);
    if (value === undefined) uncertain(node);
    else edges.push({ specifier: value, kind, timing });
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
  return { edges, unresolved };
}

/** One generation owns the only parse / resolution facts; consumers receive frozen projections. */
export class ProjectModuleGraph {
  private readonly facts = new Map<string, ModuleFact>();
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
    const path = captured === undefined ? realpathSync(file) : resolve(file);
    const existing = this.facts.get(path);
    if (existing !== undefined) return existing;
    const bytes = captured === undefined ? readFileSync(path) : Buffer.from(captured);
    const source = bytes.toString("utf8");
    const parsed = isCodeSource(path) ? parseSource(path, source) : undefined;
    const normalized = parsed === undefined ? source : normalizeSource(source, parsed.program, parsed.comments);
    const dependencies =
      parsed === undefined ? { edges: [], unresolved: [] } : moduleDependencies(path, source, parsed.program);
    const resolver = createJiti(path, this.loader.options);
    const edges = dependencies.edges.map((edge) => {
      if (isBuiltin(edge.specifier)) return Object.freeze(edge);
      let url: string;
      try {
        url = resolver.esmResolve(edge.specifier, pathToFileURL(path).href);
      } catch (cause) {
        if (edge.specifier.startsWith(".") || edge.specifier.startsWith("/") || edge.specifier.startsWith("#"))
          throw cause;
        return Object.freeze(edge);
      }
      if (!url.startsWith("file:")) return Object.freeze(edge);
      const target = realpathSync(fileURLToPath(url));
      const ownerRelative = relative(this.root, target);
      const insideOwner = ownerRelative !== ".." && !ownerRelative.startsWith(`..${sep}`) && !isAbsolute(ownerRelative);
      if (!insideOwner && (edge.specifier.startsWith(".") || isAbsolute(edge.specifier))) {
        throw new Error(
          `SourceModuleBoundaryError: ${path}: ${edge.specifier} resolves outside owner ${this.root}: ${target}`,
        );
      }
      const local = insideOwner && !target.includes(`${sep}node_modules${sep}`);
      return Object.freeze({ ...edge, ...(local ? { path: target } : {}) });
    });
    const fact: ModuleFact = Object.freeze({
      path,
      source,
      normalized,
      identity: parsed === undefined ? sourceIdentity(path, bytes) : normalizedIdentity(normalized),
      ...(parsed === undefined ? {} : { sourceType: String(parsed.program.sourceType) }),
      edges: Object.freeze(edges),
      unresolved: Object.freeze(dependencies.unresolved),
    });
    this.facts.set(path, fact);
    return fact;
  }
  capture(
    entry: string,
    options: { readonly stopPaths?: ReadonlySet<string>; readonly source?: string } = {},
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
    modules.sort((a, b) => a.path.localeCompare(b.path));
    return Object.freeze({
      root: this.root,
      modules: Object.freeze(modules),
      unresolved: Object.freeze(
        modules
          .flatMap((fact) => fact.unresolved)
          .map((fact) => Object.freeze({ ...fact, file: relative(this.root, fact.file) })),
      ),
    });
  }
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

export function moduleReuseEligibility(evalDef: DiscoveredEval): {
  readonly reuseEligibility?: "dynamic-module-unresolved";
  readonly reuseEligibilityFacts?: readonly UnresolvedModule[];
} {
  const facts = dynamicModuleFacts(evalDef);
  return facts.length === 0
    ? {}
    : Object.freeze({
        reuseEligibility: "dynamic-module-unresolved",
        reuseEligibilityFacts: Object.freeze(
          facts.slice(0, 20).map((fact) => Object.freeze({ ...fact, file: fact.file.slice(0, 1024) })),
        ),
      });
}
