import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { hostname, platform, release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { DatabaseSync, backup } from "node:sqlite";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STATE_VERSION = 1;
const OWNER_LEASE_MS = 500;
const MUTEX_LEASE_MS = 2_000;
const POLL_MS = 15;
const OPERATION_TIMEOUT_MS = 20_000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorCode(error) {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeDurableJson(path, value) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
  await syncDirectory(dirname(path));
}

function processIsKnownDead(owner) {
  if (owner.host !== hostname()) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return errorCode(error) === "ESRCH";
  }
}

async function acquireMutex(coordinationRoot) {
  await mkdir(coordinationRoot, { recursive: true, mode: 0o700 });
  const lockPath = join(coordinationRoot, "state.mutex");
  const ownerPath = join(lockPath, "owner.json");
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await writeDurableJson(ownerPath, {
        version: STATE_VERSION,
        host: hostname(),
        pid: process.pid,
        nonce: randomUUID(),
        expiresAt: Date.now() + MUTEX_LEASE_MS,
      });
      await syncDirectory(coordinationRoot);
      return async () => {
        await rm(lockPath, { recursive: true, force: true });
        await syncDirectory(coordinationRoot);
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }

    let existingOwner;
    try {
      existingOwner = JSON.parse(await readFile(ownerPath, "utf8"));
    } catch (error) {
      if (errorCode(error) !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }

    const stale = existingOwner !== undefined &&
      existingOwner.expiresAt <= Date.now() &&
      processIsKnownDead(existingOwner);
    if (stale) {
      const tombstone = join(
        coordinationRoot,
        `state.mutex.stale.${process.pid}.${randomUUID()}`,
      );
      try {
        await rename(lockPath, tombstone);
        await rm(tombstone, { recursive: true, force: true });
        await syncDirectory(coordinationRoot);
        continue;
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
    await sleep(POLL_MS);
  }
  throw new Error("Timed out acquiring the filesystem coordination mutex");
}

function initialState() {
  return {
    version: STATE_VERSION,
    revision: 0,
    nextSequence: 1,
    nextAdmissionOrdinal: 1,
    tickets: [],
    owner: null,
    barrier: null,
    recoveries: [],
  };
}

async function initializeCoordination(coordinationRoot) {
  await mkdir(coordinationRoot, { recursive: true, mode: 0o700 });
  const releaseMutex = await acquireMutex(coordinationRoot);
  try {
    const statePath = join(coordinationRoot, "state.json");
    if (!(await pathExists(statePath))) {
      await writeDurableJson(statePath, initialState());
    }
  } finally {
    await releaseMutex();
  }
}

function recoverExpiredKnownDeadOwner(state, now) {
  const owner = state.owner;
  if (
    owner === null ||
    owner.leaseExpiresAt > now ||
    !processIsKnownDead(owner)
  ) {
    return null;
  }
  const ticket = state.tickets.find((candidate) => candidate.id === owner.ticketId);
  assert(ticket, "The durable owner must refer to a durable ticket");
  ticket.status = "abandoned";
  ticket.abandonedAt = now;
  const recovery = {
    ticketId: owner.ticketId,
    sequence: ticket.sequence,
    pid: owner.pid,
    host: owner.host,
    leaseExpiresAt: owner.leaseExpiresAt,
    recoveredAt: now,
    knownDead: true,
  };
  state.recoveries.push(recovery);
  state.owner = null;
  return recovery;
}

async function mutateState(coordinationRoot, mutate) {
  const releaseMutex = await acquireMutex(coordinationRoot);
  try {
    const statePath = join(coordinationRoot, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.version, STATE_VERSION);
    const recovered = recoverExpiredKnownDeadOwner(state, Date.now());
    const result = await mutate(state);
    state.revision += 1;
    await writeDurableJson(statePath, state);
    return { result, recovered };
  } finally {
    await releaseMutex();
  }
}

async function readCoordinationState(coordinationRoot) {
  const releaseMutex = await acquireMutex(coordinationRoot);
  try {
    return JSON.parse(await readFile(join(coordinationRoot, "state.json"), "utf8"));
  } finally {
    await releaseMutex();
  }
}

async function enqueueTicket(coordinationRoot, writer, batchNumber) {
  const ticket = {
    id: randomUUID(),
    sequence: 0,
    writer,
    batchNumber,
    pid: process.pid,
    host: hostname(),
    status: "waiting",
    enqueuedAt: Date.now(),
  };
  const { result } = await mutateState(coordinationRoot, (state) => {
    ticket.sequence = state.nextSequence;
    state.nextSequence += 1;
    state.tickets.push(ticket);
    return structuredClone(ticket);
  });
  return result;
}

async function cancelTicket(coordinationRoot, ticketId) {
  const { result } = await mutateState(coordinationRoot, (state) => {
    const ticket = state.tickets.find((candidate) => candidate.id === ticketId);
    assert(ticket, "Cancellation must refer to a durable ticket");
    if (ticket.status !== "waiting") return false;
    ticket.status = "canceled";
    ticket.canceledAt = Date.now();
    return true;
  });
  return result;
}

async function tryAdmit(coordinationRoot, ticketId) {
  return mutateState(coordinationRoot, (state) => {
    if (state.barrier !== null || state.owner !== null) return null;
    const firstWaiting = state.tickets
      .filter((ticket) => ticket.status === "waiting")
      .sort((left, right) => left.sequence - right.sequence)[0];
    if (firstWaiting?.id !== ticketId) return null;

    const now = Date.now();
    const nonce = randomUUID();
    firstWaiting.status = "admitted";
    firstWaiting.admittedAt = now;
    firstWaiting.admissionOrdinal = state.nextAdmissionOrdinal;
    state.nextAdmissionOrdinal += 1;
    state.owner = {
      ticketId,
      sequence: firstWaiting.sequence,
      pid: process.pid,
      host: hostname(),
      nonce,
      admittedAt: now,
      leaseExpiresAt: now + OWNER_LEASE_MS,
    };
    return structuredClone(state.owner);
  });
}

async function releaseAdmission(coordinationRoot, ticketId, nonce) {
  const { result } = await mutateState(coordinationRoot, (state) => {
    assert.equal(state.owner?.ticketId, ticketId);
    assert.equal(state.owner?.nonce, nonce);
    const ticket = state.tickets.find((candidate) => candidate.id === ticketId);
    assert(ticket);
    assert.equal(ticket.status, "admitted");
    ticket.status = "done";
    ticket.completedAt = Date.now();
    state.owner = null;
    return structuredClone(ticket);
  });
  return result;
}

async function requestBarrier(coordinationRoot, barrierId) {
  const { result } = await mutateState(coordinationRoot, (state) => {
    assert.equal(state.barrier, null, "Only one snapshot barrier may be pending");
    const barrierState = {
      id: barrierId,
      status: "requested",
      pid: process.pid,
      host: hostname(),
      requestedAt: Date.now(),
      observedOwnerTicketId: state.owner?.ticketId ?? null,
    };
    state.barrier = barrierState;
    return structuredClone(barrierState);
  });
  return result;
}

async function tryActivateBarrier(coordinationRoot, barrierId) {
  const { result } = await mutateState(coordinationRoot, (state) => {
    assert.equal(state.barrier?.id, barrierId);
    if (state.owner !== null) return null;
    if (state.barrier.status === "requested") {
      state.barrier.status = "active";
      state.barrier.activeAt = Date.now();
    }
    return structuredClone(state.barrier);
  });
  return result;
}

async function releaseBarrier(coordinationRoot, barrierId) {
  const { result } = await mutateState(coordinationRoot, (state) => {
    assert.equal(state.barrier?.id, barrierId);
    assert.equal(state.barrier?.status, "active");
    const released = {
      ...state.barrier,
      releasedAt: Date.now(),
    };
    state.barrier = null;
    return released;
  });
  return result;
}

function openDatabase(path) {
  const database = new DatabaseSync(path, {
    open: true,
    readOnly: false,
  });
  database.exec("PRAGMA busy_timeout = 2000");
  database.exec("PRAGMA synchronous = FULL");
  return database;
}

function payloadFor(writer, batchNumber) {
  return JSON.stringify({ writer, batchNumber, value: `payload-${writer}-${batchNumber}` });
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function writeStableCommand(database, input) {
  const commandId = `${input.writer}:${input.batchNumber}`;
  const payload = payloadFor(input.writer, input.batchNumber);
  const payloadSha256 = sha256(payload);
  const existing = database.prepare(`
    SELECT writer, batch_no, payload, payload_sha256
    FROM record_commands
    WHERE command_id = ?
  `).get(commandId);
  if (existing !== undefined) {
    assert.deepEqual({ ...existing }, {
      writer: input.writer,
      batch_no: input.batchNumber,
      payload,
      payload_sha256: payloadSha256,
    });
    return { commandId, payloadSha256, duplicate: true };
  }
  database.prepare(`
    INSERT INTO record_commands (
      command_id, writer, batch_no, payload, payload_sha256, ticket_id, committed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    commandId,
    input.writer,
    input.batchNumber,
    payload,
    payloadSha256,
    input.ticketId,
    Date.now(),
  );
  return { commandId, payloadSha256, duplicate: false };
}

function emit(event) {
  process.stdout.write(`${JSON.stringify({ ...event, emittedAt: Date.now() })}\n`);
}

async function waitForFile(path) {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await pathExists(path)) return;
    await sleep(POLL_MS);
  }
  throw new Error(`Timed out waiting for gate ${path}`);
}

async function acquireTicket(coordinationRoot, ticket) {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { result: owner, recovered } = await tryAdmit(coordinationRoot, ticket.id);
    if (recovered !== null) emit({ type: "owner-recovered", ...recovered });
    if (owner !== null) return owner;
    await sleep(POLL_MS);
  }
  throw new Error(`Timed out waiting for ticket ${ticket.id}`);
}

async function runWriterChild(config) {
  const database = openDatabase(config.databasePath);
  try {
    for (const batchNumber of config.batchNumbers) {
      const ticket = await enqueueTicket(config.coordinationRoot, config.writer, batchNumber);
      emit({ type: "ticket-enqueued", writer: config.writer, batchNumber, ...ticket });
      const owner = await acquireTicket(config.coordinationRoot, ticket);
      emit({
        type: "ticket-admitted",
        writer: config.writer,
        batchNumber,
        ticketId: ticket.id,
        sequence: ticket.sequence,
        ...owner,
      });

      database.exec("BEGIN IMMEDIATE");
      let committed = false;
      try {
        const command = writeStableCommand(database, {
          writer: config.writer,
          batchNumber,
          ticketId: ticket.id,
        });
        emit({
          type: "transaction-begun",
          writer: config.writer,
          batchNumber,
          ticketId: ticket.id,
          sequence: ticket.sequence,
          commandId: command.commandId,
          duplicate: command.duplicate,
        });

        if (config.crashBeforeCommit === true) {
          await new Promise(() => {});
        }
        if (config.commitGatePath !== undefined) {
          await waitForFile(config.commitGatePath);
        }
        database.exec("COMMIT");
        committed = true;
        emit({
          type: "transaction-committed",
          writer: config.writer,
          batchNumber,
          ticketId: ticket.id,
          sequence: ticket.sequence,
          commandId: command.commandId,
          duplicate: command.duplicate,
        });
      } finally {
        if (!committed && config.crashBeforeCommit !== true) {
          database.exec("ROLLBACK");
        }
      }

      const completed = await releaseAdmission(
        config.coordinationRoot,
        ticket.id,
        owner.nonce,
      );
      emit({
        type: "ticket-released",
        writer: config.writer,
        batchNumber,
        ticketId: ticket.id,
        sequence: completed.sequence,
      });
    }
  } finally {
    database.close();
  }
  emit({ type: "writer-done", writer: config.writer });
}

async function runCancelerChild(config) {
  const ticket = await enqueueTicket(config.coordinationRoot, config.writer, 0);
  emit({ type: "ticket-enqueued", writer: config.writer, batchNumber: 0, ...ticket });
  await waitForFile(config.cancelGatePath);
  const canceled = await cancelTicket(config.coordinationRoot, ticket.id);
  assert.equal(canceled, true);
  emit({
    type: "ticket-canceled",
    writer: config.writer,
    ticketId: ticket.id,
    sequence: ticket.sequence,
  });
}

async function runBarrierChild(config) {
  const barrierId = randomUUID();
  const requested = await requestBarrier(config.coordinationRoot, barrierId);
  emit({ type: "barrier-requested", ...requested });

  let active = null;
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  while (active === null && Date.now() < deadline) {
    active = await tryActivateBarrier(config.coordinationRoot, barrierId);
    if (active === null) await sleep(POLL_MS);
  }
  assert(active, "Snapshot barrier did not drain the in-flight writer");
  emit({ type: "barrier-active", ...active });

  const source = openDatabase(config.databasePath);
  try {
    await backup(source, config.snapshotPath);
  } finally {
    source.close();
  }
  emit({ type: "backup-completed", barrierId, snapshotPath: config.snapshotPath });

  const released = await releaseBarrier(config.coordinationRoot, barrierId);
  emit({ type: "barrier-released", ...released });
}

async function runChild(config) {
  if (config.kind === "writer") return runWriterChild(config);
  if (config.kind === "canceler") return runCancelerChild(config);
  if (config.kind === "barrier") return runBarrierChild(config);
  throw new Error(`Unknown child kind: ${config.kind}`);
}

function encodeChildConfig(config) {
  return Buffer.from(JSON.stringify(config), "utf8").toString("base64url");
}

function launchChild(config, allChildren) {
  const child = spawn(process.execPath, [SCRIPT_PATH, "--child", encodeChildConfig(config)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const events = [];
  const waiters = [];
  let stderr = "";
  let exitResult;

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      event = { type: "invalid-child-output", line };
    }
    events.push(event);
    for (const waiter of [...waiters]) {
      if (waiter.matches(event)) {
        waiter.resolve(event);
        waiters.splice(waiters.indexOf(waiter), 1);
      }
    }
  });

  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exitResult = { code, signal, stderr };
      resolve(exitResult);
      for (const waiter of [...waiters]) {
        waiter.reject(
          new Error(
            `Child ${config.writer ?? config.kind} exited before ${waiter.description}: ` +
              JSON.stringify({ ...exitResult, events }),
          ),
        );
        waiters.splice(waiters.indexOf(waiter), 1);
      }
    });
  });

  const handle = {
    child,
    config,
    events,
    get exitResult() {
      return exitResult;
    },
    exitPromise,
    waitFor(type, predicate = () => true, timeout = OPERATION_TIMEOUT_MS) {
      const existing = events.find((event) => event.type === type && predicate(event));
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          description: type,
          matches: (event) => event.type === type && predicate(event),
          resolve: (event) => {
            clearTimeout(timer);
            resolve(event);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for ${type} from ${config.writer ?? config.kind}`));
        }, timeout);
        waiters.push(waiter);
      });
    },
  };
  allChildren.push(handle);
  return handle;
}

