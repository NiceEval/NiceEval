import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { Cause, Data, Effect, Exit, Result, Schema, SchemaIssue } from "effect";

import { TraceRecoveryConflict, TraceRecoveryRequired } from "./errors.js";
import type { RepoRef, ValidatedRepoRefTarget } from "./ref.js";

const GENERATION_FILE = "generation";
const LOCK_FILE = "publication.lock";
const COORDINATION_ID_FILE = "coordination-id";
const JOURNAL_FILE = "publication-journal.json";
const LOCK_CONFLICT_EXIT = 75;
const MAXIMUM_OWNER_BYTES = 32 * 1024 * 1024;
const SUPPORTED_LOCAL_FILESYSTEMS = new Set([
  0x0000ef53, // ext2/3/4
  0x58465342, // XFS
  0x9123683e, // Btrfs
  0x01021994, // tmpfs
  0x2fc12fc1, // ZFS
  0x794c7630, // overlayfs
  0xf2f52010, // F2FS
  0x858458f6, // ramfs
]);

export class TraceMutationError extends Data.TaggedError("TraceMutationError")<{
  readonly operation: string;
  readonly phase:
    | "git-private"
    | "read"
    | "lock"
    | "preimage"
    | "publish"
    | "generation"
    | "rollback"
    | "journal"
    | "cleanup"
    | "capacity";
  readonly path?: string;
  readonly message: string;
}> {}

export type TraceCoordinationError = TraceMutationError | TraceRecoveryRequired | TraceRecoveryConflict;

export interface TraceMutationPreimage {
  readonly path: string;
  readonly digest: string;
}

export interface TraceMutationPreparation {
  readonly generation: number;
  readonly snapshotDigest: string;
  readonly target?: ValidatedRepoRefTarget;
  readonly preimages?: readonly TraceMutationPreimage[];
  readonly regressionOwners?: readonly string[];
}

export interface TraceMutationPlanned<A, Changes> {
  readonly bytes: string;
  readonly value: A;
  readonly changes: Changes;
}

export interface TraceMutationReceipt<A, Changes> {
  readonly format: "niceeval.docs-trace/relation-mutation/v1";
  readonly operation: string;
  readonly dryRun: boolean;
  readonly owner: string;
  readonly target?: RepoRef;
  readonly targetKind?: ValidatedRepoRefTarget["kind"];
  readonly targetOwner?: string;
  readonly snapshotDigest: string;
  readonly generation: number;
  readonly nextGeneration: number;
  readonly changed: boolean;
  readonly headCommit: string;
  readonly preimageDigest: string | null;
  readonly plannedBytesDigest: string;
  readonly changes: Changes;
  readonly value: A;
}

export type TraceDirectoryManifestEntry =
  | { readonly kind: "directory"; readonly path: string; readonly mode: number }
  | {
      readonly kind: "file";
      readonly path: string;
      readonly mode: number;
      readonly byteLength: number;
      readonly digest: string;
    };

export interface TraceDirectoryPublication {
  readonly kind: "new-feedback-directory" | "new-docs-directory";
  readonly stagePath: string;
  readonly targetPath: string;
  readonly expectedManifest?: readonly TraceDirectoryManifestEntry[];
}

export interface TraceMutationOptions<A, Changes, E, R> {
  readonly root: string;
  readonly operation: string;
  readonly ownerPath: string;
  readonly dryRun: boolean;
  readonly prepareUnderLease: Effect.Effect<TraceMutationPreparation, E | TraceCoordinationError, R>;
  readonly plan: (input: {
    readonly source: string | undefined;
    readonly headCommit: string;
    readonly preparation: TraceMutationPreparation;
  }) => Effect.Effect<TraceMutationPlanned<A, Changes>, E, R>;
  readonly publication?: TraceDirectoryPublication;
}

export interface TraceRecoveryReceipt {
  readonly format: "niceeval.docs-trace/recovery/v1";
  readonly operation: "trace-recover";
  readonly recovered: boolean;
  readonly action: "none" | "discarded-unpublished" | "rolled-back" | "completed" | "finished-discard";
  readonly owner?: string;
  readonly generation: number;
}

interface TraceLease {
  readonly descriptor: number;
  readonly directory: string;
  readonly mode: "shared" | "exclusive";
}

interface FileSnapshotAbsent { readonly kind: "absent" }
interface FileSnapshotPresent {
  readonly kind: "file";
  readonly bytes: Buffer;
  readonly digest: string;
  readonly byteLength: number;
  readonly mode: number;
}
type FileSnapshot = FileSnapshotAbsent | FileSnapshotPresent;

