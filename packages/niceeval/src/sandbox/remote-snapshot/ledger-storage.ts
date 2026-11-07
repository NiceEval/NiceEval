// @concord-file
// @concord-implements docs/feature/sandbox/data-model.md
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Schema } from "effect";
import { assertBeforeCacheSnapshotSchema } from "../../user-database/before-cache-schema.ts";
import { UserDatabaseInvalid } from "../../user-database/errors.ts";
import type { UserDatabaseRepositoryHandler } from "../../user-database/repository.ts";
import {
  BEFORE_CACHE_SNAPSHOTS_REPOSITORY, SNAPSHOT_LEASE_MS, SnapshotLedgerEntry,
  SnapshotRepositoryRequest, type BeforeCacheSnapshotRepositoryRequest,
  type BeforeCacheSnapshotRepositoryResult, type SnapshotLedgerResult,
} from "./ledger.ts";

const decodeEntry = Schema.decodeUnknownSync(SnapshotLedgerEntry);
const decodeRequest = Schema.decodeUnknownSync(SnapshotRepositoryRequest, { onExcessProperty: "error" });

function entry(database: DatabaseSync, sql: string, ...parameters: readonly SQLInputValue[]): SnapshotLedgerEntry | undefined {
  const row = database.prepare(sql).get(...parameters);
  return row === undefined ? undefined : decodeEntry(row);
}

function insertRunHold(database: DatabaseSync, row: SnapshotLedgerEntry, holdId: string, now: number): void {
  database.prepare(`INSERT INTO before_cache_snapshot_holds
    (hold_id, artifact_id, holder, sandbox_id, expires_at, created_at) VALUES (?, ?, 'run', NULL, ?, ?)`)
    .run(holdId, row.artifact_id, now + SNAPSHOT_LEASE_MS, now);
}

function current(database: DatabaseSync, request: BeforeCacheSnapshotRepositoryRequest, artifactId: string): SnapshotLedgerEntry | undefined {
  return entry(database, `SELECT * FROM before_cache_snapshots
    WHERE artifact_id = ? AND provider = ? AND execution_domain_id = ?`, artifactId, request.provider, request.executionDomainId);
}

function ownsPreparing(row: SnapshotLedgerEntry | undefined, token: string, now: number): row is SnapshotLedgerEntry {
  return row !== undefined && row.state === "preparing" && row.lease_token === token && row.lease_until !== null && row.lease_until >= now;
}

function retire(database: DatabaseSync, artifactId: string, snapshotId: string | null): void {
  database.prepare(`UPDATE before_cache_snapshots SET state = 'deleting', snapshot_id = ?, lease_token = NULL,
    lease_until = NULL WHERE artifact_id = ?`).run(snapshotId, artifactId);
}

function lookupReserve(database: DatabaseSync, request: Extract<BeforeCacheSnapshotRepositoryRequest, { operation: "lookup-reserve" }>): SnapshotLedgerResult {
  const { provider, executionDomainId, beforeCacheKey, now } = request;
  const ready = entry(database, `SELECT * FROM before_cache_snapshots
    WHERE provider = ? AND execution_domain_id = ? AND before_cache_key = ? AND state = 'ready'`, provider, executionDomainId, beforeCacheKey);
  if (ready !== undefined) {
    if (ready.base_identity === request.baseIdentity && ready.declaration_json === request.declarationJson && ready.replacement_scope === request.replacementScope) {
      insertRunHold(database, ready, request.holdId, now);
      return { _tag: "Hit", entry: ready, holdId: request.holdId };
    }
    retire(database, ready.artifact_id, ready.snapshot_id);
  }
  const preparing = entry(database, `SELECT * FROM before_cache_snapshots
    WHERE provider = ? AND execution_domain_id = ? AND before_cache_key = ? AND state = 'preparing'
    ORDER BY generation DESC LIMIT 1`, provider, executionDomainId, beforeCacheKey);
  if (preparing !== undefined) {
    if (preparing.lease_until! >= now) return { _tag: "Busy", entry: preparing };
    // The immediate transaction protects this comparison against other takers.
    const changed = database.prepare(`UPDATE before_cache_snapshots SET lease_token = ?, lease_until = ?
      WHERE artifact_id = ? AND state = 'preparing' AND lease_token = ? AND lease_until = ? AND lease_until < ?`)
      .run(request.token, now + SNAPSHOT_LEASE_MS, preparing.artifact_id, preparing.lease_token, preparing.lease_until, now);
    if (Number(changed.changes) !== 1) return { _tag: "Busy", entry: preparing };
    return { _tag: "TakenOver", entry: current(database, request, preparing.artifact_id)! };
  }
  // ORDER BY generation DESC reads the UNIQUE index endpoint, including tombstones.
  const last = database.prepare("SELECT generation FROM before_cache_snapshots ORDER BY generation DESC LIMIT 1").get();
  const generation = last === undefined ? 1 : Schema.decodeUnknownSync(Schema.Struct({ generation: Schema.Number }))(last).generation + 1;
  if (!Number.isSafeInteger(generation)) throw new UserDatabaseInvalid({
    code: "user-database-invalid", message: "Before cache snapshot generation is exhausted", repository: BEFORE_CACHE_SNAPSHOTS_REPOSITORY,
  });
  database.prepare(`INSERT INTO before_cache_snapshots
    (artifact_id, provider, execution_domain_id, before_cache_key, base_identity, declaration_json, replacement_scope,
     generation, snapshot_name, snapshot_id, state, lease_token, lease_until, created_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'preparing', ?, ?, ?, NULL)`)
    .run(request.artifactId, provider, executionDomainId, beforeCacheKey, request.baseIdentity, request.declarationJson,
      request.replacementScope, generation, `niceeval-${request.artifactId}`, request.token, now + SNAPSHOT_LEASE_MS, now);
  return { _tag: "Reserved", entry: current(database, request, request.artifactId)! };
}