async function expectSuccessfulExit(handle) {
  const result = await handle.exitPromise;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  return result;
}

function initializeDatabase(databasePath) {
  const database = openDatabase(databasePath);
  try {
    const journalMode = database.prepare("PRAGMA journal_mode = WAL").get().journal_mode;
    assert.equal(journalMode, "wal");
    database.exec(`
      CREATE TABLE record_commands (
        command_id TEXT PRIMARY KEY,
        writer TEXT NOT NULL,
        batch_no INTEGER NOT NULL,
        payload TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        ticket_id TEXT NOT NULL UNIQUE,
        committed_at INTEGER NOT NULL
      ) STRICT;
    `);
    return database.prepare("SELECT sqlite_version() AS version").get().version;
  } finally {
    database.close();
  }
}

function inspectRecord(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database.prepare(`
      SELECT command_id, writer, batch_no, payload, payload_sha256, ticket_id
      FROM record_commands
      ORDER BY command_id
    `).all();
    const canonical = rows.map(({ ticket_id: _ticketId, ...fact }) => fact);
    return {
      rows,
      count: rows.length,
      commandIds: rows.map((row) => row.command_id),
      validityDigest: sha256(JSON.stringify(canonical)),
    };
  } finally {
    database.close();
  }
}

function assertStrictlyIncreasing(values, message) {
  for (let index = 1; index < values.length; index += 1) {
    assert(values[index - 1] < values[index], message);
  }
}

