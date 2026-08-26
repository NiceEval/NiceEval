import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";

const mode = process.argv[2];
const home = process.argv[3];
const value = process.argv[4] ?? "";
const databasePath = join(home, "niceeval.sqlite");
const legacyPath = join(home, "state.sqlite");
const ledger = "__niceeval_user_database_migrations";

function openFixtureDatabase(path, options = {}) {
  mkdirSync(dirname(path), { recursive: true });
  return new DatabaseSync(path, { allowExtension: false, ...options });
}

function prepareRevision(repository, revision) {
  const database = openFixtureDatabase(databasePath);
  try {
    database.prepare(
      `INSERT INTO ${ledger}(repository_id, revision) VALUES (?, ?) ` +
      "ON CONFLICT(repository_id) DO UPDATE SET revision = excluded.revision",
    ).run(repository, revision);
  } finally {
    database.close();
  }
}

function replaceDockerSchema(kind) {
  const database = openFixtureDatabase(databasePath);
  try {
    if (kind === "constraint") {
      database.exec("PRAGMA writable_schema = ON");
      const changed = database.prepare(`UPDATE sqlite_schema
        SET sql = replace(sql, "state IN ('indexed','deleting','tombstoned','unverified')", "state IN ('indexed')")
        WHERE type = 'table' AND name = 'docker_task_build_entries'`).run();
      database.exec("PRAGMA writable_schema = OFF");
      if (changed.changes !== 1) throw new Error("could not replace Docker v1 table constraint");
      return;
    }
    if (kind === "index") {
      database.exec(`DROP INDEX docker_setup_prefix_replacement_scope;
        CREATE INDEX docker_setup_prefix_replacement_scope
        ON docker_setup_prefix_replacement_scopes(entry_id, replacement_scope)`);
      return;
    }
    if (kind === "trigger") {
      database.exec(`DROP TRIGGER docker_setup_prefix_exact_base_insert;
        CREATE TRIGGER docker_setup_prefix_exact_base_insert BEFORE INSERT ON docker_setup_prefix_entries
        WHEN length(NEW.base_image_id) < 1
        BEGIN SELECT RAISE(ABORT, 'replaced trigger'); END`);
      return;
    }
    throw new Error(`unknown Docker schema replacement kind: ${kind}`);
  } finally {
    database.close();
  }
}

function inspect() {
  const database = openFixtureDatabase(databasePath, { readOnly: true });
  try {
    const repositories = database.prepare(`SELECT repository_id, revision FROM ${ledger} ORDER BY repository_id`).all();
    const hasDurableState = database.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'durable_state_entries'").get().count === 1;
    const entries = hasDurableState
      ? database.prepare("SELECT key, value FROM durable_state_entries ORDER BY key").all()
      : [];
    const journalMode = database.prepare("PRAGMA journal_mode").get().journal_mode;
    return { repositories, entries, hasDurableState, journalMode };
  } finally {
    database.close();
  }
}

async function internalUserDatabase() {
  const publicEntry = fileURLToPath(import.meta.resolve("niceeval"));
  const packageRoot = dirname(dirname(publicEntry));
  return import(pathToFileURL(join(packageRoot, "dist", "user-database", "index.js")).href);
}

async function useRepository(action) {
  const { durableStateRepository, userDatabaseHost } = await internalUserDatabase();
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const database = yield* userDatabaseHost.open({ home, busyTimeoutMs: 10_000 });
    if (action === "open") return { action, path: database.path };
    if (action === "put") {
      yield* durableStateRepository.put(database, { key: value, value: `value-${value}` });
      const found = yield* durableStateRepository.get(database, value);
      if (found?.value !== `value-${value}`) throw new Error("durable-state write was not readable");
      return { action, found };
    }
    if (action === "list") return { action, entries: yield* durableStateRepository.list(database) };
    throw new Error(`unknown repository action: ${action}`);
  })));
}

let result;
if (mode === "prepare-revision") {
  const revision = Number(process.argv[5]);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("prepare-revision needs a non-negative integer revision");
  prepareRevision(value, revision);
  result = { action: mode };
} else if (mode === "prepare-empty") {
  mkdirSync(home, { recursive: true });
  writeFileSync(databasePath, "");
  result = { action: mode };
} else if (mode === "replace-docker-schema") {
  replaceDockerSchema(value);
  result = { action: mode, kind: value };
} else if (mode === "prepare-legacy") {
  const database = openFixtureDatabase(legacyPath);
  database.close();
  result = { action: mode };
} else if (mode === "prepare-renamed-legacy") {
  const database = openFixtureDatabase(databasePath);
  try {
    database.exec("CREATE TABLE legacy_state_entries (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT");
  } finally {
    database.close();
  }
  result = { action: mode };
} else if (mode === "prepare-extra-object") {
  const database = openFixtureDatabase(databasePath);
  try {
    database.exec("CREATE TABLE foreign_user_database_object (value TEXT NOT NULL) STRICT");
  } finally {
    database.close();
  }
  result = { action: mode };
} else if (mode === "prepare-both") {
  let database = openFixtureDatabase(databasePath);
  database.close();
  database = openFixtureDatabase(legacyPath);
  database.close();
  result = { action: mode };
} else if (mode === "inspect") {
  result = inspect();
} else {
  result = await useRepository(mode);
}

process.stdout.write(`${JSON.stringify(result)}\n`);
