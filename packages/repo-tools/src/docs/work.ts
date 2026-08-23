import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Effect } from "effect";

import {
  DocsConflictError,
  type DocsDomainError,
  DocsFileError,
  DocsPathError,
  DocsProcessError,
  DocsWorkError,
  errorMessage,
} from "./errors.js";
import {
  type DocsCheck,
  type DocsFinalizeReceipt,
  type DocsWorkItem,
  DocsWorkItemSchema,
  type DocsWorkReceipt,
  DocsWorkReceiptSchema,
  type DocsWorkRun,
  DocsWorkRunSchema,
  type DocsWorkShowReceipt,
} from "./model.js";
import {
  absolutePath,
  atomicWriteJson,
  decodeUnknown,
  pathExists,
  readJson,
  REPOSITORY_ROOT,
  runCommand,
  runSuccessfulCommand,
  sha256,
  withFileLock,
} from "./runtime.js";

const RUNS_ROOT = ".repo-tools/docs-runs";
const SHARED_FINALIZER_PATHS = [
  "docs/README.md",
  "docs/concepts.md",
  "docs/writing-rules.json",
] as const;

function validateWorkId(kind: "run" | "item", value: string): Effect.Effect<string, DocsPathError> {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
    ? Effect.succeed(value)
    : Effect.fail(new DocsPathError({
      path: value,
      reason: `${kind} ID must contain only letters, numbers, underscore, and hyphen`,
    }));
}

