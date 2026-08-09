// External Eval roots: configuration decoding, installed-package preflight, the
// single-runtime linker hook, and a conservative module-facts projection.
//
// This module deliberately owns the boundary instead of teaching each command how
// to look through node_modules.  The package manager remains the source of truth;
// NiceEval only projects the already-installed tree into portable facts.

import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, realpathSync } from "node:fs";
import { lstat, readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import type {
  Config,
  EvalModuleEdge,
  EvalModuleFacts,
  ExternalEvalOrigin,
  InstalledPackageIdentity,
  PackageEvalRoot,
  StaticTransferPlanEntry,
} from "./types.ts";

export type EvalRootIssueCode =
  | "eval-root.config-invalid"
  | "eval-root.node-unsupported"
  | "eval-root.package-undeclared"
  | "eval-root.package-uninstalled"
  | "eval-root.installation-unverifiable"
  | "eval-root.outside-package"
  | "eval-root.missing"
  | "eval-root.owner-conflict"
  | "eval-root.yarn-pnp-unsupported"
  | "eval-root.loaded-before-registration"
  | "eval-root.preloaded-owner-unsupported"
  | "eval-root.process-reuse-unsupported"
  | "eval-root.hook-protocol-incompatible"
  | "eval-root.dependency-unverifiable"
  | "eval-root.niceeval-api-incompatible"
  | "eval-root.duplicate-relative-id";

export interface EvalRootIssue {
  readonly code: EvalRootIssueCode;
  readonly mount?: string;
  readonly dependency?: string;
  readonly packageFile?: string;
  readonly evalFile?: string;
  readonly specifier?: string;
  readonly field?: string;
  readonly message: string;
  readonly actions: readonly string[];
}

/** A batch error keeps preflight failures deterministic and machine-readable. */
export class EvalRootPreflightError extends Error {
  readonly issues: readonly EvalRootIssue[];

  constructor(issues: readonly EvalRootIssue[]) {
    const stable = Object.freeze([...issues].sort(compareIssues).map((issue) => Object.freeze({
      ...issue,
      actions: Object.freeze([...issue.actions]),
    })));
    super(stable.map((issue) => `${issue.code}${issue.mount ? ` (${issue.mount})` : ""}: ${issue.message}`).join("\n"));
    this.name = "EvalRootPreflightError";
    this.issues = stable;
  }
}

export interface ResolvedEvalRoot {
  readonly mount: string;
  readonly dependency: string;
  /** The configured package-root-relative discovery path, always slash separated. */
  readonly root: string;
  readonly consumerRoot: string;
  /** Real package root.  It is an execution capability boundary, never persisted. */
  readonly packageRoot: string;
  /** Real Eval root, proven to lie inside packageRoot. */
  readonly evalRoot: string;
  readonly package: ExternalEvalOrigin["package"];
  readonly installed: InstalledPackageIdentity;
}

interface HookOwner {
  readonly root: string;
  readonly consumerRoot: string;
}

interface ObservedModuleEdge {
  readonly sequence: number;
  readonly parent: string;
  readonly specifier: string;
  readonly target?: string;
  readonly conditions?: readonly string[];
}

interface HookInvocationState {
  owners: readonly HookOwner[];
  observations: ObservedModuleEdge[];
  /** Successful targets form the actual P4 module frontier, including nested deps. */
  trackedModules: Set<string>;
  nextObservation: number;
}

interface HookProtocolRecord {
  readonly protocolVersion: 1;
  readonly ownerRuntimeRoot: string;
  readonly registration: {
    registered: boolean;
    invocationUsed: boolean;
  };
}

const HOOK_PROTOCOL_SYMBOL = Symbol.for("niceeval.eval-root-hook.protocol");
const HOOK_PROTOCOL_VERSION = 1;
const OWNER_RUNTIME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GLOBAL_HOOKS = globalThis as typeof globalThis & { [HOOK_PROTOCOL_SYMBOL]?: unknown };
const hookInvocations = new AsyncLocalStorage<HookInvocationState>();
let deferredHookProtocolError: EvalRootPreflightError | undefined;

function hookProtocolForProcess(): HookProtocolRecord {
  const existing = GLOBAL_HOOKS[HOOK_PROTOCOL_SYMBOL];
  if (existing === undefined) {
    const record: HookProtocolRecord = {
      protocolVersion: HOOK_PROTOCOL_VERSION,
      ownerRuntimeRoot: OWNER_RUNTIME_ROOT,
      registration: { registered: false, invocationUsed: false },
    };
    GLOBAL_HOOKS[HOOK_PROTOCOL_SYMBOL] = Object.freeze(record);
    return record;
  }
  // The protocol header is the compatibility boundary.  Do not inspect any
  // other field before both values agree: a different NiceEval runtime may have
  // installed arbitrary state under the shared process symbol.
  if (!hasCompatibleHookProtocolHeader(existing)) {
    throw new EvalRootPreflightError([{
      code: "eval-root.hook-protocol-incompatible",
      message: "Another NiceEval process hook uses a different protocol or canonical runtime root.",
      actions: ["Use a fresh CLI process with one NiceEval runtime."],
    }]);
  }
  const record = existing as HookProtocolRecord;
  if (!isPlainRecord(record.registration) || typeof record.registration.registered !== "boolean" ||
    typeof record.registration.invocationUsed !== "boolean") {
    throw new EvalRootPreflightError([{
      code: "eval-root.hook-protocol-incompatible",
      message: "The existing NiceEval hook protocol has no usable registration state.",
      actions: ["Use a fresh CLI process with one NiceEval runtime."],
    }]);
  }
  return record;
}

function hasCompatibleHookProtocolHeader(value: unknown): value is {
  readonly protocolVersion: number;
  readonly ownerRuntimeRoot: string;
} {
  return isPlainRecord(value) && value.protocolVersion === HOOK_PROTOCOL_VERSION &&
    value.ownerRuntimeRoot === OWNER_RUNTIME_ROOT;
}

function assertHookProtocolCompatible(): void {
  hookProtocolForProcess();
}

const PATH_CONTROL = /[\u0000-\u001f\u007f]/;
const IGNORED_TREE_NAMES = new Set(["node_modules", ".git", ".hg", ".svn", ".niceeval", ".pnpm-store"]);
const IGNORED_YARN_NAMES = new Set(["cache", "unplugged"]);
const MODULE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Decode only the new config surface; the rest of Config remains its existing open object. */
export function decodeEvalRoots(value: unknown): Readonly<Record<string, PackageEvalRoot>> | undefined {
  if (value === undefined) return undefined;
  const issues: EvalRootIssue[] = [];
  if (!isPlainRecord(value)) {
    throw new EvalRootPreflightError([configIssue(undefined, "evalRoots", "evalRoots must be a record of mount keys.")]);
  }
  const roots: Record<string, PackageEvalRoot> = {};
  for (const mount of Object.keys(value).sort()) {
    const item = value[mount];
    if (!isRegularSlashPath(mount)) {
      issues.push(configIssue(mount, `evalRoots.${mount}`, "Mount keys must be non-empty slash-separated ordinary path segments."));
      continue;
    }
    if (!isPlainRecord(item)) {
      issues.push(configIssue(mount, `evalRoots.${mount}`, "Each mounted root must be an object with a package field."));
      continue;
    }
    for (const key of Object.keys(item)) {
      if (key !== "package" && key !== "root") {
        issues.push(configIssue(mount, `evalRoots.${mount}.${key}`, "Mounted root objects only accept package and root."));
      }
    }
    const dependency = item.package;
    const configuredRoot = item.root;
    if (typeof dependency !== "string" || dependency.trim().length === 0) {
      issues.push(configIssue(mount, `evalRoots.${mount}.package`, "package must name a direct dependency key."));
    }
    if (configuredRoot !== undefined && (typeof configuredRoot !== "string" || !isRegularSlashPath(configuredRoot))) {
      issues.push(configIssue(mount, `evalRoots.${mount}.root`, "root must be a package-relative ordinary slash path."));
    }
    if (typeof dependency === "string" && dependency.trim().length > 0 &&
      (configuredRoot === undefined || typeof configuredRoot === "string" && isRegularSlashPath(configuredRoot))) {
      roots[mount] = Object.freeze({
        package: dependency,
        ...(configuredRoot === undefined ? {} : { root: configuredRoot }),
      });
    }
  }
  if (issues.length > 0) throw new EvalRootPreflightError(issues);
  return Object.freeze(roots);
}

/**
 * `loadConfigFile()` calls this after evaluating a config module.  Keeping it here
 * makes programmatic consumers get exactly the same shape gate as the CLI.
 */
export function decodeConfigEvalRoots(config: Config): Config {
  const evalRoots = decodeEvalRoots((config as { evalRoots?: unknown }).evalRoots);
  if (evalRoots === undefined) return config;
  return Object.freeze({ ...config, evalRoots });
}

/** Node's synchronous hook API required by the external ESM+CJS owner linker. */
export function supportsExternalEvalRoots(nodeVersion = process.versions.node): boolean {
  const [major = 0, minor = 0] = nodeVersion.split(".").map((part) => Number(part));
  return major > 22 || major === 22 && minor >= 15;
}

/** Reject the only startup shapes in which a JSON worker cannot own stdout/stderr. */
export function hasOwnerPreload(argv = process.execArgv, nodeOptions = process.env.NODE_OPTIONS ?? ""): boolean {
  const tokens = [...argv, ...nodeOptions.split(/\s+/).filter(Boolean)];
  return tokens.some((token) =>
    token === "--require" || token === "-r" || token.startsWith("--require=") || token.startsWith("-r=") ||
    token === "--import" || token.startsWith("--import=") || token === "--loader" || token.startsWith("--loader=") ||
    token === "--experimental-loader" || token.startsWith("--experimental-loader="),
  );
}

export function assertMachinePreloadSupport(): void {
  if (!hasOwnerPreload()) return;
  throw new EvalRootPreflightError([{
    code: "eval-root.preloaded-owner-unsupported",
    message: "A Node preload can write before NiceEval owns the machine protocol.",
    actions: ["Clear NODE_OPTIONS and Node --require/--import/--loader options before using list --json."],
  }]);
}

/**
 * P1/P2: resolve every configured root before importing any external Eval module.
 * No package entrypoint is imported here; only package.json, its installed root and
 * the consumer lockfile are read.
 */
export async function preflightEvalRoots(
  cwd: string,
  config: Pick<Config, "evalRoots">,
): Promise<readonly ResolvedEvalRoot[]> {
  const roots = decodeEvalRoots(config.evalRoots);
  if (roots === undefined || Object.keys(roots).length === 0) return Object.freeze([]);
  if (!supportsExternalEvalRoots()) {
    throw new EvalRootPreflightError([{
      code: "eval-root.node-unsupported",
      message: `External Eval roots require Node >=22.15; current Node is ${process.versions.node}.`,
      actions: ["Use Node >=22.15, or remove evalRoots to run local evals only."],
    }]);
  }
  const consumerRoot = await realpath(resolve(cwd));
  if (existsSync(join(consumerRoot, ".pnp.cjs")) || existsSync(join(consumerRoot, ".pnp.js"))) {
    throw new EvalRootPreflightError([{
      code: "eval-root.yarn-pnp-unsupported",
      message: "Yarn Plug'n'Play does not expose the node-modules installation tree required by evalRoots.",
      actions: ["Use Yarn's node-modules linker or a supported npm/pnpm installation."],
    }]);
  }
  const directDependencies = await consumerDependencyKeys(consumerRoot);
  const lock = await readConsumerLock(consumerRoot);
  const resolved: ResolvedEvalRoot[] = [];
  const issues: EvalRootIssue[] = [];
  for (const [mount, entry] of Object.entries(roots).sort(([a], [b]) => a.localeCompare(b))) {
    try {
      if (!directDependencies.has(entry.package)) {
        throw issueError({
          code: "eval-root.package-undeclared",
          mount,
          dependency: entry.package,
          message: `"${entry.package}" is not a direct dependency of this consumer project.`,
          actions: ["Add the exact package dependency with the project's package manager, then install it."],
        });
      }
      if (lock === undefined) {
        throw issueError({
          code: "eval-root.installation-unverifiable",
          mount,
          dependency: entry.package,
          message: "No supported consumer lockfile is available to prove the installed package selection.",
          actions: ["Install with npm, pnpm, or Yarn node-modules and retain its lockfile."],
        });
      }
      const packageRoot = await locateInstalledPackage(consumerRoot, entry.package, mount);
      const packageManifestPath = join(packageRoot, "package.json");
      const packageManifest = await readJsonRecord(packageManifestPath, mount, entry.package);
      const root = entry.root ?? "evals";
      const evalCandidate = join(packageRoot, ...root.split("/"));
      if (!existsSync(evalCandidate) || !(await stat(evalCandidate)).isDirectory()) {
        throw issueError({
          code: "eval-root.missing",
          mount,
          dependency: entry.package,
          packageFile: packageManifestPath,
          message: `Configured Eval root ${JSON.stringify(root)} is not present in the installed package.`,
          actions: ["Correct evalRoots.<mount>.root or install a package revision that contains it."],
        });
      }
      const evalRoot = await realpath(evalCandidate);
      if (!isWithin(packageRoot, evalRoot)) {
        throw issueError({
          code: "eval-root.outside-package",
          mount,
          dependency: entry.package,
          packageFile: packageManifestPath,
          message: "The configured Eval root resolves outside its installed package through a symbolic link.",
          actions: ["Keep the Eval root and its assets inside the installed package."],
        });
      }
      const installed = await installedIdentity({
        lock,
        consumerRoot,
        dependency: entry.package,
        declaration: directDependencies.get(entry.package)!,
        packageRoot,
        mount,
      });
      const preloaded = loadedOwnerFile(packageRoot);
      if (preloaded !== undefined) {
        throw issueError({
          code: "eval-root.loaded-before-registration",
          mount,
          dependency: entry.package,
          evalFile: preloaded,
          message: "An external owner module was already loaded before NiceEval could bind its canonical runtime hook.",
          actions: ["Start a fresh NiceEval CLI process without importing the external Eval package first."],
        });
      }
      resolved.push(Object.freeze({
        mount,
        dependency: entry.package,
        root,
        consumerRoot,
        packageRoot,
        evalRoot,
        package: packageProjection(packageManifest),
        installed,
      }));
    } catch (cause) {
      if (cause instanceof EvalRootPreflightError) issues.push(...cause.issues);
      else issues.push({
        code: "eval-root.installation-unverifiable",
        mount,
        dependency: entry.package,
        message: cause instanceof Error ? cause.message : String(cause),
        actions: ["Repair the installed package tree and lockfile, then retry."],
      });
    }
  }
  const owners = new Map<string, ResolvedEvalRoot[]>();
  for (const root of resolved) owners.set(root.packageRoot, [...(owners.get(root.packageRoot) ?? []), root]);
  for (const rootsForOwner of owners.values()) {
    if (rootsForOwner.length < 2) continue;
    for (const root of rootsForOwner) {
      issues.push({
        code: "eval-root.owner-conflict",
        mount: root.mount,
        dependency: root.dependency,
        message: `Mounted package owner is also claimed by ${rootsForOwner.filter((other) => other.mount !== root.mount).map((other) => JSON.stringify(other.mount)).join(", ")}.`,
        actions: ["Mount one physical package owner once, or install distinct package instances for separate mounts."],
      });
    }
  }
  if (issues.length > 0) throw new EvalRootPreflightError(issues);
  return Object.freeze(resolved.sort((a, b) => a.mount.localeCompare(b.mount)));
}

/**
 * P3 is deliberately source-only: every mounted root is parsed and its static
 * owner-local closure is checked before activation/import can run package code.
 * Package-instance identity stays out of this phase; P4's hook observations own
 * that fact.
 */
export async function preflightEvalRootSources(roots: readonly ResolvedEvalRoot[]): Promise<void> {
  const issues: EvalRootIssue[] = [];
  for (const root of roots) {
    const entries = await evalEntryFiles(root.evalRoot).catch((cause) => {
      issues.push({
        code: "eval-root.missing",
        mount: root.mount,
        dependency: root.dependency,
        packageFile: join(root.packageRoot, "package.json"),
        message: `Cannot enumerate the installed Eval root: ${cause instanceof Error ? cause.message : String(cause)}`,
        actions: ["Repair the installed package contents and retry."],
      });
      return [] as string[];
    });
    for (const entry of entries) {
      try {
        await preflightEvalModule(entry, root);
      } catch (cause) {
        if (cause instanceof EvalRootPreflightError) issues.push(...cause.issues);
        else issues.push({
          code: "eval-root.installation-unverifiable",
          mount: root.mount,
          dependency: root.dependency,
          evalFile: relativePortable(root.packageRoot, entry),
          message: cause instanceof Error ? cause.message : String(cause),
          actions: ["Repair the installed Eval source and retry."],
        });
      }
    }
  }
  if (issues.length > 0) throw new EvalRootPreflightError(issues);
}

async function evalEntryFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_TREE_NAMES.has(entry.name)) await walk(file);
      } else if (entry.isFile() && (entry.name.endsWith(".eval.ts") || entry.name.endsWith(".eval.tsx") || entry.name === "eval.ts" || entry.name === "eval.tsx")) {
        files.push(file);
      }
    }
  };
  await walk(root);
  return files.sort();
}

