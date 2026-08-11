// Local Store 的写线性化原语。每个 transaction 长持一条具名 lease；同 root 同时只允许一条
// 活 lease。lease 的 fencing token 单调递增，commit 仍须在短临界区复核 token + expected head，
// 因而旧 transaction 即使迟到也不能把新 head 覆盖回去。

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import {
  LocalStoreLeaseBusyError,
  LocalStoreLeaseLostError,
  LocalStorePhysicalCorruptionError,
  nodeErrorCode,
} from "./errors.ts";
import {
  readFileIfPresent,
  removeFileIfPresent,
  runLocalStoreIo,
  syncDirectory,
  writeFileAtomically,
  writeFileExclusively,
} from "./fs.ts";
import type { LocalStorePaths } from "./paths.ts";

const LEASE_SCHEMA = "niceeval.record-store-write-lease/1";
const FENCING_SCHEMA = "niceeval.record-store-fencing/1";
const DEFAULT_LEASE_DURATION_MS = 30_000;
/** A stale staging record remains a root after its write lease ends, never based on mtime. */
const DEFAULT_STAGING_GRACE_MS = 30_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface LocalLeaseRecord {
  readonly schema: typeof LEASE_SCHEMA;
  readonly transactionId: string;
  readonly fencingToken: string;
  readonly host: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly expiresAt: string;
}

interface LocalFencingRecord {
  readonly schema: typeof FENCING_SCHEMA;
  readonly nextToken: number;
}

export type LocalWriteLeaseState = "active" | "lost" | "released";

export interface LocalWriteLeaseOptions {
  /** Lease 必须在可见 deadline 前 renew；默认 30 秒，测试或 integration 可收窄。 */
  readonly durationMs?: number;
  /** 每次 lease deadline 后 staging 仍受 GC 保护的固定 grace；默认 30 秒。 */
  readonly stagingGraceMs?: number;
  readonly now?: () => number;
}

/** A single renewal's mutually consistent lease and staging deadlines. */
export interface LocalWriteLeaseRenewal {
  readonly expiresAt: string;
  readonly stagingProtectUntil: string;
}

function valueAt(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseLeaseRecord(value: unknown): LocalLeaseRecord | undefined {
  const schema = valueAt(value, "schema");
  const transactionId = valueAt(value, "transactionId");
  const fencingToken = valueAt(value, "fencingToken");
  const host = valueAt(value, "host");
  const pid = valueAt(value, "pid");
  const startedAt = valueAt(value, "startedAt");
  const expiresAt = valueAt(value, "expiresAt");
  if (
    schema !== LEASE_SCHEMA ||
    typeof transactionId !== "string" || transactionId === "" ||
    typeof fencingToken !== "string" || !/^[0-9]+$/.test(fencingToken) ||
    typeof host !== "string" || host === "" ||
    !positiveSafeInteger(pid) ||
    typeof startedAt !== "string" || !Number.isFinite(Date.parse(startedAt)) ||
    typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))
  ) {
    return undefined;
  }
  return Object.freeze({ schema, transactionId, fencingToken, host, pid, startedAt, expiresAt });
}

function parseFencingRecord(value: unknown): LocalFencingRecord | undefined {
  const schema = valueAt(value, "schema");
  const nextToken = valueAt(value, "nextToken");
  if (schema !== FENCING_SCHEMA || !positiveSafeInteger(nextToken)) return undefined;
  return Object.freeze({ schema, nextToken });
}

function jsonBytes(value: object): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function isExpired(record: LocalLeaseRecord, now: number): boolean {
  return Date.parse(record.expiresAt) <= now;
}

function timestampAt(paths: LocalStorePaths, milliseconds: number, detail: string): string {
  const value = new Date(milliseconds);
  if (!Number.isFinite(value.getTime())) {
    throw new LocalStorePhysicalCorruptionError({
      component: "lock",
      path: paths.lease,
      detail,
    });
  }
  return value.toISOString();
}

