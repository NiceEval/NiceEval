import type { AssertionSnapshotObject } from "./api.ts";

// The execution boundary supplies safe evidence separately from the raw value
// consumed by Match predicates. Never serialize a raw command result as evidence.
const snapshots = new WeakMap<object, AssertionSnapshotObject>();

export function registerCommandAssertionSnapshot(result: object, snapshot: AssertionSnapshotObject): void {
  snapshots.set(result, Object.freeze(snapshot));
}

export function commandAssertionSnapshot(value: unknown): AssertionSnapshotObject | undefined {
  return typeof value === "object" && value !== null ? snapshots.get(value) : undefined;
}