function git(args: readonly string[]): Effect.Effect<string, DocsProcessError> {
  return Effect.try({
    try: () => execFileSync("git", args, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(),
    catch: (error) => new DocsProcessError({
      command: ["git", ...args].join(" "),
      message: errorMessage(error),
    }),
  });
}

export function normalizeOwnedPath(input: string): Effect.Effect<string, DocsPathError> {
  return Effect.try({
    try: () => {
      if (input.trim() === "" || isAbsolute(input) || input.includes("\\")) {
        throw new Error("path must be a non-empty repository-relative POSIX path");
      }
      const normalized = posix.normalize(input.replace(/^\.\//, ""));
      if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
        throw new Error("path cannot escape the repository");
      }
      const absolute = absolutePath(normalized);
      if (!existsSync(absolute)) throw new Error("path does not exist");
      const real = realpathSync(absolute);
      const realRelative = relative(REPOSITORY_ROOT, real).split(sep).join("/");
      if (realRelative === ".." || realRelative.startsWith("../") || isAbsolute(realRelative)) {
        throw new Error("path resolves outside the repository");
      }
      return normalized;
    },
    catch: (error) => new DocsPathError({ path: input, reason: errorMessage(error) }),
  });
}

function within(path: string, owner: string): boolean {
  return path === owner || path.startsWith(`${owner.replace(/\/$/, "")}/`);
}

function scopesOverlap(left: string, right: string): boolean {
  return within(left, right) || within(right, left);
}

function checkForScope(path: string): DocsCheck | undefined {
  if (within(path, "docs")) return { kind: "docs-lint", paths: [path] };
  if (within(path, "apps/docs-site")) return { kind: "docs-site-lint", paths: [path] };
  return undefined;
}

function itemId(path: string, seen: Set<string>): string {
  const stem = basename(path).replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase() || "docs";
  let candidate = `${stem}-${sha256(path).slice(0, 8)}`;
  let suffix = 2;
  while (seen.has(candidate)) candidate = `${stem}-${sha256(path).slice(0, 8)}-${suffix++}`;
  seen.add(candidate);
  return candidate;
}

export function planDocsWorkItems(
  runId: string,
  baseCommit: string,
  scopes: readonly string[],
): Effect.Effect<readonly DocsWorkItem[], DocsConflictError> {
  const conflicts: string[] = [];
  for (let left = 0; left < scopes.length; left++) {
    const current = scopes[left];
    if (current === undefined) continue;
    if (SHARED_FINALIZER_PATHS.some((shared) => scopesOverlap(current, shared))) {
      conflicts.push(`${current} owns shared finalizer state`);
    }
    if (checkForScope(current) === undefined) conflicts.push(`${current} has no documentation lint owner`);
    for (let right = left + 1; right < scopes.length; right++) {
      const other = scopes[right];
      if (other !== undefined && scopesOverlap(current, other)) {
        conflicts.push(`${current} overlaps ${other}`);
      }
    }
  }
  if (conflicts.length > 0) {
    return Effect.fail(new DocsConflictError({ operation: "prepare docs work", conflicts }));
  }
  const ids = new Set<string>();
  return Effect.succeed(scopes.map((path) => ({
    format: "niceeval.docs-work-item/v1" as const,
    runId,
    id: itemId(path, ids),
    goal: `Update ${path}`,
    baseCommit,
    read: ["docs/README.md"],
    write: [path],
    blockedBy: [],
    checks: [checkForScope(path)!],
    finalizerOnly: [...SHARED_FINALIZER_PATHS],
  })));
}

function writePreparedRun(
  run: DocsWorkRun,
  items: readonly DocsWorkItem[],
): Effect.Effect<void, DocsFileError> {
  const runs = absolutePath(RUNS_ROOT);
  const target = join(runs, run.runId);
  return Effect.scoped(Effect.gen(function*() {
    const temporary = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          mkdirSync(runs, { recursive: true });
          return mkdtempSync(join(runs, `.${run.runId}.`));
        },
        catch: (error) => new DocsFileError({
          operation: "create staged docs run",
          path: RUNS_ROOT,
          message: errorMessage(error),
        }),
      }),
      (path) => Effect.sync(() => {
        try {
          rmSync(path, { recursive: true, force: true });
        } catch {
          // Preserve the primary result.
        }
      }),
    );
    yield* Effect.try({
      try: () => {
        if (existsSync(target)) throw new Error(`run ${run.runId} already exists`);
        mkdirSync(join(temporary, "items"), { recursive: true });
        mkdirSync(join(temporary, "receipts"), { recursive: true });
        writeFileSync(join(temporary, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
        for (const item of items) {
          writeFileSync(join(temporary, "items", `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`, "utf8");
        }
        renameSync(temporary, target);
      },
      catch: (error) => new DocsFileError({
        operation: "commit docs run",
        path: `${RUNS_ROOT}/${run.runId}`,
        message: errorMessage(error),
      }),
    });
  }));
}

export function prepareDocsWork(
  rawScopes: readonly string[],
  requestedBase: string | undefined,
): Effect.Effect<DocsWorkRun, DocsDomainError> {
  return Effect.gen(function*() {
    if (rawScopes.length === 0) {
      return yield* new DocsWorkError({ operation: "prepare", reasons: ["at least one --scope is required"] });
    }
    const scopes = yield* Effect.forEach(rawScopes, normalizeOwnedPath);
    const baseCommit = yield* git(["rev-parse", "--verify", `${requestedBase ?? "HEAD"}^{commit}`]);
    const dirty = yield* git(["status", "--porcelain=v1", "--untracked-files=normal"]);
    if (dirty !== "") {
      return yield* new DocsWorkError({
        operation: "prepare",
        reasons: ["the repository is dirty; commit the base or prepare from a clean checkout"],
      });
    }
    const runId = `docs-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${sha256(`${baseCommit}\0${scopes.join("\0")}`).slice(0, 8)}`;
    const items = yield* planDocsWorkItems(runId, baseCommit, scopes);
    const run: DocsWorkRun = {
      format: "niceeval.docs-work-run/v1",
      runId,
      baseCommit,
      createdAt: new Date().toISOString(),
      items: items.map(({ id }) => id),
    };
    yield* withFileLock(`${RUNS_ROOT}/.prepare.lock`, writePreparedRun(run, items));
    return run;
  });
}

function runPath(runId: string, suffix: string): string {
  return `${RUNS_ROOT}/${runId}/${suffix}`;
}

function loadRun(runId: string): Effect.Effect<DocsWorkRun, DocsDomainError> {
  return validateWorkId("run", runId).pipe(
    Effect.flatMap((safeRunId) => readJson(runPath(safeRunId, "run.json"), DocsWorkRunSchema)),
  );
}

function loadItem(runId: string, itemId: string): Effect.Effect<DocsWorkItem, DocsDomainError> {
  return Effect.all({
    runId: validateWorkId("run", runId),
    itemId: validateWorkId("item", itemId),
  }).pipe(
    Effect.flatMap(({ itemId: safeItemId, runId: safeRunId }) =>
      readJson(runPath(safeRunId, `items/${safeItemId}.json`), DocsWorkItemSchema)),
  );
}

export function showDocsWork(runId: string): Effect.Effect<DocsWorkShowReceipt, DocsDomainError> {
  return Effect.gen(function*() {
    const run = yield* loadRun(runId);
    const items = yield* Effect.forEach(run.items, (id) => loadItem(runId, id));
    return { format: "niceeval.docs-work-show/v1", run, items };
  });
}

function walkFiles(path: string): readonly string[] {
  const absolute = absolutePath(path);
  if (!existsSync(absolute)) return [];
  if (!lstatSync(absolute).isDirectory()) return [path];
  return (readdirSync(absolute, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const parent = entry.parentPath ?? dirname(join(absolute, entry.name));
      return relative(REPOSITORY_ROOT, join(parent, entry.name)).split(sep).join("/");
    })
    .sort();
}

export function digestPaths(paths: readonly string[]): Effect.Effect<string, DocsFileError> {
  return Effect.try({
    try: () => {
      const entries = [...new Set(paths.flatMap(walkFiles))].sort();
      return sha256(entries.map((path) => `${path}\0${sha256(readFileSync(absolutePath(path)))}\n`).join(""));
    },
    catch: (error) => new DocsFileError({
      operation: "digest docs paths",
      path: paths.join(","),
      message: errorMessage(error),
    }),
  });
}

function nulPaths(value: Buffer): readonly string[] {
  return value.toString("utf8").split("\0").filter((path) => path !== "");
}

function changedSince(base: string): Effect.Effect<readonly string[], DocsProcessError> {
  return Effect.try({
    try: () => {
      const tracked = execFileSync("git", ["diff", "--name-only", "-z", base, "--"], {
        cwd: REPOSITORY_ROOT,
        encoding: "buffer",
      });
      const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
        cwd: REPOSITORY_ROOT,
        encoding: "buffer",
      });
      return [...new Set([...nulPaths(tracked), ...nulPaths(untracked)])].sort();
    },
    catch: (error) => new DocsProcessError({
      command: `git diff --name-only ${base}`,
      message: errorMessage(error),
    }),
  });
}

