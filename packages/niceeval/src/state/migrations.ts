/** Host-owned metadata schema. Service schemas are declared by their module. */
export const USER_STATE_HOST_MIGRATION_0_TO_1 = Object.freeze({
  from: 0,
  to: 1,
  sql: Object.freeze([
    "CREATE TABLE __niceeval_state_modules (service_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK (revision >= 0)) STRICT",
  ]),
});

export const USER_STATE_HOST_CURRENT_REVISION = 1;
