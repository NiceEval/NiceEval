// Transaction staging pin。put 成功前后由 backend 的单步 operation gate 持有，保证对象创建与
// staging 更新相对于 GC barrier 是原子的：崩溃至多留下可回收 orphan，绝不会让已登记对象失去
// protect root。descriptor 的持久化形状继续由 protocol 提供，Store 不复制 frozen 类型。

import { LocalStorePhysicalCorruptionError, LocalStoreStagingOwnershipError } from "./errors.ts";
import {
  readDirectoryIfPresent,
  readFileIfPresent,
  removeFileIfPresent,
  writeFileAtomically,
} from "./fs.ts";
import { join } from "node:path";
import { localStagingPath, type LocalStorePaths } from "./paths.ts";

// v2 makes the GC grace horizon explicit. Old v1 records deliberately do not get a compatibility
// interpretation: treating an unbounded old orphan as protected would create a permanent pin,
// while guessing from object mtimes would violate the Store recovery contract.
const STAGING_SCHEMA = "niceeval.record-store-staging/2";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface LocalStagingProtocol<Descriptor> {
  /** 完整 typed reference identity，不能只用 digest。 */
  readonly referenceKey: (reference: Descriptor) => string;
  /** 持久化边界仅接受 protocol 已验证的 JSON form。 */
  readonly encodeReference: (reference: Descriptor) => unknown;
  readonly decodeReference: (value: unknown) => Descriptor | undefined;
}

interface LocalStagingRecord {
  readonly schema: typeof STAGING_SCHEMA;
  readonly transactionId: string;
  readonly fencingToken: string;
  readonly protectUntil: string;
  readonly roots: readonly unknown[];
}

export interface LocalDurableStagingRecord<Descriptor> {
  readonly transactionId: string;
  readonly fencingToken: string;
  /** Absolute, writer-maintained grace deadline; GC protects this record only before this instant. */
  readonly protectUntil: string;
  readonly roots: readonly Descriptor[];
}

function valueAt(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

function parseRecord(value: unknown): LocalStagingRecord | undefined {
  const schema = valueAt(value, "schema");
  const transactionId = valueAt(value, "transactionId");
  const fencingToken = valueAt(value, "fencingToken");
  const protectUntil = valueAt(value, "protectUntil");
  const roots = valueAt(value, "roots");
  if (
    schema !== STAGING_SCHEMA ||
    typeof transactionId !== "string" || transactionId === "" ||
    typeof fencingToken !== "string" || !/^[1-9][0-9]*$/.test(fencingToken) ||
    typeof protectUntil !== "string" || !Number.isFinite(Date.parse(protectUntil)) ||
    !Array.isArray(roots)
  ) {
    return undefined;
  }
  return Object.freeze({
    schema,
    transactionId,
    fencingToken,
    protectUntil,
    roots: Object.freeze([...roots]),
  });
}

function parseJson(bytes: Uint8Array, path: string): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new LocalStorePhysicalCorruptionError({
      component: "staging",
      path,
      detail: "staging record is not valid JSON",
    });
  }
}

export class LocalStagingSet<Descriptor> {
  #roots = new Map<string, Descriptor>();
  #closed = false;
  #closeResult: Promise<void> | undefined;
  #protectUntil: string;

  private constructor(
    private readonly paths: LocalStorePaths,
    readonly transactionId: string,
    readonly fencingToken: string,
    protectUntil: string,
    private readonly protocol: LocalStagingProtocol<Descriptor>,
  ) {
    this.#protectUntil = protectUntil;
  }

  static async create<Descriptor>(
    paths: LocalStorePaths,
    transactionId: string,
    fencingToken: string,
    protectUntil: string,
    protocol: LocalStagingProtocol<Descriptor>,
  ): Promise<LocalStagingSet<Descriptor>> {
    const staging = new LocalStagingSet(paths, transactionId, fencingToken, protectUntil, protocol);
    staging.assertValidProtectUntil(protectUntil);
    await staging.write();
    return staging;
  }

