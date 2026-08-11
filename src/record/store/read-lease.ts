// Durable read lease。GC 可能运行在另一个 process，因此 lease 不能只留在 backend 的 Map；
// 每个 active lease 都以同 root 的 control/read-leases record 表示，重开后仍会进入 GC snapshot。

import { join } from "node:path";
import { typedReferenceEquals, type RecordGraphRef } from "../protocol/core.ts";
import { LocalStorePhysicalCorruptionError, LocalStoreReadLeaseError } from "./errors.ts";
import { readDirectoryIfPresent, readFileIfPresent, removeFileIfPresent, writeFileAtomically } from "./fs.ts";
import { localReadLeasePath, type LocalStorePaths } from "./paths.ts";
import type { LocalReadLeaseProtocol } from "./protocol-adapter.ts";

const READ_LEASE_SCHEMA = "niceeval.record-store-read-lease/1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type LocalDurableReadLeaseOwner =
  | { readonly kind: "record-handle"; readonly ref: RecordGraphRef }
  | { readonly kind: "record-source-reader"; readonly ref: RecordGraphRef };

export interface LocalDurableReadLeaseRecord {
  readonly leaseId: string;
  readonly owner: LocalDurableReadLeaseOwner;
  readonly ref: RecordGraphRef;
  readonly expiresAt: string;
}

interface EncodedReadLeaseRecord {
  readonly schema: typeof READ_LEASE_SCHEMA;
  readonly leaseId: string;
  readonly owner: unknown;
  readonly ref: unknown;
  readonly expiresAt: string;
}

function valueAt(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

function validLeaseId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,128}$/.test(value);
}

function parseEncodedRecord(value: unknown): EncodedReadLeaseRecord | undefined {
  const schema = valueAt(value, "schema");
  const leaseId = valueAt(value, "leaseId");
  const owner = valueAt(value, "owner");
  const ref = valueAt(value, "ref");
  const expiresAt = valueAt(value, "expiresAt");
  if (
    schema !== READ_LEASE_SCHEMA ||
    !validLeaseId(leaseId) ||
    owner === undefined ||
    ref === undefined ||
    typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))
  ) {
    return undefined;
  }
  return Object.freeze({ schema, leaseId, owner, ref, expiresAt });
}

function decodeRecord(
  value: unknown,
  path: string,
  protocol: LocalReadLeaseProtocol,
): LocalDurableReadLeaseRecord | undefined {
  const encoded = parseEncodedRecord(value);
  if (encoded === undefined) return undefined;
  const encodedOwnerKind = valueAt(encoded.owner, "kind");
  const encodedOwnerRef = valueAt(encoded.owner, "ref");
  if (encodedOwnerKind !== "record-handle" && encodedOwnerKind !== "record-source-reader") return undefined;
  const ownerRef = protocol.decodeRecordGraphRef(encodedOwnerRef);
  const ref = protocol.decodeRecordGraphRef(encoded.ref);
  if (ownerRef === undefined || ref === undefined) return undefined;
  if (ownerRef.recordId !== ref.recordId || !typedReferenceEquals(ownerRef.graph, ref.graph)) {
    throw new LocalStorePhysicalCorruptionError({
      component: "read-lease",
      path,
      detail: "read lease owner ref and protected ref disagree",
    });
  }
  return Object.freeze({
    leaseId: encoded.leaseId,
    owner: Object.freeze({ kind: encodedOwnerKind, ref: ownerRef }),
    ref,
    expiresAt: encoded.expiresAt,
  });
}

function encodeRecord(
  leaseId: string,
  owner: LocalDurableReadLeaseOwner,
  ref: RecordGraphRef,
  expiresAt: string,
  protocol: LocalReadLeaseProtocol,
): Uint8Array {
  try {
    return encoder.encode(JSON.stringify({
      schema: READ_LEASE_SCHEMA,
      leaseId,
      owner: Object.freeze({ kind: owner.kind, ref: protocol.encodeRecordGraphRef(owner.ref) }),
      ref: protocol.encodeRecordGraphRef(ref),
      expiresAt,
    }));
  } catch {
    throw new LocalStorePhysicalCorruptionError({
      component: "read-lease",
      path: leaseId,
      detail: "read lease protocol encoder produced a non-JSON value",
    });
  }
}

export class LocalDurableReadLease implements AsyncDisposable {
  #closed = false;
  #closeResult: Promise<void> | undefined;
  #expiresAt: string;

  private constructor(
    private readonly paths: LocalStorePaths,
    readonly leaseId: string,
    readonly owner: LocalDurableReadLeaseOwner,
    readonly ref: RecordGraphRef,
    expiresAt: string,
    private readonly protocol: LocalReadLeaseProtocol,
  ) {
    this.#expiresAt = expiresAt;
  }

