/** The legacy six-color series palette, retained as data rather than CSS. */
export const CLASSIC_SERIES_COLORS = Object.freeze([
  "#2a78d6",
  "#1baf7a",
  "#eda100",
  "#008300",
  "#e34948",
  "#eb6834",
] as const);

export type DimensionEncoding = "label" | "color" | "line" | "fill";

export interface DimensionDeclaration {
  readonly key: string;
  readonly encoding: DimensionEncoding;
  readonly values?: readonly string[];
}

export interface PresentedDimension {
  readonly key: string;
  readonly encoding: DimensionEncoding;
  readonly labels: ReadonlyMap<string, string>;
  readonly colorIndex: (value: string) => number;
}

/**
 * Creates deterministic label and color presentation from already closed
 * values.  It knows no Sample, SemanticFrame, field executor, or renderer.
 */
export function presentDimension(declaration: DimensionDeclaration): PresentedDimension {
  const values = declaration.values ?? [];
  const labels = shortestUniqueLabels(values);
  return Object.freeze({
    key: declaration.key,
    encoding: declaration.encoding,
    labels,
    colorIndex: (value: string) => stableColorIndex(`${declaration.key}\u0000${value}`),
  });
}

/** Maps a series identity to the fixed palette without depending on row order. */
export function stableColorIndex(identity: string, slots = CLASSIC_SERIES_COLORS.length): number {
  if (!Number.isSafeInteger(slots) || slots < 1) {
    throw new TypeError("stableColorIndex requires at least one color slot");
  }
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(identity)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % slots;
}

/**
 * Gives long identifiers their shortest unique suffix.  Equal identities keep
 * the same label because they describe the same series, not separate rows.
 */
export function shortestUniqueLabels(values: readonly string[]): ReadonlyMap<string, string> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  const distinct = [...counts.keys()];
  const parts = new Map(distinct.map((value) => [value, splitIdentifier(value)]));
  const labels = new Map<string, string>();
  for (const value of distinct) {
    const valueParts = parts.get(value)!;
    let label = value;
    for (let size = 1; size <= valueParts.length; size += 1) {
      const candidate = valueParts.slice(-size).join("/");
      const clashes = distinct.some((other) => other !== value && endsWithParts(parts.get(other)!, valueParts.slice(-size)));
      if (!clashes) {
        label = candidate;
        break;
      }
    }
    labels.set(value, label);
  }

  return labels;
}

function splitIdentifier(value: string): readonly string[] {
  const parts = value.split(/[\\/:.]+/u).filter((part) => part.length > 0);
  return parts.length === 0 ? [value] : parts;
}

function endsWithParts(value: readonly string[], suffix: readonly string[]): boolean {
  if (suffix.length > value.length) return false;
  return suffix.every((part, index) => part === value[value.length - suffix.length + index]);
}
