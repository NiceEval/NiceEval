// RecordStore 的 local backend SPI。它拥有 root-bound mutable metadata、CAS/lease/fencing、
// staging、read lease 与 GC barrier；它不解释 Record payload、radix 或选择算法。那些规则经
// LocalRecordStoreGraphAccess 从 graph/protocol 层注入，避免 Store 复制第二套图算法。

import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  typedReferenceEquals,
  type DescriptorV1,
  type GraphRootRefV1,
  type LayoutV2,
  type RecordGraphRef,
} from "../protocol/core.ts";
import {
  LocalStoreClosedError,
  LocalStoreGraphAccessError,
  LocalStoreIoError,
  LocalStoreLeaseLostError,
  LocalStoreReadLeaseError,
  nodeErrorCode,
  type LocalGraphAccessFailure,
} from "./errors.ts";
import { LocalStoreFoundation, LocalStoreGcBarrierPermit } from "./foundation.ts";
import { bytesDigest, markJournalCommitted, writePreparedJournal } from "./journal.ts";
import { LocalWriteLease } from "./lease.ts";
import {
  type LocalObjectPutResult,
  type LocalObjectReadResult,
} from "./objects.ts";
import { LocalPersistentPin, listLocalPersistentPins } from "./pins.ts";
import { localReadLeaseProtocol, localStagingProtocol } from "./protocol-adapter.ts";
import {
  LocalDurableReadLease,
  listLocalDurableReadLeases,
} from "./read-lease.ts";
import { LocalRetain, LocalRetainRegistry } from "./retain.ts";
import { LocalCapabilitySerial } from "./serial.ts";
import {
  LocalStagingSet,
  listLocalDurableStaging,
  pruneExpiredLocalDurableStaging,
} from "./staging.ts";

const RECORD_STORE_BACKEND: unique symbol = Symbol("niceeval.record-store-backend/1");
const BACKEND_TRANSACTION: unique symbol = Symbol("niceeval.record-store-transaction/1");
const BACKEND_READ_LEASE: unique symbol = Symbol("niceeval.record-store-read-lease/1");
const BACKEND_MIRROR_INSTALL: unique symbol = Symbol("niceeval.record-store-mirror-install/1");
const BACKEND_GC_BARRIER: unique symbol = Symbol("niceeval.record-store-gc-barrier/1");
const READ_LEASE_DURATION_MS = 30_000;

export type LocalRecordStoreBackendState = "open" | "closing" | "closed";
export type LocalTransactionState = "active" | "committed" | "aborted" | "lease-lost" | "closed";
export type LocalReadLeaseState = "active" | "expired" | "closed";
export type LocalMirrorInstallState = "active" | "installed" | "aborted" | "lease-lost" | "closed";

export type LocalBackendRetainOwner =
  | { readonly kind: "record-store" }
  | { readonly kind: "record-handle"; readonly ref: RecordGraphRef }
  | { readonly kind: "record-writer"; readonly recordId: string }
  | { readonly kind: "record-source-reader"; readonly ref: RecordGraphRef }
  | { readonly kind: "gc" };

export type LocalBackendWriteOwner = Extract<
  LocalBackendRetainOwner,
  { readonly kind: "record-store" | "record-writer" }
>;

export type LocalBackendReadOwner = Extract<
  LocalBackendRetainOwner,
  { readonly kind: "record-handle" | "record-source-reader" }
>;

export type LocalBackendObjectReadResult =
  | LocalObjectReadResult<DescriptorV1>
  | {
      readonly state: "permission-denied" | "unavailable" | "io-failure";
      readonly ref: DescriptorV1;
      readonly cause: unknown;
    };

/** Object reads retain their physical cause as a structured edge, rather than throwing text. */
export interface LocalBackendObjectReader {
  readonly read: (ref: DescriptorV1) => Promise<LocalBackendObjectReadResult>;
}

export type LocalGraphAccessResult<A> =
  | { readonly state: "valid"; readonly value: A }
  | { readonly state: "invalid"; readonly failure: LocalGraphAccessFailure };

/**
 * The graph worker owns these operations. Store calls them at its transaction/barrier boundaries,
 * but never traverses a radix or derives a revision itself.
 */
export interface LocalRecordStoreGraphAccess {
  readonly validateCommit: (input: {
    readonly current: LayoutV2 | null;
    readonly expected: GraphRootRefV1 | null;
    readonly next: GraphRootRefV1;
    readonly layout: LayoutV2;
    readonly reader: LocalBackendObjectReader;
  }) => Promise<LocalGraphAccessResult<void>>;
  readonly committedGraphs: (
    layout: LayoutV2,
    reader: LocalBackendObjectReader,
  ) => Promise<LocalGraphAccessResult<readonly GraphRootRefV1[]>>;
  /** Graph owns the committed radix + complete strong-closure verification for an imported history. */
  readonly validateMirrorInstall: (input: {
    readonly layout: LayoutV2;
    readonly reader: LocalBackendObjectReader;
  }) => Promise<LocalGraphAccessResult<void>>;
}

/**
 * The snapshot parser/brand lives in the mirror/protocol layer. Store accepts its typed value
 * generically and asks this adapter for the already identity-verified frozen Layout; it never
 * recreates a second structural RecordMirrorSnapshot type or permits a snapshot-less install.
 */
export interface LocalMirrorSnapshotAccess<Snapshot> {
  readonly verifySnapshot: (snapshot: Snapshot) => Promise<LocalGraphAccessResult<LayoutV2>>;
}

export interface LocalStagedObject {
  readonly ref: DescriptorV1;
  readonly bytes: Uint8Array;
}

/** Caller supplies graph-produced Layout + committed-root pages; Store owns the atomic installation. */
export interface LocalCommitPlan {
  readonly next: GraphRootRefV1;
  readonly layout: LayoutV2;
  readonly objects?: readonly LocalStagedObject[];
}

