export const SEAM_KINDS = ["locator", "runId", "timestamp", "duration"] as const;
export type SeamKind = (typeof SEAM_KINDS)[number];

const SEAM_RE = /\{\{(locator|runId|timestamp|duration)(?::([^}]+))?\}\}/g;

export interface SeamToken {
  kind: SeamKind;
  key?: string;
  raw: string;
}

export interface SeamAudit {
  template: Record<SeamKind, number>;
  bindings: Record<SeamKind, number>;
  actual: Record<SeamKind, number>;
}

export interface SeamBindings {
  locators?: Record<string, string>;
  runIds?: readonly string[];
}

export const DURATION_TOKEN = /(?:\d+m(?:\s+\d+(?:\.\d+)?)?s|\d+(?:\.\d+)?(?:ms|s))/;
export const TIMESTAMP_TOKEN =
  /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}, \d{1,2}:\d{2}(?:\s*[AP]M)?|\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]+|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)/;
export const LOCATOR_TOKEN = /@[0-9A-HJKMNP-TV-Z]{13}/;
export const RUN_ID_TOKEN = /[0-9A-Za-z._:-]{8,}/;

export function listSeams(template: string): SeamToken[] {
  const tokens: SeamToken[] = [];
  for (const match of template.matchAll(SEAM_RE)) {
    tokens.push({
      kind: match[1] as SeamKind,
      key: match[2],
      raw: match[0],
    });
  }
  return tokens;
}

export function countSeams(template: string): Record<SeamKind, number> {
  const counts = emptyCounts();
  for (const token of listSeams(template)) counts[token.kind] += 1;
  return counts;
}

export function emptyCounts(): Record<SeamKind, number> {
  return { locator: 0, runId: 0, timestamp: 0, duration: 0 };
}

export function auditSeams(template: string, bindings: SeamBindings, actual: string): SeamAudit {
  const templateCounts = countSeams(template);
  const bindingsCounts = emptyCounts();
  bindingsCounts.locator = Object.keys(bindings.locators ?? {}).length;
  bindingsCounts.runId = bindings.runIds?.length ?? 0;
  return {
    template: templateCounts,
    bindings: bindingsCounts,
    actual: {
      locator: countMatches(actual, LOCATOR_TOKEN),
      runId: 0,
      timestamp: countMatches(actual, TIMESTAMP_TOKEN),
      duration: countMatches(actual, DURATION_TOKEN),
    },
  };
}

function countMatches(text: string, token: RegExp): number {
  return text.match(new RegExp(token, "g"))?.length ?? 0;
}