  get expiresAt(): string {
    return this.#expiresAt;
  }

  static async create(
    paths: LocalStorePaths,
    leaseId: string,
    owner: LocalDurableReadLeaseOwner,
    ref: RecordGraphRef,
    expiresAt: string,
    protocol: LocalReadLeaseProtocol,
  ): Promise<LocalDurableReadLease> {
    if (!validLeaseId(leaseId)) {
      throw new LocalStorePhysicalCorruptionError({
        component: "read-lease",
        path: paths.readLeases,
        detail: "read lease identifier is invalid",
      });
    }
    await writeFileAtomically(localReadLeasePath(paths, leaseId), encodeRecord(leaseId, owner, ref, expiresAt, protocol));
    return new LocalDurableReadLease(paths, leaseId, owner, ref, expiresAt, protocol);
  }

  async renew(expiresAt: string): Promise<void> {
    this.assertActive();
    await writeFileAtomically(
      localReadLeasePath(this.paths, this.leaseId),
      encodeRecord(this.leaseId, this.owner, this.ref, expiresAt, this.protocol),
    );
    this.#expiresAt = expiresAt;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    const result = removeFileIfPresent(localReadLeasePath(this.paths, this.leaseId));
    this.#closeResult = result;
    try {
      await result;
      this.#closed = true;
    } catch (cause) {
      // An unlink failure must leave the durable lease visible and allow the owning wrapper to
      // retry; otherwise its independent backend retain could be released while GC still sees it.
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private assertActive(): void {
    if (this.#closed || Date.parse(this.#expiresAt) <= Date.now()) {
      throw new LocalStoreReadLeaseError({ reason: this.#closed ? "closed" : "expired" });
    }
  }
}

export async function listLocalDurableReadLeases(
  paths: LocalStorePaths,
  protocol: LocalReadLeaseProtocol,
  now = Date.now(),
): Promise<readonly LocalDurableReadLeaseRecord[]> {
  const names = await readDirectoryIfPresent(paths.readLeases);
  const records: LocalDurableReadLeaseRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const leaseId = name.slice(0, -".json".length);
    if (!validLeaseId(leaseId)) {
      throw new LocalStorePhysicalCorruptionError({
        component: "read-lease",
        path: join(paths.readLeases, name),
        detail: "read lease filename is invalid",
      });
    }
    const path = localReadLeasePath(paths, leaseId);
    const bytes = await readFileIfPresent(path);
    if (bytes === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(decoder.decode(bytes));
    } catch {
      throw new LocalStorePhysicalCorruptionError({
        component: "read-lease",
        path,
        detail: "read lease is not valid JSON",
      });
    }
    const record = decodeRecord(value, path, protocol);
    if (record === undefined || record.leaseId !== leaseId) {
      throw new LocalStorePhysicalCorruptionError({
        component: "read-lease",
        path,
        detail: "read lease does not match the v1 physical shape",
      });
    }
    if (Date.parse(record.expiresAt) > now) records.push(record);
  }
  return Object.freeze(records);
}

/**
 * Expired read leases do not protect GC.  Remove their durable records while the caller holds the
 * same mutation/barrier admission used for lease creation and release, so a crash cannot turn an
 * already-expired lease into permanent control-plane debris.
 */
export async function pruneExpiredLocalDurableReadLeases(
  paths: LocalStorePaths,
  protocol: LocalReadLeaseProtocol,
  now = Date.now(),
): Promise<void> {
  const names = await readDirectoryIfPresent(paths.readLeases);
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const leaseId = name.slice(0, -".json".length);
    if (!validLeaseId(leaseId)) {
      throw new LocalStorePhysicalCorruptionError({
        component: "read-lease",
        path: join(paths.readLeases, name),
        detail: "read lease filename is invalid",
      });
    }
    const path = localReadLeasePath(paths, leaseId);
    const bytes = await readFileIfPresent(path);
    if (bytes === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(decoder.decode(bytes));
    } catch {
      throw new LocalStorePhysicalCorruptionError({
        component: "read-lease",
        path,
        detail: "read lease is not valid JSON",
      });
    }
    const record = decodeRecord(value, path, protocol);
    if (record === undefined || record.leaseId !== leaseId) {
      throw new LocalStorePhysicalCorruptionError({
        component: "read-lease",
        path,
        detail: "read lease does not match the v1 physical shape",
      });
    }
    if (Date.parse(record.expiresAt) <= now) await removeFileIfPresent(path);
  }
}