export type LocalCommitResult =
  | { readonly state: "committed"; readonly graph: RecordGraphRef }
  | {
      readonly state: "head-conflict";
      readonly expected: GraphRootRefV1 | null;
      readonly actual: GraphRootRefV1 | null;
    }
  | { readonly state: "record-id-mismatch"; readonly expectedRecordId: string; readonly actualRecordId: string }
  | { readonly state: "graph-invalid"; readonly failure: LocalGraphAccessFailure }
  | { readonly state: "object-failed"; readonly result: Exclude<LocalObjectPutResult<DescriptorV1>, { readonly state: "stored" | "already-present" }> };

export type LocalMirrorInstallResult =
  | { readonly state: "installed"; readonly graph: RecordGraphRef }
  | { readonly state: "snapshot-layout-mismatch" }
  | { readonly state: "initialize-conflict"; readonly expected: null; readonly actual: LayoutV2 }
  | { readonly state: "graph-invalid"; readonly failure: LocalGraphAccessFailure }
  | { readonly state: "object-failed"; readonly result: Exclude<LocalObjectPutResult<DescriptorV1>, { readonly state: "stored" | "already-present" }> };

export type LocalBackendGcRoot =
  | { readonly kind: "committed"; readonly graph: GraphRootRefV1 }
  | {
      readonly kind: "staging";
      readonly transactionId: string;
      readonly fencingToken: string;
      readonly protectUntil: string;
      readonly roots: readonly DescriptorV1[];
    }
  | { readonly kind: "read-lease"; readonly owner: LocalBackendReadOwner; readonly ref: RecordGraphRef }
  | { readonly kind: "persistent-pin"; readonly pinId: string; readonly root: DescriptorV1 };

type LocalLayoutTransition =
  | { readonly state: "valid" }
  | {
      readonly state: "head-conflict";
      readonly expected: GraphRootRefV1 | null;
      readonly actual: GraphRootRefV1 | null;
    }
  | { readonly state: "record-id-mismatch"; readonly expectedRecordId: string; readonly actualRecordId: string }
  | { readonly state: "graph-invalid"; readonly failure: LocalGraphAccessFailure };

export interface LocalBackendGcSnapshot {
  readonly layout: LayoutV2 | null;
  readonly roots: readonly LocalBackendGcRoot[];
}

function graphRef(layout: LayoutV2): RecordGraphRef {
  return Object.freeze({ recordId: layout.recordId, graph: layout.head });
}

function isWriteOwner(owner: LocalBackendRetainOwner): owner is LocalBackendWriteOwner {
  return owner.kind === "record-store" || owner.kind === "record-writer";
}

function isReadOwner(owner: LocalBackendRetainOwner): owner is LocalBackendReadOwner {
  return owner.kind === "record-handle" || owner.kind === "record-source-reader";
}

function sameHead(left: GraphRootRefV1 | null, right: GraphRootRefV1 | null): boolean {
  return left === null ? right === null : right !== null && typedReferenceEquals(left, right);
}