async function preflightEvalModule(entry: string, root: ResolvedEvalRoot): Promise<void> {
  const owner = root.packageRoot;
  const visited = new Set<string>();
  const visit = async (input: string): Promise<void> => {
    const file = await realpath(input);
    if (!isWithin(owner, file)) {
      throw issueError({
        code: "eval-root.outside-package",
        mount: root.mount,
        dependency: root.dependency,
        packageFile: join(owner, "package.json"),
        evalFile: relativePortable(owner, input),
        message: "A static Eval module edge resolves outside the installed package owner.",
        actions: ["Keep relative Eval modules inside the package."],
      });
    }
    if (visited.has(file)) return;
    visited.add(file);
    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file));
    const parseDiagnostics = (sourceFile as unknown as { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (parseDiagnostics.length > 0) {
      const diagnostic = parseDiagnostics[0]!;
      throw issueError({
        code: "eval-root.installation-unverifiable",
        mount: root.mount,
        dependency: root.dependency,
        packageFile: join(owner, "package.json"),
        evalFile: relativePortable(owner, file),
        message: `TypeScript syntax error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
        actions: ["Fix the installed Eval source before importing it."],
      });
    }
    const inspect = async (specifier: string, recurse: boolean): Promise<void> => {
      if (!isLocalModuleSpecifier(specifier)) return;
      const target = await resolveOwnerLocalModule(dirname(file), specifier);
      if (target === undefined) return;
      if (!isWithin(owner, target)) {
        throw issueError({
          code: "eval-root.outside-package",
          mount: root.mount,
          dependency: root.dependency,
          packageFile: join(owner, "package.json"),
          evalFile: relativePortable(owner, file),
          specifier,
          message: "A static Eval module edge resolves outside the installed package owner.",
          actions: ["Keep relative Eval modules inside the package."],
        });
      }
      if (recurse) await visit(target);
    };
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && !statement.importClause?.isTypeOnly) {
        assertStaticNiceevalApi(root, file, statement);
        await inspect(statement.moduleSpecifier.text, true);
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier) && !statement.isTypeOnly) {
        assertStaticNiceevalApi(root, file, statement);
        await inspect(statement.moduleSpecifier.text, true);
      }
      const walk = async (node: ts.Node, nested: boolean): Promise<void> => {
        const entersNested = nested || ts.isFunctionLike(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node);
        if (ts.isCallExpression(node)) {
          const literal = node.arguments[0];
          if (
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              ts.isIdentifier(node.expression) && node.expression.text === "require") &&
            literal !== undefined && ts.isStringLiteral(literal)
          ) {
            // Even a branch-local literal must not be allowed to escape the owner
            // when it eventually executes.  Only top-level edges extend P3's
            // recursive closure; P4 decides whether a dynamic edge actually ran.
            await inspect(literal.text, !entersNested);
          }
        }
        const children: ts.Node[] = [];
        ts.forEachChild(node, (child) => { children.push(child); });
        for (const child of children) await walk(child, entersNested);
      };
      await walk(statement, false);
    }
  };
  await visit(entry);
}

/** P3 can name exact ESM imports that the canonical consumer runtime lacks. */
function assertStaticNiceevalApi(
  root: ResolvedEvalRoot,
  file: string,
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
): void {
  const specifier = statement.moduleSpecifier;
  if (specifier === undefined || !ts.isStringLiteral(specifier) || !isNiceevalSpecifier(specifier.text)) return;
  let runtime: Record<string, unknown>;
  try {
    const canonicalRequire = createRequire(import.meta.url);
    canonicalRequire.resolve(specifier.text);
    const loaded: unknown = canonicalRequire(specifier.text);
    runtime = isPlainRecord(loaded) || typeof loaded === "function"
      ? loaded as Record<string, unknown>
      : {};
  } catch (cause) {
    throw issueError({
      code: "eval-root.niceeval-api-incompatible",
      mount: root.mount,
      dependency: root.dependency,
      packageFile: join(root.packageRoot, "package.json"),
      evalFile: relativePortable(root.packageRoot, file),
      specifier: specifier.text,
      message: `The consumer NiceEval runtime cannot resolve ${JSON.stringify(specifier.text)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      actions: ["Upgrade the consumer NiceEval package or select a compatible external Eval package."],
    });
  }
  const named = ts.isImportDeclaration(statement)
    ? statement.importClause?.namedBindings !== undefined && ts.isNamedImports(statement.importClause.namedBindings)
      ? statement.importClause.namedBindings.elements.filter((element) => !element.isTypeOnly).map((element) => element.propertyName?.text ?? element.name.text)
      : []
    : statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.filter((element) => !element.isTypeOnly).map((element) => element.propertyName?.text ?? element.name.text)
      : [];
  const missing = named.filter((name) => !(name in runtime));
  if (missing.length === 0) return;
  throw issueError({
    code: "eval-root.niceeval-api-incompatible",
    mount: root.mount,
    dependency: root.dependency,
    packageFile: join(root.packageRoot, "package.json"),
    evalFile: relativePortable(root.packageRoot, file),
    specifier: specifier.text,
    message: `The consumer NiceEval runtime does not export ${missing.map((name) => JSON.stringify(name)).join(", ")} from ${JSON.stringify(specifier.text)}.`,
    actions: ["Upgrade the consumer NiceEval package or select a compatible external Eval package."],
  });
}

/** Configure the already-registered linker for one fresh external discovery invocation. */
export function activateEvalRootHooks(roots: readonly ResolvedEvalRoot[]): void {
  if (roots.length === 0) return;
  if (!supportsExternalEvalRoots()) {
    throw new EvalRootPreflightError([{
      code: "eval-root.node-unsupported",
      message: `External Eval roots require Node >=22.15; current Node is ${process.versions.node}.`,
      actions: ["Use a supported Node version."],
    }]);
  }
  bootstrapEvalRootHooks();
  if (deferredHookProtocolError !== undefined) throw deferredHookProtocolError;
  const protocol = hookProtocolForProcess();
  if (!protocol.registration.registered) {
    throw new EvalRootPreflightError([{
      code: "eval-root.node-unsupported",
      message: "This Node runtime does not expose the synchronous module hook required by evalRoots.",
      actions: ["Use a Node >=22.15 build with node:module.registerHooks support."],
    }]);
  }
  if (hookInvocations.getStore() !== undefined || protocol.registration.invocationUsed) {
    throw new EvalRootPreflightError([{
      code: "eval-root.process-reuse-unsupported",
      message: "External Eval discovery is supported once per NiceEval process so hook ownership remains unambiguous.",
      actions: ["Run the command in a fresh NiceEval process."],
    }]);
  }
  protocol.registration.invocationUsed = true;
  // Keep ownership and observations in the invocation's asynchronous scope.
  // `enterWith` is intentional here: CLI discovery, planning and Attempts are
  // one command continuation, while a later external invocation in this same
  // process is rejected by invocationUsed above.
  hookInvocations.enterWith({
    owners: Object.freeze(roots.map((root) => Object.freeze({ root: root.packageRoot, consumerRoot: root.consumerRoot }))),
    observations: [],
    trackedModules: new Set<string>(),
    nextObservation: 0,
  });
}

/** Register before config/eval dynamic imports.  It is inert until roots are activated. */
export function bootstrapEvalRootHooks(): void {
  let protocol: HookProtocolRecord;
  try {
    assertHookProtocolCompatible();
    protocol = hookProtocolForProcess();
  } catch (cause) {
    if (cause instanceof EvalRootPreflightError) {
      // Bootstrap runs before config decoding.  Preserve local-only commands
      // when another runtime's protocol is present, but make activation of an
      // actual external root fail with the exact structured incompatibility.
      deferredHookProtocolError = cause;
      return;
    }
    throw cause;
  }
  if (protocol.registration.registered) return;
  const registerHooks = (nodeModule as unknown as {
    registerHooks?: (hooks: {
      resolve: (specifier: string, context: { parentURL?: string; conditions?: readonly string[] }, nextResolve: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean };
    }) => void;
  }).registerHooks;
  if (registerHooks === undefined) return;
  const canonicalRequire = createRequire(import.meta.url);
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = parentPath(context.parentURL);
      const ownerParent = parent !== undefined && isHookOwnerFile(parent);
      if (parent !== undefined && ownerParent && isNiceevalSpecifier(specifier)) {
        try {
          const target = canonicalRequire.resolve(specifier);
          observe(parent, specifier, target, context.conditions);
          return { url: pathToFileURL(target).href, shortCircuit: true };
        } catch (cause) {
          throw new EvalRootPreflightError([{
            code: "eval-root.niceeval-api-incompatible",
            evalFile: parent,
            specifier,
            message: `The consumer NiceEval runtime cannot resolve ${JSON.stringify(specifier)}: ${cause instanceof Error ? cause.message : String(cause)}`,
            actions: ["Upgrade the consumer NiceEval package or select a compatible external Eval package."],
          }]);
        }
      }
      const result = nextResolve(specifier, context);
      if (parent !== undefined && (ownerParent || isHookTrackedModule(parent))) {
        if (ownerParent) assertHookLocalTargetOwned(parent, specifier, result.url);
        observe(parent, specifier, result.url, context.conditions);
      }
      return result;
    },
  });
  protocol.registration.registered = true;
}

