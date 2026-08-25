import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { sandboxActionStateCovers } from "./action.ts";
import {
  SandboxSetupPrefixCacheCaptureError,
  SandboxSetupPrefixCacheLookupError,
  SandboxSetupPrefixCacheRestoreError,
  SandboxSetupPrefixCacheValidationError,
  type SandboxSetupPrefixCacheCapability,
  type SandboxSetupPrefixCacheCaptureResult,
  type SandboxSetupPrefixCacheEligibility,
  type SandboxSetupPrefixCacheLookupResult,
  type SandboxSetupPrefixCacheOperation,
} from "./backend.ts";

const MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;

export interface E2BSetupPrefixRootOwnership {
  readonly release: () => Promise<void>;
}

export interface E2BSetupPrefixCacheTarget {
  readonly eligibility: () => SandboxSetupPrefixCacheEligibility;
  readonly captureSnapshot: () => Promise<string>;
  readonly deleteSnapshot: (snapshotId: string) => Promise<boolean>;
  readonly rebaseToSnapshot: (snapshotId: string, signal: AbortSignal) => Promise<{ readonly sandboxId: string }>;
  readonly recoverCleanBase: (signal: AbortSignal) => Promise<{ readonly sandboxId: string }>;
  readonly adoptSetupPrefixRoot: (root: E2BSetupPrefixRootOwnership) => void;
}

interface Entry {
  readonly setup_prefix_key: string;
  readonly base_identity: string;
  readonly snapshot_id: string | null;
  readonly declaration_digest: string;
  readonly generation: number;
  readonly created_at: string;
  readonly last_successful_use_at: string | null;
  readonly protected_until: string;
  readonly state: "building" | "indexed" | "unverified" | "deleting" | "tombstoned";
}

function statePath(): string {
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "niceeval", "cache", "v2", "e2b-setup-prefix.sqlite");
}