/**
 * 本地 Store 不接管仍存活进程的 lock，即使其 deadline 已过。这样不会发生“旧进程仍在写，
 * 新进程删锁并并发写 layout”的 split-brain；旧 lease 本身已在 deadline 后失效，持有者只能
 * release/abort 或退出。crash recovery 则在 holder pid 已死时取得接管权。
 */
function holderIsAlive(record: LocalLeaseRecord): boolean {
  if (record.host !== hostname()) return true;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (cause) {
    return nodeErrorCode(cause) !== "ESRCH";
  }
}

async function readLease(paths: LocalStorePaths): Promise<LocalLeaseRecord | undefined> {
  const bytes = await readFileIfPresent(paths.lease);
  if (bytes === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new LocalStorePhysicalCorruptionError({
      component: "lock",
      path: paths.lease,
      detail: "write lease is not valid JSON",
    });
  }
  const lease = parseLeaseRecord(parsed);
  if (lease === undefined) {
    throw new LocalStorePhysicalCorruptionError({
      component: "lock",
      path: paths.lease,
      detail: "write lease does not match the v1 physical shape",
    });
  }
  return lease;
}

/**
 * Store open 的 crash-recovery admission：只要 holder 仍可能写（含已过 deadline 但 pid 仍在），
 * 就不触碰 journal。这样新 reader 能读到旧或完整新 Layout，却不会把进行中的 prepare 提前标记
 * committed。
 */
export async function hasRecoverableActiveWriteLease(paths: LocalStorePaths): Promise<boolean> {
  const lease = await readLease(paths);
  return lease !== undefined && holderIsAlive(lease);
}

async function allocateFencingToken(paths: LocalStorePaths): Promise<string> {
  const bytes = await readFileIfPresent(paths.fencing);
  let previous = 0;
  if (bytes !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoder.decode(bytes));
    } catch {
      throw new LocalStorePhysicalCorruptionError({
        component: "lock",
        path: paths.fencing,
        detail: "fencing counter is not valid JSON",
      });
    }
    const record = parseFencingRecord(parsed);
    if (record === undefined) {
      throw new LocalStorePhysicalCorruptionError({
        component: "lock",
        path: paths.fencing,
        detail: "fencing counter does not match the v1 physical shape",
      });
    }
    previous = record.nextToken;
  }
  if (previous >= Number.MAX_SAFE_INTEGER) {
    throw new LocalStorePhysicalCorruptionError({
      component: "lock",
      path: paths.fencing,
      detail: "fencing counter exhausted the JSON safe integer range",
    });
  }
  const next = previous + 1;
  await writeFileAtomically(paths.fencing, jsonBytes({ schema: FENCING_SCHEMA, nextToken: next }));
  return String(next);
}

function leaseRecord(
  transactionId: string,
  fencingToken: string,
  startedAt: string,
  expiresAt: string,
): LocalLeaseRecord {
  return Object.freeze({
    schema: LEASE_SCHEMA,
    transactionId,
    fencingToken,
    host: hostname(),
    pid: process.pid,
    startedAt,
    expiresAt,
  });
}

/** 成功 rename 旧 dead-holder record 的调用者才有资格重新创建 lease。 */
async function clearDeadLease(paths: LocalStorePaths): Promise<boolean> {
  const tombstone = join(
    paths.control,
    `.write-lease.${process.pid}.${randomUUID()}.recovered`,
  );
  try {
    await runLocalStoreIo("rename", paths.lease, () => rename(paths.lease, tombstone));
  } catch (cause) {
    if (nodeErrorCode(cause) === "ENOENT") return false;
    throw cause;
  }
  await syncDirectory(paths.control);
  // tombstone 不再是 lock 的可见名称。清理失败不回滚 recovery ownership；后续 GC 可回收。
  await removeFileIfPresent(tombstone).catch(() => undefined);
  return true;
}

/**
 * Acquisition has not produced a LocalWriteLease capability until its fencing record and final
 * lease replacement both succeed. If either step fails, remove only the provisional/final record
 * still carrying this acquisition's identity. A different owner is a successor and is never
 * touched. `undefined` means somebody else already removed our record, so there is no lock left
 * for this failed acquisition to clean up.
 */