const NonEmptyTrimmedString = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));
const DigestSchema = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u));
const ModeSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const GenerationSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const IdentityPartSchema = Schema.Struct({ path: Schema.String, device: Schema.String, inode: Schema.String });
const WorktreeIdentitySchema = Schema.Struct({
  root: IdentityPartSchema,
  gitDir: IdentityPartSchema,
  commonDir: IdentityPartSchema,
  coordinationId: Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/u)),
});
const ManifestEntrySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("directory"), path: Schema.String, mode: ModeSchema }),
  Schema.Struct({
    kind: Schema.Literal("file"),
    path: Schema.String,
    mode: ModeSchema,
    byteLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    digest: DigestSchema,
  }),
]);
const JournalCommon = {
  format: Schema.Literal("niceeval.docs-trace/publication-journal/v1"),
  token: Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/u)),
  operation: NonEmptyTrimmedString,
  owner: NonEmptyTrimmedString,
  oldGeneration: GenerationSchema,
  newGeneration: GenerationSchema,
  snapshotDigest: DigestSchema,
  headCommit: NonEmptyTrimmedString,
  indexEntry: Schema.NullOr(Schema.String),
  identity: WorktreeIdentitySchema,
  createdAt: NonEmptyTrimmedString,
  process: Schema.Struct({ pid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)), host: NonEmptyTrimmedString }),
} as const;
const FileJournalSchema = Schema.Struct({
  ...JournalCommon,
  publication: Schema.Literal("file-replace"),
  temporary: NonEmptyTrimmedString,
  preimage: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("absent") }),
    Schema.Struct({
      kind: Schema.Literal("file"),
      bytesBase64: Schema.String,
      digest: DigestSchema,
      byteLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      mode: ModeSchema,
    }),
  ]),
  planned: Schema.Struct({ digest: DigestSchema, byteLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), mode: ModeSchema }),
});
const DirectoryJournalSchema = Schema.Struct({
  ...JournalCommon,
  publication: Schema.Literals(["new-feedback-directory", "new-docs-directory"]),
  phase: Schema.Literals(["prepared", "discarding-stage"]),
  stage: NonEmptyTrimmedString,
  target: NonEmptyTrimmedString,
  manifest: Schema.Array(ManifestEntrySchema).pipe(Schema.check(Schema.isMinLength(1))),
});
const JournalSchema = Schema.Union([FileJournalSchema, DirectoryJournalSchema]);
type FileJournal = typeof FileJournalSchema.Type;
type DirectoryJournal = typeof DirectoryJournalSchema.Type;
type PublicationJournal = typeof JournalSchema.Type;
type ManifestEntry = typeof ManifestEntrySchema.Type;
type WorktreeIdentity = typeof WorktreeIdentitySchema.Type;

function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
function mutationFailure(operation: string, phase: TraceMutationError["phase"], cause: unknown, path?: string): TraceMutationError {
  return new TraceMutationError({ operation, phase, ...(path === undefined ? {} : { path }), message: message(cause) });
}

export function traceDigest(bytes: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function slash(path: string): string { return path.split(sep).join("/"); }

function repositoryPath(root: string, path: string, operation: string): string {
  if (path.length === 0 || isAbsolute(path) || path.includes("\\") || path.includes("\0")) {
    throw mutationFailure(operation, "read", "path must be a canonical repository-relative path", path);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw mutationFailure(operation, "read", "path contains an unsafe segment", path);
  }
  const repository = resolve(root);
  const target = resolve(repository, path);
  if (!target.startsWith(`${repository}${sep}`)) throw mutationFailure(operation, "read", "path escapes repository root", path);
  return target;
}

function gitOutput(root: string, operation: string, args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], {
      cwd: resolve(root), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024,
    }).trimEnd();
  } catch (cause) { throw mutationFailure(operation, "git-private", cause, args.join(" ")); }
}

export function tracePrivateDirectory(root: string): Effect.Effect<string, TraceMutationError> {
  return Effect.try({
    try: () => {
      const output = gitOutput(root, "trace", ["rev-parse", "--git-path", "niceeval/docs-trace"]).trim();
      if (output.length === 0) throw new Error("git returned an empty private Trace path");
      return isAbsolute(output) ? output : resolve(root, output);
    },
    catch: (cause) => cause instanceof TraceMutationError ? cause : mutationFailure("trace", "git-private", cause),
  });
}

function readGenerationPath(path: string): number {
  if (!existsSync(path)) return 0;
  const source = readFileSync(path, "utf8").trim();
  if (!/^(?:0|[1-9]\d*)$/u.test(source)) throw new Error(`invalid Trace generation ${JSON.stringify(source)}`);
  const generation = Number(source);
  if (!Number.isSafeInteger(generation)) throw new Error("Trace generation exceeds the safe integer range");
  return generation;
}

