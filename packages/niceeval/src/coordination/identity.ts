import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import type { RecordRoot } from "../record/platform/root.ts";
import { recordRootPaths } from "../record/platform/root.ts";

/**
 * Host-local identity for one canonical Record root. It intentionally never
 * becomes portable Record data: the durable `recordId` is checked separately
 * by the lease platform once `record.json` has been read.
 */
export interface RecordCoordinationIdentity {
  readonly recordKey: string;
  readonly localStateRoot: string;
}

const identities = new WeakMap<object, RecordCoordinationIdentity>();

function recordKeyForPortableRoot(portableRoot: string): string {
  // The root has already been lexically canonicalized by makeRecordRoot(). A
  // fixed digest keeps local paths opaque and avoids embedding host paths in
  // portable state or user-facing diagnostics.
  return createHash("sha256")
    .update(portableRoot, "utf8")
    .digest("hex")
    .slice(0, 32);
}

function localStateRootFor(portableRoot: string, recordKey: string): string {
  const recordParent = dirname(portableRoot);
  const coordinationRoot = basename(recordParent) === ".niceeval"
    ? join(recordParent, "coordination")
    : join(recordParent, ".niceeval", "coordination");
  return join(coordinationRoot, "records", recordKey);
}

/**
 * Returns the one local sidecar directory for an issued RecordRoot. A forged
 * object does not receive an identity and must be rejected by the platform.
 */
export function recordCoordinationIdentity(
  root: unknown,
): RecordCoordinationIdentity | undefined {
  if (typeof root !== "object" || root === null) {
    return undefined;
  }

  const cached = identities.get(root);
  if (cached !== undefined) {
    return cached;
  }

  const paths = recordRootPaths(root as RecordRoot);
  if (paths === undefined) {
    return undefined;
  }

  const recordKey = recordKeyForPortableRoot(paths.portableRoot);
  const identity = Object.freeze({
    recordKey,
    localStateRoot: localStateRootFor(paths.portableRoot, recordKey),
  });
  identities.set(root, identity);
  return identity;
}
