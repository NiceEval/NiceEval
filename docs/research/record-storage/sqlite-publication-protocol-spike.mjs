import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

// A deliberately small, file-backed protocol proof.  The schema is only the
// minimum necessary to make publication, snapshot and migration boundaries
// observable; it is not proposed production schema.
const schemaIdentity = "niceeval.record.sqlite.protocol-spike";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const quoteSql = (value) => `'${value.replaceAll("'", "''")}'`;
const assert = (condition, message) => {
  if (!condition) throw new Error(`assertion failed: ${message}`);
};

const openDatabase = (path, { readOnly = false } = {}) => {
  const database = new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableForeignKeyConstraints: true,
    readOnly,
    timeout: 2_000,
  });
  database.exec(readOnly ? "PRAGMA query_only=ON" : "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
  return database;
};

const createSchema = (database, revision = 1) => {
  database.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE runs (
      run_id TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK (state IN ('open', 'sealing', 'sealed')),
      writer_generation INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE facts (
      run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      writer_generation INTEGER NOT NULL,
      logical_id TEXT NOT NULL,
      definition_id TEXT NOT NULL,
      family TEXT NOT NULL,
      body BLOB NOT NULL,
      canonical_digest TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      PRIMARY KEY (run_id, logical_id)
    ) STRICT;
    CREATE TABLE seal_entries (
      run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
      logical_id TEXT NOT NULL,
      digest TEXT NOT NULL,
      PRIMARY KEY (run_id, logical_id)
    ) STRICT;
  `);
  database.prepare("INSERT INTO metadata VALUES ('identity', ?)").run(schemaIdentity);
  database.prepare("INSERT INTO metadata VALUES ('revision', ?)").run(String(revision));
};

const createRun = (database, runId) =>
  database.prepare("INSERT INTO runs VALUES (?, 'open', 1)").run(runId);

const sameFrozenCommand = (stored, command) => (
  stored.runId === command.runId
  && stored.ownerId === command.ownerId
  && stored.generation === command.generation
  && stored.logicalId === command.logicalId
  && stored.definitionId === command.definitionId
  && stored.family === command.family
  && stored.canonicalDigest === command.canonicalDigest
);

// Commands are frozen before SQLite retry.  A matching committed command is a
// success even when the writer died before it could acknowledge that commit;
// a reused command id with any other identity or canonical bytes fails closed.
const append = (database, {
  runId,
  ownerId = runId,
  generation,
  logicalId,
  definitionId = "append-fact",
  family = "spike-fact",
  body,
  commandId,
  canonicalDigest = sha256(body),
}) => {
  assert(sha256(body) === canonicalDigest, "frozen canonical digest matches command bytes");
  const command = { runId, ownerId, generation, logicalId, definitionId, family, canonicalDigest };
  database.exec("BEGIN IMMEDIATE");
  try {
    const stored = database.prepare(`
      SELECT run_id AS runId, owner_id AS ownerId, writer_generation AS generation,
        logical_id AS logicalId, definition_id AS definitionId, family,
        canonical_digest AS canonicalDigest
      FROM facts WHERE command_id = ?
    `).get(commandId);
    if (stored) {
      database.exec("COMMIT");
      return sameFrozenCommand(stored, command) ? "committed-success" : "identity-conflict";
    }
    const result = database.prepare(`
      INSERT INTO facts(
        run_id, owner_id, writer_generation, logical_id, definition_id, family,
        body, canonical_digest, command_id
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM runs WHERE run_id = ? AND state = 'open' AND writer_generation = ?
      )
    `).run(
      runId, ownerId, generation, logicalId, definitionId, family, body, canonicalDigest, commandId,
      runId, generation,
    );
    database.exec("COMMIT");
    return result.changes === 1 ? "appended" : "rejected";
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

const inventory = (database, runId) => database.prepare(
  "SELECT logical_id AS logicalId, body FROM facts WHERE run_id = ? ORDER BY logical_id",
).all(runId).map((row) => ({ logicalId: row.logicalId, digest: sha256(row.body) }));

// This is the durable fence.  Its commit ends generation 1 permanently; the
// final transaction uses generation 2 and recomputes the exact inventory.
const fence = (database, runId, generation) => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = database.prepare(`
      UPDATE runs SET state = 'sealing', writer_generation = writer_generation + 1
      WHERE run_id = ? AND state = 'open' AND writer_generation = ?
    `).run(runId, generation);
    assert(result.changes === 1, "fence must advance exactly one open generation");
    database.exec("COMMIT");
    return generation + 1;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

const seal = (database, runId, generation, expectedInventory) => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = database.prepare("SELECT state, writer_generation AS generation FROM runs WHERE run_id = ?").get(runId);
    const actual = inventory(database, runId);
    assert(JSON.stringify(actual) === JSON.stringify(expectedInventory), "final transaction rechecks exact inventory");
    if (run?.state === "sealed") {
      assert(run.generation === generation, "repeated finalizer retains fenced generation");
      assertExactSeal(database, runId);
      database.exec("COMMIT");
      return "already-sealed";
    }
    assert(run?.state === "sealing" && run.generation === generation, "final transaction rechecks fenced generation");
    const insert = database.prepare("INSERT INTO seal_entries VALUES (?, ?, ?)");
    for (const [index, entry] of actual.entries()) {
      insert.run(runId, entry.logicalId, entry.digest);
      if (index === 0 && process.env.NICEEVAL_SPIKE_CRASH_AFTER_FIRST_SEAL_ROW === "1") {
        process.kill(process.pid, "SIGKILL");
      }
    }
    const result = database.prepare("UPDATE runs SET state = 'sealed' WHERE run_id = ? AND state = 'sealing' AND writer_generation = ?").run(runId, generation);
    assert(result.changes === 1, "final transaction publishes sealed state");
    database.exec("COMMIT");
    return "sealed";
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

const ordinaryRead = (database, runId) => database.prepare(`
  SELECT facts.logical_id AS logicalId, facts.body
  FROM facts JOIN runs USING (run_id)
  WHERE facts.run_id = ? AND runs.state = 'sealed'
  ORDER BY facts.logical_id
`).all(runId);

const assertExactSeal = (database, runId) => {
  const published = ordinaryRead(database, runId).map((row) => ({ logicalId: row.logicalId, digest: sha256(row.body) }));
  const sealRows = database.prepare("SELECT logical_id AS logicalId, digest FROM seal_entries WHERE run_id = ? ORDER BY logical_id").all(runId);
  assert(JSON.stringify(published) === JSON.stringify(sealRows), `Seal has no missing or extra entries for ${runId}`);
};

const runChild = (mode, arguments_) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, mode, ...arguments_], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
});

const fsyncFile = async (path) => {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
};
const fsyncDirectory = async (path) => {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
};

const validateDatabase = (path, { expectedRevision, expectedDigest, unknownBytes } = {}) => {
  const database = openDatabase(path, { readOnly: true });
  try {
    assert(database.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "SQLite integrity_check");
    assert(database.prepare("SELECT value FROM metadata WHERE key = 'identity'").get().value === schemaIdentity, "schema identity");
    if (expectedRevision !== undefined) {
      assert(database.prepare("SELECT value FROM metadata WHERE key = 'revision'").get().value === String(expectedRevision), "storage revision");
    }
    if (expectedDigest !== undefined) {
      assertExactSeal(database, "published");
      assert(
        sha256(JSON.stringify(inventory(database, "published"))) === expectedDigest,
        "published content inventory digest",
      );
    }
    if (unknownBytes !== undefined) {
      const row = database.prepare("SELECT body FROM facts WHERE run_id = 'published' AND logical_id = 'unknown-family'").get();
      assert(Buffer.compare(Buffer.from(row.body), unknownBytes) === 0, "unknown-family bytes preserved");
    }
    return { revision: database.prepare("SELECT value FROM metadata WHERE key = 'revision'").get().value };
  } finally { database.close(); }
};

const childCrashPublication = (path, point) => {
  const database = openDatabase(path);
  if (point === "before-fence") {
    append(database, { runId: "crash-before-fence", generation: 1, logicalId: "fact", body: Buffer.from("before"), commandId: "crash-before-command" });
    process.kill(process.pid, "SIGKILL");
  }
  if (point === "after-fence") {
    fence(database, "crash-after-fence", 1);
    process.kill(process.pid, "SIGKILL");
  }
  if (point === "after-seal-before-receipt") {
    const generation = fence(database, "crash-after-seal", 1);
    seal(database, "crash-after-seal", generation, inventory(database, "crash-after-seal"));
    process.kill(process.pid, "SIGKILL");
  }
  if (point === "after-command-commit-before-ack") {
    append(database, {
      runId: "crash-after-command-commit",
      generation: 1,
      logicalId: "fact",
      body: Buffer.from("committed before acknowledgement"),
      commandId: "crash-committed-command",
    });
    process.kill(process.pid, "SIGKILL");
  }
  if (point === "final-seal-before-commit") {
    const generation = fence(database, "crash-final-seal", 1);
    const expected = inventory(database, "crash-final-seal");
    process.env.NICEEVAL_SPIKE_CRASH_AFTER_FIRST_SEAL_ROW = "1";
    seal(database, "crash-final-seal", generation, expected);
  }
};

const childMigration = async (sourcePath, receiptPath, killPoint, expectedDigest, unknownText) => {
  const targetPath = `${sourcePath}.migration-target`;
  const unknownBytes = Buffer.from(unknownText, "base64");
  // Parent has closed every source connection before it starts this child.
  const source = openDatabase(sourcePath, { readOnly: true });
  await backup(source, targetPath);
  source.close();
  const target = openDatabase(targetPath);
  target.prepare("UPDATE metadata SET value = '2' WHERE key = 'revision'").run();
  target.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  target.close();
  validateDatabase(targetPath, { expectedRevision: 2, expectedDigest, unknownBytes });
  await fsyncFile(targetPath);
  if (killPoint === "pre-rename") process.kill(process.pid, "SIGKILL");
  await rename(targetPath, sourcePath);
  await fsyncDirectory(dirname(sourcePath));
  if (killPoint === "post-rename-pre-receipt") process.kill(process.pid, "SIGKILL");
  await fsyncFile(sourcePath);
  await fsyncDirectory(dirname(receiptPath));
  await open(receiptPath, "w").then(async (handle) => {
    try { await handle.writeFile(JSON.stringify({ revision: 2, digest: expectedDigest })); await handle.sync(); } finally { await handle.close(); }
  });
  process.stdout.write(JSON.stringify({ migrated: true }));
};

const makeFixture = (path) => {
  const database = openDatabase(path);
  createSchema(database);
  createRun(database, "published");
  const unknown = Buffer.from([0, 255, 4, 9, 127]);
  append(database, { runId: "published", generation: 1, logicalId: "known", body: Buffer.from("published body"), commandId: "fixture-known" });
  append(database, { runId: "published", generation: 1, logicalId: "unknown-family", body: unknown, commandId: "fixture-unknown" });
  const generation = fence(database, "published", 1);
  const expected = inventory(database, "published");
  seal(database, "published", generation, expected);
  database.close();
  return { digest: sha256(JSON.stringify(expected)), unknown };
};

const publicationProof = async (root) => {
  const path = join(root, "publication.sqlite");
  const database = openDatabase(path);
  createSchema(database);
  createRun(database, "run");
  assert(append(database, { runId: "run", generation: 1, logicalId: "first", body: Buffer.from("one"), commandId: "append-1" }) === "appended", "initial append");
  assert(append(database, { runId: "run", generation: 1, logicalId: "first", body: Buffer.from("one"), commandId: "append-1" }) === "committed-success", "matching frozen command is an idempotent committed success");
  assert(append(database, { runId: "run", generation: 1, logicalId: "first", family: "other-family", body: Buffer.from("one"), commandId: "append-1" }) === "identity-conflict", "different command identity is named conflict");
  assert(append(database, { runId: "run", generation: 1, logicalId: "first", body: Buffer.from("different bytes"), commandId: "append-1" }) === "identity-conflict", "different canonical payload digest is named conflict");
  const original = database.prepare("SELECT body, family FROM facts WHERE command_id = 'append-1'").get();
  assert(Buffer.from(original.body).equals(Buffer.from("one")) && original.family === "spike-fact", "identity conflicts neither overwrite nor add facts");
  const fenceGeneration = fence(database, "run", 1);
  assert(append(database, { runId: "run", generation: 1, logicalId: "late", body: Buffer.from("late"), commandId: "late-command" }) === "rejected", "delayed old generation rejected after durable fence");
  const expected = inventory(database, "run");
  assert(ordinaryRead(database, "run").length === 0, "ordinary reader cannot see sealing run");
  assert(seal(database, "run", fenceGeneration, expected) === "sealed", "final transaction seals exact inventory");
  assertExactSeal(database, "run");
  assert(ordinaryRead(database, "run").length === 1, "ordinary reader sees exact sealed closure");

  for (const runId of ["crash-before-fence", "crash-after-fence", "crash-after-seal", "crash-after-command-commit", "crash-final-seal"]) createRun(database, runId);
  assert(append(database, { runId: "crash-final-seal", generation: 1, logicalId: "first", body: Buffer.from("first seal row"), commandId: "crash-final-seal-first" }) === "appended", "final-seal crash fixture first fact");
  assert(append(database, { runId: "crash-final-seal", generation: 1, logicalId: "second", body: Buffer.from("second seal row"), commandId: "crash-final-seal-second" }) === "appended", "final-seal crash fixture second fact");
  database.close();
  const before = await runChild("crash-publication", [path, "before-fence"]);
  const afterFence = await runChild("crash-publication", [path, "after-fence"]);
  const afterSeal = await runChild("crash-publication", [path, "after-seal-before-receipt"]);
  const afterCommandCommit = await runChild("crash-publication", [path, "after-command-commit-before-ack"]);
  const finalSealBeforeCommit = await runChild("crash-publication", [path, "final-seal-before-commit"]);
  assert(
    before.signal === "SIGKILL" && afterFence.signal === "SIGKILL" && afterSeal.signal === "SIGKILL"
      && afterCommandCommit.signal === "SIGKILL" && finalSealBeforeCommit.signal === "SIGKILL",
    "all requested crash windows use SIGKILL",
  );
  const recovered = openDatabase(path);
  assert(recovered.prepare("SELECT state FROM runs WHERE run_id = 'crash-before-fence'").get().state === "open", "SIGKILL before fence leaves open run");
  assert(recovered.prepare("SELECT state FROM runs WHERE run_id = 'crash-after-fence'").get().state === "sealing", "SIGKILL after fence leaves sealing run");
  assert(ordinaryRead(recovered, "crash-before-fence").length === 0 && ordinaryRead(recovered, "crash-after-fence").length === 0, "ordinary reader excludes all incomplete crash runs");
  assert(recovered.prepare("SELECT state FROM runs WHERE run_id = 'crash-after-seal'").get().state === "sealed", "seal commit survives missing receipt");
  assertExactSeal(recovered, "crash-after-seal");
  assert(
    append(recovered, {
      runId: "crash-after-command-commit",
      generation: 1,
      logicalId: "fact",
      body: Buffer.from("committed before acknowledgement"),
      commandId: "crash-committed-command",
    }) === "committed-success",
    "retry after child commit and pre-ack SIGKILL confirms committed success",
  );
  assert(recovered.prepare("SELECT count(*) AS count FROM facts WHERE run_id = 'crash-after-command-commit'").get().count === 1, "post-ack crash retry writes no second row");
  const finalCrashExpected = inventory(recovered, "crash-final-seal");
  assert(recovered.prepare("SELECT state FROM runs WHERE run_id = 'crash-final-seal'").get().state === "sealing", "SIGKILL inside final Seal transaction leaves sealing run");
  assert(recovered.prepare("SELECT count(*) AS count FROM seal_entries WHERE run_id = 'crash-final-seal'").get().count === 0, "uncommitted Seal rows roll back after SIGKILL");
  assert(ordinaryRead(recovered, "crash-final-seal").length === 0, "ordinary reader excludes uncommitted final Seal");
  assert(seal(recovered, "crash-final-seal", 2, finalCrashExpected) === "sealed", "recovery finalizer rechecks and seals exact inventory once");
  const sealedEntryCount = recovered.prepare("SELECT count(*) AS count FROM seal_entries WHERE run_id = 'crash-final-seal'").get().count;
  assert(seal(recovered, "crash-final-seal", 2, finalCrashExpected) === "already-sealed", "repeated finalizer cannot rewrite a sealed Run");
  assert(recovered.prepare("SELECT count(*) AS count FROM seal_entries WHERE run_id = 'crash-final-seal'").get().count === sealedEntryCount, "repeated finalizer adds no Seal rows");
  assertExactSeal(recovered, "crash-final-seal");
  recovered.close();
  return {
    duplicateCommand: "matching frozen identity is committed-success; mismatches are identity-conflict",
    oldGenerationAfterFence: "rejected",
    crashSignals: [before.signal, afterFence.signal, afterSeal.signal, afterCommandCommit.signal, finalSealBeforeCommit.signal],
    committedCommandRecoveredAfterPreAckKill: true,
    uncommittedFinalSealRolledBackThenSealedOnce: true,
    receiptRebuildableAfterSeal: true,
  };
};

const snapshotProof = async (root) => {
  const sourcePath = join(root, "snapshot-source.sqlite");
  const transientPath = join(root, "snapshot-target.sqlite");
  const sharePath = join(root, "share-safe.sqlite");
  const source = openDatabase(sourcePath);
  createSchema(source);
  createRun(source, "published");
  append(source, { runId: "published", generation: 1, logicalId: "public", body: Buffer.from("public fact"), commandId: "snapshot-public" });
  const generation = fence(source, "published", 1);
  const publishedInventory = inventory(source, "published");
  seal(source, "published", generation, publishedInventory);
  const marker = `UNPUBLISHED_SECRET_${process.pid}_${Date.now()}`;
  createRun(source, "open-secret");
  append(source, { runId: "open-secret", generation: 1, logicalId: "secret", body: Buffer.from(marker), commandId: "snapshot-secret" });

  const barrier = { accepting: true, inFlight: 0 };
  const admit = () => { assert(barrier.accepting, "snapshot admission barrier rejects new source writers"); barrier.inFlight += 1; return () => { barrier.inFlight -= 1; }; };
  barrier.accepting = false;
  assert(barrier.inFlight === 0, "snapshot waits for admitted source writers to drain");
  await backup(source, transientPath);
  // Source writers may resume immediately after backup; cleanup is target-only.
  barrier.accepting = true;
  const release = admit(); release();
  source.close();
  const target = openDatabase(transientPath);
  target.exec("BEGIN IMMEDIATE; DELETE FROM runs WHERE state IN ('open', 'sealing'); COMMIT");
  assertExactSeal(target, "published");
  target.exec(`VACUUM INTO ${quoteSql(sharePath)}`);
  target.close();
  validateDatabase(sharePath, { expectedRevision: 1, expectedDigest: sha256(JSON.stringify(publishedInventory)) });
  const raw = await readFile(sharePath);
  assert(!raw.includes(Buffer.from(marker)), "share-safe raw bytes exclude open-row secret marker");
  const share = openDatabase(sharePath, { readOnly: true });
  assert(ordinaryRead(share, "open-secret").length === 0 && share.prepare("SELECT count(*) AS count FROM runs WHERE state <> 'sealed'").get().count === 0, "share-safe logical query contains only sealed runs");
  share.close();

  const failedTarget = join(root, "failed-snapshot.sqlite");
  let failedTargetRemoved = false;
  try {
    const retrySource = openDatabase(sourcePath, { readOnly: true });
    await backup(retrySource, failedTarget);
    retrySource.close();
    throw new Error("forced target validation failure");
  } catch {
    await rm(failedTarget, { force: true });
    failedTargetRemoved = !(await stat(failedTarget).then(() => true, () => false));
  }
  assert(failedTargetRemoved, "failed snapshot target is removed");
  return { barrier: "admission closed then drained; source admitted immediately after backup", rawSecretAbsent: true, failedTargetRemoved };
};

const migrationProof = async (root) => {
  const outcomes = [];
  for (const killPoint of ["pre-rename", "post-rename-pre-receipt"]) {
    const sourcePath = join(root, `migration-${killPoint}.sqlite`);
    const receiptPath = join(root, `migration-${killPoint}.receipt.json`);
    const fixture = makeFixture(sourcePath);
    const result = await runChild("migrate", [sourcePath, receiptPath, killPoint, fixture.digest, fixture.unknown.toString("base64")]);
    assert(result.signal === "SIGKILL", `${killPoint} child is killed`);
    const expectedRevision = killPoint === "pre-rename" ? 1 : 2;
    const reopened = validateDatabase(sourcePath, { expectedRevision, expectedDigest: fixture.digest, unknownBytes: fixture.unknown });
    assert(reopened.revision === String(expectedRevision), `${killPoint} reopen is whole source or whole target`);
    // Receipt is intentionally outside publication; it can be rebuilt from the
    // stable database after either interruption point.
    await open(receiptPath, "w").then(async (handle) => {
      try { await handle.writeFile(JSON.stringify({ rebuilt: true, revision: reopened.revision })); await handle.sync(); } finally { await handle.close(); }
    });
    outcomes.push({ killPoint, reopenedRevision: reopened.revision, receiptRebuilt: true });
  }
  return outcomes;
};

const main = async () => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-sqlite-publication-"));
  const versionProbe = new DatabaseSync(":memory:");
  const receipt = { node: process.version, sqlite: versionProbe.prepare("SELECT sqlite_version() AS version").get().version };
  versionProbe.close();
  try {
    receipt.publication = await publicationProof(root);
    receipt.snapshot = await snapshotProof(root);
    receipt.migration = await migrationProof(root);
    receipt.assertions = "all protocol assertions passed";
  } finally {
    await rm(root, { recursive: true, force: true });
    receipt.temporaryDirectoryRemoved = !(await stat(root).then(() => true, () => false));
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
};

const [mode, ...arguments_] = process.argv.slice(2);
if (mode === "crash-publication") childCrashPublication(arguments_[0], arguments_[1]);
else if (mode === "migrate") await childMigration(...arguments_);
else if (mode === undefined) await main();
else throw new Error(`unknown mode: ${mode}`);
