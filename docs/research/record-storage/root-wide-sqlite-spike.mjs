import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  rm,
  stat,
  truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync, backup, constants } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

const MIB = 1024 * 1024;
const CONTENT_BYTES = 48 * MIB;
const DURABLE_CHUNK_BYTES = MIB;
const CONTENT_COUNT = 3;
const ITEM_COUNT = 50_000;
const WRITE_BATCH_CHUNKS = 8;

const round = (value, digits = 3) => Number(value.toFixed(digits));
const mib = (value) => round(value / MIB, 2);
const rss = () => process.memoryUsage().rss;
const percentile = (values, p) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

const sqliteLimits = {
  length: 8 * MIB,
  sqlLength: 64 * 1024,
  column: 128,
  exprDepth: 64,
  compoundSelect: 16,
  functionArg: 32,
  attach: 0,
  triggerDepth: 8,
};

const openDatabase = (path, { readOnly = false } = {}) => {
  const database = new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    limits: sqliteLimits,
    readOnly,
    timeout: 5_000,
  });

  database.exec("PRAGMA trusted_schema=OFF");
  if (readOnly) {
    database.exec("PRAGMA query_only=ON");
  } else {
    database.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA wal_autocheckpoint=1000;
      PRAGMA cache_size=-8192;
      PRAGMA mmap_size=0;
    `);
  }
  return database;
};

const createSchema = (database) => {
  database.exec(`
    CREATE TABLE record_metadata (
      key TEXT PRIMARY KEY,
      value BLOB NOT NULL
    ) STRICT;

    CREATE TABLE runs (
      run_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('open', 'sealing', 'sealed')),
      writer_generation INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE attachments (
      attachment_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      family TEXT NOT NULL,
      revision INTEGER NOT NULL,
      payload BLOB NOT NULL
    ) STRICT;

    CREATE TABLE collection_items (
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      ordinal INTEGER NOT NULL,
      payload BLOB NOT NULL,
      PRIMARY KEY (run_id, ordinal)
    ) STRICT;

    CREATE TABLE contents (
      content_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      byte_length INTEGER NOT NULL,
      digest TEXT,
      chunk_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE content_chunks (
      content_id TEXT NOT NULL REFERENCES contents(content_id),
      ordinal INTEGER NOT NULL,
      bytes BLOB NOT NULL CHECK (length(bytes) <= ${DURABLE_CHUNK_BYTES}),
      PRIMARY KEY (content_id, ordinal)
    ) STRICT;

    CREATE TABLE run_seal_entries (
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      kind TEXT NOT NULL,
      logical_id TEXT NOT NULL,
      digest TEXT NOT NULL,
      PRIMARY KEY (run_id, kind, logical_id)
    ) STRICT;

    CREATE TABLE writer_probe (
      writer_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      committed_at INTEGER NOT NULL,
      PRIMARY KEY (writer_id, ordinal)
    ) STRICT;

    CREATE TABLE storage_migrations (
      revision INTEGER PRIMARY KEY,
      identity TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT;

    CREATE TRIGGER sealed_run_no_update
    BEFORE UPDATE ON runs
    WHEN OLD.status = 'sealed'
    BEGIN
      SELECT RAISE(ABORT, 'sealed run is immutable');
    END;

    CREATE TRIGGER sealed_run_no_delete
    BEFORE DELETE ON runs
    WHEN OLD.status = 'sealed'
    BEGIN
      SELECT RAISE(ABORT, 'sealed run is immutable');
    END;

    CREATE TRIGGER sealed_chunk_no_insert
    BEFORE INSERT ON content_chunks
    WHEN (SELECT status FROM runs
          JOIN contents USING (run_id)
          WHERE contents.content_id = NEW.content_id) = 'sealed'
    BEGIN
      SELECT RAISE(ABORT, 'sealed closure is immutable');
    END;

    CREATE TRIGGER sealed_chunk_no_update
    BEFORE UPDATE ON content_chunks
    WHEN (SELECT status FROM runs
          JOIN contents USING (run_id)
          WHERE contents.content_id = OLD.content_id) = 'sealed'
    BEGIN
      SELECT RAISE(ABORT, 'sealed closure is immutable');
    END;

    CREATE TRIGGER sealed_chunk_no_delete
    BEFORE DELETE ON content_chunks
    WHEN (SELECT status FROM runs
          JOIN contents USING (run_id)
          WHERE contents.content_id = OLD.content_id) = 'sealed'
    BEGIN
      SELECT RAISE(ABORT, 'sealed closure is immutable');
    END;
  `);
};

const inputFragments = function* (seed, totalBytes) {
  const sizes = [64 * 1024, 131_071, 2 * MIB, 17, 777_777];
  const reusable = sizes.map((size) => Buffer.alloc(size, seed));
  let emitted = 0;
  let index = 0;
  while (emitted < totalBytes) {
    const size = Math.min(sizes[index % sizes.length], totalBytes - emitted);
    yield reusable[index % reusable.length].subarray(0, size);
    emitted += size;
    index += 1;
  }
};

const writeContent = (database, contentIndex) => {
  const contentId = `content-${contentIndex}`;
  const seed = 31 + contentIndex * 47;
  database
    .prepare(
      "INSERT INTO contents(content_id, run_id, byte_length, digest, chunk_count) VALUES (?, 'content-run', ?, NULL, 0)",
    )
    .run(contentId, CONTENT_BYTES);

  const insertChunk = database.prepare(
    "INSERT INTO content_chunks(content_id, ordinal, bytes) VALUES (?, ?, ?)",
  );
  const hasher = createHash("sha256");
  const durable = Buffer.allocUnsafe(DURABLE_CHUNK_BYTES);
  let durableLength = 0;
  let ordinal = 0;
  let peakRss = rss();
  let transactionOpen = false;

  const flush = () => {
    if (!transactionOpen) {
      database.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
    }
    insertChunk.run(contentId, ordinal, durable.subarray(0, durableLength));
    ordinal += 1;
    durableLength = 0;
    peakRss = Math.max(peakRss, rss());
    if (ordinal % WRITE_BATCH_CHUNKS === 0) {
      database.exec("COMMIT");
      transactionOpen = false;
    }
  };

  for (const fragment of inputFragments(seed, CONTENT_BYTES)) {
    hasher.update(fragment);
    let offset = 0;
    while (offset < fragment.length) {
      const copied = fragment.copy(
        durable,
        durableLength,
        offset,
        offset + Math.min(fragment.length - offset, durable.length - durableLength),
      );
      durableLength += copied;
      offset += copied;
      if (durableLength === durable.length) flush();
    }
    peakRss = Math.max(peakRss, rss());
  }
  if (durableLength > 0) flush();
  if (transactionOpen) database.exec("COMMIT");

  const digest = hasher.digest("hex");
  database
    .prepare("UPDATE contents SET digest = ?, chunk_count = ? WHERE content_id = ?")
    .run(digest, ordinal, contentId);
  return { contentId, digest, peakRss, chunks: ordinal };
};

const readContent = (database, contentId) => {
  const metadata = database
    .prepare(
      "SELECT byte_length AS byteLength, digest, chunk_count AS chunkCount FROM contents WHERE content_id = ?",
    )
    .get(contentId);
  const rows = database
    .prepare(
      "SELECT ordinal, bytes FROM content_chunks WHERE content_id = ? ORDER BY ordinal",
    )
    .iterate(contentId);
  const hasher = createHash("sha256");
  let ordinal = 0;
  let byteLength = 0;
  let peakRss = rss();
  for (const row of rows) {
    if (row.ordinal !== ordinal) throw new Error("non-contiguous content ordinal");
    hasher.update(row.bytes);
    byteLength += row.bytes.length;
    ordinal += 1;
    peakRss = Math.max(peakRss, rss());
  }
  const digest = hasher.digest("hex");
  if (
    byteLength !== metadata.byteLength ||
    ordinal !== metadata.chunkCount ||
    digest !== metadata.digest
  ) {
    throw new Error(`content validation failed for ${contentId}`);
  }
  return { byteLength, chunks: ordinal, digest, peakRss };
};

const sealRun = (database, runId, entries) => {
  const insertSeal = database.prepare(
    "INSERT INTO run_seal_entries(run_id, kind, logical_id, digest) VALUES (?, ?, ?, ?)",
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("UPDATE runs SET status = 'sealing' WHERE run_id = ?").run(runId);
    for (const entry of entries) {
      insertSeal.run(runId, entry.kind, entry.logicalId, entry.digest);
    }
    database.prepare("UPDATE runs SET status = 'sealed' WHERE run_id = ?").run(runId);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

const runChild = (mode, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL(import.meta.url).pathname, mode, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });

const runJsonChild = async (mode, args = []) => {
  const result = await runChild(mode, args);
  if (result.code !== 0) {
    throw new Error(`${mode} failed: ${result.stderr || result.signal}`);
  }
  return JSON.parse(result.stdout.trim());
};

const childCrash = (databasePath, point) => {
  const database = openDatabase(databasePath);
  const runId = `crash-${point}`;
  database.exec("BEGIN IMMEDIATE");
  database.prepare("UPDATE runs SET status = 'sealing' WHERE run_id = ?").run(runId);
  database
    .prepare(
      "INSERT INTO run_seal_entries(run_id, kind, logical_id, digest) VALUES (?, 'probe', 'probe', 'digest')",
    )
    .run(runId);
  if (point === "before") {
    process.kill(process.pid, "SIGKILL");
  }
  database.prepare("UPDATE runs SET status = 'sealed' WHERE run_id = ?").run(runId);
  database.exec("COMMIT");
  process.kill(process.pid, "SIGKILL");
};

const childFairWriter = (databasePath, writerId, countText) => {
  const count = Number(countText);
  const database = openDatabase(databasePath);
  const insert = database.prepare(
    "INSERT INTO writer_probe(writer_id, ordinal, committed_at) VALUES (?, ?, ?)",
  );
  const durations = [];
  const startedAt = performance.now();
  let firstCommitMs;
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const operationStartedAt = performance.now();
    database.exec("BEGIN IMMEDIATE");
    insert.run(writerId, ordinal, Date.now());
    database.exec("COMMIT");
    durations.push(performance.now() - operationStartedAt);
    firstCommitMs ??= performance.now() - startedAt;
  }
  database.close();
  process.stdout.write(
    JSON.stringify({
      writerId,
      count,
      firstCommitMs: round(firstCommitMs),
      totalMs: round(performance.now() - startedAt),
      p95TransactionMs: round(percentile(durations, 0.95)),
      maxTransactionMs: round(Math.max(...durations)),
    }),
  );
};

const childBackupWriter = async (databasePath, countText) => {
  const count = Number(countText);
  const database = openDatabase(databasePath);
  const insert = database.prepare(
    "INSERT INTO writer_probe(writer_id, ordinal, committed_at) VALUES ('backup', ?, ?)",
  );
  process.stdout.write("READY\n");
  const startedAt = performance.now();
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    database.exec("BEGIN IMMEDIATE");
    insert.run(ordinal, Date.now());
    database.exec("COMMIT");
    await delay(1);
  }
  database.close();
  process.stdout.write(
    `${JSON.stringify({ count, totalMs: round(performance.now() - startedAt) })}\n`,
  );
};

const startBackupWriter = (databasePath, count) => {
  const child = spawn(
    process.execPath,
    [new URL(import.meta.url).pathname, "backup-writer", databasePath, String(count)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  let readyResolve;
  const ready = new Promise((resolve) => (readyResolve = resolve));
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes("READY\n")) readyResolve();
  });
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`backup writer failed: ${stderr || signal}`));
        return;
      }
      const line = stdout
        .trim()
        .split("\n")
        .find((candidate) => candidate.startsWith("{"));
      resolve(JSON.parse(line));
    });
  });
  return { ready, done };
};

const workerStartupReceipt = async (databasePath) => {
  const durations = [];
  for (let index = 0; index < 20; index += 1) {
    const startedAt = performance.now();
    await new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { mode: "startup", databasePath },
      });
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    durations.push(performance.now() - startedAt);
  }
  return {
    samples: durations.length,
    p50Ms: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
  };
};

const schemaFingerprint = (database) => {
  const rows = database
    .prepare(
      "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
};

const main = async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "niceeval-record-sqlite-"));
  const databasePath = join(tempRoot, "record.sqlite");
  const snapshotPath = join(tempRoot, "snapshot.sqlite");
  const stoppedCopyPath = join(tempRoot, "stopped-copy.sqlite");
  const corruptCopyPath = join(tempRoot, "corrupt-copy.sqlite");
  const report = { tempRoot };

  try {
    const database = openDatabase(databasePath);
    createSchema(database);
    const sqliteVersion = database.prepare("SELECT sqlite_version() AS version").get().version;
    report.environment = {
      node: process.version,
      sqlite: sqliteVersion,
      databaseSync: "synchronous",
      backup: typeof backup,
      setAuthorizer: typeof database.setAuthorizer,
      defensive: typeof database.enableDefensive,
      limits: typeof database.limits,
    };

    database.prepare("INSERT INTO runs VALUES ('content-run', 'open', 1)").run();
    global.gc?.();
    const contentWriteBaseline = rss();
    const contentWriteStartedAt = performance.now();
    const written = [];
    for (let index = 0; index < CONTENT_COUNT; index += 1) {
      written.push(writeContent(database, index));
    }
    const contentWriteMs = performance.now() - contentWriteStartedAt;

    global.gc?.();
    const contentReadBaseline = rss();
    const contentReadStartedAt = performance.now();
    const read = written.map(({ contentId }) => readContent(database, contentId));
    const contentReadMs = performance.now() - contentReadStartedAt;
    for (let index = 0; index < written.length; index += 1) {
      if (written[index].digest !== read[index].digest) {
        throw new Error("write/read digest mismatch");
      }
    }

    let cancellationRows = 0;
    for (const _row of database
      .prepare("SELECT bytes FROM content_chunks ORDER BY content_id, ordinal")
      .iterate()) {
      cancellationRows += 1;
      if (cancellationRows === 10) break;
    }

    const metadataOnly = database
      .prepare("SELECT byte_length AS byteLength FROM contents WHERE content_id = ?")
      .get("content-0");
    const wholeValueAdmissionBytes = 32 * MIB;
    const wholeValueRejectedBeforeChunkRead =
      metadataOnly.byteLength > wholeValueAdmissionBytes;

    sealRun(
      database,
      "content-run",
      written.map(({ contentId, digest }) => ({
        kind: "content",
        logicalId: contentId,
        digest,
      })),
    );

    report.content = {
      logicalContents: CONTENT_COUNT,
      bytesPerContentMiB: mib(CONTENT_BYTES),
      aggregateMiB: mib(CONTENT_BYTES * CONTENT_COUNT),
      inputFragmentSizes: [64 * 1024, 131_071, 2 * MIB, 17, 777_777],
      durableChunkMiB: mib(DURABLE_CHUNK_BYTES),
      chunkCount: written.reduce((sum, item) => sum + item.chunks, 0),
      digestMatch: true,
      writeMs: round(contentWriteMs),
      readAndDigestMs: round(contentReadMs),
      peakWriteRssDeltaMiB: mib(
        Math.max(...written.map((item) => item.peakRss)) - contentWriteBaseline,
      ),
      peakReadRssDeltaMiB: mib(
        Math.max(...read.map((item) => item.peakRss)) - contentReadBaseline,
      ),
      validatorCancellationRowsBeforeStop: cancellationRows,
      wholeValueAdmissionMiB: mib(wholeValueAdmissionBytes),
      wholeValueRejectedBeforeChunkRead,
      byteLengthWithoutChunkRead: metadataOnly.byteLength,
    };

    database.prepare("INSERT INTO runs VALUES ('items-run', 'open', 1)").run();
    const insertItem = database.prepare(
      "INSERT INTO collection_items(run_id, ordinal, payload) VALUES ('items-run', ?, ?)",
    );
    global.gc?.();
    const itemWriteBaseline = rss();
    let itemWritePeak = itemWriteBaseline;
    let encodedBytes = 0;
    const itemWriteStartedAt = performance.now();
    for (let start = 0; start < ITEM_COUNT; start += 250) {
      database.exec("BEGIN IMMEDIATE");
      for (let ordinal = start; ordinal < Math.min(start + 250, ITEM_COUNT); ordinal += 1) {
        const payload = Buffer.from(JSON.stringify({ ordinal, turn: ordinal % 17 }));
        encodedBytes += payload.length;
        insertItem.run(ordinal, payload);
      }
      database.exec("COMMIT");
      itemWritePeak = Math.max(itemWritePeak, rss());
    }
    const itemWriteMs = performance.now() - itemWriteStartedAt;
    global.gc?.();
    const fullReadBaseline = rss();
    const fullReadStartedAt = performance.now();
    const allItems = database
      .prepare("SELECT ordinal, payload FROM collection_items WHERE run_id = 'items-run' ORDER BY ordinal")
      .all();
    const fullReadMs = performance.now() - fullReadStartedAt;
    const fullReadPeak = rss();
    if (allItems.length !== ITEM_COUNT || allItems.at(-1).ordinal !== ITEM_COUNT - 1) {
      throw new Error("collection fixture mismatch");
    }
    sealRun(database, "items-run", [
      {
        kind: "collection",
        logicalId: "items",
        digest: createHash("sha256")
          .update(String(encodedBytes))
          .digest("hex"),
      },
    ]);
    report.collection = {
      items: ITEM_COUNT,
      encodedMiB: mib(encodedBytes),
      retained: allItems.length,
      writeMs: round(itemWriteMs),
      peakWriteRssDeltaMiB: mib(itemWritePeak - itemWriteBaseline),
      fullArrayReadMs: round(fullReadMs),
      fullArrayReadRssDeltaMiB: mib(fullReadPeak - fullReadBaseline),
    };

    database.prepare("INSERT INTO runs VALUES ('family-run', 'open', 1)").run();
    const knownBefore = Buffer.from('{"kind":"known","value":1}');
    const unknownBefore = Buffer.from([0, 255, 1, 2, 3, 4, 127]);
    database
      .prepare("INSERT INTO attachments VALUES ('known', 'family-run', 'niceeval.known', 1, ?)")
      .run(knownBefore);
    database
      .prepare("INSERT INTO attachments VALUES ('unknown', 'family-run', 'third.party', 7, ?)")
      .run(unknownBefore);
    const unknownDigestBefore = createHash("sha256").update(unknownBefore).digest("hex");
    const familyMigrationStartedAt = performance.now();
    database.exec("BEGIN IMMEDIATE");
    const knownRow = database
      .prepare("SELECT payload FROM attachments WHERE attachment_id = 'known'")
      .get();
    const decodedKnown = JSON.parse(Buffer.from(knownRow.payload).toString("utf8"));
    database
      .prepare("UPDATE attachments SET revision = 2, payload = ? WHERE attachment_id = 'known'")
      .run(Buffer.from(JSON.stringify({ ...decodedKnown, migrated: true })));
    database.exec("COMMIT");
    const familyMigrationMs = performance.now() - familyMigrationStartedAt;
    const unknownAfter = database
      .prepare("SELECT revision, payload FROM attachments WHERE attachment_id = 'unknown'")
      .get();
    const unknownDigestAfter = createHash("sha256")
      .update(unknownAfter.payload)
      .digest("hex");
    sealRun(database, "family-run", [
      {
        kind: "attachment",
        logicalId: "known",
        digest: createHash("sha256").update(knownBefore).digest("hex"),
      },
      {
        kind: "attachment",
        logicalId: "unknown",
        digest: unknownDigestAfter,
      },
    ]);
    report.familyMigration = {
      typedKnownMigrationMs: round(familyMigrationMs),
      knownRevision: database
        .prepare("SELECT revision FROM attachments WHERE attachment_id = 'known'")
        .get().revision,
      unknownRevision: unknownAfter.revision,
      unknownBytePreserved: unknownDigestBefore === unknownDigestAfter,
    };

    let sealedMutationRejected = false;
    try {
      database
        .prepare("UPDATE runs SET writer_generation = 2 WHERE run_id = 'content-run'")
        .run();
    } catch {
      sealedMutationRejected = true;
    }

    const scratch = new DatabaseSync(":memory:", {
      allowExtension: false,
      defensive: true,
    });
    scratch.exec("CREATE TABLE probe(value TEXT)");
    let defensiveSchemaWriteRejected = false;
    try {
      scratch.exec("PRAGMA writable_schema=ON; DELETE FROM sqlite_schema");
    } catch {
      defensiveSchemaWriteRejected = true;
    }
    let extensionRejected = false;
    try {
      scratch.loadExtension("missing-extension");
    } catch {
      extensionRejected = true;
    }
    scratch.close();

    const reader = openDatabase(databasePath, { readOnly: true });
    const deniedActions = new Set([
      constants.SQLITE_ATTACH,
      constants.SQLITE_DETACH,
      constants.SQLITE_INSERT,
      constants.SQLITE_UPDATE,
      constants.SQLITE_DELETE,
      constants.SQLITE_ALTER_TABLE,
      constants.SQLITE_CREATE_TABLE,
      constants.SQLITE_DROP_TABLE,
    ]);
    reader.setAuthorizer((action, _arg1, _arg2, databaseName) =>
      (databaseName !== null && databaseName !== "main") || deniedActions.has(action)
        ? constants.SQLITE_DENY
        : constants.SQLITE_OK,
    );
    let attachRejected = false;
    try {
      reader.exec("ATTACH DATABASE ':memory:' AS injected");
    } catch {
      attachRejected = true;
    }
    const sealedRunsVisible = reader
      .prepare("SELECT count(*) AS count FROM runs WHERE status = 'sealed'")
      .get().count;
    reader.close();
    report.hardening = {
      fixedReaderAuthorizerAttachRejected: attachRejected,
      extensionRejected,
      defensiveSchemaWriteRejected,
      sealedMutationRejected,
      runtimeAttachLimit: database.limits.attach,
      sealedRunsVisible,
      schemaFingerprintBeforeMigration: schemaFingerprint(database),
    };

    database.prepare("INSERT INTO runs VALUES ('crash-before', 'open', 1)").run();
    database.prepare("INSERT INTO runs VALUES ('crash-after', 'open', 1)").run();
    database.close();
    const crashBefore = await runChild("crash", [databasePath, "before"]);
    const crashAfter = await runChild("crash", [databasePath, "after"]);
    const recovered = openDatabase(databasePath);
    const beforeState = recovered
      .prepare("SELECT status FROM runs WHERE run_id = 'crash-before'")
      .get().status;
    const beforeSealRows = recovered
      .prepare("SELECT count(*) AS count FROM run_seal_entries WHERE run_id = 'crash-before'")
      .get().count;
    const afterState = recovered
      .prepare("SELECT status FROM runs WHERE run_id = 'crash-after'")
      .get().status;
    const afterSealRows = recovered
      .prepare("SELECT count(*) AS count FROM run_seal_entries WHERE run_id = 'crash-after'")
      .get().count;
    report.crash = {
      beforeCommitSignal: crashBefore.signal,
      beforeCommitState: beforeState,
      beforeCommitSealRows: beforeSealRows,
      afterCommitSignal: crashAfter.signal,
      afterCommitState: afterState,
      afterCommitSealRows: afterSealRows,
      receiptWasNotRequiredForVisibility: afterState === "sealed",
    };

    const fairnessStartedAt = performance.now();
    const fairness = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        runJsonChild("fair-writer", [databasePath, `fair-${index}`, "250"]),
      ),
    );
    report.concurrentWriters = {
      writers: fairness.length,
      transactions: fairness.reduce((sum, item) => sum + item.count, 0),
      allProgressed: fairness.every((item) => item.count === 250),
      wallMs: round(performance.now() - fairnessStartedAt),
      perWriter: fairness,
    };

    const backupWriter = startBackupWriter(databasePath, 1_000);
    await backupWriter.ready;
    const backupStartRows = recovered
      .prepare("SELECT count(*) AS count FROM writer_probe WHERE writer_id = 'backup'")
      .get().count;
    let previousRemaining;
    let observedRestarts = 0;
    let progressCalls = 0;
    const backupStartedAt = performance.now();
    const backedUpPages = await backup(recovered, snapshotPath, {
      rate: 4,
      progress: ({ remainingPages }) => {
        progressCalls += 1;
        if (previousRemaining !== undefined && remainingPages > previousRemaining) {
          observedRestarts += 1;
        }
        previousRemaining = remainingPages;
      },
    });
    const backupMs = performance.now() - backupStartedAt;
    const backupWriterResult = await backupWriter.done;
    const backupFinalRows = recovered
      .prepare("SELECT count(*) AS count FROM writer_probe WHERE writer_id = 'backup'")
      .get().count;
    const snapshot = openDatabase(snapshotPath, { readOnly: true });
    const snapshotRows = snapshot
      .prepare("SELECT count(*) AS count FROM writer_probe WHERE writer_id = 'backup'")
      .get().count;
    const snapshotIntegrity = snapshot.prepare("PRAGMA integrity_check").get().integrity_check;
    snapshot.close();
    report.snapshot = {
      concurrentWriterTransactions: backupWriterResult.count,
      writerRowsBeforeBackup: backupStartRows,
      writerRowsInSnapshot: snapshotRows,
      writerRowsAfterBackup: backupFinalRows,
      consistentPrefix:
        snapshotRows >= backupStartRows && snapshotRows <= backupFinalRows,
      backupMs: round(backupMs),
      backedUpPages,
      progressCalls,
      observedRestarts,
      integrity: snapshotIntegrity,
    };

    const workerStartup = await workerStartupReceipt(databasePath);
    report.storageWorkerStartup = workerStartup;

    const sizeBeforeMigration = (await stat(databasePath)).size;
    const schemaMigrationStartedAt = performance.now();
    recovered.exec(`
      BEGIN EXCLUSIVE;
      CREATE TABLE content_chunks_next (
        content_id TEXT NOT NULL REFERENCES contents(content_id),
        ordinal INTEGER NOT NULL,
        bytes BLOB NOT NULL CHECK (length(bytes) <= ${DURABLE_CHUNK_BYTES}),
        stored_length INTEGER NOT NULL,
        PRIMARY KEY (content_id, ordinal)
      ) STRICT;
      INSERT INTO content_chunks_next(content_id, ordinal, bytes, stored_length)
      SELECT content_id, ordinal, bytes, length(bytes) FROM content_chunks;
      DROP TABLE content_chunks;
      ALTER TABLE content_chunks_next RENAME TO content_chunks;
      CREATE TRIGGER sealed_chunk_no_insert
      BEFORE INSERT ON content_chunks
      WHEN (SELECT status FROM runs
            JOIN contents USING (run_id)
            WHERE contents.content_id = NEW.content_id) = 'sealed'
      BEGIN
        SELECT RAISE(ABORT, 'sealed closure is immutable');
      END;
      CREATE TRIGGER sealed_chunk_no_update
      BEFORE UPDATE ON content_chunks
      WHEN (SELECT status FROM runs
            JOIN contents USING (run_id)
            WHERE contents.content_id = OLD.content_id) = 'sealed'
      BEGIN
        SELECT RAISE(ABORT, 'sealed closure is immutable');
      END;
      CREATE TRIGGER sealed_chunk_no_delete
      BEFORE DELETE ON content_chunks
      WHEN (SELECT status FROM runs
            JOIN contents USING (run_id)
            WHERE contents.content_id = OLD.content_id) = 'sealed'
      BEGIN
        SELECT RAISE(ABORT, 'sealed closure is immutable');
      END;
      INSERT INTO storage_migrations VALUES (2, 'content-chunk-stored-length', unixepoch());
      COMMIT;
    `);
    const schemaMigrationMs = performance.now() - schemaMigrationStartedAt;
    const afterMigration = written.map(({ contentId }) => readContent(recovered, contentId));
    const migrationPreservedDigests = afterMigration.every(
      (item, index) => item.digest === written[index].digest,
    );
    recovered.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const sizeAfterMigration = (await stat(databasePath)).size;
    report.schemaMigration = {
      adjacentRevision: "1 -> 2",
      exclusiveLockMs: round(schemaMigrationMs),
      databaseBeforeMiB: mib(sizeBeforeMigration),
      databaseAfterCheckpointMiB: mib(sizeAfterMigration),
      contentDigestsPreserved: migrationPreservedDigests,
      schemaFingerprintAfterMigration: schemaFingerprint(recovered),
    };

    const fullDatabasePath = join(tempRoot, "full.sqlite");
    const fullDatabase = new DatabaseSync(fullDatabasePath);
    fullDatabase.exec("PRAGMA page_size=4096; VACUUM; CREATE TABLE payloads(value BLOB)");
    const currentPages = fullDatabase.prepare("PRAGMA page_count").get().page_count;
    fullDatabase.exec(`PRAGMA max_page_count=${currentPages}`);
    let databaseFullRejected = false;
    let databaseFullCode;
    try {
      fullDatabase.exec("BEGIN IMMEDIATE");
      fullDatabase.prepare("INSERT INTO payloads VALUES (?)").run(Buffer.alloc(MIB));
      fullDatabase.exec("COMMIT");
    } catch (error) {
      databaseFullRejected = true;
      databaseFullCode = error.code;
      if (fullDatabase.isTransaction) fullDatabase.exec("ROLLBACK");
    }
    const rowsAfterFull = fullDatabase
      .prepare("SELECT count(*) AS count FROM payloads")
      .get().count;
    fullDatabase.close();
    report.resourceFailure = {
      databaseFullRejected,
      code: databaseFullCode,
      rowsAfterRollback: rowsAfterFull,
    };

    recovered.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    recovered.close();
    const stoppedCopyStartedAt = performance.now();
    await copyFile(databasePath, stoppedCopyPath);
    const stoppedCopyMs = performance.now() - stoppedCopyStartedAt;
    const stoppedCopy = openDatabase(stoppedCopyPath, { readOnly: true });
    const stoppedCopyIntegrity = stoppedCopy.prepare("PRAGMA integrity_check").get().integrity_check;
    const stoppedCopyContent = readContent(stoppedCopy, "content-0");
    stoppedCopy.close();
    report.stoppedCopy = {
      databaseMiB: mib((await stat(databasePath)).size),
      copyMs: round(stoppedCopyMs),
      integrity: stoppedCopyIntegrity,
      contentDigestPreserved: stoppedCopyContent.digest === written[0].digest,
      copiedOnlyAfterCheckpointAndClose: true,
    };

    await copyFile(databasePath, corruptCopyPath);
    const corruptSize = (await stat(corruptCopyPath)).size;
    await truncate(corruptCopyPath, Math.floor(corruptSize / 2));
    let truncatedDatabaseRejected = false;
    try {
      const corrupt = openDatabase(corruptCopyPath, { readOnly: true });
      const integrity = corrupt.prepare("PRAGMA integrity_check").get().integrity_check;
      truncatedDatabaseRejected = integrity !== "ok";
      corrupt.close();
    } catch {
      truncatedDatabaseRejected = true;
    }
    report.corruption = { truncatedDatabaseRejected };
  } finally {
    if (process.env.KEEP_SPIKE !== "1") {
      await rm(tempRoot, { recursive: true, force: true });
      report.tempRemoved = true;
    } else {
      report.tempRemoved = false;
    }
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

if (!isMainThread) {
  if (workerData?.mode !== "startup") throw new Error("unknown worker mode");
  const database = openDatabase(workerData.databasePath, { readOnly: true });
  database.prepare("SELECT value FROM record_metadata WHERE key = 'format'").get();
  database.close();
  parentPort.postMessage("ready");
} else {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "crash") {
    childCrash(args[0], args[1]);
  } else if (mode === "fair-writer") {
    childFairWriter(args[0], args[1], args[2]);
  } else if (mode === "backup-writer") {
    await childBackupWriter(args[0], args[1]);
  } else if (mode === undefined) {
    await main();
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
}