function dispatchInside(database: DatabaseSync, request: BeforeCacheSnapshotRepositoryRequest): SnapshotLedgerResult {
  const { provider, executionDomainId, now } = request;
  switch (request.operation) {
    case "lookup-reserve": return lookupReserve(database, request);
    case "request-snapshot": {
      const changed = database.prepare(`UPDATE before_cache_snapshots SET requested_at = ?
        WHERE provider = ? AND execution_domain_id = ? AND artifact_id = ? AND state = 'preparing'
          AND lease_token = ? AND lease_until >= ? AND requested_at IS NULL`)
        .run(now, provider, executionDomainId, request.artifactId, request.token, now);
      return { _tag: Number(changed.changes) === 1 ? "Updated" : "LeaseLost" };
    }
    case "renew": {
      const changed = database.prepare(`UPDATE before_cache_snapshots SET lease_until = ?
        WHERE provider = ? AND execution_domain_id = ? AND artifact_id = ? AND state = 'preparing'
          AND lease_token = ? AND lease_until >= ?`)
        .run(now + SNAPSHOT_LEASE_MS, provider, executionDomainId, request.artifactId, request.token, now);
      return { _tag: Number(changed.changes) === 1 ? "Updated" : "LeaseLost" };
    }
    case "publish": {
      const row = current(database, request, request.artifactId);
      if (!ownsPreparing(row, request.token, now)) return { _tag: "LeaseLost" };
      const newer = database.prepare(`SELECT 1 FROM before_cache_snapshots WHERE provider = ? AND execution_domain_id = ?
        AND replacement_scope = ? AND generation > ? AND published_at IS NOT NULL LIMIT 1`)
        .get(provider, executionDomainId, row.replacement_scope, row.generation);
      if (newer !== undefined) {
        retire(database, row.artifact_id, request.snapshotId);
        return { _tag: "Superseded" };
      }
      database.prepare(`UPDATE before_cache_snapshots SET state = 'deleting', lease_token = NULL, lease_until = NULL
        WHERE provider = ? AND execution_domain_id = ? AND replacement_scope = ? AND generation < ? AND state = 'ready'`)
        .run(provider, executionDomainId, row.replacement_scope, row.generation);
      database.prepare(`UPDATE before_cache_snapshots SET snapshot_id = ?, state = 'ready', lease_token = NULL,
        lease_until = NULL, published_at = ? WHERE artifact_id = ?`).run(request.snapshotId, now, row.artifact_id);
      const published = current(database, request, row.artifact_id)!;
      insertRunHold(database, published, request.holdId, now);
      return { _tag: "Published", entry: published, holdId: request.holdId };
    }
    case "uncertain": {
      const row = current(database, request, request.artifactId);
      if (!ownsPreparing(row, request.token, now)) return { _tag: "LeaseLost" };
      retire(database, request.artifactId, null);
      return { _tag: "Updated" };
    }
    case "handoff": {
      const row = current(database, request, request.artifactId);
      // Deleting entries can still be consumed under this Run's live hold.
      const runHold = database.prepare(`SELECT 1 FROM before_cache_snapshot_holds WHERE hold_id = ?
        AND artifact_id = ? AND holder = 'run' AND expires_at >= ?`).get(request.runHoldId, request.artifactId, now);
      if (row === undefined || runHold === undefined || (row.state !== "ready" && row.state !== "deleting") || row.lease_token !== null) return { _tag: "Unavailable" };
      database.prepare(`INSERT INTO before_cache_snapshot_holds
        (hold_id, artifact_id, holder, sandbox_id, expires_at, created_at) VALUES (?, ?, 'sandbox', NULL, NULL, ?)`)
        .run(request.holdId, request.artifactId, now);
      if (request.releaseRunHold) database.prepare("DELETE FROM before_cache_snapshot_holds WHERE hold_id = ? AND holder = 'run'").run(request.runHoldId);
      return { _tag: "Updated" };
    }
    case "bind-sandbox": {
      const changed = database.prepare(`UPDATE before_cache_snapshot_holds SET sandbox_id = ? WHERE hold_id = ? AND holder = 'sandbox'
        AND sandbox_id IS NULL AND artifact_id IN (SELECT artifact_id FROM before_cache_snapshots WHERE provider = ? AND execution_domain_id = ?)`)
        .run(request.sandboxId, request.holdId, provider, executionDomainId);
      return { _tag: Number(changed.changes) === 1 ? "Updated" : "Unavailable" };
    }
    case "release-sandbox": {
      // Caller may send this only after confirming deletion (or zero allocation).
      database.prepare(`DELETE FROM before_cache_snapshot_holds WHERE hold_id = ? AND holder = 'sandbox'
        AND artifact_id IN (SELECT artifact_id FROM before_cache_snapshots WHERE provider = ? AND execution_domain_id = ?)`)
        .run(request.holdId, provider, executionDomainId);
      return { _tag: "Updated" };
    }
    case "renew-run-holds":
    case "release-run-holds": {
      for (const id of request.holdIds) {
        if (request.operation === "renew-run-holds") database.prepare(`UPDATE before_cache_snapshot_holds SET expires_at = ?
          WHERE hold_id = ? AND holder = 'run' AND expires_at >= ?
          AND artifact_id IN (SELECT artifact_id FROM before_cache_snapshots WHERE provider = ? AND execution_domain_id = ?)`)
          .run(now + SNAPSHOT_LEASE_MS, id, now, provider, executionDomainId);
        else database.prepare(`DELETE FROM before_cache_snapshot_holds WHERE hold_id = ? AND holder = 'run'
          AND artifact_id IN (SELECT artifact_id FROM before_cache_snapshots WHERE provider = ? AND execution_domain_id = ?)`)
          .run(id, provider, executionDomainId);
      }
      return { _tag: "Updated" };
    }
    case "invalidate": {
      const row = current(database, request, request.artifactId);
      if (row?.state === "ready") retire(database, row.artifact_id, row.snapshot_id);
      return { _tag: "Updated" };
    }
    case "claim-delete": {
      database.prepare("DELETE FROM before_cache_snapshot_holds WHERE holder = 'run' AND expires_at < ?").run(now);
      const excluded = request.excludeArtifactIds ?? [];
      const row = entry(database, `SELECT s.* FROM before_cache_snapshots s
        WHERE s.provider = ? AND s.execution_domain_id = ? AND s.state = 'deleting'
          AND (s.lease_token IS NULL OR s.lease_until < ?)
          AND NOT EXISTS (SELECT 1 FROM before_cache_snapshot_holds h WHERE h.artifact_id = s.artifact_id
            AND (h.holder = 'sandbox' OR h.expires_at >= ?))
          ${excluded.length === 0 ? "" : `AND s.artifact_id NOT IN (${excluded.map(() => "?").join(",")})`}
          ORDER BY s.generation LIMIT 1`, provider, executionDomainId, now, now, ...excluded);
      if (row === undefined) return { _tag: "Empty" };
      database.prepare("UPDATE before_cache_snapshots SET lease_token = ?, lease_until = ? WHERE artifact_id = ?")
        .run(request.token, now + SNAPSHOT_LEASE_MS, row.artifact_id);
      return { _tag: "Claimed", entry: current(database, request, row.artifact_id)! };
    }
    case "settle-delete": {
      const changed = database.prepare(`UPDATE before_cache_snapshots SET state = ?, lease_token = NULL, lease_until = NULL
        WHERE provider = ? AND execution_domain_id = ? AND artifact_id = ? AND state = 'deleting' AND lease_token = ?`)
        .run(request.deleted ? "deleted" : "deleting", provider, executionDomainId, request.artifactId, request.token);
      return { _tag: Number(changed.changes) === 1 ? "Updated" : "LeaseLost" };
    }
  }
}

function dispatch(database: DatabaseSync, input: BeforeCacheSnapshotRepositoryRequest): BeforeCacheSnapshotRepositoryResult {
  const request = decodeRequest(input);
  database.exec("BEGIN IMMEDIATE");
  try {
    const value = dispatchInside(database, request);
    database.exec("COMMIT");
    return { repository: BEFORE_CACHE_SNAPSHOTS_REPOSITORY, value };
  } catch (cause) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw cause;
  }
}

export const beforeCacheSnapshotRepositoryHandler: UserDatabaseRepositoryHandler<
  BeforeCacheSnapshotRepositoryRequest, BeforeCacheSnapshotRepositoryResult
> = Object.freeze({
  id: BEFORE_CACHE_SNAPSHOTS_REPOSITORY,
  // UserDatabase's single application migration owns schema installation.
  installCurrentSchema: assertBeforeCacheSnapshotSchema,
  assertCurrentSchema: assertBeforeCacheSnapshotSchema,
  dispatch,
});
