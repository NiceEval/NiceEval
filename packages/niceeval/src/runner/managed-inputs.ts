import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compilePatterns, enumerationBases, expandLoaderPatterns, unmatchedIncludes } from "../loaders/glob.ts";
import { registerSandboxContent } from "../sandbox/content.ts";
import { transferContentIdentity, type StaticTransferPlan } from "./transfer-inputs.ts";
import {
  childNodes,
  sourcePosition,
  syntaxNode,
  walkSyntax,
  type SourceReplacement,
  type SyntaxNode,
} from "./source-normalization.ts";

export interface ManagedInputFact {
  readonly kind: "data" | "criteria" | "private" | "content" | "transfer";
  /** Actual locators are for audit and registration matching, never execution identity. */
  readonly paths: readonly string[];
  readonly contentDigests: readonly (readonly [string, string])[];
  readonly identity: unknown;
  readonly transfer?: StaticTransferPlan;
}

const loaders = new Set(["loadText", "loadJson", "loadYaml", "loadCriteria", "loadPrivate"]);
const name = (node: unknown): string | undefined =>
  syntaxNode(node) && node.type === "Identifier" && typeof node.name === "string" ? node.name : undefined;
const literal = (node: unknown): string | undefined =>
  syntaxNode(node) && node.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
const property = (node: SyntaxNode): string | undefined =>
  node.computed === true ? literal(node.property) : name(node.property);
const nodes = (value: unknown): SyntaxNode[] => (Array.isArray(value) ? value.filter(syntaxNode) : []);

function boundNames(node: unknown): string[] {
  if (!syntaxNode(node)) return [];
  const id = name(node);
  if (id !== undefined) return [id];
  if (node.type === "Property") return boundNames(node.value);
  if (node.type === "AssignmentPattern") return boundNames(node.left);
  return childNodes(node).flatMap(boundNames);
}

function importMetaUrl(node: unknown): boolean {
  return (
    syntaxNode(node) &&
    node.type === "MemberExpression" &&
    property(node) === "url" &&
    syntaxNode(node.object) &&
    node.object.type === "MetaProperty" &&
    name(node.object.meta) === "import" &&
    name(node.object.property) === "meta"
  );
}

function inside(ownerRoot: string, path: string): string {
  const physical = realpathSync(path);
  const child = relative(realpathSync(ownerRoot), physical);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`Managed input ${path} resolves outside owner ${ownerRoot}`);
  }
  return physical;
}

function digest(path: string): string {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes === 0) return hash.digest("hex");
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Only directly bound first-party operations own locator substitutions. Values
 * with other readers, shadowed APIs, and dynamic expressions stay conservative.
 * Replacements retain call order and multiplicity in the source identity.
 */
