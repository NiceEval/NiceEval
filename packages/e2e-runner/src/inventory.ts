import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { Data, Effect, Predicate } from "effect";

import { OwnedProcess } from "./owned-process.js";

export const CASE_ID_PATTERN = /^necase_[0-9A-HJKMNP-TV-Z]{16}$/;
const TOKEN_LIKE_PATTERN = /necase_[A-Za-z0-9_-]+/g;
const CANONICAL_SUFFIX_PATTERN = / \[(necase_[0-9A-HJKMNP-TV-Z]{16})\]$/;

export type InventoryExecutor = "vitest" | "playwright";

export interface CollectedCaseV1 {
  readonly executor: InventoryExecutor;
  readonly repo: string;
  readonly path: string;
  readonly project?: string;
  readonly titlePath: readonly string[];
  readonly caseId: `necase_${string}`;
}

export interface CaseInventoryReceiptV1 {
  readonly format: "niceeval.e2e-case-inventory/v1";
  readonly executor: { readonly name: InventoryExecutor; readonly version: string };
  readonly repo: string;
  readonly argv: readonly string[];
  readonly checkout: string;
  readonly files: readonly string[];
  readonly cases: readonly CollectedCaseV1[];
  readonly bodyExecutions: 0;
  readonly forbiddenSetupExecutions: 0;
  readonly findings: readonly string[];
  readonly digest: `sha256:${string}`;
  readonly exit: number | null;
  readonly signal: string | null;
}

export interface CaseMigrationInventoryReceiptV1 {
  readonly format: "niceeval.e2e-case-migration-inventory/v1";
  readonly executor: { readonly name: InventoryExecutor; readonly version: string };
  readonly repo: string;
  readonly argv: readonly string[];
  readonly checkout: string;
  readonly files: readonly string[];
  readonly cases: readonly CollectedCaseV1[];
  readonly unassigned: readonly RawCollectedCaseV1[];
  readonly bodyExecutions: 0;
  readonly forbiddenSetupExecutions: 0;
  readonly findings: readonly string[];
  readonly digest: `sha256:${string}`;
  readonly exit: number | null;
  readonly signal: string | null;
}

export class InventoryError extends Data.TaggedError("InventoryError")<{
  readonly detail: string;
  readonly receipt: CaseInventoryReceiptV1 | CaseMigrationInventoryReceiptV1;
}> {}

