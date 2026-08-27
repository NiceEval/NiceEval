import type { CalloutGroup, CalloutItem } from "../../definition/primitives/callouts-logic.ts";
import type { ConversationContent } from "../../definition/primitives/conversation.tsx";
import type {
  SourceBlockContent,
  SourceContent,
  SourceLine,
  SourceLineDetail,
  SourceLineTone,
} from "../../definition/primitives/source-view.tsx";
import type {
  TableContent,
  TableContentRow,
} from "../../definition/primitives/index.tsx";
import type {
  AttemptAssertionView,
  AttemptAssertionsData,
  AttemptDiagnosticsData,
  ClosedEvidenceSlice,
  EvidenceLimitation,
} from "./compute.ts";

export function assertionDetailOf(assertion: AttemptAssertionView): SourceLineDetail[] {
  const display = assertion.display;
  const score = assertion.score;
  const earned = score?.state === "earned" ? score.earned ?? 0 : undefined;
  const scoreText = score === undefined
    ? ""
    : ` · weight ${score.points} ${score.points === 1 ? "pt" : "pts"} · earned ${earned === undefined ? "unavailable" : `${earned} ${earned === 1 ? "pt" : "pts"}`}`;
  const tone = assertion.decision.result === "matched"
    ? "niceeval-tone-good"
    : assertion.decision.result === "mismatched" && display.severity === "gate"
      ? "niceeval-tone-bad"
      : assertion.decision.result === "mismatched"
        ? "niceeval-tone-warn"
        : "niceeval-tone-na";
  return [
    {
      kind: "text",
      className: `niceeval-source-assertion ${tone}`,
      text: `${display.name} · ${display.severity} ${display.outcome}${scoreText}`,
    },
    {
      kind: "assertion",
      entryId: assertion.entryId,
      content: assertion.evidence,
      label: display.name,
      state: assertion.decision.result === "matched"
        ? "matched"
        : assertion.decision.result === "mismatched"
          ? "mismatched"
          : "unavailable",
    },
  ];
}

export function attemptAssertionsContent(data: AttemptAssertionsData | null): TableContent | null {
  if (data === null || (data.attention.length === 0 && data.passedGroups.length === 0)) return null;
  const rows: TableContentRow[] = data.attention.map((assertion) => ({
    key: assertion.entryId,
    cells: {
      name: { kind: "text", text: assertion.display.name },
      severity: { kind: "text", text: assertion.display.severity },
      outcome: {
        kind: "verdict",
        verdict: assertion.display.outcome === "unavailable" ? "skipped" : assertion.display.outcome,
      },
      detail: assertion.display.detail.length > 0
        ? { kind: "text", text: assertion.display.detail }
        : { kind: "notApplicable" },
    },
  }));
  return {
    columns: [
      { key: "name", header: { en: "Name", "zh-CN": "名称" } },
      { key: "severity", header: { en: "Severity", "zh-CN": "级别" } },
      { key: "outcome", header: { en: "Outcome", "zh-CN": "结果" } },
      { key: "detail", header: { en: "Detail", "zh-CN": "详情" } },
    ],
    rows,
  };
}

function assertionLineTone(assertions: readonly AttemptAssertionView[]): SourceLineTone | undefined {
  if (assertions.some((assertion) => assertion.decision.result === "mismatched" && assertion.display.severity === "gate")) return "gate-fail";
  if (assertions.some((assertion) => assertion.decision.result === "mismatched")) return "soft-fail";
  if (assertions.some((assertion) =>
    assertion.decision.result === "unavailable" ||
    assertion.decision.result === "errored" ||
    assertion.decision.result === "not-applicable")) return "unavailable";
  if (assertions.some((assertion) => assertion.decision.result === "matched")) return "passed";
  return undefined;
}

function strongerTone(current: SourceLineTone | undefined, incoming: SourceLineTone | undefined): SourceLineTone | undefined {
  const rank: Record<SourceLineTone, number> = {
    send: 0,
    passed: 1,
    unavailable: 2,
    "soft-fail": 3,
    "gate-fail": 4,
  };
  if (incoming === undefined) return current;
  if (current === undefined || rank[incoming] > rank[current]) return incoming;
  return current;
}

