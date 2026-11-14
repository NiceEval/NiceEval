import type { IdentityExplanation, IdentityDiagnostic } from "../manifest.ts";
import { stripControl } from "../../assertions/display.ts";
import { createHash } from "node:crypto";

const DELTA_COMMON_PREFIX_CAP = 24;
const DELTA_DIFF_WINDOW = 56;
const DELTA_SINGLE_SIDE_CAP = 80;

/**
 * Changed 差异的双侧值对齐到第一处不同字符,而不是各自从头独立截断——独立截断在长公共前缀下
 * 会把两侧都截在差异点之前,读者看到的是两份相同的省略串,分不清到底哪里变了。差异点起两侧
 * 各留一个有界窗口,公共前缀过长时压缩显示但保留其尾部作为定位上下文。
 */
export function windowChangedDeltaValues(from: string, to: string): [string, string] {
  if (from === to) return [boundedSingleSide(from), boundedSingleSide(to)];
  const max = Math.min(from.length, to.length);
  let shared = 0;
  while (shared < max && from[shared] === to[shared]) shared += 1;
  const prefix =
    shared > DELTA_COMMON_PREFIX_CAP
      ? `…${from.slice(shared - DELTA_COMMON_PREFIX_CAP, shared)}`
      : from.slice(0, shared);
  return [`${prefix}${boundedDiffTail(from.slice(shared))}`, `${prefix}${boundedDiffTail(to.slice(shared))}`];
}

function boundedDiffTail(text: string): string {
  return text.length > DELTA_DIFF_WINDOW ? `${text.slice(0, DELTA_DIFF_WINDOW)}…` : text;
}

function boundedSingleSide(text: string): string {
  return text.length > DELTA_SINGLE_SIDE_CAP ? `${text.slice(0, DELTA_SINGLE_SIDE_CAP - 1)}…` : text;
}

export function formatDryDelta(delta: {
  selector: string;
  _tag?: "Added" | "Removed" | "Changed" | "Unknown";
  kind?: "added" | "removed" | "changed" | "unknown";
  from?: string;
  to?: string;
}): string {
  const kind =
    delta.kind ??
    (delta._tag === "Added"
      ? "added"
      : delta._tag === "Removed"
        ? "removed"
        : delta._tag === "Unknown"
          ? "unknown"
          : delta._tag === "Changed"
            ? "changed"
            : undefined);
  switch (kind) {
    case "added":
      return `${delta.selector} added (${boundedSingleSide(delta.to ?? "")})`;
    case "removed":
      return `${delta.selector} removed (was ${boundedSingleSide(delta.from ?? "")})`;
    case "unknown":
      return `${delta.selector} unknown`;
    case "changed":
    default: {
      if (delta.from === undefined && delta.to === undefined) return delta.selector;
      const [from, to] = windowChangedDeltaValues(delta.from ?? "", delta.to ?? "");
      return `${delta.selector} changed (${from} → ${to})`;
    }
  }
}

const DIAGNOSTIC_CAUSE_DEPTH_CAP = 4;
const DIAGNOSTIC_NODE_CAP = 16;
const EXPLANATION_ITEM_CAP = 8;

// Legacy dry feedback also uses tagged deltas; both shapes share one renderer.
type DisplayDelta = Parameters<typeof formatDryDelta>[0];
type DisplayDiagnostic = Omit<IdentityDiagnostic, "observedDeltas" | "causes"> & {
  readonly observedDeltas?: readonly DisplayDelta[];
  readonly causes?: readonly DisplayDiagnostic[];
};

function boundedList<T>(items: readonly T[], format: (item: T) => string): string[] {
  const visible = items.slice(0, EXPLANATION_ITEM_CAP).map(format);
  return items.length > visible.length ? [...visible, `+${items.length - visible.length} more`] : visible;
}

function singleLine(value: string): string {
  return stripControl(value).replace(/\s+/gu, " ");
}

/** Values use the same first-difference window as the original dry renderer. */
export function formatIdentityExplanation(explanation: IdentityExplanation): string[] {
  switch (explanation.kind) {
    case "match":
      return [`via ${boundedList(explanation.via, (name) => boundedSingleSide(singleLine(name))).join(", ")}`];
    case "changed":
      return [boundedList(explanation.deltas, formatHumanDelta).join(", ")];
    case "unexplained":
      return formatIdentityDiagnostic(explanation.diagnostic);
  }
}

