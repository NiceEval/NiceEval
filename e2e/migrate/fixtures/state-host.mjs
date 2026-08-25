import { Effect } from "effect";
import { defineStateService, makeUserStateStoreHost } from "niceeval/state";

const mode = process.argv[2];
const home = process.argv[3];
const value = process.argv[4] ?? "";

const service = defineStateService({
  serviceId: "e2e.state-journey",
  currentRevision: 1,
  migrations: [{
    from: 0,
    to: 1,
    sql: [
      "CREATE TABLE {{namespace}}entries (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT",
      "CREATE INDEX {{namespace}}entries_by_value ON {{namespace}}entries(value)",
    ],
    schema: [
      { type: "table", logicalName: "entries", sql: "CREATE TABLE {{namespace}}entries (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT" },
      { type: "index", logicalName: "entries_by_value", tableLogicalName: "entries", sql: "CREATE INDEX {{namespace}}entries_by_value ON {{namespace}}entries(value)" },
    ],
  }],
  operations: [
    {
      name: "put",
      kind: "run",
      sql: "INSERT INTO {{namespace}}entries(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      bind: ({ key, value }) => [key, value],
      decode: undefined,
    },
    {
      name: "get",
      kind: "one",
      sql: "SELECT key, value FROM {{namespace}}entries WHERE key = ?",
      bind: ({ key }) => [key],
      decode: (row) => typeof row === "object" && row !== null && typeof row.key === "string" && typeof row.value === "string"
        ? { _tag: "StateRowDecodeSuccess", value: { key: row.key, value: row.value } }
        : { _tag: "StateRowDecodeFailure", reason: "expected key/value row" },
    },
    {
      name: "list",
      kind: "many",
      sql: "SELECT key, value FROM {{namespace}}entries ORDER BY key",
      bind: () => [],
      decode: (row) => typeof row === "object" && row !== null && typeof row.key === "string" && typeof row.value === "string"
        ? { _tag: "StateRowDecodeSuccess", value: { key: row.key, value: row.value } }
        : { _tag: "StateRowDecodeFailure", reason: "expected key/value row" },
    },
  ],
});

const host = makeUserStateStoreHost({ modules: [service] });

async function execute(action) {
  const program = Effect.scoped(Effect.gen(function* () {
    const store = yield* host.open({ home, busyTimeoutMs: 10_000 });
    const state = store.service(service);
    if (action === "put") {
      yield* state.execute(service.operations[0], { key: value, value: `value-${value}` });
      const found = yield* state.execute(service.operations[1], { key: value });
      if (found?.value !== `value-${value}`) throw new Error("short State write was not readable");
      return { action, key: value, found };
    }
    if (action === "list") return { action, entries: yield* state.execute(service.operations[2], {}) };
    if (action === "invalid-operation") {
      const forged = { name: "undeclared", kind: "one", sql: "SELECT 1", bind: () => [], decode: () => ({ _tag: "StateRowDecodeSuccess", value: 1 }) };
      const result = yield* Effect.either(state.execute(forged, {}));
      if (result._tag !== "Left" || result.left.code !== "service-state-invalid") throw new Error("undeclared State operation was not rejected");
      return { action, code: result.left.code };
    }
    throw new Error(`unknown state-host action: ${action}`);
  }));
  return Effect.runPromise(program);
}

if (mode === "invalid-schema") {
  let rejected = false;
  try {
    defineStateService({
      serviceId: "e2e.invalid-schema",
      currentRevision: 1,
      migrations: [{
        from: 0,
        to: 1,
        sql: ["CREATE TABLE entries (value TEXT NOT NULL) STRICT"],
        schema: [{ type: "table", logicalName: "entries", sql: "CREATE TABLE entries (value TEXT NOT NULL) STRICT" }],
      }],
      operations: [],
    });
  } catch (error) {
    rejected = error instanceof TypeError;
  }
  if (!rejected) throw new Error("illegal State schema declaration was accepted");
  process.stdout.write(`${JSON.stringify({ action: mode, rejected })}\n`);
} else {
  const result = await execute(mode);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
