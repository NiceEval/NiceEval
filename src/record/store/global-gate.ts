// 同一 local Store root 的跨进程 GC admission。进程内 gate 只能协调一个 backend instance；
// 此处用 durable barrier + 短生命 ticket 实现文件系统上的 reader/writer admission：GC 先让
// barrier 可见，再等所有已获准 ticket 排空；普通 mutation 取得 ticket 后必须二次检查 barrier。
// 因而 barrier 返回即是所有本地进程共同的 snapshot 线性化点。

import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { LocalStorePhysicalCorruptionError, nodeErrorCode } from "./errors.ts";
import {
  readDirectoryIfPresent,
  readFileIfPresent,
  removeFileIfPresent,
  runLocalStoreIo,
  syncDirectory,
  writeFileExclusively,
} from "./fs.ts";
import type { LocalStorePaths } from "./paths.ts";

const BARRIER_SCHEMA = "niceeval.record-store-gc-barrier/1";
const ADMISSION_SCHEMA = "niceeval.record-store-gc-admission/1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const RETRY_DELAY_MS = 8;

interface LocalGateHolderRecord {
  readonly schema: typeof BARRIER_SCHEMA | typeof ADMISSION_SCHEMA;
  readonly id: string;
  readonly host: string;
  readonly pid: number;
  readonly createdAt: string;
}

function valueAt(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,128}$/.test(value);
}

function parseHolderRecord(
  value: unknown,
  schema: typeof BARRIER_SCHEMA | typeof ADMISSION_SCHEMA,
): LocalGateHolderRecord | undefined {
  const recordSchema = valueAt(value, "schema");
  const id = valueAt(value, "id");
  const host = valueAt(value, "host");
  const pid = valueAt(value, "pid");
  const createdAt = valueAt(value, "createdAt");
  if (
    recordSchema !== schema ||
    !validId(id) ||
    typeof host !== "string" || host === "" ||
    typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0 ||
    typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))
  ) {
    return undefined;
  }
  return Object.freeze({ schema, id, host, pid, createdAt });
}

function recordBytes(
  schema: typeof BARRIER_SCHEMA | typeof ADMISSION_SCHEMA,
  id: string,
): Uint8Array {
  return encoder.encode(JSON.stringify({ schema, id, host: hostname(), pid: process.pid, createdAt: new Date().toISOString() }));
}

function holderIsAlive(holder: LocalGateHolderRecord): boolean {
  // A different host cannot safely be probed with process.kill. Treat it as live rather than
  // risking a concurrent sweep on a shared filesystem.
  if (holder.host !== hostname()) return true;
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (cause) {
    return nodeErrorCode(cause) !== "ESRCH";
  }
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}

async function readHolder(
  path: string,
  schema: typeof BARRIER_SCHEMA | typeof ADMISSION_SCHEMA,
): Promise<LocalGateHolderRecord | undefined> {
  const bytes = await readFileIfPresent(path);
  if (bytes === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new LocalStorePhysicalCorruptionError({
      component: "lock",
      path,
      detail: "GC admission record is not valid JSON",
    });
  }
  const record = parseHolderRecord(value, schema);
  if (record === undefined) {
    throw new LocalStorePhysicalCorruptionError({
      component: "lock",
      path,
      detail: "GC admission record does not match the v1 physical shape",
    });
  }
  return record;
}