export interface RawCollectedCaseV1 {
  readonly file: string;
  readonly project?: string;
  readonly titlePath: readonly string[];
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (Predicate.isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value: unknown): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

const text = (value: unknown, key: string): string | undefined =>
  Predicate.isObject(value) && Predicate.isString(value[key]) ? value[key] : undefined;

const array = (value: unknown, key: string): readonly unknown[] =>
  Predicate.isObject(value) && Array.isArray(value[key]) ? value[key] : [];

const parseJson = (stdout: string): unknown => JSON.parse(stdout.trim());

const collectVitest = (document: unknown): readonly RawCollectedCaseV1[] => {
  if (!Array.isArray(document)) throw new Error("Vitest list --json output must be an array");
  return document.map((entry, index) => {
    const file = text(entry, "file") ?? text(entry, "filepath") ?? text(entry, "moduleId");
    const name = text(entry, "name") ?? text(entry, "fullName");
    if (file === undefined || name === undefined) throw new Error(`Vitest list entry ${index} is missing file/name`);
    const project = text(entry, "projectName") ?? text(entry, "project");
    return { file, titlePath: [name], ...(project === undefined ? {} : { project }) };
  });
};

const collectPlaywright = (document: unknown): readonly RawCollectedCaseV1[] => {
  if (!Predicate.isObject(document)) throw new Error("Playwright JSON report must be an object");
  const output: RawCollectedCaseV1[] = [];
  const visitSuite = (suite: unknown, parents: readonly string[], inheritedFile?: string): void => {
    if (!Predicate.isObject(suite)) throw new Error("Playwright JSON report contains a non-object suite");
    const suiteTitle = text(suite, "title");
    const titlePath = suiteTitle === undefined || suiteTitle.length === 0 ? parents : [...parents, suiteTitle];
    const file = text(suite, "file") ?? inheritedFile;
    for (const spec of array(suite, "specs")) {
      if (!Predicate.isObject(spec)) throw new Error("Playwright JSON report contains a non-object spec");
      const title = text(spec, "title");
      const specFile = text(spec, "file") ?? file;
      if (title === undefined || specFile === undefined) throw new Error("Playwright JSON spec is missing title/file");
      const tests = array(spec, "tests");
      if (tests.length === 0) output.push({ file: specFile, titlePath: [...titlePath, title] });
      for (const test of tests) {
        const candidateProject = text(test, "projectName");
        const project = candidateProject === undefined || candidateProject.length === 0 ? undefined : candidateProject;
        output.push({ file: specFile, titlePath: [...titlePath, title], ...(project === undefined ? {} : { project }) });
      }
    }
    for (const child of array(suite, "suites")) visitSuite(child, titlePath, file);
  };
  for (const suite of array(document, "suites")) visitSuite(suite, []);
  const errors = array(document, "errors");
  if (errors.length > 0) throw new Error(`Playwright collection reported ${errors.length} error(s)`);
  return output;
};

const canonicalPath = (cwd: string, file: string): string => {
  const value = (isAbsolute(file) ? relative(cwd, file) : file).replaceAll("\\", "/");
  if (value.length === 0 || value === ".." || value.startsWith("../")) {
    throw new Error(`collected file is outside inventory cwd: ${file}`);
  }
  return value;
};

const validateCases = (
  executor: InventoryExecutor,
  repo: string,
  cwd: string,
  rawCases: readonly RawCollectedCaseV1[],
): { readonly cases: readonly CollectedCaseV1[]; readonly findings: readonly string[]; readonly files: readonly string[]; readonly tokenless: readonly RawCollectedCaseV1[] } => {
  const findings: string[] = [];
  const tokenless: RawCollectedCaseV1[] = [];
  const seen = new Map<string, string>();
  const files = new Set<string>();
  const cases: CollectedCaseV1[] = [];
  for (const raw of rawCases) {
    const path = canonicalPath(cwd, raw.file);
    files.add(path);
    const visibleTitle = raw.titlePath.at(-1) ?? "";
    const suffix = CANONICAL_SUFFIX_PATTERN.exec(visibleTitle);
    const tokenLikes = visibleTitle.match(TOKEN_LIKE_PATTERN) ?? [];
    if (suffix === null || tokenLikes.length !== 1 || !CASE_ID_PATTERN.test(suffix[1]!)) {
      findings.push(`InvalidCaseToken: ${path}: title must end in exactly one canonical [necase_...] token: ${JSON.stringify(visibleTitle)}`);
      if (tokenLikes.length === 0) tokenless.push({ ...raw, file: path });
      continue;
    }
    const caseId = suffix[1]! as `necase_${string}`;
    const prior = seen.get(caseId);
    if (prior !== undefined) {
      findings.push(`DuplicateCaseId: ${caseId} is collected by both ${prior} and ${path}`);
      continue;
    }
    seen.set(caseId, path);
    cases.push({ executor, repo, path, ...(raw.project === undefined ? {} : { project: raw.project }), titlePath: raw.titlePath, caseId });
  }
  return {
    cases: cases.sort((left, right) => left.path.localeCompare(right.path) || (left.project ?? "").localeCompare(right.project ?? "") || left.titlePath.join("\0").localeCompare(right.titlePath.join("\0"))),
    findings: findings.sort(),
    files: [...files].sort(),
    tokenless,
  };
};

interface ResolvedExecutorCli {
  readonly cli: string;
}

const executorPackages = (executor: InventoryExecutor): readonly string[] =>
  executor === "vitest" ? ["vitest"] : ["playwright", "@playwright/test"];

const resolveExecutorCli = (executor: InventoryExecutor, cwd: string): ResolvedExecutorCli => {
  const requireFromCwd = createRequire(resolve(cwd, "__niceeval_inventory__.cjs"));
  const failures: string[] = [];
  for (const packageName of executorPackages(executor)) {
    try {
      const manifestPath = requireFromCwd.resolve(`${packageName}/package.json`);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { readonly bin?: string | Readonly<Record<string, string>> };
      const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[executor];
      if (bin === undefined) {
        failures.push(`${packageName} does not declare a ${executor} CLI bin`);
        continue;
      }
      return { cli: resolve(dirname(manifestPath), bin) };
    } catch (cause) {
      failures.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  throw new Error(`could not resolve the ${executor} CLI from ${cwd}: ${failures.join("; ")}`);
};

const executorCommand = (executor: InventoryExecutor, cli: string, nativeArgs: readonly string[]): readonly string[] =>
  executor === "vitest"
    ? [process.execPath, cli, "list", ...nativeArgs, "--json"]
    : [process.execPath, cli, "test", "--list", "--reporter=json", ...nativeArgs];

const versionCommand = (cli: string): readonly string[] => [process.execPath, cli, "--version"];

const versionFrom = (executor: InventoryExecutor, stdout: string): string => {
  const match = executor === "vitest" ? /vitest\/(\S+)/.exec(stdout) : /Version\s+(\S+)/.exec(stdout);
  if (match?.[1] === undefined) throw new Error(`could not parse ${executor} version output`);
  return match[1];
};

export interface InventoryOptions {
  readonly executor: InventoryExecutor;
  readonly repo: string;
  readonly cwd: string;
  readonly checkout: string;
  readonly nativeArgs: readonly string[];
  readonly forMigration?: boolean;
}

export const collectCaseInventory = Effect.fn("collectCaseInventory")(function* (options: InventoryOptions) {
  const cwd = resolve(options.cwd);
  const ownedProcess = yield* OwnedProcess;
  let resolved: ResolvedExecutorCli;
  try {
    resolved = resolveExecutorCli(options.executor, cwd);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const unsigned = options.forMigration ? {
      format: "niceeval.e2e-case-migration-inventory/v1" as const,
      executor: { name: options.executor, version: "unknown" }, repo: options.repo,
      argv: [process.execPath, `<unresolved-${options.executor}-cli>`], checkout: options.checkout,
      files: [], cases: [], unassigned: [], bodyExecutions: 0 as const, forbiddenSetupExecutions: 0 as const,
      findings: [detail], exit: null, signal: null,
    } : {
      format: "niceeval.e2e-case-inventory/v1" as const,
      executor: { name: options.executor, version: "unknown" }, repo: options.repo,
      argv: [process.execPath, `<unresolved-${options.executor}-cli>`], checkout: options.checkout,
      files: [], cases: [], bodyExecutions: 0 as const, forbiddenSetupExecutions: 0 as const,
      findings: [detail], exit: null, signal: null,
    };
    const receipt: CaseInventoryReceiptV1 | CaseMigrationInventoryReceiptV1 = { ...unsigned, digest: sha256(unsigned) };
    return yield* new InventoryError({ detail, receipt });
  }
  const argv = executorCommand(options.executor, resolved.cli, options.nativeArgs);
  const [collection, versionResult] = yield* Effect.all([
    ownedProcess.run(argv, { cwd, output: "capture", stream: false }),
    ownedProcess.run(versionCommand(resolved.cli), { cwd, output: "capture", stream: false }),
  ], { concurrency: 2 });
  let version = "unknown";
  const findings: string[] = [];
  let rawCases: readonly RawCollectedCaseV1[] = [];
  if (versionResult.exitCode !== 0 || versionResult.signal !== null) findings.push(`${options.executor} version command failed`);
  else {
    try { version = versionFrom(options.executor, versionResult.stdout); }
    catch (cause) { findings.push(cause instanceof Error ? cause.message : String(cause)); }
  }
  if (collection.exitCode !== 0 || collection.signal !== null) {
    findings.push(`${options.executor} collection failed (exit=${String(collection.exitCode)}, signal=${String(collection.signal)})${collection.stderr.trim().length === 0 ? "" : `: ${collection.stderr.trim()}`}`);
  } else {
    try {
      const document = parseJson(collection.stdout);
      rawCases = options.executor === "vitest" ? collectVitest(document) : collectPlaywright(document);
    } catch (cause) {
      findings.push(`collection receipt decode failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  const validated = validateCases(options.executor, options.repo, cwd, rawCases);
  findings.push(...validated.findings);
  const unsigned = options.forMigration ? {
    format: "niceeval.e2e-case-migration-inventory/v1" as const,
    executor: { name: options.executor, version },
    repo: options.repo,
    argv,
    checkout: options.checkout,
    files: validated.files,
    cases: validated.cases,
    unassigned: validated.tokenless,
    bodyExecutions: 0 as const,
    forbiddenSetupExecutions: 0 as const,
    findings: findings.filter((finding) => !validated.tokenless.some((raw) => finding === `InvalidCaseToken: ${raw.file}: title must end in exactly one canonical [necase_...] token: ${JSON.stringify(raw.titlePath.at(-1) ?? "")}`)),
    exit: collection.exitCode,
    signal: collection.signal,
  } : {
    format: "niceeval.e2e-case-inventory/v1" as const,
    executor: { name: options.executor, version },
    repo: options.repo,
    argv,
    checkout: options.checkout,
    files: validated.files,
    cases: validated.cases,
    bodyExecutions: 0 as const,
    forbiddenSetupExecutions: 0 as const,
    findings: findings.sort(),
    exit: collection.exitCode,
    signal: collection.signal,
  };
  const receipt: CaseInventoryReceiptV1 | CaseMigrationInventoryReceiptV1 = { ...unsigned, digest: sha256(unsigned) };
  if (receipt.findings.length > 0) return yield* new InventoryError({ detail: receipt.findings.join("; "), receipt });
  return receipt;
});