export function managedInputNormalization(
  file: string,
  source: string,
  program: SyntaxNode,
  ownerRoot: string,
): {
  readonly replacements: readonly SourceReplacement[];
  readonly inputs: readonly ManagedInputFact[];
  readonly unresolved: readonly { readonly file: string; readonly line: number; readonly column: number }[];
} {
  const bindings = new Map<string, { readonly api: string; readonly namespace: boolean; readonly module: string }>();
  const declarations = new Map<string, number>();
  const constants = new Map<string, SyntaxNode>();
  const references = new Map<string, SyntaxNode[]>();
  const declare = (ids: string[]): void => ids.forEach((id) => declarations.set(id, (declarations.get(id) ?? 0) + 1));
  walkSyntax(program, (node) => {
    if (node.type === "ImportDeclaration") {
      const module = literal(node.source);
      for (const spec of nodes(node.specifiers)) {
        declare(boundNames(spec.local));
        const local = name(spec.local);
        if (node.importKind === "type" || spec.importKind === "type" || local === undefined) continue;
        if (module !== "niceeval" && module !== "niceeval/sandbox") continue;
        const api = name(spec.imported) ?? literal(spec.imported);
        if (spec.type === "ImportNamespaceSpecifier") bindings.set(local, { api: "", namespace: true, module });
        else if (api !== undefined) bindings.set(local, { api, namespace: false, module });
      }
    }
    if (node.type === "VariableDeclarator") declare(boundNames(node.id));
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ClassDeclaration" ||
      node.type === "ClassExpression"
    )
      declare(boundNames(node.id));
    if (Array.isArray(node.params)) node.params.forEach((param) => declare(boundNames(param)));
    if (node.type === "CatchClause") declare(boundNames(node.param));
  });
  const inspectBindings = (node: SyntaxNode, parent?: SyntaxNode, exported = false): void => {
    const isExported = exported || node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration";
    if (node.type === "VariableDeclaration" && node.kind === "const" && !isExported) {
      for (const declaration of nodes(node.declarations)) {
        const id = name(declaration.id);
        if (id !== undefined && declarations.get(id) === 1 && syntaxNode(declaration.init))
          constants.set(id, declaration.init);
      }
    }
    const id = name(node);
    if (id !== undefined) {
      const declaration = parent?.type === "VariableDeclarator" && parent.id === node;
      const member = parent?.type === "MemberExpression" && parent.property === node && parent.computed !== true;
      const key =
        parent?.type === "Property" && parent.key === node && parent.computed !== true && parent.shorthand !== true;
      if (!declaration && !member && !key) references.set(id, [...(references.get(id) ?? []), node]);
    }
    for (const child of childNodes(node)) inspectBindings(child, node, isExported);
  };
  inspectBindings(program);
  const locatorExpression = (node: SyntaxNode): SyntaxNode => {
    const id = name(node);
    return id !== undefined && references.get(id)?.length === 1 ? (constants.get(id) ?? node) : node;
  };
  const apiOf = (callee: unknown): string | undefined => {
    if (!syntaxNode(callee)) return undefined;
    const local = name(callee);
    if (local !== undefined) {
      const binding = bindings.get(local);
      if (declarations.get(local) !== 1 || binding?.namespace !== false) return undefined;
      if (binding.module === "niceeval" && loaders.has(binding.api)) return binding.api;
      if (binding.module === "niceeval/sandbox" && binding.api === "registerSandboxContent") return binding.api;
      return undefined;
    }
    if (callee.type !== "MemberExpression" || callee.optional === true) return undefined;
    const method = property(callee);
    const object = name(callee.object);
    const binding = object === undefined ? undefined : bindings.get(object);
    if (object !== undefined && declarations.get(object) === 1 && binding !== undefined) {
      if (binding.namespace && binding.module === "niceeval" && method !== undefined && loaders.has(method))
        return method;
      if (
        binding.module === "niceeval/sandbox" &&
        !binding.namespace &&
        binding.api === "sandboxContent" &&
        (method === "file" || method === "directory")
      )
        return `content:${method}`;
      if (binding.namespace && binding.module === "niceeval/sandbox" && method === "registerSandboxContent")
        return method;
    }
    return undefined;
  };
  const location = (node: SyntaxNode, stringsFrom: string): string | undefined => {
    const text = literal(node);
    if (text !== undefined) return resolve(stringsFrom, text);
    if (node.type !== "NewExpression" || name(node.callee) !== "URL" || declarations.has("URL")) return undefined;
    const args = nodes(node.arguments);
    const path = literal(args[0]);
    if (args.length !== 2 || path === undefined || !importMetaUrl(args[1])) return undefined;
    const url = new URL(path, pathToFileURL(file));
    return url.protocol === "file:" ? fileURLToPath(url) : undefined;
  };
  const criteriaPattern = (node: SyntaxNode): string | undefined => {
    const text = literal(node);
    if (text !== undefined) return text;
    if (node.type !== "ObjectExpression") return undefined;
    const fields = nodes(node.properties);
    if (
      fields.length !== 2 ||
      fields.some(
        (field) =>
          field.type !== "Property" || field.computed === true || field.method === true || field.kind !== "init",
      )
    )
      return undefined;
    const pattern = fields.find((field) => (name(field.key) ?? literal(field.key)) === "pattern");
    const relativeTo = fields.find((field) => (name(field.key) ?? literal(field.key)) === "relativeTo");
    const value = literal(pattern?.value);
    if (value === undefined || value.startsWith("!") || !importMetaUrl(relativeTo?.value)) return undefined;
    return relative(ownerRoot, resolve(dirname(file), value))
      .split(sep)
      .join("/");
  };
  const replacements: SourceReplacement[] = [];
  const inputs: ManagedInputFact[] = [];
  const unresolved: { file: string; line: number; column: number }[] = [];
  const uncertain = (node: SyntaxNode): void => {
    unresolved.push({ file, ...sourcePosition(source, node.start) });
  };
  const replace = (node: SyntaxNode, identity: unknown): void => {
    replacements.push({ start: node.start, end: node.end, value: identity });
  };
  const directTransfers = new Map<SyntaxNode, number>();
  const defaultExport = nodes(program.body).find((node) => node.type === "ExportDefaultDeclaration");
  const definition = defaultExport?.declaration;
  if (syntaxNode(definition) && definition.type === "CallExpression") {
    const id = name(definition.callee);
    const binding = id === undefined ? undefined : bindings.get(id);
    const args = nodes(definition.arguments);
    if (
      id !== undefined &&
      declarations.get(id) === 1 &&
      binding?.module === "niceeval" &&
      !binding.namespace &&
      (binding.api === "defineEval" || binding.api === "defineScoreEval") &&
      args.length === 1 &&
      args[0]!.type === "ObjectExpression"
    ) {
      const fields = nodes(args[0]!.properties);
      const tests = fields.filter(
        (field) =>
          field.type === "Property" && field.computed !== true && (name(field.key) ?? literal(field.key)) === "test",
      );
      const test = tests.length === 1 ? tests[0]!.value : undefined;
      if (
        !fields.some((field) => field.type === "SpreadElement" || field.computed === true) &&
        syntaxNode(test) &&
        (test.type === "FunctionExpression" || test.type === "ArrowFunctionExpression") &&
        syntaxNode(test.body) &&
        test.body.type === "BlockStatement"
      ) {
        const params = nodes(test.params);
        const context = params.length === 1 ? name(params[0]) : undefined;
        if (context !== undefined && declarations.get(context) === 1) {
          const memberOfContext = (callee: unknown, method: string, sandbox: boolean): boolean => {
            if (
              !syntaxNode(callee) ||
              callee.type !== "MemberExpression" ||
              callee.optional === true ||
              property(callee) !== method
            )
              return false;
            if (!sandbox) return name(callee.object) === context;
            return (
              syntaxNode(callee.object) &&
              callee.object.type === "MemberExpression" &&
              callee.object.optional !== true &&
              property(callee.object) === "sandbox" &&
              name(callee.object.object) === context
            );
          };
          let ordinal = 0;
          let unsafe = false;
          let hasTransfer = false;
          let sandboxEscaped = false;
          const knownSends = new Set<SyntaxNode>();
          for (const statement of nodes(test.body.body)) {
            const expressions =
              statement.type === "ExpressionStatement"
                ? [statement.expression]
                : statement.type === "VariableDeclaration"
                  ? nodes(statement.declarations).map((declaration) => declaration.init)
                  : [];
            for (const expression of expressions) {
              const call =
                syntaxNode(expression) && expression.type === "AwaitExpression" ? expression.argument : expression;
              if (!syntaxNode(call) || call.type !== "CallExpression") continue;
              if (memberOfContext(call.callee, "send", false)) {
                if (!syntaxNode(expression) || expression.type !== "AwaitExpression") unsafe = true;
                knownSends.add(call);
                ordinal++;
              }
              if (
                memberOfContext(call.callee, "uploadFile", true) ||
                memberOfContext(call.callee, "uploadDirectory", true)
              ) {
                if (!syntaxNode(expression) || expression.type !== "AwaitExpression") unsafe = true;
                directTransfers.set(call, ordinal);
              }
            }
          }
          walkSyntax(test.body, (node) => {
            if (
              node.type === "MemberExpression" &&
              ["uploadFile", "uploadDirectory", "upload"].includes(property(node) ?? "")
            )
              hasTransfer = true;
            if (node.type === "CallExpression" && memberOfContext(node.callee, "send", false) && !knownSends.has(node))
              unsafe = true;
            if (
              (node.type === "AssignmentExpression" && boundNames(node.left).includes(context)) ||
              (node.type === "UpdateExpression" && name(node.argument) === context)
            )
              unsafe = true;
          });
          const inspectContext = (node: SyntaxNode, parent?: SyntaxNode): void => {
            if (name(node) === context && !(parent?.type === "MemberExpression" && parent.object === node))
              unsafe = true;
            if (node.type === "MemberExpression" && name(node.object) === context) {
              const method = property(node);
              if (
                (method === "send" && !(parent?.type === "CallExpression" && parent.callee === node)) ||
                method === "newSession" ||
                method === "respond"
              )
                unsafe = true;
              if (
                method === "sandbox" &&
                !(parent?.type === "MemberExpression" && parent.object === node && property(parent) !== undefined)
              )
                sandboxEscaped = true;
            }
            for (const child of childNodes(node)) inspectContext(child, node);
          };
          inspectContext(test.body);
          if (unsafe || sandboxEscaped) {
            directTransfers.clear();
            if (hasTransfer || sandboxEscaped) uncertain(test);
          }
        }
      }
    }
  }
  const transferOptions = (node: SyntaxNode | undefined): readonly string[] | undefined => {
    if (node === undefined || (name(node) === "undefined" && !declarations.has("undefined"))) return [];
    if (node.type !== "ObjectExpression") return undefined;
    const fields = nodes(node.properties);
    if (fields.length === 0) return [];
    if (fields.length !== 1) return undefined;
    const field = fields[0]!;
    if (
      field.type !== "Property" ||
      field.computed === true ||
      field.kind !== "init" ||
      field.method === true ||
      (name(field.key) ?? literal(field.key)) !== "ignore" ||
      !syntaxNode(field.value) ||
      field.value.type !== "ArrayExpression" ||
      !Array.isArray(field.value.elements)
    )
      return undefined;
    const values = field.value.elements.map(literal);
    return values.some((value) => value === undefined) ? undefined : (values as string[]);
  };
  const visit = (node: SyntaxNode, parent?: SyntaxNode, grandparent?: SyntaxNode): void => {
    try {
      if (
        node.type === "Property" &&
        parent?.type === "ObjectPattern" &&
        ((name(node.key) ?? literal(node.key)) === "uploadFile" ||
          (name(node.key) ?? literal(node.key)) === "uploadDirectory")
      )
        uncertain(node);
      if (
        node.type === "MemberExpression" &&
        (property(node) === "uploadFile" || property(node) === "uploadDirectory") &&
        !(parent?.type === "CallExpression" && parent.callee === node)
      )
        uncertain(node);
      if (node.type === "CallExpression") {
        const callee = node.callee;
        const operation = syntaxNode(callee) && callee.type === "MemberExpression" ? property(callee) : undefined;
        if (
          operation === "upload" &&
          syntaxNode(callee) &&
          syntaxNode(callee.object) &&
          callee.object.type === "MemberExpression" &&
          property(callee.object) === "sandbox" &&
          literal(nodes(node.arguments)[1]) === undefined
        )
          uncertain(node);
        if (operation === "uploadFile" || operation === "uploadDirectory") {
          const args = nodes(node.arguments);
          const sourceArg = args[0];
          const locator = sourceArg === undefined ? undefined : locatorExpression(sourceArg);
          const path = locator === undefined ? undefined : location(locator, dirname(file));
          const sendOrdinal = directTransfers.get(node);
          const target = literal(args[1]);
          const targetAbsent = args.length === 1 || (name(args[1]) === "undefined" && !declarations.has("undefined"));
          const ignore = operation === "uploadFile" ? [] : transferOptions(args[2]);
          if (
            sendOrdinal === undefined ||
            path === undefined ||
            locator === undefined ||
            node.optional === true ||
            ignore === undefined ||
            (operation === "uploadFile"
              ? args.length !== 2 || target === undefined
              : args.length < 1 || args.length > 3 || (!targetAbsent && target === undefined))
          ) {
            uncertain(node);
            return;
          }
          inside(ownerRoot, path);
          const contentIdentity = transferContentIdentity(operation, path, ignore);
          const identity = { operation, target: target ?? null, ignore, sendOrdinal, contentIdentity };
          replace(locator, { operation, contentIdentity });
          inputs.push({
            kind: "transfer",
            paths: [path],
            contentDigests: [],
            identity,
            transfer: { operation, source: path, target, ignore, sendOrdinal, contentIdentity },
          });
          return;
        }
        const api = apiOf(node.callee);
        const args = nodes(node.arguments);
        if (api !== undefined) {
          const first = args[0];
          if (node.optional === true || first === undefined) {
            uncertain(node);
            return;
          }
          if (api === "loadCriteria" || api === "loadPrivate") {
            // These APIs return project-relative names. Only discard-result calls
            // prove that their selected host names have no other observer.
            const discarded =
              parent?.type === "ExpressionStatement" ||
              (parent?.type === "AwaitExpression" && grandparent?.type === "ExpressionStatement");
            const patterns = args.map((arg) => (api === "loadCriteria" ? criteriaPattern(arg) : literal(arg)));
            if (!discarded || patterns.some((pattern) => pattern === undefined)) {
              uncertain(node);
              return;
            }
            const compiled = compilePatterns(patterns as string[]);
            const selected = expandLoaderPatterns(ownerRoot, compiled);
            const missing = unmatchedIncludes(compiled, selected);
            if (missing.length > 0) {
              uncertain(node);
              return;
            }
            const bases = enumerationBases(compiled).map((base) => resolve(ownerRoot, base));
            let base = bases[0] ?? ownerRoot;
            while (
              bases.some((candidate) => {
                const path = relative(base, candidate);
                return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
              })
            )
              base = dirname(base);
            const paths = selected.map((path) => resolve(ownerRoot, path));
            const contentDigests = paths.map((path) => [path, digest(inside(ownerRoot, path))] as const);
            const identity = {
              operation: api,
              files: contentDigests.map(([path, digest]) => [relative(base, path).split(sep).join("/"), digest]),
            };
            replace({ ...first, end: args[args.length - 1]!.end }, identity);
            inputs.push({ kind: api === "loadCriteria" ? "criteria" : "private", paths, contentDigests, identity });
            return;
          }
          const content = api === "registerSandboxContent" || api.startsWith("content:");
          const locator = locatorExpression(first);
          const expected = api === "loadText" || api.startsWith("content:") ? 1 : 2;
          if ((!content && args.length !== expected) || (content && args.length !== 1 && args.length !== 2)) {
            uncertain(node);
            return;
          }
          if (
            content &&
            args.length === 2 &&
            (api !== "registerSandboxContent" || !importMetaUrl(args[1]) || literal(locator) === undefined)
          ) {
            uncertain(node);
            return;
          }
          if (content && literal(locator) !== undefined && args.length !== 2) {
            uncertain(node);
            return;
          }
          const path = location(locator, content ? dirname(file) : ownerRoot);
          if (path === undefined) {
            uncertain(node);
            return;
          }
          inside(ownerRoot, path);
          if (content) {
            const handle = registerSandboxContent(pathToFileURL(path));
            if (
              (api === "content:file" && handle.kind !== "file") ||
              (api === "content:directory" && handle.kind !== "directory")
            )
              throw new Error(`${api} received ${handle.kind} content`);
            const identity = { operation: api, kind: handle.kind, digest: handle.digest };
            replace(locator, identity);
            if (args.length === 2) replace(args[1]!, { locator: "definition-url" });
            inputs.push({ kind: "content", paths: [path], contentDigests: [], identity });
          } else {
            const sha256 = digest(path);
            const identity = { operation: api, sha256 };
            replace(locator, identity);
            inputs.push({ kind: "data", paths: [path], contentDigests: [[path, sha256]], identity });
          }
        }
      }
      for (const child of childNodes(node)) visit(child, node, parent);
    } catch (cause) {
      if (
        cause instanceof Error &&
        (("code" in cause && ["ENOENT", "ENOTDIR", "EISDIR"].includes(String(cause.code))) ||
          cause.message === "uploadDirectory selected no entries")
      ) {
        uncertain(node);
        return;
      }
      throw cause;
    }
  };
  visit(program);
  return { replacements, inputs, unresolved };
}