/** A dead holder cannot retain an invisible lock forever; rename first so only one reclaimer wins. */
async function reclaimDeadHolder(path: string): Promise<boolean> {
  const tombstone = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.recovered`,
  );
  try {
    await runLocalStoreIo("rename", path, () => rename(path, tombstone));
  } catch (cause) {
    if (nodeErrorCode(cause) === "ENOENT") return false;
    throw cause;
  }
  await syncDirectory(dirname(path));
  await removeFileIfPresent(tombstone).catch(() => undefined);
  return true;
}

async function waitForBarrierToClear(paths: LocalStorePaths): Promise<void> {
  for (;;) {
    const barrier = await readHolder(paths.gcBarrier, BARRIER_SCHEMA);
    if (barrier === undefined) return;
    if (!holderIsAlive(barrier)) {
      await reclaimDeadHolder(paths.gcBarrier);
      continue;
    }
    await delay();
  }
}

async function liveAdmissionPaths(paths: LocalStorePaths): Promise<readonly string[]> {
  const names = await readDirectoryIfPresent(paths.gcAdmissions);
  const live: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const id = name.slice(0, -".json".length);
    if (!validId(id)) {
      throw new LocalStorePhysicalCorruptionError({
        component: "lock",
        path: join(paths.gcAdmissions, name),
        detail: "GC admission filename is invalid",
      });
    }
    const path = join(paths.gcAdmissions, name);
    const holder = await readHolder(path, ADMISSION_SCHEMA);
    if (holder === undefined) continue;
    if (holder.id !== id) {
      throw new LocalStorePhysicalCorruptionError({
        component: "lock",
        path,
        detail: "GC admission filename and record identity disagree",
      });
    }
    if (!holderIsAlive(holder)) {
      await reclaimDeadHolder(path);
      continue;
    }
    live.push(path);
  }
  return Object.freeze(live);
}

export class LocalGlobalMutationPermit implements AsyncDisposable {
  #closed = false;
  #closeResult: Promise<void> | undefined;

  constructor(private readonly path: string, private readonly id: string) {}

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    const result = this.closeOnce();
    this.#closeResult = result;
    try {
      await result;
      this.#closed = true;
    } catch (cause) {
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async closeOnce(): Promise<void> {
    const holder = await readHolder(this.path, ADMISSION_SCHEMA);
    if (holder !== undefined && holder.id !== this.id) {
      throw new LocalStorePhysicalCorruptionError({
        component: "lock",
        path: this.path,
        detail: "GC admission ownership changed before release",
      });
    }
    await removeFileIfPresent(this.path);
  }
}

export class LocalGlobalGcBarrierPermit implements AsyncDisposable {
  #closed = false;
  #closeResult: Promise<void> | undefined;

  constructor(private readonly paths: LocalStorePaths, private readonly id: string) {}

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    const result = this.closeOnce();
    this.#closeResult = result;
    try {
      await result;
      this.#closed = true;
    } catch (cause) {
      // Durable ownership remains visible on a failed unlink/ownership check. Do not convert a
      // retryable cleanup failure into a closed permit while another process remains blocked.
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async closeOnce(): Promise<void> {
    const holder = await readHolder(this.paths.gcBarrier, BARRIER_SCHEMA);
    if (holder !== undefined && holder.id !== this.id) {
      throw new LocalStorePhysicalCorruptionError({
        component: "lock",
        path: this.paths.gcBarrier,
        detail: "GC barrier ownership changed before release",
      });
    }
    await removeFileIfPresent(this.paths.gcBarrier);
  }
}

/**
 * Mutations use a durable ticket. The post-create barrier check closes the only race where a GC
 * barrier appears between the first absent check and ticket creation; a barrier that appears
 * after the second check must observe and wait for this ticket before taking its snapshot.
 */
export class LocalGlobalGcAdmission {
  // These sets cover permits created inside an acquisition method but not returned to its caller
  // because an immediately-following check failed. Without them the exact durable owner would be
  // lost and a live-process ticket/barrier could block every later admission forever.
  readonly #pendingMutationPermits = new Set<LocalGlobalMutationPermit>();
  readonly #pendingBarrierPermits = new Set<LocalGlobalGcBarrierPermit>();

  constructor(private readonly paths: LocalStorePaths) {}

  async beginMutation(): Promise<LocalGlobalMutationPermit> {
    await this.cleanupPendingPermits();
    for (;;) {
      await waitForBarrierToClear(this.paths);
      const id = randomUUID();
      const path = join(this.paths.gcAdmissions, `${id}.json`);
      const created = await writeFileExclusively(path, recordBytes(ADMISSION_SCHEMA, id));
      if (created === "exists") continue;
      const permit = new LocalGlobalMutationPermit(path, id);
      try {
        const barrier = await readHolder(this.paths.gcBarrier, BARRIER_SCHEMA);
        if (barrier === undefined) return permit;
      } catch (cause) {
        try {
          await permit.close();
        } catch (cleanupCause) {
          this.#pendingMutationPermits.add(permit);
          throw cleanupCause;
        }
        throw cause;
      }
      try {
        await permit.close();
      } catch (cleanupCause) {
        this.#pendingMutationPermits.add(permit);
        throw cleanupCause;
      }
    }
  }

  async beginBarrier(): Promise<LocalGlobalGcBarrierPermit> {
    await this.cleanupPendingPermits();
    for (;;) {
      const id = randomUUID();
      const created = await writeFileExclusively(this.paths.gcBarrier, recordBytes(BARRIER_SCHEMA, id));
      if (created === "exists") {
        await waitForBarrierToClear(this.paths);
        continue;
      }
      const permit = new LocalGlobalGcBarrierPermit(this.paths, id);
      try {
        for (;;) {
          const admissions = await liveAdmissionPaths(this.paths);
          if (admissions.length === 0) return permit;
          await delay();
        }
      } catch (cause) {
        try {
          await permit.close();
        } catch (cleanupCause) {
          this.#pendingBarrierPermits.add(permit);
          throw cleanupCause;
        }
        throw cause;
      }
    }
  }

  /** Foundation invokes this at final shutdown as well as normal acquisition retry points. */
  async cleanupPendingPermits(): Promise<void> {
    // A stale barrier must disappear before retrying mutation tickets: otherwise beginMutation
    // would wait on our own unreturned barrier record.
    for (const permit of [...this.#pendingBarrierPermits]) {
      await permit.close();
      this.#pendingBarrierPermits.delete(permit);
    }
    for (const permit of [...this.#pendingMutationPermits]) {
      await permit.close();
      this.#pendingMutationPermits.delete(permit);
    }
  }
}
