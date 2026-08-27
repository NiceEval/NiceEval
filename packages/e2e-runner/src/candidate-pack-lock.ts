// A scoped, token-checked cross-process lease for the shared `pnpm pack` stage.

import { createHash, randomUUID } from "node:crypto";
import { lstat, type Stats } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as FileSystem from "effect/FileSystem";
import { Data, Effect, Fiber, Scope } from "effect";

const CONTROL_DIRECTORY = "niceeval-e2e-candidate-pack-locks";
const OWNER_FILE = "owner.json";
const RETRY_INTERVAL_MS = 100;
const HEARTBEAT_INTERVAL_MS = 1_000;
const OWNER_PUBLICATION_GRACE_MS = 10_000;

interface LockOwner { readonly token: string; readonly pid: number; readonly host: string; readonly createdAtMs: number; readonly heartbeatAtMs: number; }
type OwnerObservation = { readonly kind: "present"; readonly owner: LockOwner } | { readonly kind: "missing" } | { readonly kind: "malformed"; readonly detail: string };
interface LockInspection { readonly owner: OwnerObservation; readonly modifiedAtMs: number; }
export interface CandidatePackLock { readonly path: string; }
export class CandidatePackLockError extends Data.TaggedError("CandidatePackLockError")<{ readonly operation: "acquire" | "inspect" | "release"; readonly detail: string; }> {}

function pathFor(checkout: string): string { return join(tmpdir(), CONTROL_DIRECTORY, `${createHash("sha256").update(checkout).digest("hex")}.lock`); }
function isNotFound(error: unknown): boolean { return typeof error === "object" && error !== null && "reason" in error && (error as { readonly reason?: unknown }).reason === "NotFound"; }
function isAlreadyExists(error: unknown): boolean { return typeof error === "object" && error !== null && "reason" in error && (error as { readonly reason?: unknown }).reason === "AlreadyExists"; }
function isOwner(value: unknown): value is LockOwner { if (value === null || typeof value !== "object") return false; const owner = value as Partial<LockOwner>; return typeof owner.token === "string" && owner.token.length > 0 && typeof owner.pid === "number" && Number.isInteger(owner.pid) && owner.pid > 0 && typeof owner.host === "string" && owner.host.length > 0 && typeof owner.createdAtMs === "number" && Number.isFinite(owner.createdAtMs) && typeof owner.heartbeatAtMs === "number" && Number.isFinite(owner.heartbeatAtMs); }
function ownerDied(owner: LockOwner): boolean { if (owner.host !== hostname()) return false; try { process.kill(owner.pid, 0); return false; } catch (cause) { return (cause as NodeJS.ErrnoException).code === "ESRCH"; } }
function lstatLeaf(path: string): Effect.Effect<Stats, NodeJS.ErrnoException> { return Effect.callback((resume) => { lstat(path, (error, stat) => resume(error === null ? Effect.succeed(stat) : Effect.fail(error))); }); }

function observeOwner(path: string): Effect.Effect<OwnerObservation, CandidatePackLockError, FileSystem.FileSystem> {
  const ownerPath = join(path, OWNER_FILE);
  return lstatLeaf(ownerPath).pipe(Effect.matchEffect({
    onFailure: (error) => error.code === "ENOENT" ? Effect.succeed<OwnerObservation>({ kind: "missing" }) : Effect.fail(new CandidatePackLockError({ operation: "inspect", detail: error.message })),
    onSuccess: (stat) => !stat.isFile() || stat.isSymbolicLink() ? Effect.succeed<OwnerObservation>({ kind: "malformed", detail: "owner metadata is not a regular non-symlink file" }) : Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(ownerPath).pipe(Effect.matchEffect({
    onFailure: (error) => isNotFound(error) ? Effect.succeed<OwnerObservation>({ kind: "missing" }) : Effect.fail(new CandidatePackLockError({ operation: "inspect", detail: error.message })),
    onSuccess: (text) => Effect.succeed<OwnerObservation>((() => { try { const parsed: unknown = JSON.parse(text); return isOwner(parsed) ? { kind: "present", owner: parsed } : { kind: "malformed", detail: "owner metadata has an invalid shape" }; } catch { return { kind: "malformed", detail: "owner metadata is not valid JSON" }; } })()),
  }))),
  }));
}