/** Runtime hook facts are authoritative targets; static AST facts only name candidates. */
export function observedModuleEdgesForOwner(ownerRoot: string): readonly ObservedModuleEdge[] {
  const state = hookInvocations.getStore();
  if (state === undefined) return Object.freeze([]);
  const root = resolve(ownerRoot);
  return Object.freeze(state.observations
    .filter((edge) => isWithin(root, edge.parent))
    .map((edge) => Object.freeze({ ...edge })));
}

/** P4's complete actual frontier, used only while projecting one external Eval DAG. */
function observedModuleEdgesForInvocation(): readonly ObservedModuleEdge[] {
  const state = hookInvocations.getStore();
  return state === undefined ? Object.freeze([]) : Object.freeze(state.observations.map((edge) => Object.freeze({ ...edge })));
}

/** A tracker takes this cursor at Attempt start and later asks for newly loaded edges. */
export function moduleObservationCursor(): number {
  return hookInvocations.getStore()?.nextObservation ?? 0;
}

export function observedModuleEdgesSince(ownerRoot: string, cursor: number): readonly ObservedModuleEdge[] {
  const state = hookInvocations.getStore();
  if (state === undefined) return Object.freeze([]);
  const root = resolve(ownerRoot);
  return Object.freeze(state.observations
    .filter((edge) => edge.sequence > cursor && isWithin(root, edge.parent))
    .map((edge) => Object.freeze({ ...edge })));
}

/**
 * Parse a conservative source graph.  It intentionally never declares a dynamic
 * edge safe; those Eval definitions still discover and run, but carry gets a
 * limitation through `EvalModuleFacts`.
 */