function runOneCheck(check: DocsCheck): Effect.Effect<DocsWorkReceipt["checks"][number], DocsProcessError, CommandExecutor> {
  const invocation = check.kind === "docs-lint"
    ? ["run", "lint:docs"]
    : check.kind === "docs-site-lint"
    ? ["run", "lint:docs-site"]
    : ["run", check.script, "--", ...check.args];
  return runCommand("pnpm", invocation, { inherit: true }).pipe(
    Effect.map((exitCode) => ({
      kind: check.kind,
      status: exitCode === 0 ? "passed" as const : "failed" as const,
      summary: exitCode === 0
        ? `pnpm ${invocation.join(" ")} passed`
        : `pnpm ${invocation.join(" ")} exited with status ${exitCode}`,
    })),
  );
}

function receiptPath(runId: string, itemId: string): string {
  return runPath(runId, `receipts/${itemId}.json`);
}

function readVerifiedDependency(runId: string, itemId: string): Effect.Effect<DocsWorkReceipt, DocsDomainError> {
  return readJson(receiptPath(runId, itemId), DocsWorkReceiptSchema).pipe(
    Effect.flatMap((receipt) => receipt.status === "verified"
      ? Effect.succeed(receipt)
      : Effect.fail(new DocsWorkError({
        operation: "check dependency",
        runId,
        itemId,
        reasons: ["dependency receipt is not verified"],
      }))),
  );
}

