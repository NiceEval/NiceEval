import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

import { Data, Effect, Predicate } from "effect";

import { OwnedProcess } from "./owned-process.ts";

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

export class InventoryError extends Data.TaggedError("InventoryError")<{
  readonly detail: string;
  readonly receipt: CaseInventoryReceiptV1;
}> {}

interface RawCase {
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

const collectVitest = (document: unknown): readonly RawCase[] => {
  if (!Array.isArray(document)) throw new Error("Vitest list --json output must be an array");
  return document.map((entry, index) => {
    const file = text(entry, "file") ?? text(entry, "filepath") ?? text(entry, "moduleId");
    const name = text(entry, "name") ?? text(entry, "fullName");
    if (file === undefined || name === undefined) throw new Error(`Vitest list entry ${index} is missing file/name`);
    const project = text(entry, "projectName") ?? text(entry, "project");
    return { file, titlePath: [name], ...(project === undefined ? {} : { project }) };
  });
};

const collectPlaywright = (document: unknown): readonly RawCase[] => {
  if (!Predicate.isObject(document)) throw new Error("Playwright JSON report must be an object");
  const output: RawCase[] = [];
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
  rawCases: readonly RawCase[],
): { readonly cases: readonly CollectedCaseV1[]; readonly findings: readonly string[]; readonly files: readonly string[] } => {
  const findings: string[] = [];
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
  };
};

const executorCommand = (executor: InventoryExecutor, nativeArgs: readonly string[]): readonly string[] =>
  executor === "vitest"
    ? ["pnpm", "exec", "vitest", "list", ...nativeArgs, "--json"]
    : ["pnpm", "exec", "playwright", "test", "--list", "--reporter=json", ...nativeArgs];

const versionCommand = (executor: InventoryExecutor): readonly string[] =>
  executor === "vitest"
    ? ["pnpm", "exec", "vitest", "--version"]
    : ["pnpm", "exec", "playwright", "--version"];

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
}

export const collectCaseInventory = Effect.fn("collectCaseInventory")(function* (options: InventoryOptions) {
  const cwd = resolve(options.cwd);
  const ownedProcess = yield* OwnedProcess;
  const argv = executorCommand(options.executor, options.nativeArgs);
  const [collection, versionResult] = yield* Effect.all([
    ownedProcess.run(argv, { cwd, output: "capture", stream: false }),
    ownedProcess.run(versionCommand(options.executor), { cwd, output: "capture", stream: false }),
  ], { concurrency: 2 });
  let version = "unknown";
  const findings: string[] = [];
  let rawCases: readonly RawCase[] = [];
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
  const unsigned = {
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
  const receipt: CaseInventoryReceiptV1 = { ...unsigned, digest: sha256(unsigned) };
  if (receipt.findings.length > 0) return yield* new InventoryError({ detail: receipt.findings.join("; "), receipt });
  return receipt;
});