export async function moduleFactsForEval(
  entryFile: string,
  ownerRoot: string,
): Promise<EvalModuleFacts> {
  const realOwner = await realpath(ownerRoot);
  const modules = new Set<string>();
  const edges: EvalModuleEdge[] = [];
  const dependencies: Record<string, unknown>[] = [];
  const limitations: { code: string; file?: string; detail?: string }[] = [];
  const transferPlan: StaticTransferPlanEntry[] = [];
  const visited = new Set<string>();
  const bareCandidates = new Map<string, { parent: string; specifier: string; kind: EvalModuleEdge["kind"] }>();
  const externalOwner = hookInvocations.getStore()?.owners.some((owner) => resolve(owner.root) === realOwner) === true;

  const addLimitation = (code: string, file: string, detail?: string): void => {
    const candidate = { code, file: relativePortable(realOwner, file), ...(detail === undefined ? {} : { detail }) };
    if (!limitations.some((existing) => JSON.stringify(existing) === JSON.stringify(candidate))) limitations.push(candidate);
  };
  const addEdge = (edge: EvalModuleEdge): void => {
    if (!edges.some((existing) => JSON.stringify(existing) === JSON.stringify(edge))) edges.push(edge);
  };
  const activeOwner = hookInvocations.getStore()?.owners.find((owner) => resolve(owner.root) === realOwner);
  const addDependency = async (specifier: string, parent: string, target: string | undefined, conditions?: readonly string[]): Promise<void> => {
    if (isNiceevalSpecifier(specifier) || isNodeBuiltin(specifier)) return;
    if (target === undefined) {
      addLimitation("dependency-unverifiable", parent, specifier);
      return;
    }
    const packageRoot = await nearestPackageRoot(target);
    if (packageRoot === undefined) {
      addLimitation("dependency-unverifiable", parent, specifier);
      return;
    }
    try {
      const manifest = await readJsonRecord(join(packageRoot, "package.json"));
      const contentDigest = await canonicalTreeDigest(packageRoot);
      const baseIdentity = {
        specifier,
        package: typeof manifest.name === "string" ? manifest.name : specifier,
        ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
        ...(conditions === undefined || conditions.length === 0 ? {} : { conditions: [...conditions].sort().join(",") }),
        // A package path is intentionally never persisted; content identity is the
        // portable fact used by fingerprinting below.
        contentDigest,
      };
      const identity = activeOwner === undefined
        ? baseIdentity
        : {
            ...baseIdentity,
            ...await identifyDependencyInstance({
              consumerRoot: activeOwner.consumerRoot,
              packageRoot,
              parentModule: parent,
              specifier,
              contentDigest,
            }),
          };
      if (!dependencies.some((existing) => JSON.stringify(existing) === JSON.stringify(identity))) dependencies.push(identity);
    } catch (cause) {
      if (cause instanceof EvalRootPreflightError) throw cause;
      addLimitation("dependency-unverifiable", parent, specifier);
    }
  };

  const visit = async (input: string): Promise<void> => {
    const file = await realpath(input);
    if (visited.has(file)) return;
    if (!isWithin(realOwner, file)) {
      throw new EvalRootPreflightError([{
        code: "eval-root.outside-package",
        evalFile: input,
        message: "A static Eval module edge resolves outside the external package owner.",
        actions: ["Keep relative Eval modules inside the package."],
      }]);
    }
    visited.add(file);
    modules.add(relativePortable(realOwner, file));
    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file));
    const requireShadowed = sourceHasPotentialRequireShadow(sourceFile);
    const scanSpecifier = async (
      specifier: string,
      kind: EvalModuleEdge["kind"],
      topLevel: boolean,
    ): Promise<void> => {
      const parent = relativePortable(realOwner, file);
      if (isDynamicModuleCapability(specifier)) addLimitation("dynamic-module-edge", file, specifier);
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        const target = await resolveRelativeModule(dirname(file), specifier);
        addEdge({ parent, specifier, ...(target === undefined ? {} : { target: relativePortable(realOwner, target) }), kind });
        if (target === undefined) {
          addLimitation("module-unresolved", file, specifier);
        } else if (target.endsWith(".node")) {
          addLimitation("dynamic-module-edge", file, `${specifier} resolves to native addon`);
        } else if (topLevel) {
          await visit(target);
        } else {
          addLimitation("dynamic-module-edge", file, specifier);
        }
      } else {
        // P3 deliberately records only a candidate.  The P4 linker observation
        // below provides the target and physical package instance; resolving it
        // here would be a second, approximate module resolver.
        if (!externalOwner) {
          const target = resolveBareSpecifier(file, specifier);
          addEdge({ parent, specifier, ...(target === undefined ? {} : { target: portableBareTarget(target) }), kind });
          await addDependency(specifier, file, target);
        } else {
          addEdge({ parent, specifier, kind });
          if (topLevel) bareCandidates.set(`${parent}\u0000${specifier}`, { parent, specifier, kind });
          else addLimitation("dynamic-module-edge", file, specifier);
        }
      }
    };
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && !statement.importClause?.isTypeOnly) {
        await scanSpecifier(statement.moduleSpecifier.text, "static-import", true);
      } else if (
        ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier) && !statement.isTypeOnly
      ) {
        await scanSpecifier(statement.moduleSpecifier.text, "static-export", true);
      }
      const walk = async (node: ts.Node, nested: boolean, conditional: boolean): Promise<void> => {
        const entersNested = nested || ts.isFunctionLike(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node);
        const entersConditional = conditional || isRuntimeControlFlow(node);
        if (ts.isCallExpression(node)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const argument = node.arguments[0];
            if (argument !== undefined && ts.isStringLiteral(argument)) await scanSpecifier(argument.text, "literal-import", !entersNested && !entersConditional);
            else addLimitation("dynamic-module-edge", file, "nonliteral import()");
          } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
            const argument = node.arguments[0];
            if (requireShadowed) addLimitation("dynamic-module-edge", file, "possibly shadowed require()");
            else if (argument !== undefined && ts.isStringLiteral(argument)) await scanSpecifier(argument.text, "literal-require", !entersNested && !entersConditional);
            else addLimitation("dynamic-module-edge", file, "nonliteral require()");
          } else if (isDynamicModuleCall(node)) {
            addLimitation("dynamic-module-edge", file, "runtime module-loading capability");
          } else if (ts.isIdentifier(node.expression) && (node.expression.text === "eval" || node.expression.text === "Function")) {
            addLimitation("dynamic-module-edge", file, node.expression.text);
          }
          await collectStaticTransfer(
            node,
            file,
            realOwner,
            transferPlan,
            addLimitation,
            conditional,
          );
        }
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Worker") {
          addLimitation("dynamic-module-edge", file, "Worker");
        }
        const children: ts.Node[] = [];
        ts.forEachChild(node, (child) => { children.push(child); });
        for (const child of children) await walk(child, entersNested, entersConditional);
      };
      await walk(statement, false, false);
    }
  };

  await visit(entryFile);
  const observedCandidates = new Set<string>();
  const reachable = new Set<string>();
  for (const module of modules) {
    const absolute = resolve(realOwner, module);
    try {
      reachable.add(await realpath(absolute));
    } catch {
      reachable.add(absolute);
    }
  }
  for (const observed of observedModuleEdgesForInvocation()) {
    const parentPhysical = canonicalObservedPath(observed.parent);
    if (!reachable.has(parentPhysical)) continue;
    const parent = isWithin(realOwner, parentPhysical)
      ? relativePortable(realOwner, parentPhysical)
      : portableBareTarget(parentPhysical);
    const targetPhysical = observed.target === undefined ? undefined : canonicalObservedPath(observed.target);
    if (targetPhysical !== undefined && !targetPhysical.startsWith("node:")) reachable.add(targetPhysical);
    const target = targetPhysical === undefined
      ? undefined
      : isWithin(realOwner, targetPhysical) ? relativePortable(realOwner, targetPhysical) : portableBareTarget(targetPhysical);
    const candidate = isWithin(realOwner, parentPhysical)
      ? bareCandidates.get(`${parent}\u0000${observed.specifier}`)
      : undefined;
    const matching = edges.find((edge) => edge.parent === parent && edge.specifier === observed.specifier);
    const conditions = observed.conditions === undefined || observed.conditions.length === 0
      ? undefined
      : Object.freeze([...observed.conditions].sort());
    if (matching !== undefined && matching.target === undefined && target !== undefined) {
      const index = edges.indexOf(matching);
      edges[index] = { ...matching, target, ...(conditions === undefined ? {} : { conditions }) };
    } else if (!edges.some((edge) => edge.parent === parent && edge.specifier === observed.specifier && edge.target === target &&
      JSON.stringify(edge.conditions ?? []) === JSON.stringify(conditions ?? []))) {
      edges.push({ parent, specifier: observed.specifier, ...(target === undefined ? {} : { target }), ...(conditions === undefined ? {} : { conditions }), kind: candidate?.kind ?? "literal-import" });
    }
    if (candidate !== undefined) observedCandidates.add(`${parent}\u0000${observed.specifier}`);
    if (!isLocalModuleSpecifier(observed.specifier) && !isNiceevalSpecifier(observed.specifier) && !isNodeBuiltin(observed.specifier)) {
      await addDependency(observed.specifier, observed.parent, observed.target, conditions);
    }
  }
  for (const [key, candidate] of bareCandidates) {
    if (!observedCandidates.has(key) && !isNiceevalSpecifier(candidate.specifier) && !isNodeBuiltin(candidate.specifier)) {
      addLimitation("dependency-unverifiable", entryFile, `${candidate.specifier} was not observed by the owner linker`);
    }
  }
  return Object.freeze({
    version: 1,
    modules: Object.freeze([...modules].sort()),
    edges: Object.freeze(edges.sort(compareEdges).map((edge) => Object.freeze({ ...edge }))),
    dependencies: Object.freeze(dependencies.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))).map((item) => Object.freeze(item))),
    transferPlan: Object.freeze(transferPlan.sort(compareTransferPlan).map((item) => Object.freeze({
      ...item,
      ...(item.ignore === undefined ? {} : { ignore: Object.freeze([...item.ignore]) }),
    }))),
    limitations: Object.freeze(limitations.sort(compareLimitations).map((item) => Object.freeze({ ...item }))),
  }) as EvalModuleFacts;
}

/** Construct a per-Eval public origin without leaking any local installation path. */
export function originForEval(root: ResolvedEvalRoot, relativeEvalId: string): ExternalEvalOrigin {
  return Object.freeze({
    kind: "package",
    mount: root.mount,
    root: root.root,
    relativeEvalId,
    dependency: root.dependency,
    package: Object.freeze({ ...root.package }),
    installed: Object.freeze({ ...root.installed }),
  });
}

/** Runtime revision is a compact stable fingerprint face built by package build. */
export async function runtimeContractRevision(): Promise<string> {
  return (await readRuntimeContractManifest())?.revision ?? `source:${process.versions.node}:hook-v1`;
}

/**
 * Resolve the canonical runtime's real dependency instances for a planned pair.
 * Provider SDK imports are conditional: an unselected E2B/Vercel/Docker branch
 * remains a visible `not-selected` fact and never turns a clean local run into
 * an installation error.
 */