  /** 恢复未过期 staging 时只接受完全同一个 transaction + fencing owner。 */
  static async reopen<Descriptor>(
    paths: LocalStorePaths,
    transactionId: string,
    fencingToken: string,
    protocol: LocalStagingProtocol<Descriptor>,
  ): Promise<LocalStagingSet<Descriptor>> {
    const path = localStagingPath(paths, transactionId);
    const bytes = await readFileIfPresent(path);
    if (bytes === undefined) {
      throw new LocalStoreStagingOwnershipError({
        transactionId,
        fencingToken,
        detail: "staging record is missing",
      });
    }
    const record = parseRecord(parseJson(bytes, path));
    if (record === undefined) {
      throw new LocalStorePhysicalCorruptionError({
        component: "staging",
        path,
        detail: "staging record does not match the v2 physical shape",
      });
    }
    if (record.transactionId !== transactionId || record.fencingToken !== fencingToken) {
      throw new LocalStoreStagingOwnershipError({
        transactionId,
        fencingToken,
        detail: "staging record belongs to a different transaction or fencing token",
      });
    }
    if (Date.parse(record.protectUntil) <= Date.now()) {
      throw new LocalStoreStagingOwnershipError({
        transactionId,
        fencingToken,
        detail: "staging record grace period has expired",
      });
    }
    const staging = new LocalStagingSet(
      paths,
      transactionId,
      fencingToken,
      record.protectUntil,
      protocol,
    );
    for (const encoded of record.roots) {
      const ref = protocol.decodeReference(encoded);
      if (ref === undefined) {
        throw new LocalStorePhysicalCorruptionError({
          component: "staging",
          path,
          detail: "staging record contains an invalid protocol reference",
        });
      }
      staging.#roots.set(protocol.referenceKey(ref), ref);
    }
    return staging;
  }

