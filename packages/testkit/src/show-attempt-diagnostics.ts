import type { ProcessReceipt } from "./process.js";

export interface ShowAttemptDiagnostic {
  readonly code: string;
  readonly kind: string;
  readonly phase: string;
  readonly summary: string;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

function record(value: unknown, path: string, receipt: ProcessReceipt): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`decodeShowAttemptDiagnostics(): ${path} is not an object\n\n${receipt.diagnostic()}`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, path: string, receipt: ProcessReceipt): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`decodeShowAttemptDiagnostics(): ${path} is not an array\n\n${receipt.diagnostic()}`);
  }
  return value;
}

function string(value: unknown, path: string, receipt: ProcessReceipt): string {
  if (typeof value !== "string") {
    throw new Error(`decodeShowAttemptDiagnostics(): ${path} is not a string\n\n${receipt.diagnostic()}`);
  }
  return value;
}

/** Strictly read stable diagnostic facts from public `niceeval show @locator --json`. */
export function decodeShowAttemptDiagnostics(receipt: ProcessReceipt): readonly ShowAttemptDiagnostic[] {
  const document = record(receipt.json<unknown>(), "$", receipt);
  if (string(document.schema, "$.schema", receipt) !== "niceeval.show/v1") {
    throw new Error(`decodeShowAttemptDiagnostics(): $.schema is not niceeval.show/v1\n\n${receipt.diagnostic()}`);
  }
  const data = record(document.data, "$.data", receipt);
  if (string(data.kind, "$.data.kind", receipt) !== "attempt") {
    throw new Error(`decodeShowAttemptDiagnostics(): $.data.kind is not attempt\n\n${receipt.diagnostic()}`);
  }
  const observability = record(data.observability, "$.data.observability", receipt);
  const entries = array(observability.entries, "$.data.observability.entries", receipt);
  if (entries.length !== 1) {
    throw new Error(`decodeShowAttemptDiagnostics(): expected one observability entry, got ${entries.length}\n\n${receipt.diagnostic()}`);
  }
  const entry = record(entries[0], "$.data.observability.entries[0]", receipt);
  if (string(entry.state, "$.data.observability.entries[0].state", receipt) !== "available") {
    throw new Error(`decodeShowAttemptDiagnostics(): observability entry is not available\n\n${receipt.diagnostic()}`);
  }
  const detail = record(entry.detail, "$.data.observability.entries[0].detail", receipt);
  const diagnostics = record(detail.diagnostics, "$.data.observability.entries[0].detail.diagnostics", receipt);
  return array(
    diagnostics.diagnostics,
    "$.data.observability.entries[0].detail.diagnostics.diagnostics",
    receipt,
  ).map((value, index) => {
    const diagnostic = record(
      value,
      `$.data.observability.entries[0].detail.diagnostics.diagnostics[${index}]`,
      receipt,
    );
    return {
      code: string(diagnostic.code, `diagnostics[${index}].code`, receipt),
      kind: string(diagnostic.kind, `diagnostics[${index}].kind`, receipt),
      phase: string(diagnostic.phase, `diagnostics[${index}].phase`, receipt),
      summary: string(diagnostic.summary, `diagnostics[${index}].summary`, receipt),
    };
  });
}
