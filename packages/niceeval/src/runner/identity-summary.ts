import type { JsonValue } from "../types.ts";

interface ChangedField {
  readonly path: string;
  readonly from: JsonValue | undefined;
  readonly to: JsonValue | undefined;
}

/** Compare complete manifest values before their display summaries are bounded. */
function changedFields(from: JsonValue | undefined, to: JsonValue | undefined, path = ""): ChangedField[] {
  if (from === to) return [];
  if ((Array.isArray(from) || from === undefined) && (Array.isArray(to) || to === undefined)) {
    return Array.from({ length: Math.max(from?.length ?? 0, to?.length ?? 0) }, (_, index) =>
      changedFields(from?.[index], to?.[index], `${path}[${index}]`),
    ).flat();
  }
  if (
    from !== null &&
    to !== null &&
    (typeof from === "object" || from === undefined) &&
    (typeof to === "object" || to === undefined) &&
    !Array.isArray(from) &&
    !Array.isArray(to)
  ) {
    return [...new Set([...Object.keys(from ?? {}), ...Object.keys(to ?? {})])]
      .sort()
      .flatMap((key) => changedFields(from?.[key], to?.[key], path === "" ? key : `${path}.${key}`));
  }
  return [{ path: path || "value", from, to }];
}

/** Budget encoded strings so escaping cannot exceed the existing 512-character summary limit. */
function boundedJsonText(value: string, limit: number): string {
  let end = value.length;
  while (JSON.stringify(value.slice(0, end) + (end < value.length ? "…" : "")).length > limit) end -= 1;
  return value.slice(0, end) + (end < value.length ? "…" : "");
}

/** Existing from/to strings remain bounded value summaries; no protocol fields are added. */
export function summarizeStructuredIdentityChange(
  from: JsonValue | undefined,
  to: JsonValue | undefined,
): {
  readonly from: string;
  readonly to: string;
} {
  const changes = changedFields(from, to);
  const summarize = (side: "from" | "to"): string =>
    JSON.stringify(
      Object.fromEntries([
        ...changes
          .slice(0, 3)
          .map((change) => [
            boundedJsonText(change.path, 100),
            boundedJsonText(change[side] === undefined ? "absent" : JSON.stringify(change[side]), 48),
          ]),
        ...(changes.length > 3 ? [[`+${changes.length - 3} more`, "omitted"]] : []),
      ]),
    );
  return { from: summarize("from"), to: summarize("to") };
}

/** Plan summaries contain only changed paths, so per-Eval unchanged IDs never affect grouping. */
export function structuredIdentityPaths(delta: {
  readonly selector: string;
  readonly from?: string;
  readonly to?: string;
}): string | undefined {
  if (delta.selector !== "plan:physical") return undefined;
  try {
    const value: unknown = JSON.parse(delta.to ?? delta.from ?? "null");
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    return Object.keys(value).join(", ");
  } catch {
    return undefined;
  }
}