export function readTraceGeneration(root: string): Effect.Effect<number, TraceMutationError> {
  return tracePrivateDirectory(root).pipe(Effect.flatMap((directory) => Effect.try({
    try: () => readGenerationPath(resolve(directory, GENERATION_FILE)),
    catch: (cause) => mutationFailure("trace", "read", cause, GENERATION_FILE),
  })));
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function durableReplace(path: string, bytes: string, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const descriptor = openSync(temporary, "wx", mode);
    try { fchmodSync(descriptor, mode); writeFileSync(descriptor, bytes); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally { rmSync(temporary, { force: true }); }
}

function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if ((statSync(directory).mode & 0o7777) !== 0o700) chmodSync(directory, 0o700);
}

function assertSupportedCoordination(root: string, directory: string, operation: string): void {
  const repository = statSync(resolve(root));
  const coordination = statSync(directory);
  if (repository.dev !== coordination.dev) throw mutationFailure(
    operation,
    "lock",
    "repository owners and Git-private Trace coordination must be on the same filesystem",
    directory,
  );
  for (const path of [resolve(root), directory]) {
    const type = statfsSync(path).type >>> 0;
    if (!SUPPORTED_LOCAL_FILESYSTEMS.has(type)) throw mutationFailure(
      operation,
      "lock",
      `unsupported or non-local filesystem type 0x${type.toString(16)}`,
      path,
    );
  }
}

function acquireLease(root: string, mode: TraceLease["mode"], operation: string, create: boolean): Effect.Effect<TraceLease | undefined, TraceMutationError> {
  return tracePrivateDirectory(root).pipe(Effect.flatMap((directory) => Effect.try({
    try: () => {
      const lockPath = resolve(directory, LOCK_FILE);
      if (!create && !existsSync(lockPath)) return undefined;
      ensurePrivateDirectory(directory);
      assertSupportedCoordination(root, directory, operation);
      const descriptor = openSync(lockPath, "a+", 0o600);
      try {
        if ((fstatSync(descriptor).mode & 0o7777) !== 0o600) fchmodSync(descriptor, 0o600);
        const result = spawnSync("flock", [
          mode === "shared" ? "--shared" : "--exclusive", "--nonblock", "--conflict-exit-code", String(LOCK_CONFLICT_EXIT), "3",
        ], { stdio: ["ignore", "ignore", "pipe", descriptor] });
        if (result.error !== undefined) throw result.error;
        if (result.status === LOCK_CONFLICT_EXIT) throw new TraceMutationError({ operation, phase: "lock", path: lockPath, message: `${mode} Trace lease is busy` });
        if (result.status !== 0) throw new Error(`flock helper exited ${String(result.status)}: ${result.stderr?.toString("utf8").trim() ?? "unknown error"}`);
        return { descriptor, directory, mode };
      } catch (cause) { closeSync(descriptor); throw cause; }
    },
    catch: (cause) => cause instanceof TraceMutationError ? cause : mutationFailure(operation, "lock", cause, LOCK_FILE),
  })));
}

function releaseLease(lease: TraceLease, operation: string): Effect.Effect<void, TraceMutationError> {
  return Effect.try({ try: () => closeSync(lease.descriptor), catch: (cause) => mutationFailure(operation, "cleanup", cause, LOCK_FILE) });
}

function withLease<A, E, R>(
  root: string,
  mode: TraceLease["mode"],
  operation: string,
  create: boolean,
  use: (lease: TraceLease | undefined) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | TraceMutationError, R> {
  return Effect.uninterruptibleMask((restore) => Effect.gen(function*() {
    const lease = yield* acquireLease(root, mode, operation, create);
    const useExit = yield* Effect.exit(restore(use(lease)));
    if (lease === undefined) {
      if (Exit.isFailure(useExit)) return yield* Effect.failCause(useExit.cause);
      return useExit.value;
    }
    const releaseExit = yield* Effect.exit(releaseLease(lease, operation));
    if (Exit.isFailure(releaseExit)) {
      if (Exit.isFailure(useExit)) return yield* Effect.failCause(Cause.combine(useExit.cause, releaseExit.cause));
      return yield* Effect.failCause(releaseExit.cause);
    }
    if (Exit.isFailure(useExit)) return yield* Effect.failCause(useExit.cause);
    return useExit.value;
  }));
}

function journalPath(directory: string): string { return resolve(directory, JOURNAL_FILE); }

export function withTraceReadLease<A, E, R>(root: string, read: () => Effect.Effect<A, E, R>): Effect.Effect<A, E | TraceMutationError | TraceRecoveryRequired, R> {
  return withLease(root, "shared", "read", true, (lease) => Effect.gen(function*() {
    const directory = lease?.directory ?? (yield* tracePrivateDirectory(root));
    const path = journalPath(directory);
    if (existsSync(path)) return yield* new TraceRecoveryRequired({ path, nextStep: "pnpm trace recover" });
    return yield* read();
  }));
}

export function isTraceMutationActive(root: string): Effect.Effect<boolean, TraceMutationError> {
  return Effect.gen(function*() {
    const result = yield* Effect.result(acquireLease(root, "shared", "read", true));
    if (Result.isFailure(result)) {
      if (result.failure.phase === "lock" && result.failure.message.includes("busy")) return true;
      return yield* result.failure;
    }
    if (result.success === undefined) return false;
    yield* releaseLease(result.success, "read");
    return false;
  });
}

export function withStableTraceRead<A, E, R>(
  root: string,
  read: (generation: number) => Effect.Effect<A, E, R>,
): Effect.Effect<{ readonly generation: number; readonly value: A }, E | TraceCoordinationError, R> {
  return withTraceReadLease(root, () => Effect.gen(function*() {
    const generation = yield* readTraceGeneration(root);
    const value = yield* read(generation);
    const after = yield* readTraceGeneration(root);
    if (after !== generation) return yield* new TraceMutationError({ operation: "read", phase: "preimage", path: GENERATION_FILE, message: "Trace generation changed while compiling" });
    return { generation, value };
  }));
}

function identityPart(path: string): { readonly path: string; readonly device: string; readonly inode: string } {
  const canonical = realpathSync(path);
  const status = statSync(canonical);
  return { path: canonical, device: String(status.dev), inode: String(status.ino) };
}

function coordinationId(directory: string, create: boolean): string {
  const path = resolve(directory, COORDINATION_ID_FILE);
  if (!existsSync(path)) {
    if (!create) throw new Error("coordination identity is missing");
    durableReplace(path, `${randomUUID()}\n`, 0o600);
  }
  const value = readFileSync(path, "utf8").trim();
  if (!/^[0-9a-f-]{36}$/u.test(value)) throw new Error("coordination identity is invalid");
  return value;
}

function worktreeIdentity(root: string, directory: string, create: boolean, operation: string): WorktreeIdentity {
  try {
    return {
      root: identityPart(resolve(root)),
      gitDir: identityPart(gitOutput(root, operation, ["rev-parse", "--path-format=absolute", "--git-dir"]).trim()),
      commonDir: identityPart(gitOutput(root, operation, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()),
      coordinationId: coordinationId(directory, create),
    };
  } catch (cause) {
    if (cause instanceof TraceMutationError) throw cause;
    throw mutationFailure(operation, "journal", cause, directory);
  }
}

function sameIdentity(left: WorktreeIdentity, right: WorktreeIdentity): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function headCommit(root: string, operation: string): string { return gitOutput(root, operation, ["rev-parse", "HEAD"]).trim(); }
function indexEntry(root: string, owner: string, operation: string): string | null {
  const output = gitOutput(root, operation, ["ls-files", "--stage", "--", owner]);
  return output.length === 0 ? null : output;
}

function readFileSnapshot(path: string, operation: string): FileSnapshot {
  try {
    if (!existsSync(path)) return { kind: "absent" };
    const status = lstatSync(path);
    if (!status.isFile() || status.isSymbolicLink()) throw new Error("owner must be a regular, non-symlink file");
    if (status.size > MAXIMUM_OWNER_BYTES) throw mutationFailure(operation, "capacity", `owner exceeds ${MAXIMUM_OWNER_BYTES} bytes`, path);
    const bytes = readFileSync(path);
    return { kind: "file", bytes, digest: traceDigest(bytes), byteLength: bytes.byteLength, mode: status.mode & 0o7777 };
  } catch (cause) {
    if (cause instanceof TraceMutationError) throw cause;
    throw mutationFailure(operation, "read", cause, path);
  }
}

function fileSnapshotMatches(snapshot: FileSnapshot, expected: FileJournal["preimage"] | FileJournal["planned"]): boolean {
  if ("kind" in expected && expected.kind === "absent") return snapshot.kind === "absent";
  return snapshot.kind === "file" && snapshot.digest === expected.digest && snapshot.byteLength === expected.byteLength && snapshot.mode === expected.mode;
}

function preimageForJournal(snapshot: FileSnapshot): FileJournal["preimage"] {
  return snapshot.kind === "absent" ? { kind: "absent" } : {
    kind: "file", bytesBase64: snapshot.bytes.toString("base64"), digest: snapshot.digest, byteLength: snapshot.byteLength, mode: snapshot.mode,
  };
}

function manifest(root: string, operation: string): readonly ManifestEntry[] | undefined {
  if (!existsSync(root)) return undefined;
  const entries: ManifestEntry[] = [];
  const visit = (absolute: string, path: string): void => {
    const status = lstatSync(absolute);
    if (status.isSymbolicLink()) throw new Error(`${path}: symlink is forbidden`);
    if (status.isDirectory()) {
      entries.push({ kind: "directory", path, mode: status.mode & 0o7777 });
      for (const child of readdirSync(absolute).sort()) visit(resolve(absolute, child), path === "." ? child : `${path}/${child}`);
      return;
    }
    if (!status.isFile()) throw new Error(`${path}: special file is forbidden`);
    const bytes = readFileSync(absolute);
    entries.push({ kind: "file", path, mode: status.mode & 0o7777, byteLength: bytes.byteLength, digest: traceDigest(bytes) });
  };
  try { visit(root, "."); return entries.sort((left, right) => left.path.localeCompare(right.path)); }
  catch (cause) { throw mutationFailure(operation, "read", cause, root); }
}

function sameManifest(
  left: readonly TraceDirectoryManifestEntry[] | undefined,
  right: readonly TraceDirectoryManifestEntry[],
): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}
function manifestIsSubset(current: readonly ManifestEntry[] | undefined, planned: readonly ManifestEntry[]): boolean {
  if (current === undefined) return true;
  const expected = new Map(planned.map((entry) => [entry.path, entry]));
  return current.every((entry) => JSON.stringify(entry) === JSON.stringify(expected.get(entry.path)));
}

function validateJournal(root: string, directory: string, input: unknown): PublicationJournal {
  const decoded = Schema.decodeUnknownResult(JournalSchema, { errors: "all", onExcessProperty: "error" })(input);
  if (Result.isFailure(decoded)) throw new TraceRecoveryConflict({ path: journalPath(directory), message: SchemaIssue.makeFormatterDefault()(decoded.failure.issue) });
  const journal = decoded.success;
  if (journal.newGeneration !== journal.oldGeneration + 1) throw new TraceRecoveryConflict({ path: journalPath(directory), message: "journal generations are not consecutive" });
  repositoryPath(root, journal.owner, "recover");
  if (journal.publication === "file-replace") {
    repositoryPath(root, journal.temporary, "recover");
    if (dirname(journal.temporary) !== dirname(journal.owner) || !basename(journal.temporary).includes(journal.token)) {
      throw new TraceRecoveryConflict({ path: journalPath(directory), message: "file temporary path does not belong to the owner transaction" });
    }
    if (journal.preimage.kind === "file") {
      const bytes = Buffer.from(journal.preimage.bytesBase64, "base64");
      if (bytes.byteLength !== journal.preimage.byteLength || traceDigest(bytes) !== journal.preimage.digest || bytes.byteLength > MAXIMUM_OWNER_BYTES) {
        throw new TraceRecoveryConflict({ path: journalPath(directory), message: "file preimage bytes do not match their receipt" });
      }
    }
  } else {
    const stage = repositoryPath(root, journal.stage, "recover");
    const target = repositoryPath(root, journal.target, "recover");
    const feedbackDirectory = journal.publication === "new-feedback-directory" &&
      /^feedback\/\.stage-[0-9a-f-]{36}$/u.test(journal.stage) &&
      /^feedback\/(?!\.)[^/]+$/u.test(journal.target);
    const docsDirectory = journal.publication === "new-docs-directory" &&
      /^docs\/design\/\.stage-[0-9a-f-]{36}$/u.test(journal.stage) &&
      /^docs\/design\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(journal.target);
    if ((!feedbackDirectory && !docsDirectory) || journal.owner !== `${journal.target}/README.md` ||
      dirname(stage) !== dirname(target)) {
      throw new TraceRecoveryConflict({ path: journalPath(directory), message: "directory publication paths are invalid" });
    }
    const keys = journal.manifest.map((entry) => entry.path);
    if (journal.manifest[0]?.path !== "." || new Set(keys).size !== keys.length || journal.manifest.some((entry) =>
      entry.path !== "." && (entry.path.startsWith("/") || entry.path.includes("\\") || entry.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")))) {
      throw new TraceRecoveryConflict({ path: journalPath(directory), message: "directory manifest paths are invalid" });
    }
  }
  return journal;
}

function readJournal(root: string, directory: string): PublicationJournal | undefined {
  const path = journalPath(directory);
  if (!existsSync(path)) return undefined;
  try { return validateJournal(root, directory, JSON.parse(readFileSync(path, "utf8")) as unknown); }
  catch (cause) {
    if (cause instanceof TraceRecoveryConflict) throw cause;
    throw new TraceRecoveryConflict({ path, message: message(cause) });
  }
}
function writeJournal(directory: string, journal: PublicationJournal): void { durableReplace(journalPath(directory), `${JSON.stringify(journal, null, 2)}\n`, 0o600); }
function removeJournal(directory: string): void { rmSync(journalPath(directory), { force: true }); fsyncDirectory(directory); }

function removeExactFile(path: string, expected: FileJournal["planned"], operation: string): void {
  const current = readFileSnapshot(path, operation);
  if (current.kind === "absent") return;
  if (!fileSnapshotMatches(current, expected)) throw new TraceRecoveryConflict({ path, message: "transaction temporary file changed" });
  rmSync(path);
  fsyncDirectory(dirname(path));
}

function writePreparedFile(path: string, bytes: Buffer, mode: number): void {
  const descriptor = openSync(path, "wx", mode);
  try { fchmodSync(descriptor, mode); writeFileSync(descriptor, bytes); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  fsyncDirectory(dirname(path));
}

function restoreFile(root: string, journal: FileJournal): void {
  const owner = repositoryPath(root, journal.owner, "recover");
  const temporary = repositoryPath(root, journal.temporary, "recover");
  if (journal.preimage.kind === "absent") { rmSync(owner); fsyncDirectory(dirname(owner)); return; }
  const bytes = Buffer.from(journal.preimage.bytesBase64, "base64");
  if (existsSync(temporary)) removeExactFile(temporary, journal.planned, "recover");
  writePreparedFile(temporary, bytes, journal.preimage.mode);
  if (!fileSnapshotMatches(readFileSnapshot(owner, "recover"), journal.planned)) {
    throw new TraceRecoveryConflict({ path: journal.owner, message: "owner changed immediately before rollback" });
  }
  renameSync(temporary, owner);
  fsyncDirectory(dirname(owner));
}

function discardStage(root: string, directory: string, journal: DirectoryJournal): void {
  const stage = repositoryPath(root, journal.stage, "recover");
  const target = repositoryPath(root, journal.target, "recover");
  if (existsSync(target)) throw new TraceRecoveryConflict({ path: journal.target, message: "target reappeared while discarding stage" });
  const current = manifest(stage, "recover");
  if (!manifestIsSubset(current, journal.manifest)) throw new TraceRecoveryConflict({ path: journal.stage, message: "discarding stage is not an exact remaining subset of its manifest" });
  if (current !== undefined) {
    const ordered = [...current].sort((left, right) => {
      const depth = right.path.split("/").length - left.path.split("/").length;
      if (depth !== 0) return depth;
      if (left.kind !== right.kind) return left.kind === "file" ? -1 : 1;
      return right.path.localeCompare(left.path);
    });
    for (const entry of ordered) {
      const absolute = entry.path === "." ? stage : resolve(stage, entry.path);
      const status = lstatSync(absolute);
      if (entry.kind === "file") {
        if (!status.isFile() || status.isSymbolicLink()) throw new TraceRecoveryConflict({ path: journal.stage, message: `${entry.path} changed while discarding` });
        const bytes = readFileSync(absolute);
        if ((status.mode & 0o7777) !== entry.mode || bytes.byteLength !== entry.byteLength || traceDigest(bytes) !== entry.digest) {
          throw new TraceRecoveryConflict({ path: journal.stage, message: `${entry.path} changed while discarding` });
        }
        rmSync(absolute);
      } else {
        if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o7777) !== entry.mode || readdirSync(absolute).length > 0) {
          throw new TraceRecoveryConflict({ path: journal.stage, message: `${entry.path} changed while discarding` });
        }
        rmdirSync(absolute);
      }
      fsyncDirectory(dirname(absolute));
    }
  }
  if (existsSync(stage)) throw new TraceRecoveryConflict({ path: journal.stage, message: "stage remained after exact discard" });
  fsyncDirectory(dirname(stage));
  removeJournal(directory);
}

function verifyRecoveryIdentity(root: string, directory: string, journal: PublicationJournal): void {
  if (journal.process.host !== hostname()) {
    throw new TraceRecoveryConflict({ path: journalPath(directory), message: "journal belongs to another host" });
  }
  if (!sameIdentity(worktreeIdentity(root, directory, false, "recover"), journal.identity)) {
    throw new TraceRecoveryConflict({ path: journalPath(directory), message: "worktree or Git identity changed while a journal was active" });
  }
}
function verifyRecoveryGit(root: string, journal: PublicationJournal): void {
  if (headCommit(root, "recover") !== journal.headCommit || indexEntry(root, journal.owner, "recover") !== journal.indexEntry) {
    throw new TraceRecoveryConflict({ path: journal.owner, message: "HEAD or owner Git index entry changed while a journal was active" });
  }
}

function recoverFileJournal(root: string, directory: string, journal: FileJournal): TraceRecoveryReceipt {
  verifyRecoveryIdentity(root, directory, journal);
  const generation = readGenerationPath(resolve(directory, GENERATION_FILE));
  const owner = repositoryPath(root, journal.owner, "recover");
  const temporary = repositoryPath(root, journal.temporary, "recover");
  const ownerState = readFileSnapshot(owner, "recover");
  const temporaryState = readFileSnapshot(temporary, "recover");
  if (generation === journal.newGeneration) {
    if (!fileSnapshotMatches(ownerState, journal.planned) || temporaryState.kind !== "absent") throw new TraceRecoveryConflict({ path: journal.owner, message: "committed file publication no longer matches its journal" });
    removeJournal(directory);
    return { format: "niceeval.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "completed", owner: journal.owner, generation };
  }
  if (generation !== journal.oldGeneration) throw new TraceRecoveryConflict({ path: GENERATION_FILE, message: "generation is neither the journal old nor new value" });
  verifyRecoveryGit(root, journal);
  if (fileSnapshotMatches(ownerState, journal.preimage)) {
    if (temporaryState.kind !== "absent") removeExactFile(temporary, journal.planned, "recover");
    removeJournal(directory);
    return { format: "niceeval.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "discarded-unpublished", owner: journal.owner, generation };
  }
  if (fileSnapshotMatches(ownerState, journal.planned) && temporaryState.kind === "absent") {
    restoreFile(root, journal);
    removeJournal(directory);
    return { format: "niceeval.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "rolled-back", owner: journal.owner, generation };
  }
  throw new TraceRecoveryConflict({ path: journal.owner, message: "file publication state does not match a safe recovery transition" });
}

function recoverDirectoryJournal(root: string, directory: string, journal: DirectoryJournal): TraceRecoveryReceipt {
  verifyRecoveryIdentity(root, directory, journal);
  const generation = readGenerationPath(resolve(directory, GENERATION_FILE));
  const stage = repositoryPath(root, journal.stage, "recover");
  const target = repositoryPath(root, journal.target, "recover");
  if (journal.phase === "discarding-stage") {
    if (generation !== journal.oldGeneration) throw new TraceRecoveryConflict({ path: GENERATION_FILE, message: "discard phase requires the old generation" });
    verifyRecoveryGit(root, journal);
    discardStage(root, directory, journal);
    return { format: "niceeval.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "finished-discard", owner: journal.owner, generation };
  }
  const stageManifest = manifest(stage, "recover");
  const targetManifest = manifest(target, "recover");
  if (generation === journal.newGeneration) {
    if (stageManifest !== undefined || !sameManifest(targetManifest, journal.manifest)) throw new TraceRecoveryConflict({ path: journal.target, message: "committed directory publication no longer matches its journal" });
    removeJournal(directory);
    return { format: "niceeval.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "completed", owner: journal.owner, generation };
  }
  if (generation !== journal.oldGeneration) throw new TraceRecoveryConflict({ path: GENERATION_FILE, message: "generation is neither the journal old nor new value" });
  verifyRecoveryGit(root, journal);
  if (sameManifest(stageManifest, journal.manifest) && targetManifest === undefined) {
    const discarding = { ...journal, phase: "discarding-stage" as const };
    writeJournal(directory, discarding);
    discardStage(root, directory, discarding);
    return { format: "niceeval.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "discarded-unpublished", owner: journal.owner, generation };
  }
  if (stageManifest === undefined && sameManifest(targetManifest, journal.manifest)) {
    if (existsSync(stage)) throw new TraceRecoveryConflict({ path: journal.stage, message: "stage appeared immediately before rollback" });
    renameSync(target, stage);
    fsyncDirectory(dirname(target));
    const discarding = { ...journal, phase: "discarding-stage" as const };
    writeJournal(directory, discarding);
    discardStage(root, directory, discarding);
    return { format: "niceeval.docs-trace/recovery/v1", operation: "trace-recover", recovered: true, action: "rolled-back", owner: journal.owner, generation };
  }
  throw new TraceRecoveryConflict({ path: journal.target, message: "directory publication state does not match a safe recovery transition" });
}

function recoverUnderLease(root: string, directory: string): TraceRecoveryReceipt {
  const journal = readJournal(root, directory);
  const generation = readGenerationPath(resolve(directory, GENERATION_FILE));
  if (journal === undefined) return { format: "niceeval.docs-trace/recovery/v1", operation: "trace-recover", recovered: false, action: "none", generation };
  return journal.publication === "file-replace" ? recoverFileJournal(root, directory, journal) : recoverDirectoryJournal(root, directory, journal);
}

export function recoverTrace(root: string): Effect.Effect<TraceRecoveryReceipt, TraceCoordinationError> {
  return withLease(root, "exclusive", "trace-recover", true, (lease) => Effect.try({
    try: () => {
      if (lease === undefined) throw new Error("exclusive Trace lease was not created");
      worktreeIdentity(root, lease.directory, true, "trace-recover");
      return recoverUnderLease(root, lease.directory);
    },
    catch: (cause) => cause instanceof TraceMutationError || cause instanceof TraceRecoveryConflict ? cause : mutationFailure("trace-recover", "rollback", cause),
  }));
}

function writeGeneration(directory: string, generation: number, operation: string): void {
  try { durableReplace(resolve(directory, GENERATION_FILE), `${generation}\n`, 0o600); }
  catch (cause) { throw mutationFailure(operation, "generation", cause, GENERATION_FILE); }
}
function verifyAdditionalPreimages(operation: string, preimages: readonly TraceMutationPreimage[]): void {
  for (const preimage of preimages) {
    const state = readFileSnapshot(preimage.path, operation);
    if (state.kind !== "file" || state.digest !== preimage.digest) throw mutationFailure(operation, "preimage", "preimage changed during publication", preimage.path);
  }
}
function samePreparation(left: TraceMutationPreparation, right: TraceMutationPreparation): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function receiptFor<A, Changes>(input: {
  readonly options: TraceMutationOptions<A, Changes, unknown, unknown>;
  readonly preparation: TraceMutationPreparation;
  readonly planned: TraceMutationPlanned<A, Changes>;
  readonly source: FileSnapshot;
  readonly headCommit: string;
  readonly changed: boolean;
}): TraceMutationReceipt<A, Changes> {
  return {
    format: "niceeval.docs-trace/relation-mutation/v1", operation: input.options.operation, dryRun: input.options.dryRun, owner: input.options.ownerPath,
    ...(input.preparation.target === undefined ? {} : { target: input.preparation.target.ref, targetKind: input.preparation.target.kind, targetOwner: input.preparation.target.owner.path }),
    snapshotDigest: input.preparation.snapshotDigest,
    generation: input.preparation.generation,
    nextGeneration: input.preparation.generation + (input.changed ? 1 : 0),
    changed: input.changed,
    headCommit: input.headCommit,
    preimageDigest: input.source.kind === "absent" ? null : input.source.digest,
    plannedBytesDigest: traceDigest(input.planned.bytes),
    changes: input.planned.changes,
    value: input.planned.value,
  };
}

function buildFileJournal(
  root: string, directory: string, operation: string, ownerPath: string, preparation: TraceMutationPreparation,
  source: FileSnapshot, plannedBytes: Buffer, plannedMode: number, head: string, index: string | null,
): FileJournal {
  const token = randomUUID();
  const temporary = slash(relative(resolve(root), resolve(dirname(repositoryPath(root, ownerPath, operation)), `.${basename(ownerPath)}.niceeval-${token}.tmp`)));
  return {
    format: "niceeval.docs-trace/publication-journal/v1", publication: "file-replace", token, operation, owner: ownerPath, temporary,
    oldGeneration: preparation.generation, newGeneration: preparation.generation + 1, snapshotDigest: preparation.snapshotDigest,
    headCommit: head, indexEntry: index, identity: worktreeIdentity(root, directory, true, operation), createdAt: new Date().toISOString(),
    process: { pid: process.pid, host: hostname() }, preimage: preimageForJournal(source),
    planned: { digest: traceDigest(plannedBytes), byteLength: plannedBytes.byteLength, mode: plannedMode },
  };
}

function buildDirectoryJournal(
  root: string, directory: string, operation: string, ownerPath: string, publication: TraceDirectoryPublication,
  preparation: TraceMutationPreparation, plannedManifest: readonly ManifestEntry[], head: string, index: string | null,
): DirectoryJournal {
  return {
    format: "niceeval.docs-trace/publication-journal/v1", publication: publication.kind, phase: "prepared",
    token: basename(publication.stagePath).slice(".stage-".length), operation, owner: ownerPath, stage: publication.stagePath, target: publication.targetPath,
    oldGeneration: preparation.generation, newGeneration: preparation.generation + 1, snapshotDigest: preparation.snapshotDigest,
    headCommit: head, indexEntry: index, identity: worktreeIdentity(root, directory, true, operation), createdAt: new Date().toISOString(),
    process: { pid: process.pid, host: hostname() }, manifest: plannedManifest,
  };
}

function publishJournal(root: string, journal: PublicationJournal): void {
  if (journal.publication === "file-replace") {
    const temporary = repositoryPath(root, journal.temporary, journal.operation);
    const owner = repositoryPath(root, journal.owner, journal.operation);
    if (!fileSnapshotMatches(readFileSnapshot(owner, journal.operation), journal.preimage)) throw mutationFailure(journal.operation, "preimage", "owner changed immediately before atomic rename", journal.owner);
    renameSync(temporary, owner);
    fsyncDirectory(dirname(owner));
    return;
  }
  const stage = repositoryPath(root, journal.stage, journal.operation);
  const target = repositoryPath(root, journal.target, journal.operation);
  if (!sameManifest(manifest(stage, journal.operation), journal.manifest) || existsSync(target)) throw mutationFailure(journal.operation, "preimage", "stage or target changed immediately before atomic rename", journal.target);
  renameSync(stage, target);
  fsyncDirectory(dirname(target));
}

function committedJournalState(root: string, directory: string, journal: PublicationJournal): boolean {
  if (readGenerationPath(resolve(directory, GENERATION_FILE)) !== journal.newGeneration) return false;
  if (journal.publication === "file-replace") {
    return fileSnapshotMatches(readFileSnapshot(repositoryPath(root, journal.owner, "recover-after-failure"), "recover-after-failure"), journal.planned) &&
      readFileSnapshot(repositoryPath(root, journal.temporary, "recover-after-failure"), "recover-after-failure").kind === "absent";
  }
  return manifest(repositoryPath(root, journal.stage, "recover-after-failure"), "recover-after-failure") === undefined &&
    sameManifest(manifest(repositoryPath(root, journal.target, "recover-after-failure"), "recover-after-failure"), journal.manifest);
}

function safelyCommittedJournalState(root: string, directory: string, journal: PublicationJournal): boolean {
  try { return committedJournalState(root, directory, journal); }
  catch { return false; }
}

function cleanAfterFailedPublication<E>(
  root: string,
  directory: string,
  journal: PublicationJournal,
  original: E | TraceCoordinationError,
): { readonly committed: true } | { readonly committed: false; readonly error: E | TraceCoordinationError } {
  try {
    const recovery = recoverUnderLease(root, directory);
    if (recovery.action === "completed" || (
      recovery.action === "none" && !existsSync(journalPath(directory)) && safelyCommittedJournalState(root, directory, journal)
    )) return { committed: true };
    return { committed: false, error: original };
  }
  catch (recoveryCause) {
    if (!existsSync(journalPath(directory)) && safelyCommittedJournalState(root, directory, journal)) return { committed: true };
    return {
      committed: false,
      error: new TraceMutationError({ operation: "recover-after-failure", phase: "rollback", message: `publication failed (${message(original)}) and recovery failed (${message(recoveryCause)})` }),
    };
  }
}

export function mutateTraceOwner<A, Changes, E, R>(
  options: TraceMutationOptions<A, Changes, E, R>,
): Effect.Effect<TraceMutationReceipt<A, Changes>, E | TraceCoordinationError, R> {
  if (options.dryRun) {
    return withTraceReadLease(options.root, () => Effect.gen(function*() {
      const preparation = yield* options.prepareUnderLease;
      const owner = repositoryPath(options.root, options.ownerPath, options.operation);
      const source = readFileSnapshot(owner, options.operation);
      const head = headCommit(options.root, options.operation);
      const planned = yield* options.plan({ source: source.kind === "absent" ? undefined : source.bytes.toString("utf8"), headCommit: head, preparation });
      const changed = source.kind === "absent" || !source.bytes.equals(Buffer.from(planned.bytes, "utf8"));
      return receiptFor({ options: options as TraceMutationOptions<A, Changes, unknown, unknown>, preparation, planned, source, headCommit: head, changed });
    }));
  }

  return withLease(options.root, "exclusive", options.operation, true, (lease) => Effect.uninterruptible(Effect.gen(function*() {
    if (lease === undefined) return yield* mutationFailure(options.operation, "lock", "exclusive Trace lease was not created");
    worktreeIdentity(options.root, lease.directory, true, options.operation);
    yield* Effect.try({
      try: () => recoverUnderLease(options.root, lease.directory),
      catch: (cause) => cause instanceof TraceMutationError || cause instanceof TraceRecoveryConflict ? cause : mutationFailure(options.operation, "rollback", cause),
    });
    const preparation = yield* options.prepareUnderLease;
    const owner = repositoryPath(options.root, options.ownerPath, options.operation);
    const source = readFileSnapshot(owner, options.operation);
    const head = headCommit(options.root, options.operation);
    const index = indexEntry(options.root, options.ownerPath, options.operation);
    const planned = yield* options.plan({ source: source.kind === "absent" ? undefined : source.bytes.toString("utf8"), headCommit: head, preparation });
    const plannedBytes = Buffer.from(planned.bytes, "utf8");
    if (plannedBytes.byteLength > MAXIMUM_OWNER_BYTES) return yield* mutationFailure(options.operation, "capacity", `planned owner exceeds ${MAXIMUM_OWNER_BYTES} bytes`, options.ownerPath);
    const changed = source.kind === "absent" || !source.bytes.equals(plannedBytes);
    const receipt = receiptFor({ options: options as TraceMutationOptions<A, Changes, unknown, unknown>, preparation, planned, source, headCommit: head, changed });
    if (!changed) return receipt;

    let journal: PublicationJournal;
    if (options.publication === undefined) {
      journal = buildFileJournal(options.root, lease.directory, options.operation, options.ownerPath, preparation, source, plannedBytes, source.kind === "file" ? source.mode : 0o644, head, index);
    } else {
      if (source.kind !== "absent") return yield* mutationFailure(options.operation, "preimage", "new directory publication requires an absent owner", options.ownerPath);
      const stage = repositoryPath(options.root, options.publication.stagePath, options.operation);
      const target = repositoryPath(options.root, options.publication.targetPath, options.operation);
      if (existsSync(target)) return yield* mutationFailure(options.operation, "preimage", "directory publication target already exists", options.publication.targetPath);
      const plannedManifest = manifest(stage, options.operation);
      if (plannedManifest === undefined) return yield* mutationFailure(options.operation, "preimage", "directory publication stage is missing", options.publication.stagePath);
      if (options.publication.expectedManifest !== undefined &&
        !sameManifest(plannedManifest, options.publication.expectedManifest)) {
        return yield* mutationFailure(options.operation, "preimage", "directory publication stage differs from the planned manifest", options.publication.stagePath);
      }
      const readme = plannedManifest.find((entry) => entry.kind === "file" && entry.path === "README.md");
      if (readme?.kind !== "file" || readme.digest !== traceDigest(plannedBytes)) return yield* mutationFailure(options.operation, "preimage", "staged README differs from planned owner bytes", options.publication.stagePath);
      journal = buildDirectoryJournal(options.root, lease.directory, options.operation, options.ownerPath, options.publication, preparation, plannedManifest, head, index);
    }

    const execution = Effect.try({
      try: () => writeJournal(lease.directory, journal),
      catch: (cause) => mutationFailure(options.operation, "journal", cause, journalPath(lease.directory)),
    }).pipe(Effect.flatMap(() => Effect.gen(function*() {
      if (journal.publication === "file-replace") {
        yield* Effect.try({
          try: () => writePreparedFile(repositoryPath(options.root, journal.temporary, options.operation), plannedBytes, journal.planned.mode),
          catch: (cause) => mutationFailure(options.operation, "publish", cause, journal.temporary),
        });
      }
      const confirmed = yield* options.prepareUnderLease;
      if (!samePreparation(preparation, confirmed)) return yield* mutationFailure(options.operation, "preimage", "Trace Snapshot or target preparation changed after journal fsync");
      const confirmedOwner = readFileSnapshot(owner, options.operation);
      if (!fileSnapshotMatches(confirmedOwner, journal.publication === "file-replace" ? journal.preimage : { kind: "absent" })) return yield* mutationFailure(options.operation, "preimage", "owner changed after journal fsync", options.ownerPath);
      if (headCommit(options.root, options.operation) !== head || indexEntry(options.root, options.ownerPath, options.operation) !== index) return yield* mutationFailure(options.operation, "preimage", "HEAD or owner Git index entry changed after journal fsync", options.ownerPath);
      verifyAdditionalPreimages(options.operation, preparation.preimages ?? []);
      if (journal.publication !== "file-replace" && !sameManifest(manifest(repositoryPath(options.root, journal.stage, options.operation), options.operation), journal.manifest)) {
        return yield* mutationFailure(options.operation, "preimage", "directory manifest changed after journal fsync", journal.stage);
      }
      yield* Effect.try({ try: () => publishJournal(options.root, journal), catch: (cause) => cause instanceof TraceMutationError ? cause : mutationFailure(options.operation, "publish", cause, options.ownerPath) });
      yield* Effect.try({ try: () => writeGeneration(lease.directory, preparation.generation + 1, options.operation), catch: (cause) => cause instanceof TraceMutationError ? cause : mutationFailure(options.operation, "generation", cause) });
      yield* Effect.try({ try: () => removeJournal(lease.directory), catch: (cause) => mutationFailure(options.operation, "cleanup", cause, journalPath(lease.directory)) });
      return receipt;
    })));
    const completed = yield* Effect.result(execution);
    if (Result.isSuccess(completed)) return completed.success;
    const cleanup = cleanAfterFailedPublication(options.root, lease.directory, journal, completed.failure);
    if (cleanup.committed) return receipt;
    return yield* Effect.fail(cleanup.error);
  })));
}

export const mutateTraceOwnerFile = mutateTraceOwner;