async function removeOwnedAcquisitionLease(
  paths: LocalStorePaths,
  transactionId: string,
  fencingTokens: readonly string[],
): Promise<void> {
  const current = await readLease(paths);
  if (current === undefined) return;
  if (
    current.transactionId !== transactionId ||
    !fencingTokens.includes(current.fencingToken)
  ) {
    return;
  }
  await removeFileIfPresent(paths.lease);
}

export class LocalWriteLease implements AsyncDisposable {
  #state: LocalWriteLeaseState = "active";
  #expiresAt: string;
  #releaseResult: Promise<void> | undefined;

  private constructor(
    private readonly paths: LocalStorePaths,
    readonly transactionId: string,
    readonly fencingToken: string,
    private readonly startedAt: string,
    expiresAt: string,
    private readonly durationMs: number,
    private readonly stagingGraceMs: number,
    private readonly now: () => number,
  ) {
    this.#expiresAt = expiresAt;
  }

  get state(): LocalWriteLeaseState {
    return this.#state;
  }

  get expiresAt(): string {
    return this.#expiresAt;
  }

  /** The durable staging deadline corresponding to the currently visible lease deadline. */
  get stagingProtectUntil(): string {
    return timestampAt(
      this.paths,
      Date.parse(this.#expiresAt) + this.stagingGraceMs,
      "write lease staging grace deadline is outside the supported date range",
    );
  }

  static async acquire(paths: LocalStorePaths, options: LocalWriteLeaseOptions = {}): Promise<LocalWriteLease> {
    const durationMs = options.durationMs ?? DEFAULT_LEASE_DURATION_MS;
    const stagingGraceMs = options.stagingGraceMs ?? DEFAULT_STAGING_GRACE_MS;
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      throw new LocalStorePhysicalCorruptionError({
        component: "lock",
        path: paths.lease,
        detail: "write lease duration must be a positive JSON safe integer",
      });
    }
    if (!Number.isSafeInteger(stagingGraceMs) || stagingGraceMs <= 0) {
      throw new LocalStorePhysicalCorruptionError({
        component: "lock",
        path: paths.lease,
        detail: "write lease staging grace must be a positive JSON safe integer",
      });
    }
    const now = options.now ?? Date.now;
    const transactionId = randomUUID();

    for (;;) {
      const startedAt = timestampAt(paths, now(), "write lease start is outside the supported date range");
      const provisional = leaseRecord(
        transactionId,
        "0",
        startedAt,
        timestampAt(paths, now() + durationMs, "write lease expiry is outside the supported date range"),
      );
      const creation = await writeFileExclusively(paths.lease, jsonBytes(provisional));
      if (creation === "created") {
        let ownedFencingTokens: readonly string[] = Object.freeze(["0"]);
        try {
          const fencingToken = await allocateFencingToken(paths);
          // `writeFileAtomically` may fail either before or after rename. Both the provisional
          // and final record are ours until this method returns the lease capability.
          ownedFencingTokens = Object.freeze(["0", fencingToken]);
          const expiresAt = timestampAt(
            paths,
            now() + durationMs,
            "write lease expiry is outside the supported date range",
          );
          await writeFileAtomically(
            paths.lease,
            jsonBytes(leaseRecord(transactionId, fencingToken, startedAt, expiresAt)),
          );
          return new LocalWriteLease(
            paths,
            transactionId,
            fencingToken,
            startedAt,
            expiresAt,
            durationMs,
            stagingGraceMs,
            now,
          );
        } catch (cause) {
          try {
            await removeOwnedAcquisitionLease(paths, transactionId, ownedFencingTokens);
          } catch (cleanupCause) {
            // A live own lock is the immediately actionable failure. It is typed by the
            // filesystem boundary and must not be hidden behind the earlier allocation/write
            // failure, otherwise callers would retry into a permanent same-process busy lease.
            throw cleanupCause;
          }
          throw cause;
        }
      }

      const current = await readLease(paths);
      if (current === undefined) continue; // creator crashed or released between EEXIST and read
      if (!isExpired(current, now()) || holderIsAlive(current)) {
        throw new LocalStoreLeaseBusyError({
          transactionId: current.transactionId,
          fencingToken: current.fencingToken,
          expiresAt: current.expiresAt,
        });
      }
      await clearDeadLease(paths);
    }
  }

