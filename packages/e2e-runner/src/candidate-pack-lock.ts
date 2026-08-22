// A cross-process lease around the shared `pnpm pack` lifecycle.
//
// `pnpm pack` runs root `prepare`, which replaces dist/, Vite client output,
// and INDEX.md. Candidate destinations are invocation-private, but those
// lifecycle outputs are not. The lease therefore covers only `pnpm pack`;
// planning, candidate consumers, and scenario runs remain concurrent.

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, rename, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  E2EExecutionCancelledError,
  isExecutionCancelled,
  type E2EExecutionControl,
} from "./owned-process.ts";

const CONTROL_DIRECTORY = "niceeval-e2e-candidate-pack-locks";
const OWNER_FILE = "owner.json";
const RETRY_INTERVAL_MS = 100;
const HEARTBEAT_INTERVAL_MS = 1_000;
// A successful mkdir is followed immediately by owner publication. Never
// reclaim an ownerless directory: a paused initializer may still own it.
const OWNER_PUBLICATION_GRACE_MS = 10_000;

interface LockOwner {
  readonly token: string;
  readonly pid: number;
  readonly host: string;
  readonly createdAtMs: number;
  readonly heartbeatAtMs: number;
}

type OwnerObservation =
  | { readonly kind: "present"; readonly owner: LockOwner }
  | { readonly kind: "missing" }
  | { readonly kind: "malformed"; readonly detail: string };

interface LockInspection {
  readonly owner: OwnerObservation;
  readonly modifiedAtMs: number;
}

export interface CandidatePackLock {
  /** OS-control-directory lease path, useful only for diagnostics. */
  readonly path: string;
  /** Idempotently stop heartbeats, drain in-flight writes, then release our lease. */
  release(): Promise<void>;
}

class CandidatePackLockUnavailableError extends Error {
  constructor(lockPath: string, detail: string) {
    super(
      `candidate pack lock has no trustworthy owner after ${OWNER_PUBLICATION_GRACE_MS}ms: ${lockPath} (${detail}). ` +
        "Refusing to reclaim it because a paused initializer could still write; remove the abandoned control-directory lease only after confirming no pack is active.",
    );
    this.name = "CandidatePackLockUnavailableError";
  }
}

class CandidatePackLockOwnerDiedError extends Error {
  constructor(lockPath: string, owner: LockOwner) {
    super(
      `candidate pack lock owner died without releasing its lease: ${lockPath} (owner=${owner.host}:${owner.pid}). ` +
        "Refusing automatic removal because another waiter could otherwise delete a newly acquired lease. " +
        "After confirming no pnpm pack is active, remove this exact OS-control-directory lease and retry.",
    );
    this.name = "CandidatePackLockOwnerDiedError";
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function isLockOwner(value: unknown): value is LockOwner {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<LockOwner>;
  return (
    typeof candidate.token === "string" &&
    candidate.token.length > 0 &&
    typeof candidate.pid === "number" &&
    Number.isInteger(candidate.pid) &&
    candidate.pid > 0 &&
    typeof candidate.host === "string" &&
    candidate.host.length > 0 &&
    typeof candidate.createdAtMs === "number" &&
    Number.isFinite(candidate.createdAtMs) &&
    typeof candidate.heartbeatAtMs === "number" &&
    Number.isFinite(candidate.heartbeatAtMs)
  );
}

async function observeOwner(lockPath: string): Promise<OwnerObservation> {
  const ownerPath = join(lockPath, OWNER_FILE);
  try {
    const ownerStat = await lstat(ownerPath);
    if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) {
      return { kind: "malformed", detail: "owner metadata is not a regular file" };
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(ownerPath, "utf8"));
      return isLockOwner(parsed)
        ? { kind: "present", owner: parsed }
        : { kind: "malformed", detail: "owner metadata has an invalid shape" };
    } catch (error) {
      if (error instanceof SyntaxError) return { kind: "malformed", detail: "owner metadata is not valid JSON" };
      if (errorCode(error) === "ENOENT") return { kind: "missing" };
      throw error;
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { kind: "missing" };
    throw error;
  }
}

async function inspectLock(lockPath: string): Promise<LockInspection | undefined> {
  try {
    const lockStat = await lstat(lockPath);
    if (!lockStat.isDirectory() || lockStat.isSymbolicLink()) {
      throw new Error(`candidate pack lock must be a real directory: ${lockPath}`);
    }
    return { owner: await observeOwner(lockPath), modifiedAtMs: lockStat.mtimeMs };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

/** `ESRCH` is the only process state that proves a same-host holder is dead. */
function isKnownDeadOwner(owner: LockOwner): boolean {
  if (owner.host !== hostname()) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    // EPERM / unknown platform state does not prove the process died.
    return errorCode(error) === "ESRCH";
  }
}

function cancellationError(): E2EExecutionCancelledError {
  return new E2EExecutionCancelledError("e2e candidate packing cancelled while waiting for the checkout-local pack lock");
}

async function waitForRetry(control: E2EExecutionControl | undefined): Promise<void> {
  if (isExecutionCancelled(control)) throw cancellationError();
  const abortSignal = control?.abortSignal;
  if (abortSignal === undefined) {
    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (result: "retry" | "cancelled") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal.removeEventListener("abort", abort);
      if (result === "retry") resolve();
      else reject(cancellationError());
    };
    const timer = setTimeout(() => finish("retry"), RETRY_INTERVAL_MS);
    const abort = () => finish("cancelled");
    abortSignal.addEventListener("abort", abort, { once: true });
    if (abortSignal.aborted) abort();
  });
}