export function checkDocsWork(
  runId: string,
  itemId: string,
  mode: { readonly _tag: "report" } | { readonly _tag: "verify"; readonly receipt: string },
): Effect.Effect<DocsWorkReceipt, DocsDomainError, CommandExecutor> {
  return Effect.gen(function*() {
    const run = yield* loadRun(runId);
    const item = yield* loadItem(runId, itemId);
    if (item.runId !== run.runId || item.baseCommit !== run.baseCommit) {
      return yield* new DocsWorkError({
        operation: "check",
        runId,
        itemId,
        reasons: ["work item does not match its owning run"],
      });
    }
    yield* Effect.forEach(item.blockedBy, (dependency) => readVerifiedDependency(runId, dependency));
    const allItems = yield* Effect.forEach(run.items, (id) => loadItem(runId, id));
    const changed = yield* changedSince(run.baseCommit);
    const allowedRunPaths = allItems.flatMap(({ write, finalizerOnly }) => [...write, ...finalizerOnly]);
    const outOfRun = changed.filter((path) =>
      (within(path, "docs") || within(path, "apps/docs-site")) &&
      !allowedRunPaths.some((owner) => within(path, owner)));
    const changedRead = changed.filter((path) => item.read.some((owner) => within(path, owner)));
    const reasons = [
      ...outOfRun.map((path) => `out-of-run documentation change: ${path}`),
      ...changedRead.map((path) => `previous-result input changed: ${path}`),
    ];
    if (reasons.length > 0) {
      return yield* new DocsWorkError({ operation: "check", runId, itemId, reasons });
    }
    const changedPaths = changed.filter((path) => item.write.some((owner) => within(path, owner)));
    const readDigest = yield* digestPaths(item.read);
    const writeDigest = yield* digestPaths(item.write);

    let reportedReceipt: string | undefined;
    if (mode._tag === "verify") {
      const normalizedReceipt = yield* normalizeOwnedPath(mode.receipt);
      const prior = yield* readJson(normalizedReceipt, DocsWorkReceiptSchema);
      const mismatches = [
        ...(prior.status !== "reported" ? ["receipt is not reported"] : []),
        ...(prior.runId !== runId ? ["receipt run ID differs"] : []),
        ...(prior.itemId !== itemId ? ["receipt item ID differs"] : []),
        ...(prior.baseCommit !== run.baseCommit ? ["receipt base differs"] : []),
        ...(prior.readDigest !== readDigest ? ["receipt read digest is stale"] : []),
        ...(prior.writeDigest !== writeDigest ? ["receipt write digest is stale"] : []),
      ];
      if (mismatches.length > 0) {
        return yield* new DocsWorkError({ operation: "verify", runId, itemId, reasons: mismatches });
      }
      reportedReceipt = normalizedReceipt;
    }

    const checks = yield* Effect.forEach(item.checks, runOneCheck, { concurrency: 1 });
    const receipt: DocsWorkReceipt = {
      format: "niceeval.docs-work-receipt/v1",
      runId,
      itemId,
      baseCommit: run.baseCommit,
      checkedAt: new Date().toISOString(),
      readDigest,
      writeDigest,
      changedPaths,
      status: mode._tag === "report" ? "reported" : "verified",
      ...(reportedReceipt === undefined ? {} : { reportedReceipt }),
      checks,
    };
    const failed = checks.filter(({ status }) => status === "failed");
    if (failed.length > 0) {
      return yield* new DocsWorkError({
        operation: mode._tag === "report" ? "report" : "verify",
        runId,
        itemId,
        reasons: failed.map(({ summary }) => summary),
        receipt,
      });
    }
    yield* withFileLock(
      runPath(runId, `.locks/${itemId}.lock`),
      atomicWriteJson(receiptPath(runId, itemId), receipt),
    );
    return receipt;
  });
}

export function finalizeDocsWork(
  runId: string,
): Effect.Effect<DocsFinalizeReceipt, DocsDomainError, CommandExecutor> {
  return Effect.gen(function*() {
    const run = yield* loadRun(runId);
    const items = yield* Effect.forEach(run.items, (id) => loadItem(runId, id));
    const receipts = yield* Effect.forEach(items, (item) => readJson(
      receiptPath(runId, item.id),
      DocsWorkReceiptSchema,
    ).pipe(Effect.mapError(() => new DocsWorkError({
      operation: "finalize",
      runId,
      itemId: item.id,
      reasons: ["verified receipt is missing or invalid"],
    }))));
    const blockers: string[] = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const receipt = receipts[index];
      if (item === undefined || receipt === undefined) continue;
      if (receipt.status !== "verified") blockers.push(`${item.id}: receipt is not verified`);
      if (receipt.baseCommit !== run.baseCommit) blockers.push(`${item.id}: base differs`);
      const readDigest = yield* digestPaths(item.read);
      const writeDigest = yield* digestPaths(item.write);
      if (receipt.readDigest !== readDigest) blockers.push(`${item.id}: read digest is stale`);
      if (receipt.writeDigest !== writeDigest) blockers.push(`${item.id}: write digest is stale`);
      for (const dependency of item.blockedBy) {
        const dependencyReceipt = receipts.find(({ itemId }) => itemId === dependency);
        if (dependencyReceipt?.status !== "verified") blockers.push(`${item.id}: dependency ${dependency} is not verified`);
      }
    }
    if (blockers.length > 0) {
      return yield* new DocsWorkError({ operation: "finalize", runId, reasons: blockers });
    }
    yield* runSuccessfulCommand("pnpm", ["lint"], { inherit: true }).pipe(
      Effect.mapError((error) => new DocsWorkError({
        operation: "finalize lint",
        runId,
        reasons: [error.message],
      })),
    );
    return {
      format: "niceeval.docs-work-finalize/v1",
      runId,
      status: "finalized",
      receipts: receipts.map((receipt) => receiptPath(runId, receipt.itemId)),
      checks: [{ kind: "command", status: "passed", summary: "pnpm lint passed" }],
    };
  });
}