function inspect(path: string): Effect.Effect<LockInspection | undefined, CandidatePackLockError, FileSystem.FileSystem> {
  return lstatLeaf(path).pipe(Effect.matchEffect({
    onFailure: (error) => error.code === "ENOENT" ? Effect.succeed(undefined) : Effect.fail(new CandidatePackLockError({ operation: "inspect", detail: error.message })),
    onSuccess: (stat) => !stat.isDirectory() || stat.isSymbolicLink() ? Effect.fail(new CandidatePackLockError({ operation: "inspect", detail: `candidate pack lock must be a real non-symlink directory: ${path}` })) : observeOwner(path).pipe(Effect.map((owner) => ({ owner, modifiedAtMs: stat.mtimeMs }))),
  }));
}

function writeOwner(path: string, owner: LockOwner): Effect.Effect<void, CandidatePackLockError, FileSystem.FileSystem> {
  const temporary = join(path, `.${OWNER_FILE}.${owner.token}.${randomUUID()}.tmp`);
  return Effect.flatMap(FileSystem.FileSystem, (fs) => fs.writeFileString(temporary, `${JSON.stringify(owner)}\n`, { flag: "wx" }).pipe(
    Effect.andThen(fs.rename(temporary, join(path, OWNER_FILE))),
    Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
    Effect.mapError((error) => new CandidatePackLockError({ operation: "acquire", detail: error.message })),
  ));
}

function release(path: string, token: string): Effect.Effect<void, never, FileSystem.FileSystem> {
  return observeOwner(path).pipe(Effect.catch(() => Effect.succeed<OwnerObservation>({ kind: "missing" })), Effect.flatMap((current) => current.kind === "present" && current.owner.token === token ? Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(path, { recursive: true, force: true }).pipe(Effect.ignore)) : Effect.void));
}

function heartbeat(path: string, owner: LockOwner): Effect.Effect<never, never, FileSystem.FileSystem> {
  return Effect.sleep(HEARTBEAT_INTERVAL_MS).pipe(Effect.andThen(observeOwner(path)), Effect.flatMap((current) => current.kind === "present" && current.owner.token === owner.token ? writeOwner(path, { ...owner, heartbeatAtMs: Date.now() }).pipe(Effect.ignore) : Effect.void), Effect.catch(() => Effect.void), Effect.forever);
}

function acquireAt(path: string, announced: boolean): Effect.Effect<CandidatePackLock, CandidatePackLockError, FileSystem.FileSystem | Scope.Scope> {
  const now = Date.now(); const owner: LockOwner = { token: randomUUID(), pid: process.pid, host: hostname(), createdAtMs: now, heartbeatAtMs: now };
  return Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeDirectory(path).pipe(
    Effect.matchEffect({
      onSuccess: () => writeOwner(path, owner).pipe(Effect.catch((error) => fs.remove(path, { recursive: true, force: true }).pipe(Effect.ignore, Effect.andThen(Effect.fail(error)))), Effect.flatMap(() => Effect.forkScoped(heartbeat(path, owner))), Effect.flatMap((fiber) => Effect.acquireRelease(Effect.succeed({ path }), () => Fiber.interrupt(fiber).pipe(Effect.andThen(release(path, owner.token)))))),
      onFailure: (error) => !isAlreadyExists(error) ? Effect.fail(new CandidatePackLockError({ operation: "acquire", detail: error.message })) : inspect(path).pipe(Effect.flatMap((current) => {
        if (current === undefined) return acquireAt(path, announced);
        if (current.owner.kind === "present" && ownerDied(current.owner.owner)) return Effect.fail(new CandidatePackLockError({ operation: "acquire", detail: `candidate pack lock owner died without releasing: ${path} (owner=${current.owner.owner.host}:${current.owner.owner.pid})` }));
        if (current.owner.kind !== "present" && Date.now() - current.modifiedAtMs > OWNER_PUBLICATION_GRACE_MS) return Effect.fail(new CandidatePackLockError({ operation: "acquire", detail: `candidate pack lock has no trustworthy owner: ${path}` }));
        return (announced ? Effect.void : Effect.sync(() => console.log(`[e2e] waiting for candidate pack lock: ${path}`))).pipe(Effect.andThen(Effect.sleep(RETRY_INTERVAL_MS)), Effect.andThen(acquireAt(path, true)));
      })),
    }),
  ));
}

export function acquireCandidatePackLock(repoRoot: string): Effect.Effect<CandidatePackLock, CandidatePackLockError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.flatMap(FileSystem.FileSystem, (fs) => fs.realPath(resolve(repoRoot)).pipe(Effect.mapError((error) => new CandidatePackLockError({ operation: "acquire", detail: error.message })), Effect.flatMap((checkout) => fs.makeDirectory(join(tmpdir(), CONTROL_DIRECTORY), { recursive: true }).pipe(Effect.mapError((error) => new CandidatePackLockError({ operation: "acquire", detail: error.message })), Effect.andThen(acquireAt(pathFor(checkout), false))))));
}