export async function runtimeContractFacts(selectedProvider?: string): Promise<Readonly<Record<string, string>>> {
  const manifest = await readRuntimeContractManifest();
  if (manifest === undefined) {
    return Object.freeze({
      revision: `source:${process.versions.node}:hook-v1`,
      node: process.versions.node,
      protocol: "owner-hook-v1",
    });
  }
  const facts: Record<string, string> = {
    revision: manifest.revision,
    node: process.versions.node,
    protocol: "owner-hook-v1",
  };
  const canonicalRequire = createRequire(import.meta.url);
  for (const file of manifest.files) {
    const current = new URL(`../../dist/${file.file}`, import.meta.url);
    const bytes = await readFile(current);
    facts[`file:${file.file}`] = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  }
  for (const edge of manifest.bare) {
    if (isNodeBuiltin(edge.specifier) || isNiceevalSpecifier(edge.specifier)) continue;
    const provider = optionalProviderForRuntimeSpecifier(edge.specifier);
    if (provider !== undefined && provider !== selectedProvider) {
      facts[`bare:${edge.specifier}`] = "not-selected";
      continue;
    }
    let target: string;
    try {
      target = canonicalRequire.resolve(edge.specifier);
    } catch (cause) {
      const selected = provider === undefined ? "required" : `selected ${provider} provider`;
      throw new EvalRootPreflightError([{
        code: "eval-root.dependency-unverifiable",
        dependency: edge.specifier,
        message: `The ${selected} NiceEval runtime dependency ${JSON.stringify(edge.specifier)} cannot be resolved: ${cause instanceof Error ? cause.message : String(cause)}`,
        actions: ["Install the selected provider dependency in the consumer's NiceEval runtime tree."],
      }]);
    }
    const packageRoot = await nearestPackageRoot(target);
    if (packageRoot === undefined) {
      throw new EvalRootPreflightError([{
        code: "eval-root.dependency-unverifiable",
        dependency: edge.specifier,
        message: `The resolved runtime target for ${JSON.stringify(edge.specifier)} has no package root.`,
        actions: ["Repair the installed NiceEval runtime tree."],
      }]);
    }
    const manifestRecord = await readJsonRecord(join(packageRoot, "package.json"));
    const contentDigest = await cachedRuntimeTreeDigest(packageRoot);
    const entryDigest = `sha256:${createHash("sha256").update(await readFile(target)).digest("hex")}`;
    facts[`bare:${edge.specifier}`] = JSON.stringify({
      package: typeof manifestRecord.name === "string" ? manifestRecord.name : edge.specifier,
      ...(typeof manifestRecord.version === "string" ? { version: manifestRecord.version } : {}),
      contentDigest,
      entryDigest,
      edges: edge.edges,
    });
  }
  return Object.freeze(Object.fromEntries(Object.entries(facts).sort(([a], [b]) => a.localeCompare(b))));
}

interface RuntimeContractManifest {
  readonly revision: string;
  readonly files: readonly { readonly file: string; readonly sha256: string }[];
  readonly bare: readonly { readonly specifier: string; readonly edges: readonly string[] }[];
}

const runtimeTreeDigestCache = new Map<string, Promise<string>>();

async function cachedRuntimeTreeDigest(root: string): Promise<string> {
  const realRoot = await realpath(root);
  const cached = runtimeTreeDigestCache.get(realRoot);
  if (cached !== undefined) return cached;
  const pending = canonicalTreeDigest(realRoot);
  runtimeTreeDigestCache.set(realRoot, pending);
  try {
    return await pending;
  } catch (cause) {
    runtimeTreeDigestCache.delete(realRoot);
    throw cause;
  }
}

async function readRuntimeContractManifest(): Promise<RuntimeContractManifest | undefined> {
  const file = new URL("../../dist/runtime-contract-manifest.json", import.meta.url);
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!isPlainRecord(value) || typeof value.revision !== "string" || !Array.isArray(value.files)) return undefined;
    const files = value.files.flatMap((entry) => isPlainRecord(entry) && typeof entry.file === "string" && typeof entry.sha256 === "string"
      ? [{ file: entry.file, sha256: entry.sha256 }]
      : []);
    if (files.length !== value.files.length) return undefined;
    const bare = Array.isArray(value.bare)
      ? value.bare.flatMap((entry) => typeof entry === "string"
        ? [{ specifier: entry, edges: ["static"] }]
        : isPlainRecord(entry) && typeof entry.specifier === "string" && Array.isArray(entry.edges) && entry.edges.every((edge) => typeof edge === "string")
          ? [{ specifier: entry.specifier, edges: entry.edges as string[] }]
          : [])
      : [];
    if (Array.isArray(value.bare) && bare.length !== value.bare.length) return undefined;
    return Object.freeze({
      revision: value.revision,
      files: Object.freeze(files.map((entry) => Object.freeze(entry))),
      bare: Object.freeze(bare.map((entry) => Object.freeze({ ...entry, edges: Object.freeze([...entry.edges].sort()) }))),
    });
  } catch {
    return undefined;
  }
}

function optionalProviderForRuntimeSpecifier(specifier: string): string | undefined {
  if (specifier === "dockerode") return "docker";
  if (specifier === "e2b") return "e2b";
  if (specifier === "@vercel/sandbox") return "vercel";
  return undefined;
}