function incompleteStructuredSummary(value: string): boolean {
  if (!/^\s*[{[]/u.test(value)) return false;
  try {
    JSON.parse(value);
    return false;
  } catch {
    return true;
  }
}

// Hash only the available display summary, never the execution identity or manifest.
function summaryHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function formatHumanDelta(delta: DisplayDelta): string {
  if (delta.selector === "config:agentInstalls" && delta.from !== undefined && delta.to !== undefined) {
    const installs = agentInstallDifference(delta.from, delta.to);
    if (installs !== undefined) return `${delta.selector} changed (${installs})`;
  }
  if (
    delta.from !== undefined &&
    delta.to !== undefined &&
    (incompleteStructuredSummary(delta.from) || incompleteStructuredSummary(delta.to))
  ) {
    if (delta.from === delta.to) {
      return `${delta.selector} changed (comparison unavailable: recorded structured summaries are incomplete and identical)`;
    }
    return `${delta.selector} changed (summary sha256:${summaryHash(delta.from)} → summary sha256:${summaryHash(delta.to)}; structured summaries incomplete)`;
  }
  return formatDryDelta({
    ...delta,
    ...(delta.from === undefined ? {} : { from: humanDeltaValue(delta.from) }),
    ...(delta.to === undefined ? {} : { to: humanDeltaValue(delta.to) }),
  });
}

/** Presentation only: the stored manifest and execution identity remain unchanged. */
function agentInstallDifference(from: string, to: string): string | undefined {
  try {
    const before: unknown = JSON.parse(from),
      after: unknown = JSON.parse(to);
    if (!Array.isArray(before) || !Array.isArray(after)) return undefined;
    const describe = (value: unknown): string | undefined => {
      if (typeof value !== "object" || value === null) return undefined;
      // Read the frozen agentInstalls identity encoding, independent of author API spelling.
      const declaration: unknown = Reflect.get(value, "ensure");
      if (typeof declaration !== "object" || declaration === null) return undefined;
      const agent = Reflect.get(declaration, "agent"),
        version = Reflect.get(declaration, "version"),
        revision = Reflect.get(declaration, "revision");
      if (typeof agent !== "string" || typeof version !== "string" || typeof revision !== "string") return undefined;
      return `${singleLine(agent)} ${singleLine(version)} (recipe ${singleLine(revision)})`;
    };
    const changes: string[] = [];
    for (let index = 0; index < Math.max(before.length, after.length); index++) {
      if (JSON.stringify(before[index]) === JSON.stringify(after[index])) continue;
      const left = index < before.length ? describe(before[index]) : "absent";
      const right = index < after.length ? describe(after[index]) : "absent";
      if (left === undefined || right === undefined || left === right) return undefined;
      changes.push(`${boundedSingleSide(left)} → ${boundedSingleSide(right)}`);
    }
    return changes.length ? boundedList(changes, (value) => value).join(", ") : undefined;
  } catch {
    return undefined;
  }
}

/** Structured manifest summaries become human key=value lists rather than JSON. */
function humanDeltaValue(value: string): string {
  if (/^\s*[{[]/u.test(value)) {
    try {
      // Apply the window only after finding the differing value, including a
      // difference beyond the first entries of a structured summary.
      return diagnosticValue(JSON.parse(value), 0, false);
    } catch {
      return `summary sha256:${summaryHash(value)} (structured summary incomplete)`;
    }
  }
  return singleLine(value);
}

function diagnosticValue(value: unknown, depth: number, bounded = true): string {
  if (value === null || typeof value !== "object") return singleLine(String(value));
  if (bounded && depth >= DIAGNOSTIC_CAUSE_DEPTH_CAP) return "…";
  const values = Array.isArray(value) ? value : Object.entries(value);
  const format = (item: unknown): string =>
    Array.isArray(value)
      ? diagnosticValue(item, depth + 1, bounded)
      : (() => {
          const [key, child] = item as [string, unknown];
          return `${singleLine(key)}=${diagnosticValue(child, depth + 1, bounded)}`;
        })();
  return (bounded ? boundedList(values, format) : values.map(format)).join(", ") || "none";
}

export function formatIdentityDiagnostic(diagnostic: DisplayDiagnostic, indent = ""): string[] {
  return renderDiagnostic(diagnostic, indent, 0, { nodes: 0 });
}

function renderDiagnostic(
  diagnostic: DisplayDiagnostic,
  indent: string,
  depth: number,
  budget: { nodes: number },
): string[] {
  budget.nodes += 1;
  const lines = [`${indent}${singleLine(diagnostic.code)}: ${boundedSingleSide(singleLine(diagnostic.summary))}`];
  for (const fact of boundedList(diagnostic.facts ?? [], (fact) =>
    "value" in fact
      ? `${singleLine(fact.label)}: ${boundedSingleSide(diagnosticValue(fact.value, 0))}`
      : `${singleLine(fact.label)}: ${windowChangedDeltaValues(diagnosticValue(fact.from, 0), diagnosticValue(fact.to, 0)).join(" → ")}`,
  )) {
    lines.push(`${indent}  ${fact}`);
  }
  if (diagnostic.observedDeltas === undefined) {
    lines.push(`${indent}  observed inputs: unavailable (comparable manifest inputs were not available)`);
  } else if (diagnostic.observedDeltas.length === 0) {
    lines.push(`${indent}  observed inputs: no differences in comparable manifest fields`);
  } else {
    lines.push(`${indent}  observed inputs:`);
    for (const delta of boundedList(diagnostic.observedDeltas, formatHumanDelta)) lines.push(`${indent}    ${delta}`);
  }
  for (const limitation of boundedList(
    diagnostic.limitations ?? [],
    (limitation) => `limitation: ${boundedSingleSide(singleLine(limitation))}`,
  )) {
    lines.push(`${indent}  ${limitation}`);
  }
  const causes = diagnostic.causes ?? [];
  for (let index = 0; index < causes.length; index++) {
    if (depth >= DIAGNOSTIC_CAUSE_DEPTH_CAP || budget.nodes >= DIAGNOSTIC_NODE_CAP) {
      lines.push(`${indent}  +${causes.length - index} more causes`);
      break;
    }
    lines.push(`${indent}  cause:`);
    lines.push(...renderDiagnostic(causes[index]!, `${indent}    `, depth + 1, budget));
  }
  return lines;
}
