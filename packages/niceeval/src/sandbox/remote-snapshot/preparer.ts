// @concord-file
// @concord-implements docs/feature/sandbox/architecture/remote-snapshot-cache.md
import { randomUUID } from "node:crypto";
import { Clock, Deferred, Effect, Exit, Result, Schema, Scope } from "effect";
import { userDatabaseHost, type UserDatabase } from "../../user-database/index.ts";
import { BeforeCacheLookupError, type BeforeCacheError, type BeforeCacheStep } from "../backend.ts";
import type { MaterializedSandboxCase } from "../case-types.ts";
import { beforeCacheReplacementScope } from "../before-cache-replacement.ts";
import type {
  BeforeCacheArtifact, BeforeCacheCapture, BeforeCacheDegradedReason, BeforeCacheLookup, BeforeCacheMaterialized,
  BeforeCachePreparationContext, BeforeCachePreparer, BeforeCacheSource,
} from "../layer.ts";
import { SandboxRuntimeMaterializationError, type SandboxRuntimeMaterializeContext } from "../runtime.ts";
import { type BeforeCacheSnapshotDriver, type BeforeCacheSnapshotTarget } from "./driver.ts";
import {
  SNAPSHOT_HEARTBEAT_MS, snapshotLedgerRequest, type SnapshotLedgerDomain, type SnapshotLedgerEntry,
  type SnapshotLedgerRequest,
} from "./ledger.ts";

const ArtifactMarkerPath = "/var/lib/niceeval/before-cache-artifact.json";
const Marker = Schema.Struct({ artifactId: Schema.String, beforeCacheKey: Schema.String });
const Locator = Schema.Struct({ artifactId: Schema.String, executionDomainId: Schema.String });
const decodeMarker = Schema.decodeUnknownSync(Marker, { onExcessProperty: "error" });
const decodeLocator = Schema.decodeUnknownSync(Locator, { onExcessProperty: "error" });
const Declaration = Schema.Struct({
  baseIdentity: Schema.String, beforeCacheKey: Schema.String, declarationDigest: Schema.String,
  requiredState: Schema.Literals(["all", "dockerData"]), storageSchemaRevision: Schema.String,
  artifactFormatRevision: Schema.String, changeFrequency: Schema.Number, declarationMetadata: Schema.Json,
});
const decodeDeclaration = Schema.decodeUnknownSync(Declaration, { onExcessProperty: "error" });
const degraded = (reason: BeforeCacheDegradedReason, detail: string) => ({ _tag: "Degraded" as const, reason, detail });
const ledgerError = () => new BeforeCacheLookupError({ operation: "ledger", reason: "ledger-unavailable" });
const io = <A>(run: (signal: AbortSignal) => Promise<A>) => Effect.tryPromise({ try: run, catch: () => ledgerError() });

interface Reservation { readonly entry: SnapshotLedgerEntry; readonly token: string; lost: boolean }
interface VerifiedStagingProof {
  readonly _tag: "Verified";
  readonly mounts: ReadonlySet<string>;
  readonly target: BeforeCacheSnapshotTarget;
}
type StagingProof = VerifiedStagingProof | { readonly _tag: "Rejected"; readonly reason: BeforeCacheDegradedReason; readonly detail: string };
interface RunState<Plan> {
  readonly key: string;
  readonly plan: Plan;
  readonly database: UserDatabase;
  readonly domain: SnapshotLedgerDomain;
  readonly target: BeforeCacheSnapshotTarget;
  readonly reservations: Map<string, Reservation>;
  readonly entries: Map<string, SnapshotLedgerEntry>;
  readonly holds: Map<string, string>;
  readonly unavailable: Set<string>;
  disabled: boolean;
}