  get roots(): readonly Descriptor[] {
    return Object.freeze([...this.#roots.values()]);
  }

  get protectUntil(): string {
    return this.#protectUntil;
  }

  /**
   * Lease renew first extends durable GC protection, then updates the lease file. A failed lease
   * renewal can therefore leave only an extra grace window; it can never shorten protection for
   * a still-valid lease.
   */
  async extendProtectUntil(protectUntil: string): Promise<void> {
    this.assertOpen();
    const next = this.assertValidProtectUntil(protectUntil);
    if (next <= Date.parse(this.#protectUntil)) return;
    const previous = this.#protectUntil;
    this.#protectUntil = protectUntil;
    try {
      await this.write();
    } catch (cause) {
      this.#protectUntil = previous;
      throw cause;
    }
  }

  async add(reference: Descriptor): Promise<void> {
    this.assertOpen();
    const key = this.protocol.referenceKey(reference);
    if (this.#roots.has(key)) return;
    this.#roots.set(key, reference);
    try {
      await this.write();
    } catch (cause) {
      this.#roots.delete(key);
      throw cause;
    }
  }

  /** 成功 commit / abort 后移除自己的 staging pin；重复 close 不再接触磁盘。 */
  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    const result = removeFileIfPresent(localStagingPath(this.paths, this.transactionId));
    this.#closeResult = result;
    try {
      await result;
      this.#closed = true;
    } catch (cause) {
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  private assertOpen(): void {
    if (this.#closed) {
      throw new LocalStoreStagingOwnershipError({
        transactionId: this.transactionId,
        fencingToken: this.fencingToken,
        detail: "staging set is already closed",
      });
    }
  }

  private async write(): Promise<void> {
    const roots = [...this.#roots.values()].map((reference) => this.protocol.encodeReference(reference));
    const record: LocalStagingRecord = Object.freeze({
      schema: STAGING_SCHEMA,
      transactionId: this.transactionId,
      fencingToken: this.fencingToken,
      protectUntil: this.#protectUntil,
      roots: Object.freeze(roots),
    });
    let bytes: Uint8Array;
    try {
      bytes = encoder.encode(JSON.stringify(record));
    } catch {
      throw new LocalStoreStagingOwnershipError({
        transactionId: this.transactionId,
        fencingToken: this.fencingToken,
        detail: "protocol reference encoder produced a non-JSON staging value",
      });
    }
    await writeFileAtomically(localStagingPath(this.paths, this.transactionId), bytes);
  }

  private assertValidProtectUntil(protectUntil: string): number {
    const milliseconds = Date.parse(protectUntil);
    if (typeof protectUntil !== "string" || !Number.isFinite(milliseconds)) {
      throw new LocalStoreStagingOwnershipError({
        transactionId: this.transactionId,
        fencingToken: this.fencingToken,
        detail: "staging protect-until must be a valid absolute timestamp",
      });
    }
    return milliseconds;
  }
}

/**
 * GC always scans the durable directory rather than only the current backend's in-memory map.
 * It protects only records whose writer-maintained grace deadline has not elapsed. The caller
 * that owns a GC barrier may additionally call `pruneExpiredLocalDurableStaging` to reclaim old
 * records; neither function ever relies on object or metadata mtimes.
 */
export async function listLocalDurableStaging<Descriptor>(
  paths: LocalStorePaths,
  protocol: LocalStagingProtocol<Descriptor>,
  now = Date.now(),
): Promise<readonly LocalDurableStagingRecord<Descriptor>[]> {
  const names = await readDirectoryIfPresent(paths.staging);
  const records: LocalDurableStagingRecord<Descriptor>[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const transactionId = name.slice(0, -".json".length);
    if (transactionId === "" || transactionId.includes("/") || transactionId.includes("\\")) {
      throw new LocalStorePhysicalCorruptionError({
        component: "staging",
        path: join(paths.staging, name),
        detail: "staging filename is invalid",
      });
    }
    const path = localStagingPath(paths, transactionId);
    const bytes = await readFileIfPresent(path);
    if (bytes === undefined) continue;
    const record = parseRecord(parseJson(bytes, path));
    if (record === undefined) {
      throw new LocalStorePhysicalCorruptionError({
        component: "staging",
        path,
        detail: "staging record does not match the v2 physical shape",
      });
    }
    if (record.transactionId !== transactionId) {
      throw new LocalStorePhysicalCorruptionError({
        component: "staging",
        path,
        detail: "staging filename and payload transaction identity disagree",
      });
    }
    if (Date.parse(record.protectUntil) <= now) continue;
    const roots: Descriptor[] = [];
    for (const encoded of record.roots) {
      const root = protocol.decodeReference(encoded);
      if (root === undefined) {
        throw new LocalStorePhysicalCorruptionError({
          component: "staging",
          path,
          detail: "staging record contains an invalid protocol reference",
        });
      }
      roots.push(root);
    }
    records.push(Object.freeze({
      transactionId: record.transactionId,
      fencingToken: record.fencingToken,
      protectUntil: record.protectUntil,
      roots: Object.freeze(roots),
    }));
  }
  return Object.freeze(records);
}

/**
 * Safe GC-barrier cleanup point for crashed / abandoned writers. The barrier excludes acquire,
 * renew, put, abort and commit in every local Store process, while a valid writer always records
 * `protectUntil >= lease expiry + grace` before it extends its lease. Removing an elapsed record
 * here therefore cannot unprotect a live writer. The record's own deadline is the sole oracle.
 */
export async function pruneExpiredLocalDurableStaging(
  paths: LocalStorePaths,
  now = Date.now(),
): Promise<void> {
  const names = await readDirectoryIfPresent(paths.staging);
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const transactionId = name.slice(0, -".json".length);
    if (transactionId === "" || transactionId.includes("/") || transactionId.includes("\\")) {
      throw new LocalStorePhysicalCorruptionError({
        component: "staging",
        path: join(paths.staging, name),
        detail: "staging filename is invalid",
      });
    }
    const path = localStagingPath(paths, transactionId);
    const bytes = await readFileIfPresent(path);
    if (bytes === undefined) continue;
    const record = parseRecord(parseJson(bytes, path));
    if (record === undefined || record.transactionId !== transactionId) {
      throw new LocalStorePhysicalCorruptionError({
        component: "staging",
        path,
        detail: "staging record does not match the v2 physical shape",
      });
    }
    if (Date.parse(record.protectUntil) <= now) await removeFileIfPresent(path);
  }
}