/** Public helper used by path consumers to enforce the owner boundary after realpath. */
export async function assertPathWithinEvalOwner(path: string, ownerRoot: string): Promise<string> {
  const owner = await realpath(ownerRoot);
  const lexical = resolve(path);
  let probe = lexical;
  let resolvedTarget: string | undefined;
  for (;;) {
    try {
      resolvedTarget = await realpath(probe);
      break;
    } catch {
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  // A target created later (download destination, generated build output) has
  // no realpath yet.  Its nearest existing ancestor is still the capability
  // boundary we can prove before creation; callers re-check when reading it.
  const target = resolvedTarget ?? probe;
  if (!isWithin(owner, target)) {
    throw new EvalRootPreflightError([{
      code: "eval-root.outside-package",
      evalFile: path,
      message: "An Eval-owned local input resolves outside its package owner.",
      actions: ["Keep Eval assets inside the package root."],
    }]);
  }
  return resolvedTarget ?? lexical;
}

function configIssue(mount: string | undefined, field: string, message: string): EvalRootIssue {
  return {
    code: "eval-root.config-invalid",
    ...(mount === undefined ? {} : { mount }),
    field,
    message,
    actions: ["Use evalRoots: { mount: { package, root? } } with ordinary slash paths."],
  };
}

function issueError(issue: EvalRootIssue): EvalRootPreflightError {
  return new EvalRootPreflightError([issue]);
}

function compareIssues(a: EvalRootIssue, b: EvalRootIssue): number {
  return `${a.mount ?? ""}\u0000${a.code}\u0000${a.field ?? ""}`.localeCompare(`${b.mount ?? ""}\u0000${b.code}\u0000${b.field ?? ""}`);
}

function compareEdges(a: EvalModuleEdge, b: EvalModuleEdge): number {
  return `${a.parent}\u0000${a.specifier}\u0000${a.target ?? ""}\u0000${(a.conditions ?? []).join("\u0000")}\u0000${a.kind}`.localeCompare(`${b.parent}\u0000${b.specifier}\u0000${b.target ?? ""}\u0000${(b.conditions ?? []).join("\u0000")}\u0000${b.kind}`);
}

function compareLimitations(
  a: { code: string; file?: string; detail?: string },
  b: { code: string; file?: string; detail?: string },
): number {
  return `${a.code}\u0000${a.file ?? ""}\u0000${a.detail ?? ""}`.localeCompare(`${b.code}\u0000${b.file ?? ""}\u0000${b.detail ?? ""}`);
}

function compareTransferPlan(a: StaticTransferPlanEntry, b: StaticTransferPlanEntry): number {
  return `${String(a.sequence).padStart(8, "0")}\u0000${a.kind}\u0000${a.source}\u0000${a.target}\u0000${a.digest}\u0000${(a.ignore ?? []).join("\u0000")}`
    .localeCompare(`${String(b.sequence).padStart(8, "0")}\u0000${b.kind}\u0000${b.source}\u0000${b.target}\u0000${b.digest}\u0000${(b.ignore ?? []).join("\u0000")}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isRegularSlashPath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.endsWith("/") || value.includes("\\") || PATH_CONTROL.test(value)) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("../"));
}

function relativePortable(root: string, file: string): string {
  const value = relative(root, file).split(sep).join("/");
  return value.length === 0 ? "." : value;
}

function parentPath(url: string | undefined): string | undefined {
  if (url === undefined || !url.startsWith("file:")) return undefined;
  try {
    return fileURLToPath(url);
  } catch {
    return undefined;
  }
}

function canonicalObservedPath(path: string): string {
  if (path.startsWith("node:")) return path;
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isHookOwnerFile(file: string): boolean {
  const state = hookInvocations.getStore();
  return state?.owners.some((owner) => isWithin(owner.root, file) && !relativePortable(owner.root, file).split("/").includes("node_modules")) === true;
}

function isHookTrackedModule(file: string): boolean {
  const state = hookInvocations.getStore();
  if (state === undefined) return false;
  try {
    return state.trackedModules.has(realpathSync(file));
  } catch {
    return state.trackedModules.has(resolve(file));
  }
}

/**
 * P4 is the first moment Node has resolved a dynamic/local specifier.  Reject an
 * owner escape here too, rather than trusting the P3 AST to see every import().
 * Bare package targets are deliberately excluded: their installed instance is a
 * separate dependency fact and may live outside the owner package.
 */
function assertHookLocalTargetOwned(parent: string, specifier: string, targetUrl: string): void {
  if (!(specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:"))) return;
  const owner = hookInvocations.getStore()?.owners.find((candidate) => isWithin(candidate.root, parent));
  if (owner === undefined || !targetUrl.startsWith("file:")) return;
  let target: string;
  try {
    target = realpathSync(fileURLToPath(targetUrl));
  } catch {
    // Let Node/tsx report a genuinely unresolved file.  A resolved target is the
    // only fact this guard needs to judge, and failure here must not fake an owner
    // escape for an unrelated resolver error.
    return;
  }
  if (isWithin(owner.root, target)) return;
  throw new EvalRootPreflightError([{
    code: "eval-root.outside-package",
    evalFile: parent,
    specifier,
    message: "A Node-resolved local Eval module escapes its installed package owner.",
    actions: ["Keep relative and file: Eval imports inside the package root."],
  }]);
}

function isNiceevalSpecifier(specifier: string): boolean {
  return specifier === "niceeval" || specifier.startsWith("niceeval/");
}

function observe(parent: string, specifier: string, target: string | undefined, conditions?: readonly string[]): void {
  const state = hookInvocations.getStore();
  if (state === undefined) return;
  state.nextObservation += 1;
  const targetPath = target === undefined ? undefined : target.startsWith("file:") ? fileURLToPath(target) : target;
  if (targetPath !== undefined && !targetPath.startsWith("node:")) {
    try {
      state.trackedModules.add(realpathSync(targetPath));
    } catch {
      state.trackedModules.add(resolve(targetPath));
    }
  }
  state.observations.push({
    sequence: state.nextObservation,
    parent,
    specifier,
    target: targetPath,
    ...(conditions === undefined || conditions.length === 0 ? {} : { conditions: Object.freeze([...conditions].sort()) }),
  });
}

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || (nodeModule.builtinModules as readonly string[]).includes(specifier);
}

/** CJS cache is the one observable pre-registration cache; ESM cache is opaque. */
function loadedOwnerFile(ownerRoot: string): string | undefined {
  const canonicalRequire = createRequire(import.meta.url) as unknown as {
    cache?: Record<string, unknown>;
  };
  return Object.keys(canonicalRequire.cache ?? {}).find((file) => isWithin(ownerRoot, resolve(file)));
}

async function consumerDependencyKeys(cwd: string): Promise<Map<string, string>> {
  const manifest = await readJsonRecord(join(cwd, "package.json"));
  const out = new Map<string, string>();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const values = manifest[field];
    if (!isPlainRecord(values)) continue;
    for (const [name, raw] of Object.entries(values)) if (typeof raw === "string") out.set(name, raw);
  }
  return out;
}

interface ConsumerLock {
  readonly kind: "pnpm" | "npm" | "yarn";
  readonly path: string;
  readonly text: string;
  readonly digest: string;
}

async function readConsumerLock(cwd: string): Promise<ConsumerLock | undefined> {
  const candidates: readonly [ConsumerLock["kind"], string][] = [
    ["pnpm", "pnpm-lock.yaml"],
    ["npm", "package-lock.json"],
    ["yarn", "yarn.lock"],
  ];
  for (const [kind, name] of candidates) {
    const path = join(cwd, name);
    if (!existsSync(path)) continue;
    const text = await readFile(path, "utf8");
    return Object.freeze({ kind, path, text, digest: hashText(text) });
  }
  return undefined;
}

async function locateInstalledPackage(cwd: string, dependency: string, mount: string): Promise<string> {
  const direct = join(cwd, "node_modules", ...dependency.split("/"));
  const candidates = [direct];
  try {
    const resolver = createRequire(join(cwd, "package.json"));
    candidates.push(dirname(resolver.resolve(`${dependency}/package.json`)));
  } catch {
    // Some packages intentionally do not export package.json; direct node_modules
    // lookup remains valid and does not import their package main.
  }
  for (const candidate of candidates) {
    if (!existsSync(join(candidate, "package.json"))) continue;
    return realpath(candidate);
  }
  throw issueError({
    code: "eval-root.package-uninstalled",
    mount,
    dependency,
    message: `Direct dependency "${dependency}" is declared but no installed package root was found.`,
    actions: ["Run the project's frozen install command."],
  });
}

async function readJsonRecord(path: string, mount?: string, dependency?: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isPlainRecord(parsed)) throw new Error("expected an object");
    return parsed;
  } catch (cause) {
    if (mount !== undefined) {
      throw issueError({
        code: "eval-root.installation-unverifiable",
        mount,
        dependency,
        packageFile: path,
        message: `Installed package metadata cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`,
        actions: ["Repair or reinstall the dependency."],
      });
    }
    throw cause;
  }
}

function packageProjection(manifest: Record<string, unknown>): ExternalEvalOrigin["package"] {
  const repository = repositoryUrl(manifest.repository);
  return Object.freeze({
    name: typeof manifest.name === "string" ? manifest.name : "(unnamed package)",
    ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
    ...(repository === undefined ? {} : { repository }),
    ...(typeof manifest.license === "string" ? { license: manifest.license } : {}),
  });
}

function repositoryUrl(value: unknown): string | undefined {
  const raw = typeof value === "string"
    ? value
    : isPlainRecord(value) && typeof value.url === "string" ? value.url : undefined;
  if (raw === undefined) return undefined;
  try {
    const url = new URL(raw.replace(/^git\+/, ""));
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return raw.replace(/^[^@/]+@/, "");
  }
}

async function installedIdentity(input: {
  readonly lock: ConsumerLock;
  readonly consumerRoot: string;
  readonly dependency: string;
  readonly declaration: string;
  readonly packageRoot: string;
  readonly mount: string;
}): Promise<InstalledPackageIdentity> {
  const { lock, consumerRoot, dependency, declaration, packageRoot, mount } = input;
  // The direct key must be visible in the lock selection.  This intentionally does
  // not guess a transitive match from an installed package version.
  if (!lockMentionsDependency(lock, dependency, declaration)) {
    throw issueError({
      code: "eval-root.installation-unverifiable",
      mount,
      dependency,
      message: `The ${lock.kind} lockfile cannot be matched to direct dependency "${dependency}".`,
      actions: ["Regenerate the lockfile with the project's package manager."],
    });
  }
  const lockfile = lock.kind;
  if (declaration.startsWith("workspace:")) {
    return Object.freeze({ kind: "workspace", contentDigest: await canonicalTreeDigest(packageRoot), lockfile, lockDigest: lock.digest });
  }
  if (declaration.startsWith("file:") || declaration.startsWith("link:")) {
    return Object.freeze({ kind: "file", contentDigest: await canonicalTreeDigest(packageRoot), lockfile, lockDigest: lock.digest });
  }
  const commit = gitCommit(declaration) ?? gitCommit(lock.text);
  if (isGitDeclaration(declaration) || commit !== undefined && /(?:git\+|github:|git:|git@|commit:)/i.test(lock.text)) {
    if (commit === undefined) {
      throw issueError({
        code: "eval-root.installation-unverifiable",
        mount,
        dependency,
        message: "The Git dependency has no immutable commit in the lock selection.",
        actions: ["Lock the dependency to a commit and reinstall."],
      });
    }
    return Object.freeze({ kind: "git", commit, lockfile, lockDigest: lock.digest });
  }
  let instance: globalThis.Record<string, string>;
  try {
    instance = await identifyDependencyInstance({
      consumerRoot,
      packageRoot,
      parentModule: join(consumerRoot, "package.json"),
      specifier: dependency,
      contentDigest: await canonicalTreeDigest(packageRoot),
    });
  } catch (cause) {
    if (cause instanceof EvalRootPreflightError) throw cause;
    throw issueError({
      code: "eval-root.installation-unverifiable",
      mount,
      dependency,
      message: `The lock selection has no portable identity for this package: ${cause instanceof Error ? cause.message : String(cause)}`,
      actions: ["Use a supported frozen registry/tarball install with immutable identity metadata."],
    });
  }
  const integrity = instance.integrity;
  if (instance.identityKind !== "registry" || integrity === undefined) {
    throw issueError({
      code: "eval-root.installation-unverifiable",
      mount,
      dependency,
      message: "The lock selection does not expose a portable registry/tarball integrity for this package.",
      actions: ["Use a supported frozen registry/tarball install with immutable integrity metadata."],
    });
  }
  return Object.freeze({
    kind: isTarballDeclaration(declaration) ? "tarball" : "registry",
    integrity,
    lockfile,
    lockDigest: lock.digest,
  });
}

/**
 * P4 dependency identity.  Node has already supplied the physical target via
 * the synchronous hook; adapters only map that concrete target into the
 * consumer lock's portable locator.  They never re-run a module resolver.
 */
async function identifyDependencyInstance(input: {
  readonly consumerRoot: string;
  readonly packageRoot: string;
  readonly parentModule: string;
  readonly specifier: string;
  readonly contentDigest: string;
}): Promise<globalThis.Record<string, string>> {
  const lock = await readConsumerLock(input.consumerRoot);
  if (lock === undefined) {
    throw dependencyIdentityError(input, "No supported consumer lockfile is available for the actual dependency target.");
  }
  const manifest = await readJsonRecord(join(input.packageRoot, "package.json"));
  const name = typeof manifest.name === "string" ? manifest.name : undefined;
  const version = typeof manifest.version === "string" ? manifest.version : undefined;
  if (name === undefined || version === undefined) {
    throw dependencyIdentityError(input, "The actual dependency target has no name/version package identity.");
  }
  const installPath = await portableInstalledPath(input.consumerRoot, input.packageRoot);
  const identity = lock.kind === "npm"
    ? await identifyNpmInstance(lock, input, name, version, installPath)
    : lock.kind === "pnpm"
      ? identifyPnpmInstance(lock, input, name, version, installPath)
      : identifyYarnInstance(lock, input, name, version, installPath);
  return Object.freeze(identity);
}

function dependencyIdentityError(
  input: { readonly parentModule: string; readonly specifier: string },
  message: string,
): EvalRootPreflightError {
  return new EvalRootPreflightError([{
    code: "eval-root.dependency-unverifiable",
    evalFile: input.parentModule,
    specifier: input.specifier,
    message,
    actions: ["Repair the consumer lockfile/install tree so this exact dependency instance has one portable locator."],
  }]);
}

async function portableInstalledPath(consumerRoot: string, packageRoot: string): Promise<string> {
  const root = await realpath(consumerRoot);
  const target = await realpath(packageRoot);
  const rel = relative(root, target).split(sep).join("/");
  if (rel !== "" && rel !== ".." && !rel.startsWith("../")) return rel;
  const normalized = target.split(sep).join("/");
  const marker = "/node_modules/.pnpm/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) return `virtual:${normalized.slice(markerIndex + marker.length)}`;
  const nodeModules = "/node_modules/";
  const nodeModulesIndex = normalized.lastIndexOf(nodeModules);
  if (nodeModulesIndex >= 0) return `node_modules/${normalized.slice(nodeModulesIndex + nodeModules.length)}`;
  return `external:${basename(target)}`;
}

async function identifyNpmInstance(
  lock: ConsumerLock,
  input: { readonly consumerRoot: string; readonly packageRoot: string; readonly parentModule: string; readonly specifier: string; readonly contentDigest: string },
  name: string,
  version: string,
  installPath: string,
): Promise<globalThis.Record<string, string>> {
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(lock.text);
    if (!isPlainRecord(value) || !isPlainRecord(value.packages)) throw new Error("package-lock has no packages map");
    parsed = value;
  } catch (cause) {
    throw dependencyIdentityError(input, `Cannot decode npm package-lock packages map: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const packages = parsed.packages as Record<string, unknown>;
  const candidates: { key: string; entry: Record<string, unknown> }[] = [];
  for (const [key, raw] of Object.entries(packages)) {
    if (!isPlainRecord(raw) || raw.version !== version) continue;
    if (raw.name !== undefined && raw.name !== name) continue;
    const candidate = key === "" ? input.consumerRoot : resolve(input.consumerRoot, key);
    try {
      if ((await realpath(candidate)) === (await realpath(input.packageRoot))) candidates.push({ key, entry: raw });
    } catch {
      // The lock may contain packages not materialised in this install.
    }
  }
  if (candidates.length !== 1) {
    throw dependencyIdentityError(input, `npm package-lock maps the actual ${name}@${version} target to ${candidates.length} logical package entries.`);
  }
  const candidate = candidates[0]!;
  const identity = lockEntryIdentity(candidate.entry, lock, input, input.contentDigest);
  return {
    locator: `npm:${candidate.key || "."}`,
    installPath,
    lockKind: lock.kind,
    lockDigest: lock.digest,
    ...identity,
  };
}

function identifyPnpmInstance(
  lock: ConsumerLock,
  input: { readonly parentModule: string; readonly specifier: string; readonly packageRoot: string; readonly contentDigest: string },
  name: string,
  version: string,
  installPath: string,
): globalThis.Record<string, string> {
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = parseYaml(lock.text);
    if (!isPlainRecord(value) || !isPlainRecord(value.packages)) throw new Error("pnpm lock has no packages map");
    parsed = value;
  } catch (cause) {
    throw dependencyIdentityError(input, `Cannot decode pnpm lock packages map: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const packages = parsed.packages as Record<string, unknown>;
  const virtualLocator = pnpmVirtualLocator(installPath);
  const candidates = Object.entries(packages)
    .filter(([key, entry]) => isPlainRecord(entry) && pnpmKeyMatches(key, name, version))
    .map(([key, entry]) => ({ key, entry: entry as Record<string, unknown> }));
  const narrowed = virtualLocator === undefined
    ? candidates
    : candidates.filter((candidate) => pnpmLocatorMatches(candidate.key, virtualLocator));
  const selected = narrowed.length === 1 ? narrowed[0] : candidates.length === 1 ? candidates[0] : undefined;
  if (selected === undefined) {
    throw dependencyIdentityError(input, `pnpm lock cannot uniquely map actual ${name}@${version} target${virtualLocator === undefined ? "" : ` (${virtualLocator})`}.`);
  }
  const identity = lockEntryIdentity(selected.entry, lock, input, input.contentDigest);
  return {
    locator: `pnpm:${virtualLocator ?? selected.key.replace(/^\//, "")}`,
    installPath,
    lockKind: lock.kind,
    lockDigest: lock.digest,
    ...identity,
  };
}

function identifyYarnInstance(
  lock: ConsumerLock,
  input: { readonly parentModule: string; readonly specifier: string; readonly packageRoot: string; readonly contentDigest: string },
  name: string,
  version: string,
  installPath: string,
): globalThis.Record<string, string> {
  const berry = parseYarnBerryEntry(lock.text, name, version);
  const classic = berry === undefined ? parseYarnClassicEntry(lock.text, name, version) : undefined;
  const selected = berry ?? classic;
  if (selected === undefined) {
    throw dependencyIdentityError(input, `Yarn lock cannot uniquely map actual ${name}@${version} target.`);
  }
  const identity = lockEntryIdentity(selected, lock, input, input.contentDigest);
  return {
    locator: `yarn:${installPath}`,
    installPath,
    lockKind: lock.kind,
    lockDigest: lock.digest,
    ...identity,
  };
}

function lockEntryIdentity(
  entry: Record<string, unknown>,
  lock: ConsumerLock,
  input: { readonly parentModule: string; readonly specifier: string; readonly packageRoot: string; readonly contentDigest: string },
  precomputedContentDigest: string,
): globalThis.Record<string, string> {
  const resolution = isPlainRecord(entry.resolution) ? entry.resolution : entry;
  const integrity = typeof resolution.integrity === "string"
    ? resolution.integrity
    : typeof entry.integrity === "string" ? entry.integrity
    : typeof entry.checksum === "string" ? `yarn:${entry.checksum}` : undefined;
  if (integrity !== undefined) return { identityKind: "registry", integrity };
  const resolved = typeof entry.resolved === "string"
    ? entry.resolved
    : typeof resolution.tarball === "string" ? resolution.tarball
    : typeof resolution.repo === "string" ? resolution.repo
    : typeof resolution.directory === "string" ? resolution.directory
    : typeof resolution.path === "string" ? resolution.path
    : typeof entry.resolution === "string" ? entry.resolution
    : undefined;
  const commit = resolved === undefined ? undefined : gitCommit(resolved);
  if (commit !== undefined) return { identityKind: "git", commit };
  if (resolved !== undefined && (resolved.startsWith("file:") || resolved.startsWith("link:") || resolved.startsWith("portal:") || resolved.startsWith("workspace:"))) {
    if (precomputedContentDigest.length === 0) {
      // This branch only runs for pnpm/yarn.  The content hash is asynchronous,
      // so callers that need it must not silently invent a registry identity.
      throw dependencyIdentityError(input, "A file/workspace dependency needs a content digest but its adapter did not provide one.");
    }
    return { identityKind: "file", contentDigest: precomputedContentDigest };
  }
  throw dependencyIdentityError(input, `The ${lock.kind} lock entry has no immutable integrity, Git commit, or file/workspace identity.`);
}

function pnpmVirtualLocator(installPath: string): string | undefined {
  const marker = ".pnpm/";
  const index = installPath.indexOf(marker);
  if (index < 0) return undefined;
  const rest = installPath.slice(index + marker.length);
  return rest.split("/node_modules/", 1)[0] || undefined;
}

function pnpmKeyMatches(key: string, name: string, version: string): boolean {
  const normalized = key.replace(/^\//, "");
  return normalized === `${name}@${version}` || normalized.startsWith(`${name}@${version}(`) ||
    normalized.startsWith(`${name}@${version}_`);
}

function pnpmLocatorMatches(key: string, locator: string): boolean {
  const normalized = key.replace(/^\//, "").replaceAll("/", "+").replace(/[()]/g, "_");
  return locator === normalized || locator.startsWith(`${normalized}_`) || locator.startsWith(`${normalized}(`);
}

function parseYarnBerryEntry(text: string, name: string, version: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = parseYaml(text);
    if (!isPlainRecord(value)) return undefined;
    const matches = Object.entries(value)
      .filter(([key, entry]) => key !== "__metadata" && isPlainRecord(entry) && entry.version === version && key.includes(`${name}@`))
      .map(([, entry]) => entry as Record<string, unknown>);
    return matches.length === 1 ? matches[0] : undefined;
  } catch {
    return undefined;
  }
}

function parseYarnClassicEntry(text: string, name: string, version: string): Record<string, unknown> | undefined {
  const blocks = text.split(/\n(?=\S)/g);
  const matches: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const [header = "", ...lines] = block.split("\n");
    if (!header.includes(`${name}@`)) continue;
    const foundVersion = lines.find((line) => /^\s*version\s+/.test(line))?.match(/version\s+["']?([^"'\s]+)["']?/);
    if (foundVersion?.[1] !== version) continue;
    const resolved = lines.find((line) => /^\s*resolved\s+/.test(line))?.match(/resolved\s+["']?([^"']+)["']?/);
    const integrity = lines.find((line) => /^\s*integrity\s+/.test(line))?.trim().split(/\s+/)[1];
    matches.push({
      ...(resolved?.[1] === undefined ? {} : { resolved: resolved[1] }),
      ...(integrity === undefined ? {} : { integrity }),
    });
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function lockMentionsDependency(lock: ConsumerLock, dependency: string, declaration: string): boolean {
  const escaped = escapeRegExp(dependency);
  if (new RegExp(`(^|[\\s'\"/])${escaped}([\\s'\":@/]|$)`, "m").test(lock.text)) return true;
  return lock.text.includes(declaration);
}

function isGitDeclaration(value: string): boolean {
  return /^(?:git\+|git:|github:|git@|https?:\/\/[^\s]+\.git(?:#|$))/i.test(value);
}

function isTarballDeclaration(value: string): boolean {
  return /(?:\.tgz|\.tar\.gz)(?:#|$)/i.test(value) || /^https?:\/\//i.test(value);
}

function gitCommit(value: string): string | undefined {
  const hash = value.match(/(?:#|commit:\s*|commit=)([0-9a-f]{7,64})\b/i)?.[1];
  return hash?.toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function canonicalTreeDigest(root: string): Promise<string> {
  const realRoot = await realpath(root);
  const digest = createHash("sha256");
  const visited = new Set<string>();
  const walk = async (current: string, rel: string): Promise<void> => {
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      const link = await readlink(current);
      const target = await realpath(resolve(dirname(current), link));
      if (!isWithin(realRoot, target)) throw new Error(`symlink ${rel} escapes package root`);
      digest.update(`link\0${rel}\0${relativePortable(realRoot, target)}\0`);
      if (!visited.has(target)) {
        visited.add(target);
        await walk(target, rel);
      }
      return;
    }
    if (info.isDirectory()) {
      if (rel !== "." && ignoredTreePath(rel)) return;
      digest.update(`dir\0${rel}\0`);
      const children = await readdir(current);
      for (const child of children.sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) {
        await walk(join(current, child), rel === "." ? child : `${rel}/${child}`);
      }
      return;
    }
    if (info.isFile()) {
      const bytes = await readFile(current);
      digest.update(`file\0${rel}\0${info.size}\0${createHash("sha256").update(bytes).digest("hex")}\0`);
      return;
    }
    throw new Error(`special file ${rel} cannot be included in a portable package identity`);
  };
  await walk(realRoot, ".");
  return digest.digest("hex");
}

function ignoredTreePath(rel: string): boolean {
  const segments = rel.split("/");
  if (segments.some((segment) => IGNORED_TREE_NAMES.has(segment))) return true;
  return segments.length >= 2 && segments[0] === ".yarn" && IGNORED_YARN_NAMES.has(segments[1]!);
}

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

async function resolveRelativeModule(from: string, specifier: string): Promise<string | undefined> {
  const base = resolve(from, specifier);
  const candidates = extname(base)
    ? [base]
    : [base, ...MODULE_EXTENSIONS.map((extension) => `${base}${extension}`), ...MODULE_EXTENSIONS.map((extension) => join(base, `index${extension}`))];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return realpath(candidate);
    } catch {
      // Try the next TypeScript/JavaScript extension.
    }
  }
  return undefined;
}

function isLocalModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:");
}

async function resolveOwnerLocalModule(from: string, specifier: string): Promise<string | undefined> {
  if (specifier.startsWith("file:")) {
    try {
      const path = fileURLToPath(specifier);
      return (await stat(path)).isFile() ? realpath(path) : undefined;
    } catch {
      return undefined;
    }
  }
  return resolveRelativeModule(from, specifier);
}

function resolveBareSpecifier(parent: string, specifier: string): string | undefined {
  try {
    return createRequire(pathToFileURL(parent).href).resolve(specifier);
  } catch {
    return undefined;
  }
}

async function nearestPackageRoot(file: string): Promise<string | undefined> {
  let current = dirname(file);
  for (;;) {
    if (existsSync(join(current, "package.json"))) return realpath(current);
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function portableBareTarget(target: string): string {
  const normalized = target.split(sep).join("/");
  const marker = "/node_modules/";
  const index = normalized.lastIndexOf(marker);
  return index === -1 ? basename(normalized) : normalized.slice(index + marker.length);
}

/**
 * Find the two public host-transfer calls without pretending to understand arbitrary
 * JavaScript.  A literal call becomes a reproducible plan entry; every other shape
 * remains legal for a fresh run but carries a `dynamic-transfer` limitation.
 */
async function collectStaticTransfer(
  call: ts.CallExpression,
  containingFile: string,
  ownerRoot: string,
  plan: StaticTransferPlanEntry[],
  limitation: (code: string, file: string, detail?: string) => void,
  conditional: boolean,
): Promise<void> {
  if (!ts.isPropertyAccessExpression(call.expression)) return;
  const method = call.expression.name.text;
  if (method !== "uploadFile" && method !== "uploadDirectory") return;
  if (conditional) {
    limitation("dynamic-transfer", containingFile, `${method} occurs under runtime control flow`);
    return;
  }
  const sourceNode = call.arguments[0];
  const source = sourceNode === undefined ? undefined : staticTransferSource(sourceNode, containingFile);
  if (source === undefined) {
    limitation("dynamic-transfer", containingFile, `${method} source is not a literal path or new URL(..., import.meta.url)`);
    return;
  }
  const targetNode = call.arguments[1];
  const target = targetNode === undefined && method === "uploadDirectory"
    ? "$WORKDIR"
    : targetNode !== undefined && ts.isStringLiteral(targetNode) ? targetNode.text : undefined;
  if (target === undefined) {
    limitation("dynamic-transfer", containingFile, `${method} target is not a literal path`);
    return;
  }
  const ignore = method === "uploadDirectory" ? staticIgnoreList(call.arguments[2]) : undefined;
  if (method === "uploadDirectory" && call.arguments[2] !== undefined && ignore === undefined) {
    limitation("dynamic-transfer", containingFile, "uploadDirectory ignore list is not a literal string array");
    return;
  }
  try {
    const realSource = await realpath(source);
    if (!isWithin(ownerRoot, realSource)) {
      throw new EvalRootPreflightError([{
        code: "eval-root.outside-package",
        evalFile: containingFile,
        message: `${method} source resolves outside the Eval owner package.`,
        actions: ["Keep Eval transfer inputs inside the owning project or package."],
      }]);
    }
    const info = await lstat(realSource);
    const kind = method === "uploadFile" ? "file" : "directory";
    if (kind === "file" && !info.isFile() || kind === "directory" && !info.isDirectory()) {
      limitation("dynamic-transfer", containingFile, `${method} source kind is not ${kind}`);
      return;
    }
    const digest = kind === "file"
      ? `sha256:${createHash("sha256").update(await readFile(realSource)).digest("hex")}`
      : `sha256:${await strictDirectoryDigest(realSource, ignore ?? [])}`;
    const entry: StaticTransferPlanEntry = Object.freeze({
      sequence: plan.length,
      kind,
      source: relativePortable(ownerRoot, realSource),
      target,
      digest,
      ...(ignore === undefined || ignore.length === 0 ? {} : { ignore: Object.freeze([...ignore]) }),
    });
    // Each syntactic call is an execution contract, including two adjacent
    // calls with identical source/target values.  The sequence lets Attempt
    // evidence prove that both were actually snapshotted and sent.
    plan.push(entry);
  } catch (cause) {
    if (cause instanceof EvalRootPreflightError) throw cause;
    limitation("dynamic-transfer", containingFile, `${method} source cannot be planned: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Any branch/loop can decide whether a literal transfer is performed this Attempt. */
function isRuntimeControlFlow(node: ts.Node): boolean {
  return ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) ||
    ts.isSwitchStatement(node) || ts.isCaseClause(node) || ts.isDefaultClause(node) || ts.isForStatement(node) ||
    ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) ||
    ts.isTryStatement(node) || ts.isCatchClause(node);
}

function isDynamicModuleCapability(specifier: string): boolean {
  return specifier === "node:vm" || specifier === "vm" || specifier === "node:worker_threads" ||
    specifier === "worker_threads" || specifier === "node:child_process" || specifier === "child_process";
}

function isDynamicModuleCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression) && node.expression.text === "createRequire") return true;
  return ts.isPropertyAccessExpression(node.expression) &&
    ((node.expression.name.text === "require" && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "module") ||
      node.expression.name.text === "createRequire");
}

/** Scope precision is not needed to stay safe: any local `require` binding makes literal CJS edges dynamic. */
function sourceHasPotentialRequireShadow(sourceFile: ts.SourceFile): boolean {
  let shadowed = false;
  const isRequireName = (name: ts.BindingName | ts.ModuleExportName | undefined): boolean =>
    name !== undefined && ts.isIdentifier(name) && name.text === "require";
  const visit = (node: ts.Node): void => {
    if (shadowed) return;
    if ((ts.isVariableDeclaration(node) && isRequireName(node.name)) ||
      (ts.isFunctionDeclaration(node) && isRequireName(node.name)) ||
      (ts.isClassDeclaration(node) && isRequireName(node.name)) ||
      (ts.isParameter(node) && isRequireName(node.name)) ||
      (ts.isImportSpecifier(node) && isRequireName(node.name)) ||
      (ts.isImportClause(node) && isRequireName(node.name)) ||
      (ts.isNamespaceImport(node) && isRequireName(node.name))) {
      shadowed = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return shadowed;
}

function staticTransferSource(node: ts.Expression, containingFile: string): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return resolve(dirname(containingFile), node.text);
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "URL") return undefined;
  const [first, second] = node.arguments ?? [];
  if (first === undefined || !ts.isStringLiteral(first) || second === undefined || !isImportMetaUrl(second)) return undefined;
  return fileURLToPath(new URL(first.text, pathToFileURL(containingFile)));
}

function isImportMetaUrl(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node) && node.name.text === "url" &&
    ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.expression.name.text === "meta";
}

function staticIgnoreList(node: ts.Expression | undefined): readonly string[] | undefined {
  if (node === undefined) return [];
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const property = node.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) && candidate.name.text === "ignore",
  );
  if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return undefined;
  const values: string[] = [];
  for (const element of property.initializer.elements) {
    if (!ts.isStringLiteral(element) && !ts.isNoSubstitutionTemplateLiteral(element)) return undefined;
    values.push(element.text);
  }
  return values;
}

/** Directory transfer hash; symlinks and special files are intentionally rejected. */
async function strictDirectoryDigest(root: string, ignore: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  const ignored = new Set(ignore);
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
      if (ignored.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const info = await lstat(path);
      if (info.isDirectory()) {
        hash.update(`d\0${relativePath}\0`);
        await walk(path, relativePath);
      } else if (info.isFile()) {
        hash.update(`f\0${relativePath}\0${info.size}\0`);
        hash.update(createHash("sha256").update(await readFile(path)).digest("hex"));
        hash.update("\0");
      } else if (info.isSymbolicLink()) {
        throw new Error(`directory transfer contains symbolic link ${relativePath}`);
      } else {
        throw new Error(`directory transfer contains special file ${relativePath}`);
      }
    }
  };
  await walk(root, "");
  return hash.digest("hex");
}
