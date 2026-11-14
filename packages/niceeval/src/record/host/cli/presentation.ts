import type {
  RecordMaintenanceOperationFailure,
} from "../types.ts";

function assertNever(value: never): never {
  throw new Error(`Unreachable Record CLI presentation value: ${String(value)}`);
}

export function renderRecordMaintenanceFailure(
  failure: RecordMaintenanceOperationFailure,
  _recordPath: string,
): string {
  switch (failure._tag) {
    case "RecordMaintenanceBusy":
      return `${failure.code}\nClose the Record command holding the lock, then retry.\n`;
    case "RecordFormatUnsupported":
      return `${failure.code}\nThis Record was written by an older version of NiceEval. Rerun the experiment or remove this Record storage.\n`;
    case "RecordMaintenanceOperationFailed":
      return `${failure.code}\n`;
    default:
      return assertNever(failure);
  }
}