async function open(): Promise<DatabaseSync> {
  const path = statePath();
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      setup_prefix_key TEXT PRIMARY KEY,
      base_identity TEXT NOT NULL,
      snapshot_id TEXT UNIQUE,
      declaration_digest TEXT NOT NULL,
      generation INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      last_successful_use_at TEXT,
      protected_until TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('building','indexed','unverified','deleting','tombstoned'))
    );
    CREATE TABLE IF NOT EXISTS roots (
      root_id TEXT PRIMARY KEY,
      setup_prefix_key TEXT NOT NULL REFERENCES entries(setup_prefix_key),
      sandbox_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function declarationDigest(input: SandboxSetupPrefixCacheOperation): string {
  const value = input.manifest.declarationMetadata;
  const json = JSON.stringify(value);
  // The runner's key is content-addressed from this exact value. Requiring the
  // same digest-shaped relationship avoids accepting a registry key supplied by
  // an arbitrary caller without duplicating the runner's canonicalizer.
  if (input.manifest.setupPrefixKey.length === 0 || input.manifest.setupManifestDigest !== `sha256:${input.manifest.setupPrefixKey.slice(7)}`) {
    throw new Error("E2B setup-prefix key and manifest digest do not agree");
  }
  return json;
}

function validate(target: E2BSetupPrefixCacheTarget, input: SandboxSetupPrefixCacheOperation): Extract<SandboxSetupPrefixCacheEligibility, { readonly _tag: "Eligible" }> {
  const eligibility = target.eligibility();
  if (eligibility._tag === "Unsupported") throw new Error(eligibility.reason);
  if (input.manifest.baseImageId !== eligibility.baseImageId) throw new Error("E2B setup-prefix Base identity changed");
  if (!sandboxActionStateCovers(eligibility.coverage, input.manifest.requiredState)) throw new Error("E2B snapshot does not cover the requested state");
  declarationDigest(input);
  return eligibility;
}

function failure<T extends Error>(ErrorType: new (fields: ConstructorParameters<typeof SandboxSetupPrefixCacheLookupError>[0]) => T, operation: string, input: SandboxSetupPrefixCacheOperation, cause: unknown): T {
  return new ErrorType({ operation, reason: cause instanceof Error ? cause.message : String(cause), setupPrefixKey: input.manifest.setupPrefixKey, cause });
}

async function releaseRoot(rootId: string): Promise<void> {
  const db = await open();
  try { db.prepare("DELETE FROM roots WHERE root_id = ?").run(rootId); } finally { db.close(); }
}

/** Best-effort automatic GC only touches snapshots that have a complete NiceEval registry proof. */
async function reclaimColdSnapshots(target: E2BSetupPrefixCacheTarget): Promise<void> {
  const db = await open();
  const candidates: Entry[] = [];
  try {
    db.exec("BEGIN IMMEDIATE");
    const now = Date.now();
    const rows = db.prepare(`
      SELECT entry.* FROM entries AS entry
      WHERE entry.state = 'indexed'
        AND entry.snapshot_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM roots WHERE roots.setup_prefix_key = entry.setup_prefix_key)
    `).all() as unknown as Entry[];
    for (const row of rows) {
      const lastUse = Date.parse(row.last_successful_use_at ?? row.created_at);
      if (Date.parse(row.protected_until) > now || now - lastUse < MINIMUM_AGE_MS) continue;
      const marked = db.prepare("UPDATE entries SET state = 'deleting' WHERE setup_prefix_key = ? AND state = 'indexed'")
        .run(row.setup_prefix_key);
      if (marked.changes === 1) candidates.push(row);
    }
    db.exec("COMMIT");
  } catch (cause) {
    try { db.exec("ROLLBACK"); } catch { /* no active transaction */ }
    throw cause;
  } finally { db.close(); }
  for (const candidate of candidates) {
    const settled = await open();
    try {
      let state: "indexed" | "tombstoned" = "indexed";
      try {
        if (candidate.snapshot_id === null) throw new Error("E2B GC entry has no snapshot identity");
        await target.deleteSnapshot(candidate.snapshot_id);
        state = "tombstoned";
      } catch { /* retain an artifact when provider deletion cannot be proven */ }
      settled.prepare("UPDATE entries SET state = ? WHERE setup_prefix_key = ? AND generation = ? AND state = 'deleting'")
        .run(state, candidate.setup_prefix_key, candidate.generation);
    } finally { settled.close(); }
  }
}

async function restore(target: E2BSetupPrefixCacheTarget, input: SandboxSetupPrefixCacheOperation, signal: AbortSignal): Promise<SandboxSetupPrefixCacheLookupResult> {
  try {
    validate(target, input);
    const db = await open();
    let row: Entry | undefined;
    let rootId: string | undefined;
    try {
      row = db.prepare("SELECT * FROM entries WHERE setup_prefix_key = ? AND state = 'indexed'").get(input.manifest.setupPrefixKey) as Entry | undefined;
      if (row === undefined || row.base_identity !== input.manifest.baseImageId) return { _tag: "Miss", setupPrefixKey: input.manifest.setupPrefixKey };
      if (row.snapshot_id === null) throw new Error("indexed E2B setup-prefix entry has no snapshot identity");
      const snapshotId = row.snapshot_id;
      const allocatedRootId = randomUUID();
      rootId = allocatedRootId;
      db.prepare("INSERT INTO roots(root_id, setup_prefix_key, sandbox_id, created_at) VALUES (?, ?, ?, ?)")
        .run(allocatedRootId, row.setup_prefix_key, `pending:${allocatedRootId}`, new Date().toISOString());
      const rebound = await target.rebaseToSnapshot(snapshotId, signal);
      db.prepare("UPDATE roots SET sandbox_id = ? WHERE root_id = ? AND sandbox_id = ?")
        .run(rebound.sandboxId, allocatedRootId, `pending:${allocatedRootId}`);
      db.prepare("UPDATE entries SET last_successful_use_at = ? WHERE setup_prefix_key = ? AND snapshot_id = ? AND state = 'indexed'")
        .run(new Date().toISOString(), row.setup_prefix_key, snapshotId);
      target.adoptSetupPrefixRoot({ release: () => releaseRoot(allocatedRootId) });
      return { _tag: "Restored", setupPrefixKey: row.setup_prefix_key, entryId: row.setup_prefix_key, generation: row.generation, artifactId: snapshotId, sandboxId: rebound.sandboxId };
    } catch (cause) {
      if (rootId !== undefined) db.prepare("DELETE FROM roots WHERE root_id = ?").run(rootId);
      throw cause;
    } finally { db.close(); }
  } catch (cause) {
    if (cause instanceof SandboxSetupPrefixCacheValidationError) throw cause;
    throw failure(SandboxSetupPrefixCacheLookupError, "restore E2B setup-prefix snapshot", input, cause);
  }
}

async function capture(target: E2BSetupPrefixCacheTarget, input: SandboxSetupPrefixCacheOperation, signal: AbortSignal): Promise<SandboxSetupPrefixCacheCaptureResult> {
  try {
    validate(target, input);
    if ((input.knownSensitiveValues ?? []).some((value) => value.length > 0)) {
      return { _tag: "ContinuedUncached", setupPrefixKey: input.manifest.setupPrefixKey, reason: "capture-failed", sandboxId: "e2b-sensitive-state" };
    }
    const db = await open();
    let generation: number;
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare("SELECT * FROM entries WHERE setup_prefix_key = ?").get(input.manifest.setupPrefixKey) as Entry | undefined;
      if (existing !== undefined) {
        db.exec("COMMIT");
        return { _tag: "Contended", setupPrefixKey: input.manifest.setupPrefixKey, reason: existing.state === "indexed" ? "indexed-generation" : "active-writer" };
      }
      generation = (db.prepare("SELECT COALESCE(MAX(generation), 0) AS n FROM entries").get() as { n: number }).n + 1;
      db.prepare("INSERT INTO entries(setup_prefix_key, base_identity, snapshot_id, declaration_digest, generation, created_at, protected_until, state) VALUES (?, ?, NULL, ?, ?, ?, ?, 'building')")
        .run(input.manifest.setupPrefixKey, input.manifest.baseImageId, declarationDigest(input), generation, new Date().toISOString(), new Date(Date.now() + MINIMUM_AGE_MS).toISOString());
      db.exec("COMMIT");
    } catch (cause) {
      try { db.exec("ROLLBACK"); } catch { /* no active transaction */ }
      throw cause;
    } finally { db.close(); }

    let snapshotId: string | undefined;
    try {
      snapshotId = await target.captureSnapshot();
      signal.throwIfAborted();
      const publishing = await open();
      try {
        const published = publishing.prepare("UPDATE entries SET snapshot_id = ?, state = 'indexed' WHERE setup_prefix_key = ? AND generation = ? AND state = 'building'")
          .run(snapshotId, input.manifest.setupPrefixKey, generation);
        if (published.changes !== 1) throw new Error("E2B setup-prefix publication lost its generation fence");
      } finally { publishing.close(); }
      const rebound = await target.rebaseToSnapshot(snapshotId, signal);
      const active = await open();
      const rootId = randomUUID();
      active.prepare("INSERT INTO roots(root_id, setup_prefix_key, sandbox_id, created_at) VALUES (?, ?, ?, ?)")
        .run(rootId, input.manifest.setupPrefixKey, rebound.sandboxId, new Date().toISOString());
      active.close();
      target.adoptSetupPrefixRoot({ release: () => releaseRoot(rootId) });
      return { _tag: "Captured", setupPrefixKey: input.manifest.setupPrefixKey, entryId: input.manifest.setupPrefixKey, generation, artifactId: snapshotId, sandboxId: rebound.sandboxId };
    } catch (cause) {
      if (snapshotId !== undefined) await target.deleteSnapshot(snapshotId).catch(() => undefined);
      const failed = await open();
      try { failed.prepare("UPDATE entries SET state = 'unverified' WHERE setup_prefix_key = ? AND generation = ? AND state = 'building'").run(input.manifest.setupPrefixKey, generation); } finally { failed.close(); }
      throw cause;
    }
  } catch (cause) {
    throw failure(SandboxSetupPrefixCacheCaptureError, "capture E2B setup-prefix snapshot", input, cause);
  }
}

export function makeE2BSetupPrefixCacheCapability(target: E2BSetupPrefixCacheTarget): SandboxSetupPrefixCacheCapability {
  return {
    eligibility: target.eligibility,
    lookupAndRebase: (input) => Effect.tryPromise({
      try: async (signal) => { await reclaimColdSnapshots(target); return restore(target, input, signal); },
      catch: (cause) => cause as never,
    }),
    captureAndRebase: (input) => Effect.tryPromise({
      try: async (signal) => { await reclaimColdSnapshots(target); return capture(target, input, signal); },
      catch: (cause) => cause as never,
    }),
    recoverCleanBase: () => Effect.tryPromise({
      try: async (signal) => {
        const eligibility = target.eligibility();
        if (eligibility._tag === "Unsupported") throw new Error(eligibility.reason);
        return {
          _tag: "RecoveredCleanBase" as const,
          baseImageId: eligibility.baseImageId,
          sandboxId: (await target.recoverCleanBase(signal)).sandboxId,
        };
      },
      catch: (cause) => new SandboxSetupPrefixCacheRestoreError({ operation: "recover E2B setup-prefix Base", reason: cause instanceof Error ? cause.message : String(cause), cause }),
    }),
  };
}