/** Join full assertion entries to sealed source only through sourceItemId + sha256 + line range. */
export function attachAssertionsToSource(
  source: SourceContent | null,
  assertions: AttemptAssertionsData | null,
): SourceContent | null {
  if (source === null || assertions === null) return source;
  const entries = [
    ...assertions.attention,
    ...assertions.passedGroups.flatMap((group) => group.items),
  ];
  const blocks = [source.spine, ...source.detached];
  const blockIdentities = new Set(blocks.map((block) => `${block.sourceItemId}\u0000${block.sha256}`));
  const mappedEntries = new Set<string>();

  const cloneBlock = (block: SourceBlockContent): SourceBlockContent => ({
    ...block,
    lines: block.lines.map((line) => {
      const bound = entries.flatMap((entry) => entry.sourceSites
        .filter((site) =>
          site.target.state === "exact" &&
          site.target.sourceItemId === block.sourceItemId &&
          site.target.sha256 === block.sha256 &&
          line.number >= site.start.line &&
          line.number <= site.end.line)
        .map((site) => ({ entry, site })));
      for (const { entry } of bound) mappedEntries.add(entry.entryId);
      const assertionEntries = bound
        .filter(({ site }) => site.role !== "score")
        .map(({ entry }) => entry);
      const startEntries = bound
        .filter(({ site }) => site.role !== "score" && site.start.line === line.number)
        .map(({ entry }) => entry);
      const existingAssertionIds = new Set(
        (line.details ?? []).flatMap((detail) => detail.kind === "assertion" ? [detail.entryId] : []),
      );
      const details = [
        ...(line.details ?? []),
        ...startEntries
          .filter((entry) => !existingAssertionIds.has(entry.entryId))
          .flatMap(assertionDetailOf),
      ];
      const scoreEntries = bound.filter(({ site, entry }) => site.role === "score" && entry.score !== undefined);
      const score = scoreEntries.reduce((sum, { entry }) =>
        sum + (entry.score?.state === "earned" ? entry.score.earned ?? 0 : 0), 0);
      const pill = scoreEntries.length === 0 ? line.pill : `${score} ${score === 1 ? "pt" : "pts"}`;
      const tone = strongerTone(line.tone, assertionLineTone(assertionEntries));
      return {
        ...line,
        ...(tone === undefined ? {} : { tone }),
        ...(pill === undefined ? {} : { pill }),
        ...(details.length === 0 ? {} : { details }),
      };
    }),
  });

  const spine = cloneBlock(source.spine);
  const detached = source.detached.map(cloneBlock);
  // Assertions with no exact retained source target remain visible below the source.
  for (const entry of entries) {
    const hasKnownSite = entry.sourceSites.some((site) =>
      site.target.state === "exact" &&
      blockIdentities.has(`${site.target.sourceItemId}\u0000${site.target.sha256}`));
    if (!hasKnownSite) mappedEntries.delete(entry.entryId);
  }
  const unmapped = [
    ...(source.unmapped ?? []),
    ...entries.filter((entry) => !mappedEntries.has(entry.entryId)).flatMap(assertionDetailOf),
  ];
  return {
    ...source,
    spine,
    detached,
    ...(unmapped.length === 0 ? {} : { unmapped }),
  };
}

export const executionEvidenceUnavailableCallouts: readonly CalloutGroup[] = [{
  title: { en: "Execution evidence unavailable", "zh-CN": "执行证据不可用" },
  items: [{
    level: "warning",
    message: {
      en: "The events artifact is missing or was not published.",
      "zh-CN": "事件证据缺失或未发布。",
    },
  }],
}];

export function attemptDiagnosticsContent(data: AttemptDiagnosticsData | null): readonly CalloutGroup[] {
  if (data === null) return [];
  return data.groups.map((group) => ({
    title: group.phase,
    items: group.items.map((diagnostic): CalloutItem => ({
      level: diagnostic.level,
      message: `${diagnostic.code}: ${diagnostic.summary}`,
    })),
  }));
}

function limitationItems(limitations: readonly EvidenceLimitation[]): readonly CalloutItem[] {
  return limitations.map((limitation) => ({
    level: "warning" as const,
    message: `${limitation.code}: ${limitation.summary}`,
  }));
}

export function evidenceSliceCallouts(
  label: string,
  slice: ClosedEvidenceSlice<unknown>,
): readonly CalloutGroup[] {
  if (slice.state === "available") return [];
  const items = limitationItems(slice.limitations);
  return [{
    title: label,
    items: items.length > 0 ? items : [{ level: "warning", message: `Evidence state: ${slice.state}.` }],
  }];
}

export function sliceData<Data>(slice: ClosedEvidenceSlice<Data>): Data | null {
  return slice.state === "available" || slice.state === "partial" ? slice.data : null;
}

/**
 * Conversation turns are embedded only through exact retained turnIds. No
 * label, source order, text, or ordinal fallback participates in this join.
 */
export function embedConversationInSource(
  source: SourceContent | null,
  conversation: ConversationContent | null,
): { readonly source: SourceContent | null; readonly conversation: ConversationContent | null } {
  const turns = conversation?.turns ?? [];
  const turnById = new Map(turns.map((turn) => [turn.key, turn] as const));
  const mappedTurnIds = new Set<string>();

  const cloneLine = (line: SourceLine): SourceLine => {
    const lineTurns = (line.turnIds ?? []).flatMap((turnId) => {
      const turn = turnById.get(turnId);
      if (turn === undefined) return [];
      mappedTurnIds.add(turnId);
      return [turn];
    });
    const details = line.details === undefined && lineTurns.length === 0
      ? undefined
      : [
          ...(line.details ?? []),
          ...(lineTurns.length === 0
            ? []
            : [{ kind: "turn-trace" as const, data: { turns: lineTurns, locator: conversation?.locator } }]),
        ];
    return { ...line, ...(details === undefined ? {} : { details }) };
  };
  const cloneBlock = (block: SourceBlockContent): SourceBlockContent => ({
    ...block,
    lines: block.lines.map(cloneLine),
  });
  const embeddedSource = source === null
    ? null
    : { ...source, spine: cloneBlock(source.spine), detached: source.detached.map(cloneBlock) };
  const remainingTurns = turns.filter((turn) => !mappedTurnIds.has(turn.key));
  const remainingConversation = conversation === null || remainingTurns.length === 0
    ? null
    : { ...conversation, turns: remainingTurns };
  return { source: embeddedSource, conversation: remainingConversation };
}