async function cleanupChildren(allChildren) {
  for (const handle of allChildren) {
    if (handle.exitResult === undefined) handle.child.kill("SIGKILL");
  }
  await Promise.allSettled(allChildren.map((handle) => handle.exitPromise));
}

async function runParent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "niceeval-sqlite-coordination-"));
  const coordinationRoot = join(temporaryRoot, "coordination");
  const databasePath = join(temporaryRoot, "record.sqlite");
  const snapshotPath = join(temporaryRoot, "snapshot.sqlite");
  const gatesRoot = join(temporaryRoot, "gates");
  const allChildren = [];

  try {
    await mkdir(gatesRoot, { recursive: true });
    await initializeCoordination(coordinationRoot);
    const sqliteVersion = initializeDatabase(databasePath);

    const fifoHolderGate = join(gatesRoot, "fifo-holder-release");
    const cancelGate = join(gatesRoot, "cancel-waiter");

    const holder = launchChild({
      kind: "writer",
      writer: "holder",
      batchNumbers: [0],
      commitGatePath: fifoHolderGate,
      coordinationRoot,
      databasePath,
    }, allChildren);
    const holderEnqueued = await holder.waitFor("ticket-enqueued");
    const holderBegun = await holder.waitFor("transaction-begun");

    const writerA = launchChild({
      kind: "writer",
      writer: "writer-a",
      batchNumbers: [0, 1],
      coordinationRoot,
      databasePath,
    }, allChildren);
    const writerAFirst = await writerA.waitFor(
      "ticket-enqueued",
      (event) => event.batchNumber === 0,
    );

    const canceler = launchChild({
      kind: "canceler",
      writer: "canceled-writer",
      cancelGatePath: cancelGate,
      coordinationRoot,
    }, allChildren);
    const canceledEnqueued = await canceler.waitFor("ticket-enqueued");

    const writerB = launchChild({
      kind: "writer",
      writer: "writer-b",
      batchNumbers: [0, 1],
      coordinationRoot,
      databasePath,
    }, allChildren);
    const writerBFirst = await writerB.waitFor(
      "ticket-enqueued",
      (event) => event.batchNumber === 0,
    );

    const crashingWriter = launchChild({
      kind: "writer",
      writer: "crashing-writer",
      batchNumbers: [0],
      crashBeforeCommit: true,
      coordinationRoot,
      databasePath,
    }, allChildren);
    const crashEnqueued = await crashingWriter.waitFor("ticket-enqueued");

    assert.deepEqual(
      [
        holderEnqueued.sequence,
        writerAFirst.sequence,
        canceledEnqueued.sequence,
        writerBFirst.sequence,
        crashEnqueued.sequence,
      ],
      [1, 2, 3, 4, 5],
    );

    await writeFile(cancelGate, "cancel\n", "utf8");
    const canceled = await canceler.waitFor("ticket-canceled");
    await expectSuccessfulExit(canceler);

    await writeFile(fifoHolderGate, "release\n", "utf8");
    const crashBegun = await crashingWriter.waitFor("transaction-begun");
    const crashAdmission = await crashingWriter.waitFor("ticket-admitted");
    assert.equal(crashBegun.ticketId, crashAdmission.ticketId);
    assert.equal(crashingWriter.child.kill("SIGKILL"), true);
    const crashExit = await crashingWriter.exitPromise;
    assert.equal(crashExit.signal, "SIGKILL");

    const recoveryEvent = await Promise.race([
      writerA.waitFor("owner-recovered"),
      writerB.waitFor("owner-recovered"),
    ]);
    assert.equal(recoveryEvent.ticketId, crashEnqueued.id);
    assert.equal(recoveryEvent.knownDead, true);
    assert(recoveryEvent.recoveredAt >= recoveryEvent.leaseExpiresAt);

    await Promise.all([
      holder.waitFor("writer-done"),
      writerA.waitFor("writer-done"),
      writerB.waitFor("writer-done"),
    ]);
    await Promise.all([
      expectSuccessfulExit(holder),
      expectSuccessfulExit(writerA),
      expectSuccessfulExit(writerB),
    ]);

    const barrierWriterGate = join(gatesRoot, "barrier-writer-release");
    const barrierWriter = launchChild({
      kind: "writer",
      writer: "barrier-inflight",
      batchNumbers: [0],
      commitGatePath: barrierWriterGate,
      coordinationRoot,
      databasePath,
    }, allChildren);
    const barrierWriterEnqueued = await barrierWriter.waitFor("ticket-enqueued");
    const barrierWriterBegun = await barrierWriter.waitFor("transaction-begun");

    const barrier = launchChild({
      kind: "barrier",
      coordinationRoot,
      databasePath,
      snapshotPath,
    }, allChildren);
    const barrierRequested = await barrier.waitFor("barrier-requested");
    assert.equal(barrierRequested.observedOwnerTicketId, barrierWriterEnqueued.id);

    const queuedAfterBarrier = launchChild({
      kind: "writer",
      writer: "barrier-queued",
      batchNumbers: [0],
      coordinationRoot,
      databasePath,
    }, allChildren);
    const queuedEnqueued = await queuedAfterBarrier.waitFor("ticket-enqueued");
    await sleep(200);
    assert.equal(
      queuedAfterBarrier.events.some((event) => event.type === "transaction-begun"),
      false,
      "The requested barrier must block new transactions",
    );

    await writeFile(barrierWriterGate, "release\n", "utf8");
    const inFlightCommitted = await barrierWriter.waitFor("transaction-committed");
    const barrierActive = await barrier.waitFor("barrier-active");
    const backupCompleted = await barrier.waitFor("backup-completed");
    const barrierReleased = await barrier.waitFor("barrier-released");
    const queuedBegun = await queuedAfterBarrier.waitFor("transaction-begun");
    const queuedCommitted = await queuedAfterBarrier.waitFor("transaction-committed");

    await Promise.all([
      expectSuccessfulExit(barrierWriter),
      expectSuccessfulExit(barrier),
      expectSuccessfulExit(queuedAfterBarrier),
    ]);

    assert(barrierRequested.requestedAt >= holderBegun.emittedAt);
    assert(inFlightCommitted.emittedAt >= barrierRequested.requestedAt);
    assert(barrierActive.activeAt >= inFlightCommitted.emittedAt);
    assert(backupCompleted.emittedAt >= barrierActive.activeAt);
    assert(barrierReleased.releasedAt >= backupCompleted.emittedAt);
    assert(queuedBegun.emittedAt >= barrierReleased.releasedAt);
    assert.equal(barrierWriterBegun.ticketId, barrierWriterEnqueued.id);
    assert.equal(queuedBegun.ticketId, queuedEnqueued.id);

    const stateBeforeDeletion = await readCoordinationState(coordinationRoot);
    assert.equal(stateBeforeDeletion.owner, null);
    assert.equal(stateBeforeDeletion.barrier, null);

    const firstGenerationTickets = stateBeforeDeletion.tickets;
    const survivingTickets = firstGenerationTickets.filter(
      (ticket) => ticket.status !== "canceled",
    );
    const authoritativeOrder = survivingTickets
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .map((ticket) => ticket.sequence);
    const admissionOrder = survivingTickets
      .slice()
      .sort((left, right) => left.admissionOrdinal - right.admissionOrdinal)
      .map((ticket) => ticket.sequence);
    assert.deepEqual(admissionOrder, authoritativeOrder);
    assertStrictlyIncreasing(admissionOrder, "FIFO admission must follow durable sequence");

    const writerATickets = firstGenerationTickets.filter(
      (ticket) => ticket.writer === "writer-a",
    );
    const writerBTickets = firstGenerationTickets.filter(
      (ticket) => ticket.writer === "writer-b",
    );
    assert.equal(writerATickets.length, 2);
    assert.equal(writerBTickets.length, 2);
    assert(writerATickets[1].sequence > crashEnqueued.sequence);
    assert(writerBTickets[1].sequence > crashEnqueued.sequence);

    const canceledTicket = firstGenerationTickets.find(
      (ticket) => ticket.id === canceled.ticketId,
    );
    assert.equal(canceledTicket?.status, "canceled");
    const crashedTicket = firstGenerationTickets.find(
      (ticket) => ticket.id === crashEnqueued.id,
    );
    assert.equal(crashedTicket?.status, "abandoned");
    assert.equal(stateBeforeDeletion.recoveries.length, 1);

    const liveRecordBeforeDeletion = inspectRecord(databasePath);
    const snapshotRecord = inspectRecord(snapshotPath);
    assert.equal(liveRecordBeforeDeletion.count, 7);
    assert(snapshotRecord.commandIds.includes("barrier-inflight:0"));
    assert(!snapshotRecord.commandIds.includes("barrier-queued:0"));
    assert(liveRecordBeforeDeletion.commandIds.includes("barrier-queued:0"));
    assert(!liveRecordBeforeDeletion.commandIds.includes("crashing-writer:0"));

    const rowsPerTicket = new Map();
    for (const row of liveRecordBeforeDeletion.rows) {
      rowsPerTicket.set(row.ticket_id, (rowsPerTicket.get(row.ticket_id) ?? 0) + 1);
    }
    assert([...rowsPerTicket.values()].every((count) => count === 1));

    const healthyWriters = [
      "holder",
      "writer-a",
      "writer-b",
      "barrier-inflight",
      "barrier-queued",
    ];
    for (const writer of healthyWriters) {
      assert(liveRecordBeforeDeletion.rows.some((row) => row.writer === writer));
    }

    await rm(coordinationRoot, { recursive: true, force: true });
    assert.equal(await pathExists(coordinationRoot), false);
    const liveRecordWithCoordinationDeleted = inspectRecord(databasePath);
    assert.equal(
      liveRecordWithCoordinationDeleted.validityDigest,
      liveRecordBeforeDeletion.validityDigest,
    );

    await initializeCoordination(coordinationRoot);
    const replayWriter = launchChild({
      kind: "writer",
      writer: "holder",
      batchNumbers: [0],
      coordinationRoot,
      databasePath,
    }, allChildren);
    const replayCommitted = await replayWriter.waitFor("transaction-committed");
    assert.equal(replayCommitted.duplicate, true);
    await expectSuccessfulExit(replayWriter);
    const rebuiltState = await readCoordinationState(coordinationRoot);
    const liveRecordAfterRebuild = inspectRecord(databasePath);
    assert.equal(liveRecordAfterRebuild.count, liveRecordBeforeDeletion.count);
    assert.equal(
      liveRecordAfterRebuild.validityDigest,
      liveRecordBeforeDeletion.validityDigest,
    );

    const filesystem = await statfs(temporaryRoot);
    const filesystemMagic = Number(filesystem.type).toString(16);
    assert.equal(filesystemMagic, "ef53", "This selection receipt requires local ext4");

    return {
      receiptVersion: 1,
      observedAt: new Date().toISOString(),
      selectionReference: {
        platform: platform(),
        kernel: release(),
        filesystem: "ext4",
        filesystemMagic: `0x${filesystemMagic}`,
        node: process.version,
        sqlite: sqliteVersion,
        coordinationAuthority: "durable atomic JSON state guarded by a recoverable filesystem mutex",
        recordAuthority: "file-backed SQLite commits keyed by stable command identity",
      },
      fixture: {
        independentChildProcesses: allChildren.length,
        firstGenerationTickets: firstGenerationTickets.length,
        admittedTickets: survivingTickets.length,
        canceledTickets: 1,
        crashedOwners: 1,
        healthyWriters,
        committedBoundedBatches: liveRecordBeforeDeletion.count,
        replayedDuplicateTransactions: 1,
      },
      assertions: {
        durableFifoAdmission: true,
        oneBoundedBatchPerTicket: true,
        backlogRequeuesAtTail: true,
        canceledWaiterDoesNotBlockSuccessor: true,
        expiredKnownDeadOwnerRecovered: true,
        finiteHealthyWritersProgressAndFinish: true,
        snapshotBarrierDrainsInFlightTransaction: true,
        snapshotBarrierBlocksAndThenReleasesQueuedWriters: true,
        coordinationStateIsNotRecordValidity: true,
      },
      fifo: {
        ticketOrder: firstGenerationTickets.map((ticket) => ({
          sequence: ticket.sequence,
          writer: ticket.writer,
          batchNumber: ticket.batchNumber,
          status: ticket.status,
          admissionOrdinal: ticket.admissionOrdinal ?? null,
        })),
        survivingSequenceOrder: authoritativeOrder,
        admissionSequenceOrder: admissionOrder,
        backlogRequeues: {
          writerA: writerATickets.map((ticket) => ticket.sequence),
          writerB: writerBTickets.map((ticket) => ticket.sequence),
          initialQueueTail: crashEnqueued.sequence,
        },
      },
      cancellation: {
        ticketSequence: canceled.sequence,
        finalStatus: canceledTicket.status,
        successorSequence: writerBFirst.sequence,
        successorCommitted: liveRecordBeforeDeletion.commandIds.includes("writer-b:0"),
      },
      crashRecovery: {
        crashedTicketSequence: crashEnqueued.sequence,
        childExitSignal: crashExit.signal,
        leaseExpiresAt: recoveryEvent.leaseExpiresAt,
        recoveredAt: recoveryEvent.recoveredAt,
        recoveredAfterLeaseExpiryMs:
          recoveryEvent.recoveredAt - recoveryEvent.leaseExpiresAt,
        knownDead: recoveryEvent.knownDead,
        crashedCommandCommitted: false,
        successorSequence: writerATickets[1].sequence,
      },
      snapshotBarrier: {
        inFlightTicketSequence: barrierWriterEnqueued.sequence,
        queuedTicketSequence: queuedEnqueued.sequence,
        requestedAt: barrierRequested.requestedAt,
        inFlightBeganAt: barrierWriterBegun.emittedAt,
        inFlightCommittedAt: inFlightCommitted.emittedAt,
        activeAt: barrierActive.activeAt,
        backupCompletedAt: backupCompleted.emittedAt,
        releasedAt: barrierReleased.releasedAt,
        queuedTransactionBeganAt: queuedBegun.emittedAt,
        queuedTransactionCommittedAt: queuedCommitted.emittedAt,
        snapshotCommandCount: snapshotRecord.count,
        snapshotContainsInFlightCommit: true,
        snapshotExcludesQueuedPostBarrierCommit: true,
      },
      recordValidity: {
        committedCommandCount: liveRecordBeforeDeletion.count,
        stableCommandIds: liveRecordBeforeDeletion.commandIds,
        digestBeforeCoordinationDeletion: liveRecordBeforeDeletion.validityDigest,
        digestWhileCoordinationDeleted: liveRecordWithCoordinationDeleted.validityDigest,
        digestAfterCoordinationRebuildAndReplay: liveRecordAfterRebuild.validityDigest,
        rebuiltCoordinationTicketCount: rebuiltState.tickets.length,
        stableReplayWasDuplicate: replayCommitted.duplicate,
      },
      limitations: [
        "This is a Linux/ext4 single-host selection receipt, not a cross-platform guarantee.",
        "It does not establish correctness on network filesystems or under a hostile local file modifier.",
        "It validates a protocol candidate and does not claim that production Coordination already implements it.",
      ],
    };
  } finally {
    await cleanupChildren(allChildren);
    await rm(temporaryRoot, { recursive: true, force: true });
    assert.equal(await pathExists(temporaryRoot), false, "Temporary fixture must be removed");
  }
}

if (process.argv[2] === "--child") {
  const config = JSON.parse(Buffer.from(process.argv[3], "base64url").toString("utf8"));
  try {
    await runChild(config);
  } catch (error) {
    emit({
      type: "child-error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
  }
} else {
  const receipt = await runParent();
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
