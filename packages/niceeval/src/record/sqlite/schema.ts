export { RECORD_SQLITE_BASELINE_SQL } from "./current-schema.ts";

export const RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL = `
CREATE TEMP TABLE IF NOT EXISTS niceeval_prepared_seal_raw(
  run_id TEXT NOT NULL,entry_kind TEXT NOT NULL,logical_identity TEXT NOT NULL,digest TEXT NOT NULL,
  PRIMARY KEY(run_id,entry_kind,logical_identity,digest)) WITHOUT ROWID;
CREATE TEMP TABLE IF NOT EXISTS niceeval_prepared_seal_ordered(
  run_id TEXT NOT NULL,ordinal INTEGER NOT NULL,entry_kind TEXT NOT NULL,logical_identity TEXT NOT NULL,digest TEXT NOT NULL,
  PRIMARY KEY(run_id,ordinal)) WITHOUT ROWID;`;