function isStoredObject(
  result: LocalObjectPutResult<DescriptorV1>,
): result is Extract<LocalObjectPutResult<DescriptorV1>, { readonly state: "stored" | "already-present" }> {
  return result.state === "stored" || result.state === "already-present";
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

/**
 * A transaction owns both an independent backend retain and a write lease. `putObject` adds to
 * durable staging under the same GC admission operation; commit only removes staging after the
 * single atomic Layout replacement and its durable commit marker.
 */
export class LocalBackendTransaction implements AsyncDisposable {
  readonly [BACKEND_TRANSACTION]: "niceeval.record-backend-transaction/1" = "niceeval.record-backend-transaction/1";
  #state: LocalTransactionState = "active";
  #operations = new LocalCapabilitySerial();
  #abortResult: Promise<void> | undefined;
  #closeResult: Promise<void> | undefined;
  #retainReleased = false;
  #terminalCleanupComplete = false;
  #leaseLostFailure: LocalStoreLeaseLostError | undefined;

  constructor(
    private readonly backend: LocalRecordStoreBackend,
    private readonly retain: LocalRetain<LocalBackendWriteOwner>,
    private readonly lease: LocalWriteLease,
    private readonly staging: LocalStagingSet<DescriptorV1>,
    readonly expected: GraphRootRefV1 | null,
  ) {}

  get state(): LocalTransactionState {
    return this.#state;
  }

  async putObject(ref: DescriptorV1, bytes: Uint8Array): Promise<LocalObjectPutResult<DescriptorV1>> {
    return this.#operations.run(() => this.putObjectOnce(ref, bytes));
  }

  private async putObjectOnce(
    ref: DescriptorV1,
    bytes: Uint8Array,
  ): Promise<LocalObjectPutResult<DescriptorV1>> {
    this.assertActive();
    try {
      return await this.backend.mutation(async () => {
        await this.lease.assertActive();
        await this.staging.extendProtectUntil(this.lease.stagingProtectUntil);
        const result = await this.backend.foundation.objects.put(ref, bytes);
        if (isStoredObject(result)) {
          await this.staging.add(ref);
        }
        return result;
      });
    } catch (cause) {
      this.noteLeaseLoss(cause);
      throw cause;
    }
  }

  async renew(): Promise<void> {
    return this.#operations.run(() => this.renewOnce());
  }

  private async renewOnce(): Promise<void> {
    this.assertActive();
    try {
      await this.backend.mutation(async () => {
        await this.lease.assertActive();
        const renewal = this.lease.planRenewal();
        // A failed lease write after this point leaves conservative extra staging retention,
        // never an unprotected live lease.
        await this.staging.extendProtectUntil(renewal.stagingProtectUntil);
        await this.lease.renew(renewal);
      });
    } catch (cause) {
      this.noteLeaseLoss(cause);
      throw cause;
    }
  }

  async commit(plan: LocalCommitPlan): Promise<LocalCommitResult> {
    return this.#operations.run(() => this.commitOnce(plan));
  }

  private async commitOnce(plan: LocalCommitPlan): Promise<LocalCommitResult> {
    this.assertActive();
    try {
      return await this.backend.mutation(async () => {
        await this.lease.assertActive();
        await this.staging.extendProtectUntil(this.lease.stagingProtectUntil);
        for (const object of plan.objects ?? []) {
          const result = await this.backend.putWithinTransaction(this.staging, object.ref, object.bytes);
          if (!isStoredObject(result)) {
            return { state: "object-failed", result };
          }
        }

        const snapshot = await this.backend.foundation.readLayoutSnapshot();
        const actual = snapshot.layout?.head ?? null;
        if (!sameHead(this.expected, actual)) {
          return { state: "head-conflict", expected: this.expected, actual };
        }
        const localValidation = validateLayoutTransition(snapshot.layout, this.expected, plan);
        if (localValidation.state !== "valid") return localValidation;

        const graphValidation = await this.backend.graph.validateCommit({
          current: snapshot.layout,
          expected: this.expected,
          next: plan.next,
          layout: plan.layout,
          reader: this.backend.objectReader,
        });
        if (graphValidation.state === "invalid") {
          return { state: "graph-invalid", failure: graphValidation.failure };
        }

        const nextBytes = this.backend.foundation.encodeLayout(plan.layout);
        await writePreparedJournal(this.backend.foundation.paths, {
          transactionId: this.lease.transactionId,
          fencingToken: this.lease.fencingToken,
          expectedLayout: snapshot.bytes === undefined ? null : bytesDigest(snapshot.bytes),
          nextLayout: bytesDigest(nextBytes),
          nextGeneration: plan.layout.generation,
        });

        // Fencing is checked immediately before the only mutable replacement; a stale writer
        // cannot move head after a newer lease has won even if all objects were already staged.
        await this.lease.assertActive();
        await this.backend.foundation.writeLayoutBytes(nextBytes);
        await markJournalCommitted(this.backend.foundation.paths, {
          schema: "niceeval.record-store-journal/1",
          transactionId: this.lease.transactionId,
          fencingToken: this.lease.fencingToken,
          phase: "prepare",
          expectedLayout: snapshot.bytes === undefined ? null : bytesDigest(snapshot.bytes),
          nextLayout: bytesDigest(nextBytes),
          nextGeneration: plan.layout.generation,
        });

        await this.staging.close();
        await this.lease.release();
        this.#state = "committed";
        return { state: "committed", graph: graphRef(plan.layout) };
      });
    } catch (cause) {
      this.noteLeaseLoss(cause);
      throw cause;
    }
  }

  async abort(): Promise<void> {
    if (this.#abortResult !== undefined) return this.#abortResult;
    // Architecture fixes abort's first settled result. Queue it so a concurrent commit/renew
    // reaches its own lease check before terminal cleanup begins.
    const result = this.#operations.run(() => this.abortOnce());
    this.#abortResult = result;
    try {
      await result;
    } catch (cause) {
      // A failed terminal cleanup must remain retryable. A successfully cleaned-up lost lease,
      // in contrast, retains its first precise LocalStoreLeaseLostError as abort's settled result.
      if (!this.#terminalCleanupComplete && this.#abortResult === result) {
        this.#abortResult = undefined;
      }
      throw cause;
    }
  }

  async close(): Promise<void> {
    if (this.#closeResult !== undefined) return this.#closeResult;
    // abort is enqueued first; methods invoked after close queue behind this terminal operation.
    const abortResult = this.requiresTerminalCleanup() ? this.abort() : undefined;
    const result = this.#operations.run(() => this.closeOnce(abortResult));
    this.#closeResult = result;
    try {
      await result;
    } catch (cause) {
      // A cached abort failure remains the transaction result. Retain cleanup failure is the one
      // case that must permit another close attempt, otherwise the capability would leak it.
      if (!this.#retainReleased && this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async abortOnce(): Promise<void> {
    if (this.#state === "committed" || this.#state === "closed") return;
    if (this.#state === "lease-lost") {
      await this.cleanupLostLease();
      throw this.leaseLostFailure();
    }
    try {
      await this.backend.mutation(async () => {
        await this.lease.assertActive();
        await this.staging.close();
        await this.lease.release();
      });
      this.#terminalCleanupComplete = true;
      this.#state = "aborted";
    } catch (cause) {
      this.noteLeaseLoss(cause);
      if (cause instanceof LocalStoreLeaseLostError) {
        // The exact lost-lease failure is saved before cleanup. Cleanup deliberately does not
        // assert active: it may remove only our still-owned record, never a successor's.
        await this.cleanupLostLease();
        throw this.leaseLostFailure();
      }
      throw cause;
    }
  }

  private async closeOnce(abortResult: Promise<void> | undefined): Promise<void> {
    let abortFailed = false;
    let abortFailure: unknown;
    try {
      if (abortResult !== undefined) await abortResult;
    } catch (cause) {
      abortFailed = true;
      abortFailure = cause;
    }
    if (this.requiresTerminalCleanup()) {
      // staging.close()/lease.release() failed. Keep the retain and the admission capability
      // alive so a later abort/close can finish exact-owner cleanup instead of faking closure.
      if (abortFailed) throw abortFailure;
      return;
    }
    try {
      // A lost lease makes abort reject by contract, but it must not strand the transaction's
      // independent retain and keep a closed public Store alive forever.
      await this.retain.close();
      this.#retainReleased = true;
    } catch (cause) {
      // The retain itself is still live, so this cleanup failure is the actionable result and a
      // later close must retry it rather than hiding it behind the historical lease-loss error.
      throw cause;
    }
    if (this.#retainReleased && this.#state !== "lease-lost") this.#state = "closed";
    if (abortFailed) throw abortFailure;
  }

  private assertActive(): void {
    if (this.#state !== "active") {
      throw new LocalStoreClosedError({ operation: "begin-write" });
    }
  }

  private noteLeaseLoss(cause: unknown): void {
    if (cause instanceof LocalStoreLeaseLostError) {
      this.#state = "lease-lost";
      if (this.#leaseLostFailure === undefined) this.#leaseLostFailure = cause;
    }
  }

  /** Lost leases still own their pre-existing staging file until exact-owner release finishes. */
  private async cleanupLostLease(): Promise<void> {
    if (this.#terminalCleanupComplete) return;
    await this.backend.mutation(async () => {
      await this.staging.close();
      await this.lease.release();
    });
    this.#terminalCleanupComplete = true;
  }

  private leaseLostFailure(): LocalStoreLeaseLostError {
    if (this.#leaseLostFailure !== undefined) return this.#leaseLostFailure;
    // `lease-lost` is assigned only by noteLeaseLoss above. This is an internal invariant guard,
    // not a substitute for a fresh assertActive() that could block exact-owner cleanup.
    throw new LocalStoreClosedError({ operation: "begin-write" });
  }

  private requiresTerminalCleanup(): boolean {
    return (
      (this.#state === "active" || this.#state === "lease-lost") &&
      !this.#terminalCleanupComplete
    );
  }
}

/**
 * Dedicated imported-history installer. It is intentionally not a `commit` overload: the caller
 * must provide a typed snapshot adapter, uses expected:null forever, stages every copied raw
 * object, and atomically makes the one complete Layout visible only after graph verification.
 */
export class LocalBackendMirrorInstall<Snapshot> implements AsyncDisposable {
  readonly [BACKEND_MIRROR_INSTALL]: "niceeval.record-backend-mirror-install/1" = "niceeval.record-backend-mirror-install/1";
  readonly expected: null = null;
  #state: LocalMirrorInstallState = "active";
  #operations = new LocalCapabilitySerial();
  #abortResult: Promise<void> | undefined;
  #closeResult: Promise<void> | undefined;
  #retainReleased = false;
  #terminalCleanupComplete = false;
  #leaseLostFailure: LocalStoreLeaseLostError | undefined;

  constructor(
    private readonly backend: LocalRecordStoreBackend,
    private readonly retain: LocalRetain<LocalBackendWriteOwner>,
    private readonly lease: LocalWriteLease,
    private readonly staging: LocalStagingSet<DescriptorV1>,
    private readonly snapshot: Snapshot,
    private readonly snapshotLayout: LayoutV2,
  ) {}

  get state(): LocalMirrorInstallState {
    return this.#state;
  }

  async putObject(ref: DescriptorV1, bytes: Uint8Array): Promise<LocalObjectPutResult<DescriptorV1>> {
    return this.#operations.run(() => this.putObjectOnce(ref, bytes));
  }

  private async putObjectOnce(
    ref: DescriptorV1,
    bytes: Uint8Array,
  ): Promise<LocalObjectPutResult<DescriptorV1>> {
    this.assertActive();
    try {
      return await this.backend.mutation(async () => {
        await this.lease.assertActive();
        await this.staging.extendProtectUntil(this.lease.stagingProtectUntil);
        return this.backend.putWithinTransaction(this.staging, ref, bytes);
      });
    } catch (cause) {
      this.noteLeaseLoss(cause);
      throw cause;
    }
  }

  async renew(): Promise<void> {
    return this.#operations.run(() => this.renewOnce());
  }

  private async renewOnce(): Promise<void> {
    this.assertActive();
    try {
      await this.backend.mutation(async () => {
        await this.lease.assertActive();
        const renewal = this.lease.planRenewal();
        await this.staging.extendProtectUntil(renewal.stagingProtectUntil);
        await this.lease.renew(renewal);
      });
    } catch (cause) {
      this.noteLeaseLoss(cause);
      throw cause;
    }
  }

  async install(layout: LayoutV2): Promise<LocalMirrorInstallResult> {
    return this.#operations.run(() => this.installOnce(layout));
  }

  private async installOnce(layout: LayoutV2): Promise<LocalMirrorInstallResult> {
    this.assertActive();
    try {
      return await this.backend.mutation(async () => {
        await this.lease.assertActive();
        await this.staging.extendProtectUntil(this.lease.stagingProtectUntil);
        const expectedBytes = this.backend.foundation.encodeLayout(this.snapshotLayout);
        const candidateBytes = this.backend.foundation.encodeLayout(layout);
        if (!sameBytes(expectedBytes, candidateBytes)) return { state: "snapshot-layout-mismatch" };

        const current = await this.backend.foundation.readLayoutSnapshot();
        if (current.layout !== null) {
          return { state: "initialize-conflict", expected: null, actual: current.layout };
        }

        const graphValidation = await this.backend.graph.validateMirrorInstall({
          layout,
          reader: this.backend.objectReader,
        });
        if (graphValidation.state === "invalid") {
          return { state: "graph-invalid", failure: graphValidation.failure };
        }

        await writePreparedJournal(this.backend.foundation.paths, {
          transactionId: this.lease.transactionId,
          fencingToken: this.lease.fencingToken,
          expectedLayout: null,
          nextLayout: bytesDigest(candidateBytes),
          nextGeneration: layout.generation,
        });
        // Recheck the durable fencing record immediately before the sole mutable replacement.
        await this.lease.assertActive();
        await this.backend.foundation.writeLayoutBytes(candidateBytes);
        await markJournalCommitted(this.backend.foundation.paths, {
          schema: "niceeval.record-store-journal/1",
          transactionId: this.lease.transactionId,
          fencingToken: this.lease.fencingToken,
          phase: "prepare",
          expectedLayout: null,
          nextLayout: bytesDigest(candidateBytes),
          nextGeneration: layout.generation,
        });
        await this.staging.close();
        await this.lease.release();
        this.#state = "installed";
        return { state: "installed", graph: graphRef(layout) };
      });
    } catch (cause) {
      this.noteLeaseLoss(cause);
      throw cause;
    }
  }

  async abort(): Promise<void> {
    if (this.#abortResult !== undefined) return this.#abortResult;
    const result = this.#operations.run(() => this.abortOnce());
    this.#abortResult = result;
    try {
      await result;
    } catch (cause) {
      if (!this.#terminalCleanupComplete && this.#abortResult === result) {
        this.#abortResult = undefined;
      }
      throw cause;
    }
  }

  async close(): Promise<void> {
    if (this.#closeResult !== undefined) return this.#closeResult;
    const abortResult = this.requiresTerminalCleanup() ? this.abort() : undefined;
    const result = this.#operations.run(() => this.closeOnce(abortResult));
    this.#closeResult = result;
    try {
      await result;
    } catch (cause) {
      if (!this.#retainReleased && this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async abortOnce(): Promise<void> {
    if (this.#state === "installed" || this.#state === "closed") return;
    if (this.#state === "lease-lost") {
      await this.cleanupLostLease();
      throw this.leaseLostFailure();
    }
    try {
      await this.backend.mutation(async () => {
        await this.lease.assertActive();
        await this.staging.close();
        await this.lease.release();
      });
      this.#terminalCleanupComplete = true;
      this.#state = "aborted";
    } catch (cause) {
      this.noteLeaseLoss(cause);
      if (cause instanceof LocalStoreLeaseLostError) {
        await this.cleanupLostLease();
        throw this.leaseLostFailure();
      }
      throw cause;
    }
  }

  private async closeOnce(abortResult: Promise<void> | undefined): Promise<void> {
    let abortFailed = false;
    let abortFailure: unknown;
    try {
      if (abortResult !== undefined) await abortResult;
    } catch (cause) {
      abortFailed = true;
      abortFailure = cause;
    }
    if (this.requiresTerminalCleanup()) {
      if (abortFailed) throw abortFailure;
      return;
    }
    try {
      await this.retain.close();
      this.#retainReleased = true;
    } catch (cause) {
      throw cause;
    }
    if (this.#retainReleased && this.#state !== "lease-lost") this.#state = "closed";
    if (abortFailed) throw abortFailure;
  }

  private assertActive(): void {
    if (this.#state !== "active") throw new LocalStoreClosedError({ operation: "mirror-install" });
  }

  private noteLeaseLoss(cause: unknown): void {
    if (cause instanceof LocalStoreLeaseLostError) {
      this.#state = "lease-lost";
      if (this.#leaseLostFailure === undefined) this.#leaseLostFailure = cause;
    }
  }

  private async cleanupLostLease(): Promise<void> {
    if (this.#terminalCleanupComplete) return;
    await this.backend.mutation(async () => {
      await this.staging.close();
      await this.lease.release();
    });
    this.#terminalCleanupComplete = true;
  }

  private leaseLostFailure(): LocalStoreLeaseLostError {
    if (this.#leaseLostFailure !== undefined) return this.#leaseLostFailure;
    throw new LocalStoreClosedError({ operation: "mirror-install" });
  }

  private requiresTerminalCleanup(): boolean {
    return (
      (this.#state === "active" || this.#state === "lease-lost") &&
      !this.#terminalCleanupComplete
    );
  }
}

export class LocalBackendReadLease implements AsyncDisposable {
  readonly [BACKEND_READ_LEASE]: "niceeval.record-backend-read-lease/1" = "niceeval.record-backend-read-lease/1";
  #state: LocalReadLeaseState = "active";
  #expiresAt: number;
  #operations = new LocalCapabilitySerial();
  #closeRequested = false;
  #closeResult: Promise<void> | undefined;
  #leaseClosed = false;
  #retainReleased = false;

  constructor(
    private readonly backend: LocalRecordStoreBackend,
    private readonly retain: LocalRetain<LocalBackendReadOwner>,
    readonly owner: LocalBackendReadOwner,
    readonly ref: RecordGraphRef,
    private readonly lease: LocalDurableReadLease,
    private readonly durationMs: number,
  ) {
    this.#expiresAt = Date.parse(lease.expiresAt);
  }

  get state(): LocalReadLeaseState {
    return this.#state;
  }

  get expiresAt(): string {
    return new Date(this.#expiresAt).toISOString();
  }

  async readObject(ref: DescriptorV1): Promise<LocalObjectReadResult<DescriptorV1>> {
    this.assertAdmission();
    return this.backend.foundation.objects.read(ref);
  }

  async renew(): Promise<void> {
    this.assertAdmission();
    return this.#operations.run(() => this.renewOnce());
  }

  private async renewOnce(): Promise<void> {
    this.assertActive();
    await this.backend.mutation(async () => {
      this.assertActive();
      const expiresAt = Date.now() + this.durationMs;
      await this.lease.renew(new Date(expiresAt).toISOString());
      this.#expiresAt = expiresAt;
    });
  }

  async close(): Promise<void> {
    if (this.#leaseClosed && this.#retainReleased) return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    this.#closeRequested = true;
    const result = this.#operations.run(() => this.closeOnce());
    this.#closeResult = result;
    try {
      await result;
    } catch (cause) {
      // The durable lease or independent retain remains live on failure; retain the explicit
      // closing admission and let a later close resume cleanup rather than resurrecting a lease.
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private assertActive(): void {
    if (this.#state === "active" && Date.now() >= this.#expiresAt) this.#state = "expired";
    if (this.#state !== "active") {
      throw new LocalStoreReadLeaseError({ reason: this.#state === "expired" ? "expired" : "closed" });
    }
  }

  private assertAdmission(): void {
    if (this.#closeRequested) throw new LocalStoreReadLeaseError({ reason: "closed" });
    this.assertActive();
  }

  private async closeOnce(): Promise<void> {
    if (!this.#leaseClosed) {
      await this.backend.mutation(async () => {
        await this.lease.close();
        this.#leaseClosed = true;
        this.#state = "closed";
      });
    }
    if (!this.#retainReleased) {
      await this.retain.close();
      this.#retainReleased = true;
    }
  }
}

export class LocalBackendGcBarrier implements AsyncDisposable {
  readonly [BACKEND_GC_BARRIER]: "niceeval.record-backend-gc-barrier/1" = "niceeval.record-backend-gc-barrier/1";
  #closed = false;
  #permitClosed = false;
  #retainReleased = false;
  #closeResult: Promise<void> | undefined;

  constructor(
    private readonly retain: LocalRetain<{ readonly kind: "gc" }>,
    private readonly permit: LocalStoreGcBarrierPermit,
    readonly snapshot: LocalBackendGcSnapshot,
  ) {}

  get state(): "active" | "closed" {
    return this.#closed ? "closed" : "active";
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    const result = this.closeOnce();
    this.#closeResult = result;
    try {
      await result;
      this.#closed = true;
    } catch (cause) {
      // A failed durable barrier cleanup retains both this capability and its GC retain. Repeating
      // close resumes at the unfinished step instead of falsely exposing a closed snapshot.
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async closeOnce(): Promise<void> {
    // Barrier release is the lifecycle linearization point: end durable/local blocking first,
    // then and only then free the independent retain that keeps the backend alive.
    if (!this.#permitClosed) {
      await this.permit.close();
      this.#permitClosed = true;
    }
    if (!this.#retainReleased) {
      await this.retain.close();
      this.#retainReleased = true;
    }
  }
}

/**
 * The raw pin file is deliberately not returned: releasing it must re-enter the same local +
 * cross-process mutation admission as pin creation, otherwise an unpin could race a GC snapshot.
 */
export class LocalBackendPersistentPin implements AsyncDisposable {
  #closed = false;
  #pinClosed = false;
  #retainReleased = false;
  #closeResult: Promise<void> | undefined;
  #operations = new LocalCapabilitySerial();

  constructor(
    private readonly backend: LocalRecordStoreBackend,
    private readonly pin: LocalPersistentPin<DescriptorV1>,
    private readonly retain: LocalRetain<{ readonly kind: "gc" }>,
  ) {}

  get pinId(): string {
    return this.pin.pinId;
  }

  get root(): DescriptorV1 {
    return this.pin.root;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    const result = this.#operations.run(() => this.closeOnce());
    this.#closeResult = result;
    try {
      await result;
      this.#closed = true;
    } catch (cause) {
      // The persistent file remains protected until its durable deletion succeeds; retain stays
      // held until then so this escaped capability cannot outlive backend finalization.
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async closeOnce(): Promise<void> {
    if (!this.#pinClosed) {
      await this.backend.mutation(() => this.pin.close());
      this.#pinClosed = true;
    }
    if (!this.#retainReleased) {
      await this.retain.close();
      this.#retainReleased = true;
    }
  }
}

/**
 * A failed staging creation, or a post-operation admission-finalizer failure, can leave an
 * exact-owned staging/lease pair without a transaction object to expose it. Keep both resources
 * and their transaction retain internally until a later write admission or backend close
 * completes cleanup; otherwise a transient failure would turn into a same-process busy lock with
 * no capability left to retry.
 */
class LocalPendingWriteLeaseCleanup implements AsyncDisposable {
  #closed = false;
  #stagingClosed = false;
  #leaseReleased = false;
  #retainReleased = false;
  #closeResult: Promise<void> | undefined;

  constructor(
    private readonly backend: LocalRecordStoreBackend,
    private readonly lease: LocalWriteLease,
    private readonly staging: LocalStagingSet<DescriptorV1> | undefined,
    private readonly retain: LocalRetain<LocalBackendWriteOwner>,
  ) {
    this.#stagingClosed = staging === undefined;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    const result = this.closeOnce();
    this.#closeResult = result;
    try {
      await result;
      this.#closed = true;
    } catch (cause) {
      // The lease and its independent retain remain available for a later exact-owner retry.
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async closeOnce(): Promise<void> {
    if (!this.#stagingClosed || !this.#leaseReleased) {
      await this.backend.mutation(async () => {
        if (this.staging !== undefined && !this.#stagingClosed) {
          await this.staging.close();
        }
        if (!this.#leaseReleased) {
          await this.lease.release();
        }
      });
      this.#stagingClosed = true;
      this.#leaseReleased = true;
    }
    if (!this.#retainReleased) {
      await this.retain.close();
      this.#retainReleased = true;
    }
  }
}

export class LocalRecordStoreBackend implements AsyncDisposable {
  readonly [RECORD_STORE_BACKEND]: "niceeval.record-store-backend/1" = "niceeval.record-store-backend/1";
  readonly objectReader: LocalBackendObjectReader;
  readonly #retains: LocalRetainRegistry<LocalBackendRetainOwner>;
  // A pin whose creation operation completed but whose admission finalizer then failed has no
  // caller-visible handle. Keep an internal capability/retain until a later cleanup succeeds so
  // it is never silently converted into an unowned permanent GC root.
  readonly #pendingPinCleanup = new Set<LocalBackendPersistentPin>();
  readonly #pendingWriteLeaseCleanup = new Set<LocalPendingWriteLeaseCleanup>();
  readonly #transferredWriteRetains = new WeakSet<LocalRetain<LocalBackendWriteOwner>>();

  private constructor(
    readonly foundation: LocalStoreFoundation,
    readonly graph: LocalRecordStoreGraphAccess,
  ) {
    this.#retains = new LocalRetainRegistry(async () => this.finalize());
    this.objectReader = Object.freeze({
      read: async (ref: DescriptorV1): Promise<LocalBackendObjectReadResult> => {
        try {
          return await foundation.objects.read(ref);
        } catch (cause) {
          return localBackendObjectReadFailure(ref, cause);
        }
      },
    });
  }

  get state(): LocalRecordStoreBackendState {
    return this.#retains.state;
  }

  static async create(
    root: string | URL,
    graph: LocalRecordStoreGraphAccess,
  ): Promise<LocalRecordStoreBackend> {
    return new LocalRecordStoreBackend(await LocalStoreFoundation.create(root), graph);
  }

  static async open(
    root: string | URL,
    graph: LocalRecordStoreGraphAccess,
  ): Promise<LocalRecordStoreBackend> {
    return new LocalRecordStoreBackend(await LocalStoreFoundation.open(root), graph);
  }

  retain<Owner extends LocalBackendRetainOwner>(owner: Owner): LocalRetain<Owner> {
    return this.#retains.retain(owner);
  }

  async readLayout(retain: LocalRetain<LocalBackendRetainOwner>): Promise<LayoutV2 | null> {
    this.assertHeld(retain, "retain");
    return this.foundation.readLayout();
  }

  async beginWrite(
    retain: LocalRetain<LocalBackendWriteOwner>,
    expected: GraphRootRefV1 | null,
  ): Promise<LocalBackendTransaction> {
    this.assertHeld(retain, "begin-write");
    if (!isWriteOwner(retain.owner)) throw new LocalStoreClosedError({ operation: "begin-write" });
    const transactionRetain = this.#retains.retain(retain.owner, "begin-write");
    try {
      const staged = await this.acquireStagedLease(transactionRetain);
      return new LocalBackendTransaction(this, transactionRetain, staged.lease, staged.staging, expected);
    } catch (cause) {
      if (!this.#transferredWriteRetains.has(transactionRetain)) {
        await transactionRetain.close();
      }
      throw cause;
    }
  }

  /**
   * Mirror is a separate expected:null path. `snapshotAccess` is supplied by the typed snapshot
   * owner and must validate brand/identity before Store accepts the resulting frozen Layout.
   */
  async beginMirrorInstall<Snapshot>(
    retain: LocalRetain<LocalBackendWriteOwner>,
    snapshot: Snapshot,
    snapshotAccess: LocalMirrorSnapshotAccess<Snapshot>,
  ): Promise<LocalBackendMirrorInstall<Snapshot>> {
    this.assertHeld(retain, "begin-write");
    if (!isWriteOwner(retain.owner)) throw new LocalStoreClosedError({ operation: "mirror-install" });
    const verifiedSnapshot = await snapshotAccess.verifySnapshot(snapshot);
    if (verifiedSnapshot.state === "invalid") {
      throw new LocalStoreGraphAccessError({
        operation: "validate-mirror-snapshot",
        failure: verifiedSnapshot.failure,
      });
    }
    const installRetain = this.#retains.retain(retain.owner, "mirror-install");
    try {
      const staged = await this.acquireStagedLease(installRetain);
      return new LocalBackendMirrorInstall(
        this,
        installRetain,
        staged.lease,
        staged.staging,
        snapshot,
        verifiedSnapshot.value,
      );
    } catch (cause) {
      if (!this.#transferredWriteRetains.has(installRetain)) {
        await installRetain.close();
      }
      throw cause;
    }
  }

  async openRead(
    retain: LocalRetain<LocalBackendReadOwner>,
    ref: RecordGraphRef,
  ): Promise<LocalBackendReadLease> {
    this.assertHeld(retain, "open-read");
    if (!isReadOwner(retain.owner)) throw new LocalStoreClosedError({ operation: "open-read" });
    const readRetain = this.#retains.retain(retain.owner, "open-read");
    try {
      const expiresAt = new Date(Date.now() + READ_LEASE_DURATION_MS).toISOString();
      const lease = await this.mutation(() =>
        LocalDurableReadLease.create(
          this.foundation.paths,
          randomUUID(),
          retain.owner,
          ref,
          expiresAt,
          localReadLeaseProtocol,
        )
      );
      return new LocalBackendReadLease(this, readRetain, retain.owner, ref, lease, READ_LEASE_DURATION_MS);
    } catch (cause) {
      await readRetain.close();
      throw cause;
    }
  }

  async beginGcBarrier(
    retain: LocalRetain<{ readonly kind: "gc" }>,
  ): Promise<LocalBackendGcBarrier> {
    this.assertHeld(retain, "begin-gc");
    const permit = await this.foundation.beginGcBarrier();
    try {
      // This is the safe cleanup point: both local and file-global barriers are held, so no
      // writer can renew/put/abort/commit while an elapsed durable staging record is removed.
      const snapshotAt = Date.now();
      await pruneExpiredLocalDurableStaging(this.foundation.paths, snapshotAt);
      const layout = await this.foundation.readLayout();
      const roots: LocalBackendGcRoot[] = [];
      if (layout !== null) {
        const committed = await this.graph.committedGraphs(layout, this.objectReader);
        if (committed.state === "invalid") {
          throw new LocalStoreGraphAccessError({
            operation: "enumerate-committed-roots",
            failure: committed.failure,
          });
        }
        for (const graph of committed.value) roots.push(Object.freeze({ kind: "committed", graph }));
      }
      for (const staging of await listLocalDurableStaging(
        this.foundation.paths,
        localStagingProtocol,
        snapshotAt,
      )) {
        roots.push(Object.freeze({
          kind: "staging",
          transactionId: staging.transactionId,
          fencingToken: staging.fencingToken,
          protectUntil: staging.protectUntil,
          roots: staging.roots,
        }));
      }
      for (const read of await listLocalDurableReadLeases(
        this.foundation.paths,
        localReadLeaseProtocol,
        snapshotAt,
      )) {
        roots.push(Object.freeze({ kind: "read-lease", owner: read.owner, ref: read.ref }));
      }
      for (const pin of await listLocalPersistentPins(this.foundation.paths, localStagingProtocol)) {
        roots.push(Object.freeze({ kind: "persistent-pin", pinId: pin.pinId, root: pin.root }));
      }
      // The source retain must remain live throughout beginGcBarrier(). Once the immutable
      // snapshot is complete, obtain the returned capability's independent retain synchronously;
      // this avoids creating an unreachable retained barrier when snapshot validation itself fails.
      this.assertHeld(retain, "begin-gc");
      const gcRetain = this.#retains.retain<{ readonly kind: "gc" }>({ kind: "gc" }, "begin-gc");
      return new LocalBackendGcBarrier(gcRetain, permit, Object.freeze({ layout, roots: Object.freeze(roots) }));
    } catch (cause) {
      // There is no returned independent retain on this path. A cleanup failure remains
      // observable rather than pretending the durable/local barrier was released.
      await permit.close();
      throw cause;
    }
  }

  async pin(root: DescriptorV1): Promise<LocalBackendPersistentPin> {
    // Pin is an escaped backend capability, not a scoped helper: its independent retain keeps
    // filesystem state available until durable unpin has completed.
    const pinRetain = this.#retains.retain<{ readonly kind: "gc" }>({ kind: "gc" });
    let created: LocalPersistentPin<DescriptorV1> | undefined;
    try {
      await this.mutation(async () => {
        created = await LocalPersistentPin.create(this.foundation.paths, root, localStagingProtocol);
      });
      if (created === undefined) {
        // A successful mutation always assigns `created`; keep this typed invariant guard at the
        // ownership boundary rather than manufacturing an unretained pin capability.
        await pinRetain.close();
        throw new LocalStoreClosedError({ operation: "retain" });
      }
      return new LocalBackendPersistentPin(this, created, pinRetain);
    } catch (cause) {
      if (created === undefined) {
        await pinRetain.close();
        throw cause;
      }
      // `mutation` can reject after its operation has created the durable pin (for example, an
      // admission-ticket cleanup failure). Before surfacing that failure, exact-unpin the pin
      // through a normal mutation. If this cleanup itself fails, preserve its typed failure and
      // retain an internal capability so the root remains owned and backend.close can retry it.
      const pending = new LocalBackendPersistentPin(this, created, pinRetain);
      try {
        await pending.close();
      } catch (cleanupCause) {
        this.#pendingPinCleanup.add(pending);
        throw cleanupCause;
      }
      throw cause;
    }
  }

  async close(): Promise<void> {
    await this.drainPendingWriteLeaseCleanup();
    await this.drainPendingPinCleanup();
    await this.#retains.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  async mutation<A>(operation: () => Promise<A>): Promise<A> {
    return this.foundation.mutation(operation);
  }

  async putWithinTransaction(
    staging: LocalStagingSet<DescriptorV1>,
    ref: DescriptorV1,
    bytes: Uint8Array,
  ): Promise<LocalObjectPutResult<DescriptorV1>> {
    const result = await this.foundation.objects.put(ref, bytes);
    if (result.state === "stored" || result.state === "already-present") await staging.add(ref);
    return result;
  }

  private async acquireStagedLease(
    cleanupRetain: LocalRetain<LocalBackendWriteOwner>,
  ): Promise<{
    readonly lease: LocalWriteLease;
    readonly staging: LocalStagingSet<DescriptorV1>;
  }> {
    // Retry any prior exact-owned release before attempting a new lease. This is outside the
    // following mutation because the pending capability takes its own Store admission.
    await this.drainPendingWriteLeaseCleanup();
    let lease: LocalWriteLease | undefined;
    let staging: LocalStagingSet<DescriptorV1> | undefined;
    try {
      await this.mutation(async () => {
        lease = await LocalWriteLease.acquire(this.foundation.paths);
        staging = await LocalStagingSet.create(
          this.foundation.paths,
          lease.transactionId,
          lease.fencingToken,
          lease.stagingProtectUntil,
          localStagingProtocol,
        );
      });
    } catch (cause) {
      if (lease !== undefined) {
        // The outer mutation can fail after the operation created both resources (for example,
        // while releasing its global admission ticket). No transaction object will escape, so
        // atomically clean the captured staging/lease or retain a retry capability for it.
        try {
          await this.cleanupUnreturnedStagedLease(lease, staging, cleanupRetain);
        } catch (cleanupCause) {
          throw cleanupCause;
        }
      }
      throw cause;
    }
    if (lease === undefined || staging === undefined) {
      // Both are assigned together inside the successful mutation. Keep an explicit typed guard
      // rather than returning a partial authority if an implementation invariant is broken.
      await cleanupRetain.close();
      throw new LocalStoreClosedError({ operation: "begin-write" });
    }
    return Object.freeze({ lease, staging });
  }

  private async cleanupUnreturnedStagedLease(
    lease: LocalWriteLease,
    staging: LocalStagingSet<DescriptorV1> | undefined,
    cleanupRetain: LocalRetain<LocalBackendWriteOwner>,
  ): Promise<void> {
    const pending = new LocalPendingWriteLeaseCleanup(this, lease, staging, cleanupRetain);
    this.#transferredWriteRetains.add(cleanupRetain);
    try {
      await pending.close();
    } catch (cause) {
      this.#pendingWriteLeaseCleanup.add(pending);
      throw cause;
    }
  }

  private async drainPendingWriteLeaseCleanup(): Promise<void> {
    for (const pending of [...this.#pendingWriteLeaseCleanup]) {
      await pending.close();
      this.#pendingWriteLeaseCleanup.delete(pending);
    }
  }

  private async drainPendingPinCleanup(): Promise<void> {
    for (const pending of [...this.#pendingPinCleanup]) {
      await pending.close();
      this.#pendingPinCleanup.delete(pending);
    }
  }

  private assertHeld<Owner extends LocalBackendRetainOwner>(
    retain: LocalRetain<Owner>,
    operation: "retain" | "begin-write" | "open-read" | "begin-gc",
  ): void {
    if (!this.#retains.owns(retain) || retain.state !== "held") {
      throw new LocalStoreClosedError({ operation });
    }
  }
}

function validateLayoutTransition(
  current: LayoutV2 | null,
  expected: GraphRootRefV1 | null,
  plan: LocalCommitPlan,
): LocalLayoutTransition {
  if (!typedReferenceEquals(plan.layout.head, plan.next)) {
    return { state: "graph-invalid", failure: layoutSemanticFailure("layout-head-mismatch", "commit-layout") };
  }
  if (current === null) {
    if (expected !== null) {
      return { state: "head-conflict", expected, actual: null };
    }
    if (plan.layout.generation !== 1) {
      return { state: "graph-invalid", failure: layoutSemanticFailure("layout-generation-invalid", "commit-layout") };
    }
    return { state: "valid" };
  }
  if (expected === null) {
    return { state: "head-conflict", expected: null, actual: current.head };
  }
  if (current.recordId !== plan.layout.recordId) {
    return {
      state: "record-id-mismatch",
      expectedRecordId: plan.layout.recordId,
      actualRecordId: current.recordId,
    };
  }
  if (plan.layout.generation !== current.generation + 1) {
    return { state: "graph-invalid", failure: layoutSemanticFailure("layout-generation-invalid", "commit-layout") };
  }
  return { state: "valid" };
}
