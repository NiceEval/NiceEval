import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { ErrorSource, MigrationGuide, MigrationOccurrence } from "./types.ts";

const MAX_GUIDE_BYTES = 32 * 1024;
const MAX_PACKAGE_METADATA_BYTES = 64 * 1024;
const GUIDE_ASSETS = Object.freeze({
  "judge-provider": new URL("../migrations/judge-provider.md", import.meta.url),
});
const PACKAGE_METADATA_ASSET = new URL("../../package.json", import.meta.url);

function readBoundedAsset(asset: URL, maximumBytes: number): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(asset, "r");
    const size = fstatSync(descriptor).size;
    if (size <= 0 || size > maximumBytes) return undefined;
    const bytes = Buffer.allocUnsafe(maximumBytes + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(descriptor, bytes, count, bytes.length - count, count);
      if (read === 0) break;
      count += read;
    }
    return count <= 0 || count > maximumBytes ? undefined : bytes.subarray(0, count).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Reading enrichment is best effort and cannot replace the real error.
      }
    }
  }
}

function freezeSource(source: ErrorSource): ErrorSource {
  return source.state === "located"
    ? Object.freeze({
        state: "located" as const,
        file: source.file,
        line: source.line,
        column: source.column,
      })
    : Object.freeze({ state: "unavailable" as const, reason: source.reason });
}

export class MigrationRequiredError extends Error {
  override readonly name = "MigrationRequiredError";
  readonly code = "migration-required" as const;
  readonly occurrences: readonly MigrationOccurrence[];

  constructor(input: { readonly occurrences: readonly MigrationOccurrence[] }) {
    super("This configuration requires migration.");
    this.occurrences = Object.freeze(input.occurrences.map((occurrence) => Object.freeze({
      guideId: occurrence.guideId,
      subject: occurrence.subject,
      source: freezeSource(occurrence.source),
    })));
  }
}

export function isMigrationRequiredError(value: unknown): value is MigrationRequiredError {
  try {
    return value instanceof MigrationRequiredError;
  } catch {
    return false;
  }
}

const MAX_MIGRATION_ISSUES = 32;
const MAX_WRAPPER_DEPTH = 8;

function ownData(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function arrayDataValues(value: unknown, limit: number): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  let length = 0;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "number") return [];
    length = Math.min(limit, descriptor.value);
  } catch {
    return [];
  }
  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const entry = ownData(value, String(index));
    if (entry !== undefined) values.push(entry);
  }
  return values;
}

/**
 * Find direct and discovery-aggregated migration errors without invoking
 * getters on arbitrary failures. Traversal is deliberately narrow and bounded.
 */
export function collectMigrationRequiredErrors(value: unknown): readonly MigrationRequiredError[] {
  const found: MigrationRequiredError[] = [];
  const seen = new WeakSet<object>();
  let remainingNodes = 128;

  const visit = (candidate: unknown, depth: number): void => {
    if (remainingNodes === 0 || depth > MAX_WRAPPER_DEPTH || typeof candidate !== "object" || candidate === null) return;
    if (seen.has(candidate)) return;
    remainingNodes--;
    seen.add(candidate);
    if (isMigrationRequiredError(candidate)) {
      found.push(candidate);
      return;
    }
    visit(ownData(candidate, "cause"), depth + 1);
    const issues = arrayDataValues(ownData(candidate, "issues"), MAX_MIGRATION_ISSUES);
    for (const issue of issues) {
      if (typeof issue !== "object" || issue === null) continue;
      visit(ownData(issue, "cause"), depth + 1);
    }
  };

  visit(value, 0);
  return Object.freeze(found);
}

export function collectMigrationOccurrences(value: unknown): readonly MigrationOccurrence[] {
  const occurrences: MigrationOccurrence[] = [];
  const seen = new Set<string>();
  for (const error of collectMigrationRequiredErrors(value)) {
    for (const occurrence of error.occurrences) {
      const sourceKey = occurrence.source.state === "located"
        ? `${occurrence.source.file}:${occurrence.source.line}:${occurrence.source.column}`
        : `unavailable:${occurrence.source.reason}`;
      const key = JSON.stringify([occurrence.guideId, occurrence.subject, sourceKey]);
      if (seen.has(key)) continue;
      seen.add(key);
      occurrences.push(occurrence);
    }
  }
  return Object.freeze(occurrences);
}

export type MigrationGuideLoadResult =
  | { readonly state: "available"; readonly guide: MigrationGuide }
  | { readonly state: "asset-unavailable" };

/** Reads only a compile-time whitelist; callers cannot construct asset paths. */
export function loadMigrationGuide(guideId: string): MigrationGuideLoadResult {
  if (!Object.hasOwn(GUIDE_ASSETS, guideId)) return { state: "asset-unavailable" };
  try {
    const content = readBoundedAsset(GUIDE_ASSETS[guideId as keyof typeof GUIDE_ASSETS], MAX_GUIDE_BYTES);
    if (content === undefined || content.trim() === "") return { state: "asset-unavailable" };
    return {
      state: "available",
      guide: Object.freeze({ id: guideId, language: "en", format: "markdown", content }),
    };
  } catch {
    return { state: "asset-unavailable" };
  }
}

export function loadInstalledPackageVersion(): string {
  const content = readBoundedAsset(PACKAGE_METADATA_ASSET, MAX_PACKAGE_METADATA_BYTES);
  if (content === undefined) return "unknown";
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return "unknown";
    const descriptor = Object.getOwnPropertyDescriptor(parsed, "version");
    return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : "unknown";
  } catch {
    return "unknown";
  }
}
