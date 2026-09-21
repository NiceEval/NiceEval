import {
  collectMigrationOccurrences,
  loadInstalledPackageVersion,
  loadMigrationGuide,
  MigrationRequiredError,
  type MigrationGuideLoadResult,
} from "./migration.ts";
import type { ErrorAssistanceData, ErrorSource } from "./types.ts";

export function renderErrorSource(source: ErrorSource): string[] {
  if (source.state === "located") {
    return [`Source: ${source.file}:${source.line}:${source.column}`];
  }
  return source.reason === "budget-exhausted"
    ? ["Source location: unknown", "Source details omitted: diagnostic budget exhausted."]
    : ["Source location: unknown"];
}

function migrationOccurrenceLines(error: MigrationRequiredError): string[] {
  const lines: string[] = [];
  for (const occurrence of error.occurrences) {
    lines.push(...renderErrorSource(occurrence.source), `Subject: ${occurrence.subject}`);
  }
  return lines;
}

export function renderMigrationRequiredError(
  error: MigrationRequiredError,
  loadGuide: (guideId: string) => MigrationGuideLoadResult = loadMigrationGuide,
): string {
  const guideIds = [...new Set(error.occurrences.map((occurrence) => occurrence.guideId))];
  const lines = [
    "error: This Judge configuration requires migration.",
    "Code: migration-required",
  ];
  for (const guideId of guideIds) lines.push(`Guide: ${guideId}`);
  lines.push(...migrationOccurrenceLines(error));
  for (const guideId of guideIds) {
    const loaded = loadGuide(guideId);
    lines.push(loaded.state === "available"
      ? loaded.guide.content.trimEnd()
      : `Migration guide asset unavailable: ${guideId} (niceeval ${loadInstalledPackageVersion()})`);
  }
  return `${lines.join("\n")}\n`;
}

/** Render a direct error or a bounded aggregate such as DiscoveryError. */
export function renderMigrationAssistance(value: unknown): string | undefined {
  try {
    const occurrences = collectMigrationOccurrences(value);
    return occurrences.length === 0
      ? undefined
      : renderMigrationRequiredError(new MigrationRequiredError({ occurrences }));
  } catch {
    // Presentation enrichment must never replace the original failure.
    return undefined;
  }
}

export function renderAssistedDiagnosticDetails(data: ErrorAssistanceData): readonly string[] {
  const lines = [`Owner: ${data.owner}`];
  for (const source of data.sources) {
    if (typeof source !== "object" || source === null || Array.isArray(source)) continue;
    if (source.state === "located" && typeof source.file === "string" &&
      typeof source.line === "number" && typeof source.column === "number") {
      lines.push(`Source: ${source.file}:${source.line}:${source.column}`);
      continue;
    }
    lines.push("Source location: unknown");
    if (source.reason === "budget-exhausted") {
      lines.push("Source details omitted: diagnostic budget exhausted.");
    }
  }
  for (const affected of data.affected) {
    if (typeof affected === "string") lines.push(`Affected: ${affected}`);
  }
  if (data.affectedObjectsOmitted > 0) lines.push(`Affected objects omitted: ${data.affectedObjectsOmitted}`);
  if (data.sourceLocationsOmitted > 0) lines.push(`Source locations omitted: ${data.sourceLocationsOmitted}`);
  lines.push(data.nextStep);
  if (data.guideId !== undefined) lines.push(`Guide: ${data.guideId}`);
  return lines;
}
