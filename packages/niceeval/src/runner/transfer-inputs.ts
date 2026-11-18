import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  registerSandboxContent,
  registeredSandboxContentSnapshotOf,
  type RegisteredSandboxContentSnapshot,
} from "../sandbox/content.ts";

export interface StaticTransferPlan {
  readonly operation: "uploadFile" | "uploadDirectory";
  readonly source: string;
  readonly target: string | undefined;
  readonly ignore: readonly string[];
  readonly sendOrdinal: number;
  readonly contentIdentity: string;
}

/** Uses the same selected immutable tree as the public directory transfer. */
export function captureTransferInput(
  operation: StaticTransferPlan["operation"],
  source: string,
  ignore: readonly string[],
): RegisteredSandboxContentSnapshot {
  const content = registerSandboxContent(pathToFileURL(source));
  const snapshot = registeredSandboxContentSnapshotOf(content);
  if (snapshot.kind !== (operation === "uploadFile" ? "file" : "directory")) {
    throw new Error(`${operation} source is a ${snapshot.kind}`);
  }
  if (snapshot.kind === "file")
    return {
      ...snapshot,
      digest: `sha256:${createHash("sha256").update(Buffer.from(snapshot.contentBase64, "base64")).digest("hex")}`,
    };
  const ignored = new Set(ignore);
  const entries = snapshot.entries.filter((entry) => !entry.path.split("/").some((part) => ignored.has(part)));
  if (entries.length === 0) throw new Error("uploadDirectory selected no entries");
  const digest = `sha256:${createHash("sha256")
    .update(JSON.stringify({ kind: snapshot.kind, mode: snapshot.mode, entries }))
    .digest("hex")}`;
  return { ...snapshot, entries, digest };
}

export const transferContentIdentity = (
  operation: StaticTransferPlan["operation"],
  source: string,
  ignore: readonly string[],
): string => captureTransferInput(operation, source, ignore).digest;