/** Mount IDs distinguish a replacement at the same path from an unchanged mount. */
function writableMounts(text: string): ReadonlySet<string> {
  const result = new Set<string>();
  for (const line of text.trim().split("\n")) {
    const parts = line.split(" ");
    if (parts.length < 10 || !parts[5]?.split(",").includes("rw")) continue;
    const target = parts[4]!.replace(/\\([0-7]{3})/gu, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
    result.add(`${parts[0]}\0${target}`);
  }
  return result;
}

const readMounts = Effect.fn("remoteSnapshot.readMounts")(function*(sandbox: MaterializedSandboxCase) {
  const result = yield* io((signal) => sandbox.authorBackend.runCommand("cat", ["/proc/self/mountinfo"], { user: "root", signal }));
  if (result.exitCode !== 0 || result.stdout.trim() === "") return yield* ledgerError();
  return writableMounts(result.stdout);
});

const SensitiveScan = `
const fs = require('node:fs'); const path = require('node:path');
const needles = JSON.parse(Buffer.from(process.argv[1], 'base64').toString()).map(x => Buffer.from(x));
const skip = new Set(['/proc', '/sys', '/dev']);
const longest = Math.max(...needles.map(x => x.length));
async function visit(p) {
  if (skip.has(p)) return false;
  const s = await fs.promises.lstat(p);
  if (s.isSymbolicLink()) return false;
  if (s.isDirectory()) { for (const n of await fs.promises.readdir(p)) if (await visit(path.join(p,n))) return true; return false; }
  if (!s.isFile()) return false;
  let tail = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(p)) {
    const bytes = Buffer.concat([tail, chunk]);
    if (needles.some(n => bytes.includes(n))) return true;
    tail = bytes.subarray(Math.max(0, bytes.length - longest + 1));
  }
  return false;
}
visit('/').then(found => { process.stdout.write(found ? 'found' : 'clean'); }, () => { process.exitCode = 2; });
`;

/** One shared snapshot protocol. Drivers never decide lease, hold or fallback semantics. */
export function remoteSnapshotPreparer<Plan>(driver: BeforeCacheSnapshotDriver<Plan>): BeforeCachePreparer<Plan> {
  const runs = new Map<string, Deferred.Deferred<RunState<Plan>, BeforeCacheError>>();
  const targets = new Map<string, Map<Plan, BeforeCacheSnapshotTarget>>();
  const disabledDomains = new Set<string>();
  const stagingProofs = new WeakMap<MaterializedSandboxCase, StagingProof>();
  const runKey = (context: BeforeCachePreparationContext, target: BeforeCacheSnapshotTarget) =>
    JSON.stringify([context.runId, context.providerId, target.executionDomainId]);
  const contextKey = (context: BeforeCachePreparationContext) => JSON.stringify([context.runId, context.providerId]);

  const request = Effect.fn("remoteSnapshot.ledger")(function*(state: RunState<Plan>, input: SnapshotLedgerRequest) {
    return yield* snapshotLedgerRequest(state.database, input).pipe(
      Effect.tapError(() => Effect.sync(() => { state.disabled = true; disabledDomains.add(state.key); })),
      Effect.mapError(() => ledgerError()),
    );
  });
  const timedRequest = Effect.fn("remoteSnapshot.timedLedger")(function*(
    state: RunState<Plan>, input: SnapshotLedgerRequest extends infer R ? R extends SnapshotLedgerRequest ? Omit<R, "provider" | "executionDomainId" | "now"> : never : never,
  ) {
    const now = yield* Clock.currentTimeMillis;
    return yield* request(state, { ...state.domain, now, ...input });
  });

  const cleanup = Effect.fn("remoteSnapshot.cleanup")(function*(state: RunState<Plan>) {
    // Abandon only leases still owned by this process. Expired owners touch no row.
    for (const reservation of state.reservations.values()) {
      if (!reservation.lost) yield* timedRequest(state, { operation: "uncertain", artifactId: reservation.entry.artifact_id, token: reservation.token });
    }
    yield* timedRequest(state, { operation: "release-run-holds", holdIds: [...state.holds.values()] });
    state.holds.clear();
    if (state.disabled) return;
    const visited = new Set<string>();
    while (true) {
      const token = randomUUID();
      const claimed = yield* timedRequest(state, { operation: "claim-delete", token, excludeArtifactIds: [...visited] });
      if (claimed._tag !== "Claimed") break;
      const row = claimed.entry;
      visited.add(row.artifact_id);
      const deletion = yield* Effect.result(Effect.gen(function*() {
        let snapshotId = row.snapshot_id;
        if (snapshotId === null) {
          const found = yield* driver.findSnapshot(state.plan, row.snapshot_name);
          if (found._tag === "Pending") return false;
          if (found._tag === "Absent") {
            const now = yield* Clock.currentTimeMillis;
            return row.requested_at === null || now >= row.requested_at + driver.snapshotSettleMs;
          }
          snapshotId = found.snapshotId;
        }
        if (snapshotId === state.target.baseIdentity || snapshotId === state.target.baseReference) {
          return yield* new BeforeCacheLookupError({ operation: "cleanup", reason: "Refusing to delete the declared Base snapshot" });
        }
        yield* driver.deleteSnapshot(state.plan, snapshotId);
        return true;
      }));
      yield* timedRequest(state, { operation: "settle-delete", artifactId: row.artifact_id, token,
        deleted: Result.isSuccess(deletion) && deletion.success });
      if (Result.isFailure(deletion)) return yield* new BeforeCacheLookupError({ operation: "cleanup", reason: "Snapshot deletion failed; its ledger entry is retained" });
    }
  });

  const stateFor = Effect.fn("remoteSnapshot.runState")(function*(plan: Plan, context: BeforeCachePreparationContext, target: BeforeCacheSnapshotTarget) {
    const key = runKey(context, target);
    const existing = runs.get(key);
    if (existing !== undefined) return yield* Deferred.await(existing);
    const pending = Deferred.makeUnsafe<RunState<Plan>, BeforeCacheError>();
    runs.set(key, pending);
    yield* Effect.addFinalizer(() => Effect.sync(() => {
      runs.delete(key);
      disabledDomains.delete(key);
      const group = targets.get(contextKey(context));
      if (group !== undefined) {
        for (const [candidate, value] of group) if (value.executionDomainId === target.executionDomainId) group.delete(candidate);
        if (group.size === 0) targets.delete(contextKey(context));
      }
    }));
    const create = Effect.gen(function*() {
      const database = yield* userDatabaseHost.open().pipe(Effect.mapError(() => {
        disabledDomains.add(key);
        return ledgerError();
      }));
      const state: RunState<Plan> = {
        key, plan, database, target, domain: { provider: context.providerId, executionDomainId: target.executionDomainId },
        reservations: new Map(), entries: new Map(), holds: new Map(), unavailable: new Set(), disabled: false,
      };
      yield* Effect.addFinalizer(() => cleanup(state).pipe(Effect.ensuring(Effect.sync(() => { runs.delete(key); })), Effect.orDie));
      yield* Effect.forkScoped(Effect.gen(function*() {
        while (true) {
          yield* Effect.sleep(SNAPSHOT_HEARTBEAT_MS);
          if (state.disabled) continue;
          const heartbeat = yield* Effect.result(Effect.gen(function*() {
            for (const reservation of state.reservations.values()) {
              if (reservation.lost) continue;
              const result = yield* timedRequest(state, { operation: "renew", artifactId: reservation.entry.artifact_id, token: reservation.token });
              if (result._tag !== "Updated") reservation.lost = true;
            }
            yield* timedRequest(state, { operation: "renew-run-holds", holdIds: [...state.holds.values()] });
          }));
          if (Result.isFailure(heartbeat)) state.disabled = true;
        }
      }));
      return state;
    });
    return yield* create.pipe(Effect.onExit((exit) => Deferred.done(pending, exit)));
  });

  const artifactOf = (row: SnapshotLedgerEntry, step: BeforeCacheStep): BeforeCacheArtifact => ({
    locator: { artifactId: row.artifact_id, executionDomainId: row.execution_domain_id },
    beforeCacheKey: row.before_cache_key, declarationDigest: step.declaration.declarationDigest,
  });
  const accept = Effect.fn("remoteSnapshot.accept")(function*(state: RunState<Plan>, row: SnapshotLedgerEntry, holdId: string) {
    const previous = state.holds.get(row.artifact_id);
    if (previous !== undefined && previous !== holdId) yield* timedRequest(state, { operation: "release-run-holds", holdIds: [previous] });
    state.entries.set(row.artifact_id, row);
    state.holds.set(row.artifact_id, holdId);
    state.reservations.delete(row.before_cache_key);
  });
  const resolve = Effect.fn("remoteSnapshot.resolve")(function*(plan: Plan, context: BeforeCachePreparationContext) {
    const key = contextKey(context);
    const known = targets.get(key)?.get(plan);
    if (known !== undefined && disabledDomains.has(runKey(context, known))) return yield* ledgerError();
    const target = yield* driver.resolveBase(plan).pipe(Effect.mapError(() => new BeforeCacheLookupError({ operation: "eligibility", reason: "eligibility-failed" })));
    if (target._tag === "Resolved") {
      let group = targets.get(key);
      if (group === undefined) { group = new Map(); targets.set(key, group); }
      group.set(plan, target);
    }
    return target;
  });

  const lookup = Effect.fn("remoteSnapshot.lookup")(function*(
    plan: Plan, context: BeforeCachePreparationContext, steps: readonly BeforeCacheStep[],
  ): Effect.fn.Return<BeforeCacheLookup, BeforeCacheError, Scope.Scope> {
    const target = yield* resolve(plan, context);
    if (target._tag !== "Resolved") return degraded("base-image-unverified", target.reason);
    const state = yield* stateFor(plan, context, target);
    if (state.disabled) return degraded("ledger-unavailable", "Snapshot ledger is unavailable for this Run");
    for (const step of steps) {
      if (target.baseIdentity !== step.declaration.baseIdentity) return degraded("base-image-unverified", "Base identity changed after planning");
      const input = {
        operation: "lookup-reserve" as const,
        beforeCacheKey: step.declaration.beforeCacheKey, baseIdentity: target.baseIdentity,
        declarationJson: JSON.stringify(yield* Effect.try({ try: () => decodeDeclaration(step.declaration), catch: () => ledgerError() })),
        replacementScope: beforeCacheReplacementScope({ provider: context.providerId, executionDomainId: target.executionDomainId, baseReference: target.baseReference }, step),
      };
      while (true) {
        const token = randomUUID(), holdId = randomUUID();
        const result = yield* timedRequest(state, { ...input, artifactId: randomUUID(), token, holdId });
        if (result._tag === "Hit") {
          if (state.unavailable.has(result.entry.artifact_id)) {
            yield* timedRequest(state, { operation: "release-run-holds", holdIds: [result.holdId] });
            break;
          }
          yield* accept(state, result.entry, result.holdId);
          return { _tag: "Hit", artifact: artifactOf(result.entry, step) };
        }
        if (result._tag === "Busy") { yield* Effect.sleep("500 millis"); continue; }
        if (result._tag !== "Reserved" && result._tag !== "TakenOver") return degraded("lease-lost", "Snapshot reservation was not acquired");
        const reservation: Reservation = { entry: result.entry, token, lost: false };
        state.reservations.set(step.declaration.beforeCacheKey, reservation);
        if (result._tag === "Reserved") return { _tag: "Miss" };
        while (true) {
          if (reservation.lost) return degraded("lease-lost", "Snapshot publication lease was lost");
          const found = yield* driver.findSnapshot(plan, result.entry.snapshot_name).pipe(Effect.mapError(() => new BeforeCacheLookupError({ operation: "snapshot", reason: "snapshot-uncertain" })));
          if (found._tag === "Pending") { yield* Effect.sleep("1 second"); continue; }
          if (found._tag === "Absent") {
            yield* timedRequest(state, { operation: "uncertain", artifactId: result.entry.artifact_id, token });
            state.reservations.delete(step.declaration.beforeCacheKey);
            break;
          }
          const published = yield* timedRequest(state, { operation: "publish", artifactId: result.entry.artifact_id, token, snapshotId: found.snapshotId, holdId });
          if (published._tag !== "Published") return degraded("lease-lost", "Recovered snapshot publication was fenced");
          yield* accept(state, published.entry, published.holdId);
          return { _tag: "Hit", artifact: artifactOf(published.entry, step) };
        }
      }
    }
    return { _tag: "Miss" };
  }, Effect.catch((error): Effect.Effect<BeforeCacheLookup> => Effect.succeed(degraded(
    error instanceof BeforeCacheLookupError && error.reason === "eligibility-failed" ? "eligibility-failed"
      : error instanceof BeforeCacheLookupError && error.reason === "snapshot-uncertain" ? "snapshot-uncertain" : "ledger-unavailable",
    "Snapshot lookup is unavailable; before actions will execute normally",
  ))));

  const rememberStaging = Effect.fn("remoteSnapshot.rememberStaging")(function*(plan: Plan, context: BeforeCachePreparationContext, sandbox: MaterializedSandboxCase) {
    const planned = targets.get(contextKey(context))?.get(plan);
    const resolved = yield* Effect.result(resolve(plan, context));
    if (Result.isFailure(resolved)) {
      stagingProofs.set(sandbox, { _tag: "Rejected", reason: "eligibility-failed", detail: "Staging Base could not be resolved" });
      return;
    }
    const target = resolved.success;
    if (target._tag !== "Resolved") {
      stagingProofs.set(sandbox, { _tag: "Rejected", reason: "base-image-unverified", detail: target.reason });
      return;
    }
    if (planned !== undefined && (planned.baseIdentity !== target.baseIdentity || planned.executionDomainId !== target.executionDomainId)) {
      stagingProofs.set(sandbox, { _tag: "Rejected", reason: "base-image-unverified", detail: "Staging Base changed after planning" });
      return;
    }
    const mounts = yield* Effect.result(readMounts(sandbox));
    stagingProofs.set(sandbox, Result.isSuccess(mounts) ? { _tag: "Verified", target, mounts: mounts.success }
      : { _tag: "Rejected", reason: "mounted-state", detail: "Staging writable mounts could not be recorded" });
  });

  const materializeFrom = Effect.fn("remoteSnapshot.materializeFrom")(function*(
    plan: Plan, context: BeforeCachePreparationContext, purpose: "staging" | "consumer", source: BeforeCacheSource, materialize: SandboxRuntimeMaterializeContext,
  ) {
    const base = Effect.fn("remoteSnapshot.materializeBase")(function*(reason?: string) {
      const sandbox = yield* context.materializeBase(materialize);
      // Proof failure disables capture, not an otherwise valid Base instance.
      yield* rememberStaging(plan, context, sandbox);
      const proof = stagingProofs.get(sandbox);
      if (purpose === "staging" && proof?._tag === "Rejected") {
        yield* io(() => sandbox.group.stop());
        return degraded(proof.reason, proof.detail);
      }
      return { _tag: "Materialized" as const, sandbox, start: reason === undefined ? { _tag: "Restored" as const } : { _tag: "FellBackToBase" as const, reason } };
    });
    if (source._tag === "Base") return yield* base();
    const parsed = yield* Effect.result(Effect.try({ try: () => decodeLocator(source.artifact.locator), catch: () => ledgerError() }));
    if (Result.isFailure(parsed)) return yield* base("artifact-missing");
    const target = yield* Effect.result(resolve(plan, context));
    if (Result.isFailure(target)) return yield* base(target.failure.reason === "ledger-unavailable" ? "ledger-disabled" : "domain-mismatch");
    if (target.success._tag !== "Resolved") return yield* base("domain-mismatch");
    const stateResult = yield* Effect.result(stateFor(plan, context, target.success));
    if (Result.isFailure(stateResult)) return yield* base("ledger-disabled");
    const state = stateResult.success, id = parsed.success.artifactId;
    const row = state.entries.get(id), runHoldId = state.holds.get(id);
    if (state.disabled) return yield* base("ledger-disabled");
    if (state.unavailable.has(id)) return yield* base("artifact-unavailable");
    if (parsed.success.executionDomainId !== target.success.executionDomainId) return yield* base("domain-mismatch");
    if (row === undefined || row.snapshot_id === null) return yield* base("artifact-missing");
    if (runHoldId === undefined) return yield* base("hold-missing");
    if (row.before_cache_key !== source.artifact.beforeCacheKey) return yield* base("key-mismatch");
    const holdId = randomUUID();
    const handoff = yield* Effect.result(timedRequest(state, { operation: "handoff", artifactId: id, holdId, runHoldId, releaseRunHold: false }));
    if (Result.isFailure(handoff) || handoff.success._tag !== "Updated") return yield* base(Result.isFailure(handoff) ? "ledger-disabled" : "hold-missing");
    const child = yield* Scope.make();
    let released = false;
    const release = Effect.fn("remoteSnapshot.releaseSandboxHold")(function*() {
      if (released) return;
      yield* timedRequest(state, { operation: "release-sandbox", holdId });
      released = true;
    });
    let sandbox: MaterializedSandboxCase | undefined;
    const close = Effect.fn("remoteSnapshot.closeSnapshotSandbox")(function*() {
      yield* Scope.close(child, Exit.void);
      yield* release();
    });
    yield* Effect.addFinalizer(() => close().pipe(Effect.orDie));
    const created = yield* Effect.result(driver.createFromSnapshot(plan, row.snapshot_id, materialize).pipe(Scope.provide(child)));
    if (Result.isFailure(created)) {
      state.unavailable.add(id);
      yield* close().pipe(Effect.mapError((cause) => new SandboxRuntimeMaterializationError({ code: "sandbox.materialization-failed", provider: context.providerId, message: "Failed snapshot instance could not be retired", cause: new Error(cause.reason) })));
      return yield* base("snapshot-gone");
    }
    sandbox = created.success;
    const bound = yield* Effect.result(timedRequest(state, { operation: "bind-sandbox", holdId, sandboxId: sandbox.group.primary.sandboxId }));
    const verified = yield* Effect.result(io(async (signal) => {
      const result = await sandbox!.authorBackend.runCommand("cat", [ArtifactMarkerPath], { user: "root", signal });
      if (result.exitCode !== 0) return false;
      try {
        const marker = decodeMarker(JSON.parse(result.stdout));
        const declaration = decodeDeclaration(JSON.parse(row.declaration_json));
        return marker.artifactId === id && marker.beforeCacheKey === row.before_cache_key &&
          declaration.declarationDigest === source.artifact.declarationDigest;
      } catch { return false; }
    }));
    if (Result.isFailure(bound) || bound.success._tag !== "Updated" || Result.isFailure(verified) || !verified.success) {
      state.unavailable.add(id);
      if (Result.isSuccess(verified) && !verified.success) yield* timedRequest(state, { operation: "invalidate", artifactId: id }).pipe(Effect.catch(() => Effect.void));
      yield* close().pipe(Effect.mapError((cause) => new SandboxRuntimeMaterializationError({ code: "sandbox.materialization-failed", provider: context.providerId, message: "Invalid snapshot instance could not be retired", cause: new Error(cause.reason) })));
      return yield* base(Result.isFailure(bound) ? "ledger-disabled" : bound.success._tag !== "Updated" ? "hold-missing" : "marker-mismatch");
    }
    yield* rememberStaging(plan, context, sandbox);
    const proof = stagingProofs.get(sandbox);
    if (purpose === "staging" && proof?._tag === "Rejected") {
      yield* close();
      return degraded(proof.reason, proof.detail);
    }
    return { _tag: "Materialized" as const, sandbox, start: { _tag: "Restored" as const } };
  }, (effect, _plan, context, purpose) => {
    const materialized = effect.pipe(Effect.mapError((error) => error instanceof SandboxRuntimeMaterializationError ? error
      : new SandboxRuntimeMaterializationError({ code: "sandbox.materialization-failed", provider: context.providerId,
          message: "Snapshot instance could not be retired", cause: error })));
    return purpose === "consumer" ? materialized : materialized.pipe(
      Effect.catch((): Effect.Effect<BeforeCacheMaterialized> => Effect.succeed(degraded("staging-failed", "Snapshot staging could not become ready"))),
    );
  });

  const capture = Effect.fn("remoteSnapshot.capture")(function*(
    plan: Plan, context: BeforeCachePreparationContext, staging: MaterializedSandboxCase, step: BeforeCacheStep,
  ): Effect.fn.Return<BeforeCacheCapture, BeforeCacheError, Scope.Scope> {
    const target = yield* resolve(plan, context);
    if (target._tag !== "Resolved") return degraded("base-image-unverified", target.reason);
    const state = yield* stateFor(plan, context, target);
    if (state.disabled) return degraded("ledger-unavailable", "Snapshot ledger is unavailable for this Run");
    const reservation = state.reservations.get(step.declaration.beforeCacheKey);
    if (reservation === undefined || reservation.lost) return degraded("lease-lost", "Snapshot publication lease was lost");
    const renewed = yield* timedRequest(state, { operation: "renew", artifactId: reservation.entry.artifact_id, token: reservation.token });
    if (renewed._tag !== "Updated") { reservation.lost = true; return degraded("lease-lost", "Snapshot publication lease was lost"); }
    const proof = stagingProofs.get(staging);
    if (proof?._tag === "Rejected") return degraded(proof.reason, proof.detail);
    if (proof === undefined || proof.target.baseIdentity !== step.declaration.baseIdentity || target.baseIdentity !== step.declaration.baseIdentity ||
      proof.target.executionDomainId !== target.executionDomainId) return degraded("base-image-unverified", "Staging Base differs from the planned Base");
    const mounts = yield* Effect.result(readMounts(staging));
    if (Result.isFailure(mounts)) return degraded("mounted-state", "Staging writable mounts could not be verified");
    for (const mount of mounts.success) {
      if (!proof.mounts.has(mount) && !driver.preserves.disks.includes(mount.split("\0")[1]!)) return degraded("mounted-state", "New writable mount is outside the snapshot disks");
    }
    const values = (step.knownSensitiveValues ?? []).filter((value) => value.length > 0);
    if (values.length > 0) {
      const scan = yield* Effect.result(io((signal) => staging.authorBackend.runCommand("node", ["-e", SensitiveScan, Buffer.from(JSON.stringify(values)).toString("base64")], { user: "root", signal })));
      if (Result.isFailure(scan) || scan.success.exitCode !== 0 || scan.success.stdout !== "clean") return degraded("sensitive-state", "Known sensitive bytes could not be ruled out");
    }
    const artifactId = reservation.entry.artifact_id;
    const marker = JSON.stringify({ artifactId, beforeCacheKey: step.declaration.beforeCacheKey });
    const written = yield* Effect.result(io((signal) => staging.authorBackend.runCommand("sh", ["-c", 'install -d -m 755 /var/lib/niceeval && printf "%s" "$1" > "$2"', "niceeval", marker, ArtifactMarkerPath], { user: "root", signal })));
    if (Result.isFailure(written) || written.success.exitCode !== 0) return degraded("staging-failed", "Artifact marker could not be written");
    if (!driver.preserves.memory) {
      const sync = yield* Effect.result(io((signal) => staging.authorBackend.runCommand("sync", [], { user: "root", signal })));
      if (Result.isFailure(sync) || sync.success.exitCode !== 0) return degraded("staging-failed", "Snapshot disks could not be quiesced");
    }
    // No command is sent to staging between quiesce and snapshot Ready.
    const requested = yield* timedRequest(state, { operation: "request-snapshot", artifactId, token: reservation.token });
    if (requested._tag !== "Updated") { reservation.lost = true; return degraded("lease-lost", "Snapshot request lease was lost"); }
    const created = yield* Effect.result(driver.createSnapshot(plan, staging, reservation.entry.snapshot_name));
    if (reservation.lost) return degraded("lease-lost", "Snapshot publication lease was lost");
    if (Result.isFailure(created) || created.success._tag === "Rejected") {
      const retired = yield* timedRequest(state, { operation: "uncertain", artifactId, token: reservation.token });
      state.reservations.delete(step.declaration.beforeCacheKey);
      if (retired._tag !== "Updated") return degraded("lease-lost", "Snapshot publication lease was lost");
      return Result.isFailure(created) ? degraded("snapshot-uncertain", "Snapshot request outcome is uncertain; its ledger entry is retained")
        : degraded("snapshot-rejected", "Provider rejected the snapshot request before acceptance");
    }
    const published = yield* timedRequest(state, { operation: "publish", artifactId, token: reservation.token,
      snapshotId: created.success.snapshotId, holdId: randomUUID() });
    if (published._tag !== "Published") { reservation.lost = true; return degraded("lease-lost", "Snapshot publication was fenced"); }
    yield* accept(state, published.entry, published.holdId);
    return { _tag: "Published", artifact: artifactOf(published.entry, step) };
  }, Effect.catch((error): Effect.Effect<BeforeCacheCapture> => Effect.succeed(degraded(
    error instanceof BeforeCacheLookupError && error.operation === "eligibility" ? "eligibility-failed" : "ledger-unavailable",
    "Snapshot capture is unavailable; before actions will execute normally",
  ))));

  return {
    continuesStaging: driver.sourceUsableAfterSnapshot,
    supportsAgentDerived: true,
    eligibility: (plan, context) => driver.resolveBase(plan).pipe(
      Effect.map((target) => target._tag === "Ineligible"
      ? { _tag: "Unsupported" as const, code: target.code, reason: target.reason }
      : { _tag: "Eligible" as const, persistence: "persistent" as const, dependency: "parent-backed" as const,
        coverage: "all" as const, baseIdentity: target.baseIdentity, keyScope: target.keyScope,
        replacementScope: { provider: context.providerId, executionDomainId: target.executionDomainId, baseReference: target.baseReference } }),
      Effect.catch(() => Effect.succeed(degraded("eligibility-failed", "Snapshot Base identity could not be resolved"))),
    ),
    lookup, materializeFrom, capture,
  };
}