  async assertActive(): Promise<void> {
    if (this.#state === "released") {
      throw new LocalStoreLeaseLostError({
        transactionId: this.transactionId,
        fencingToken: this.fencingToken,
        reason: "released",
      });
    }
    if (this.#state === "lost" || Date.parse(this.#expiresAt) <= this.now()) {
      this.#state = "lost";
      throw new LocalStoreLeaseLostError({
        transactionId: this.transactionId,
        fencingToken: this.fencingToken,
        reason: "expired",
      });
    }
    const current = await readLease(this.paths);
    if (current === undefined) {
      this.#state = "lost";
      throw new LocalStoreLeaseLostError({
        transactionId: this.transactionId,
        fencingToken: this.fencingToken,
        reason: "missing",
      });
    }
    if (
      current.transactionId !== this.transactionId ||
      current.fencingToken !== this.fencingToken
    ) {
      this.#state = "lost";
      throw new LocalStoreLeaseLostError({
        transactionId: this.transactionId,
        fencingToken: this.fencingToken,
        reason: "superseded",
      });
    }
    if (isExpired(current, this.now())) {
      this.#state = "lost";
      throw new LocalStoreLeaseLostError({
        transactionId: this.transactionId,
        fencingToken: this.fencingToken,
        reason: "expired",
      });
    }
  }

  planRenewal(): LocalWriteLeaseRenewal {
    const expiresAt = timestampAt(
      this.paths,
      this.now() + this.durationMs,
      "renewed write lease expiry is outside the supported date range",
    );
    return Object.freeze({
      expiresAt,
      stagingProtectUntil: timestampAt(
        this.paths,
        Date.parse(expiresAt) + this.stagingGraceMs,
        "renewed staging grace deadline is outside the supported date range",
      ),
    });
  }

  async renew(renewal: LocalWriteLeaseRenewal): Promise<void> {
    await this.assertActive();
    const expiresAt = Date.parse(renewal.expiresAt);
    const protectUntil = Date.parse(renewal.stagingProtectUntil);
    if (
      !Number.isFinite(expiresAt) ||
      !Number.isFinite(protectUntil) ||
      protectUntil <= expiresAt
    ) {
      throw new LocalStorePhysicalCorruptionError({
        component: "lock",
        path: this.paths.lease,
        detail: "renewal deadlines are invalid or staging grace precedes lease expiry",
      });
    }
    await writeFileAtomically(
      this.paths.lease,
      jsonBytes(leaseRecord(this.transactionId, this.fencingToken, this.startedAt, renewal.expiresAt)),
    );
    this.#expiresAt = renewal.expiresAt;
  }

  /**
   * 仅在磁盘 lease 仍精确属于本对象时删除；若已被 fencing 接管，绝不能删除 successor 的
   * lock。释放幂等，符合 BackendTransaction.close() 的 cleanup 前提。
   */
  async release(): Promise<void> {
    if (this.#state === "released") return;
    if (this.#releaseResult !== undefined) return this.#releaseResult;
    const result = this.releaseOnce();
    this.#releaseResult = result;
    try {
      await result;
      this.#state = "released";
    } catch (cause) {
      if (this.#releaseResult === result) this.#releaseResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.release();
  }

  private async releaseOnce(): Promise<void> {
    const current = await readLease(this.paths);
    if (
      current !== undefined &&
      (current.transactionId !== this.transactionId || current.fencingToken !== this.fencingToken)
    ) return;
    // When a previous release unlinked our record but its parent fsync failed, readLease now sees
    // ENOENT. Still call removeFileIfPresent so its retry performs that parent fsync rather than
    // treating a non-durable disappearance as a completed release. A successor never reaches
    // this branch because the exact owner comparison above returns first.
    await removeFileIfPresent(this.paths.lease);
  }
}