async function writeOwner(lockPath: string, owner: LockOwner, released: () => boolean): Promise<void> {
  const ownerPath = join(lockPath, OWNER_FILE);
  const temporaryPath = join(lockPath, `.${OWNER_FILE}.${owner.token}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(owner)}\n`, { encoding: "utf8", flag: "wx" });
    // release() drains this full promise before deleting the lease directory,
    // closing the write-after-release resurrection race.
    if (released()) return;
    await rename(temporaryPath, ownerPath);
  } finally {
    // `rename` consumes the temp file on success. On failure this only removes
    // our unique scratch file and never recreates the canonical lease.
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

class CandidatePackLockHandle implements CandidatePackLock {
  private released = false;
  private releasePromise: Promise<void> | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private readonly inFlightHeartbeats = new Set<Promise<void>>();

  constructor(
    readonly path: string,
    private owner: LockOwner,
  ) {}

  async initialize(): Promise<void> {
    await writeOwner(this.path, this.owner, () => this.released);
    if (this.released) return;
    this.heartbeatTimer = setInterval(() => this.startHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  private startHeartbeat(): void {
    if (this.released) return;
    const heartbeat = this.heartbeat();
    this.inFlightHeartbeats.add(heartbeat);
    void heartbeat.then(
      () => this.inFlightHeartbeats.delete(heartbeat),
      () => this.inFlightHeartbeats.delete(heartbeat),
    );
  }

  private async heartbeat(): Promise<void> {
    if (this.released) return;
    const current = await observeOwner(this.path);
    // A live holder is never reclaimed by time. If an external actor removed
    // the lease, do not recreate it at the canonical path.
    if (current.kind !== "present" || current.owner.token !== this.owner.token) return;
    this.owner = { ...this.owner, heartbeatAtMs: Date.now() };
    await writeOwner(this.path, this.owner, () => this.released);
  }

  release(): Promise<void> {
    if (this.releasePromise !== undefined) return this.releasePromise;
    this.releasePromise = this.releaseImpl();
    return this.releasePromise;
  }

  private async releaseImpl(): Promise<void> {
    this.released = true;
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    // clearInterval cannot stop a callback that is already writing metadata.
    await Promise.allSettled([...this.inFlightHeartbeats]);

    const current = await observeOwner(this.path);
    if (current.kind !== "present" || current.owner.token !== this.owner.token) return;
    await rm(this.path, { recursive: true, force: true });
  }
}

function lockPathForCheckout(checkoutRoot: string): string {
  // Use the full canonical path digest, not a basename or short hash: aliases
  // to one checkout converge, while independently checked-out repositories do
  // not contend. The control directory is outside package input paths.
  const digest = createHash("sha256").update(checkoutRoot).digest("hex");
  return join(tmpdir(), CONTROL_DIRECTORY, `${digest}.lock`);
}

/**
 * Acquire a per-checkout `pnpm pack` lease. A verified same-host dead PID is
 * reported with an exact manual-cleanup path, never automatically reclaimed:
 * filesystem directory deletion cannot be made compare-and-delete safe here.
 * Missing/malformed owner metadata gets a bounded publication grace, then a
 * typed safety failure rather than risky takeover.
 */
export async function acquireCandidatePackLock(
  repoRoot: string,
  control: E2EExecutionControl | undefined = undefined,
): Promise<CandidatePackLock> {
  const checkoutRoot = await realpath(resolve(repoRoot));
  const lockPath = lockPathForCheckout(checkoutRoot);
  await mkdir(join(tmpdir(), CONTROL_DIRECTORY), { recursive: true });
  let announcedWait = false;

  while (true) {
    if (isExecutionCancelled(control)) throw cancellationError();
    let created = false;
    try {
      await mkdir(lockPath);
      created = true;
      const now = Date.now();
      const lock = new CandidatePackLockHandle(lockPath, {
        token: randomUUID(),
        pid: process.pid,
        host: hostname(),
        createdAtMs: now,
        heartbeatAtMs: now,
      });
      await lock.initialize();
      if (isExecutionCancelled(control)) {
        await lock.release();
        throw cancellationError();
      }
      if (announcedWait) console.log(`[e2e] acquired candidate pack lock: ${lockPath}`);
      return lock;
    } catch (error) {
      if (created) {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
      }
      if (errorCode(error) !== "EEXIST") throw error;
    }

    const inspection = await inspectLock(lockPath);
    if (inspection === undefined) continue;
    if (inspection.owner.kind === "present" && isKnownDeadOwner(inspection.owner.owner)) {
      throw new CandidatePackLockOwnerDiedError(lockPath, inspection.owner.owner);
    }
    if (inspection.owner.kind !== "present" && Date.now() - inspection.modifiedAtMs > OWNER_PUBLICATION_GRACE_MS) {
      const detail = inspection.owner.kind === "missing" ? "owner metadata is missing" : inspection.owner.detail;
      throw new CandidatePackLockUnavailableError(lockPath, detail);
    }
    if (!announcedWait) {
      const detail = inspection.owner.kind === "present"
        ? `owner=${inspection.owner.owner.host}:${inspection.owner.owner.pid}`
        : "owner metadata is being published";
      console.log(`[e2e] waiting for candidate pack lock: ${lockPath} (${detail})`);
      announcedWait = true;
    }
    await waitForRetry(control);
  }
}
