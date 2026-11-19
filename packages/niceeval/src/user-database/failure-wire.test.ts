import { expect, test } from "vitest";
import { normalizeExternalCause } from "../shared/external-cause.ts";
import {
  UserDatabaseBusy,
  UserDatabaseInvalid,
  UserDatabaseLegacyFound,
  UserDatabaseUnsupported,
  type UserDatabaseFailure,
} from "./errors.ts";
import { decodeUserDatabaseFailure, encodeUserDatabaseFailure } from "./failure-wire.ts";
import { isUserDatabaseWorkerFailure } from "./protocol.ts";

// @feature docs/feature/sandbox/README.md
test("UserDatabase failures preserve recovery fields and external diagnostic chains across the worker", () => {
  const cause = normalizeExternalCause(
    Object.assign(new Error("database locked", { cause: Object.assign(new Error("disk fault"), { code: "EIO" }) }), {
      code: "SQLITE_BUSY",
      status: 503,
    }),
  );
  const failures: readonly UserDatabaseFailure[] = [
    new UserDatabaseInvalid({ code: "user-database-invalid", message: "invalid row", repository: "incus", cause }),
    new UserDatabaseBusy({ code: "user-database-busy", message: "busy", repository: "docker-cache", cause }),
    new UserDatabaseInvalid({ code: "user-database-invalid", message: "invalid host", repository: undefined, cause }),
    new UserDatabaseBusy({ code: "user-database-busy", message: "busy host", repository: undefined, cause }),
    new UserDatabaseUnsupported({
      code: "user-database-unsupported",
      message: "unsupported format",
      repository: "global",
      databasePath: "/home/state.sqlite",
      cause,
    }),
    new UserDatabaseLegacyFound({
      code: "user-database-legacy-found",
      message: "legacy database",
      legacyPath: "/home/legacy.sqlite",
      databasePath: "/home/state.sqlite",
    }),
    new UserDatabaseInvalid({
      code: "user-database-invalid",
      message: "invalid schema",
      repository: "durable-state",
      cause: undefined,
    }),
  ];
  for (const failure of failures) {
    const wire: unknown = structuredClone(encodeUserDatabaseFailure(failure));
    expect(isUserDatabaseWorkerFailure(wire)).toBe(true);
    if (!isUserDatabaseWorkerFailure(wire)) throw new Error("Rejected valid failure");
    const decoded = decodeUserDatabaseFailure(wire);
    expect(decoded).toBeInstanceOf(failure.constructor);
    expect({ ...decoded }).toEqual({ ...failure });
  }
});

// @feature docs/feature/sandbox/README.md
test("UserDatabase worker rejects incomplete recovery facts and malformed external causes", () => {
  const valid = encodeUserDatabaseFailure(
    new UserDatabaseUnsupported({
      code: "user-database-unsupported",
      message: "unsupported",
      repository: "incus",
      databasePath: "/home/state.sqlite",
      cause: normalizeExternalCause(new Error("external")),
    }),
  );
  expect(isUserDatabaseWorkerFailure({ code: valid.code, message: valid.message })).toBe(false);
  expect(isUserDatabaseWorkerFailure({ ...valid, databasePath: undefined })).toBe(false);
  expect(isUserDatabaseWorkerFailure({ ...valid, cause: { _tag: "Error", message: "incomplete" } })).toBe(false);
  expect(isUserDatabaseWorkerFailure({ ...valid, extra: "unrecognized" })).toBe(false);
  expect(
    isUserDatabaseWorkerFailure({ code: "user-database-busy", scope: "repository", message: "busy", cause: undefined }),
  ).toBe(false);
});
