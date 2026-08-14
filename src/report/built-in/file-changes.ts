import type {
  ClosedFileChangeEndpoint,
  FileChangesDomainDetail,
  FileChangesDomainView,
  FileChangesNet,
} from "../../analysis/index.ts";
import type { AttemptLocator } from "../../attempt-locator.ts";
import {
  Callout,
  defineComponent,
  Stack,
  Table,
  Text,
} from "../author/index.ts";
import {
  freezeClosedReportNode,
  type ClosedReportNode,
  type ReportNode,
} from "../semantic/closed.ts";

/** Bound every presentation dimension before it reaches ClosedReportTree. */
const DISPLAY_ENTRIES_MAX = 8;
const DISPLAY_WINDOWS_MAX = 64;
const DISPLAY_CHANGES_PER_WINDOW_MAX = 32;
const DISPLAY_PATHS_MAX = 128;
const DISPLAY_PATH_CHANGE_REFS_MAX = 32;
const DISPLAY_LIMITATIONS_MAX = 16;
const DISPLAY_PATH_TEXT_MAX = 512;
const DISPLAY_FAILURE_TEXT_MAX = 512;

/** A closed FileChanges view is supplied by the Attempt page; this component never queries Record. */
export interface FileChangesTrajectoryProps {
  readonly view: FileChangesDomainView;
  readonly locator?: AttemptLocator;
}

interface FileChangesDisplayModel {
  readonly entries: readonly FileChangesDisplayEntry[];
  readonly omittedEntries: number;
}

type FileChangesDisplayEntry =
  | {
      readonly locator: string;
      readonly state: "available";
      readonly detail: FileChangesDisplayDetail;
    }
  | {
      readonly locator: string;
      readonly state: "not-recorded" | "unsupported" | "invalid" | "failed" | "duplicate";
      readonly detail?: string;
    };

interface FileChangesDisplayDetail {
  readonly attribution: string;
  readonly collection: FileChangesCollectionDisplay;
  readonly trajectory: readonly FileChangesWindowDisplay[];
  readonly windowTotal: number;
  readonly omittedWindows: number;
  readonly paths: readonly FileChangesPathDisplay[];
  readonly pathTotal: number;
  readonly omittedPaths: number;
}

interface FileChangesCollectionDisplay {
  readonly state: "complete" | "partial";
  readonly limitations: readonly string[];
  readonly omittedLimitations: number;
}

interface FileChangesWindowDisplay {
  readonly windowId: string;
  readonly sequence: number;
  readonly changes: readonly FileChangesChangeDisplay[];
  readonly changeTotal: number;
  readonly omittedChanges: number;
}

interface FileChangesChangeDisplay {
  readonly changeId: string;
  readonly path: string;
  readonly kind: string;
  readonly before: FileChangesEndpointDisplay;
  readonly after: FileChangesEndpointDisplay;
}

interface FileChangesEndpointDisplay {
  readonly summary: string;
}

interface FileChangesPathDisplay {
  readonly path: string;
  readonly changes: string;
  readonly omittedChangeRefs: number;
  readonly net: FileChangesNetDisplay;
}

type FileChangesNetDisplay =
  | {
      readonly state: "available";
      readonly kind: "none" | "created" | "modified" | "deleted";
    }
  | {
      readonly state: "indeterminate";
      readonly reason: string;
    };

/**
 * One bounded resolved display model drives terminal and Web/static faces.
 * It has no Sample, Record reader, SemanticFrame, or deferred capability.
 */
export const FileChangesTrajectory = defineComponent<
  FileChangesTrajectoryProps,
  FileChangesDisplayModel
>({
  resolve: (props) => resolveDisplayModel(props),
  text: (model) => displayFaceNode(model),
  web: (model) => displayFaceNode(model),
});

function resolveDisplayModel(props: FileChangesTrajectoryProps): FileChangesDisplayModel {
  const grouped = new Map<string, FileChangesDomainView["entries"][number][]>();
  for (const entry of props.view.entries) {
    if (props.locator !== undefined && entry.attempt.locator !== props.locator) continue;
    const entries = grouped.get(entry.attempt.locator) ?? [];
    entries.push(entry);
    grouped.set(entry.attempt.locator, entries);
  }
  const entriesByLocator = [...grouped.entries()]
    .sort(([left], [right]) => compareText(left, right));
  const visible = entriesByLocator.slice(0, DISPLAY_ENTRIES_MAX);
  return Object.freeze({
    entries: Object.freeze(visible.map(([locator, candidates]) => displayEntry(locator, candidates))),
    omittedEntries: entriesByLocator.length - visible.length,
  });
}

function displayEntry(
  locator: string,
  candidates: readonly FileChangesDomainView["entries"][number][],
): FileChangesDisplayEntry {
  if (candidates.length !== 1) return Object.freeze({ locator, state: "duplicate" as const });
  const entry = candidates[0]!;
  if (entry.state === "available") {
    return Object.freeze({ locator, state: "available" as const, detail: displayDetail(entry.detail) });
  }
  return Object.freeze({
    locator,
    state: entry.state,
    ...(entry.state === "failed" ? { detail: boundedText(entry.detail, DISPLAY_FAILURE_TEXT_MAX) } : {}),
  });
}

function displayDetail(detail: FileChangesDomainDetail): FileChangesDisplayDetail {
  const windows = [...detail.trajectory]
    .sort((left, right) => left.sequence - right.sequence || compareText(left.windowId, right.windowId));
  const visibleWindows = windows.slice(0, DISPLAY_WINDOWS_MAX);
  const paths = [...detail.paths].sort((left, right) => compareText(left.path, right.path));
  const visiblePaths = paths.slice(0, DISPLAY_PATHS_MAX);
  return Object.freeze({
    attribution: `agent-send-window-endpoints · ${detail.attribution.policy.defaultPolicy} · ${detail.attribution.policy.include.length} include / ${detail.attribution.policy.ignore.length} ignore`,
    collection: displayCollection(detail),
    trajectory: Object.freeze(visibleWindows.map(displayWindow)),
    windowTotal: windows.length,
    omittedWindows: windows.length - visibleWindows.length,
    paths: Object.freeze(visiblePaths.map(displayPath)),
    pathTotal: paths.length,
    omittedPaths: paths.length - visiblePaths.length,
  });
}

function displayCollection(detail: FileChangesDomainDetail): FileChangesCollectionDisplay {
  const limitations = detail.collection.limitations.map(limitationText);
  const visible = limitations.slice(0, DISPLAY_LIMITATIONS_MAX);
  return Object.freeze({
    state: detail.collection.state,
    limitations: Object.freeze(visible),
    omittedLimitations: limitations.length - visible.length,
  });
}

function displayWindow(window: FileChangesDomainDetail["trajectory"][number]): FileChangesWindowDisplay {
  const changes = [...window.changes]
    .sort((left, right) => compareText(left.path, right.path) || compareText(left.changeId, right.changeId));
  const visible = changes.slice(0, DISPLAY_CHANGES_PER_WINDOW_MAX);
  return Object.freeze({
    windowId: window.windowId,
    sequence: window.sequence,
    changes: Object.freeze(visible.map((change) => Object.freeze({
      changeId: change.changeId,
      path: boundedText(change.path, DISPLAY_PATH_TEXT_MAX),
      kind: change.kind,
      before: displayEndpoint(change.before),
      after: displayEndpoint(change.after),
    }))),
    changeTotal: changes.length,
    omittedChanges: changes.length - visible.length,
  });
}

function displayPath(path: FileChangesDomainDetail["paths"][number]): FileChangesPathDisplay {
  const references = path.changes.map((change) => `${change.windowId}/${change.changeId}`);
  const visible = references.slice(0, DISPLAY_PATH_CHANGE_REFS_MAX);
  return Object.freeze({
    path: boundedText(path.path, DISPLAY_PATH_TEXT_MAX),
    changes: visible.join(", "),
    omittedChangeRefs: references.length - visible.length,
    net: displayNet(path.net),
  });
}

function displayNet(net: FileChangesNet): FileChangesNetDisplay {
  if (net.state === "indeterminate") {
    return Object.freeze({ state: "indeterminate" as const, reason: net.reason });
  }
  return Object.freeze({
    state: "available" as const,
    kind: net.kind,
  });
}

/** Both faces receive the same fully validated, data-only display tree. */
function displayFaceNode(model: FileChangesDisplayModel): ClosedReportNode {
  return freezeClosedReportNode(displayNode(model));
}

function displayEndpoint(endpoint: ClosedFileChangeEndpoint): FileChangesEndpointDisplay {
  if (endpoint.state === "absent") return Object.freeze({ summary: "absent" });
  const revision = endpoint.revision;
  switch (revision.kind) {
    case "unavailable":
      return Object.freeze({ summary: `unavailable · ${revision.reason}` });
    case "elided":
      return Object.freeze({ summary: `elided · ${revision.reason} · ${revision.byteLength} byte(s)` });
    case "text": {
      if (revision.content.state === "omitted") {
        return Object.freeze({
          summary: `text · ${revision.byteLength} byte(s) · ${revision.sha256} · content omitted · ${revision.content.reason}`,
        });
      }
      const content = revision.content.content;
      if (content.state !== "available") {
        return Object.freeze({
          summary: `text · ${revision.byteLength} byte(s) · ${revision.sha256} · content ${content.state}`,
        });
      }
      return Object.freeze({
        summary: `text · ${revision.byteLength} byte(s) · ${revision.sha256} · content available`,
      });
    }
  }
}

function displayNode(model: FileChangesDisplayModel): ReportNode {
  if (model.entries.length === 0) {
    return Callout({
      tone: "warning",
      title: "File Changes unavailable for selection",
      children: [Text({ value: "No included Attempt matched the File Changes view request." })],
    });
  }
  return Stack({
    children: [
      ...model.entries.map(displayEntryNode),
      ...(model.omittedEntries === 0
        ? []
        : [Text({
          value: `${model.omittedEntries} additional File Changes Attempt entr${model.omittedEntries === 1 ? "y" : "ies"} omitted by the display limit.`,
        })]),
    ],
  });
}

function displayEntryNode(entry: FileChangesDisplayEntry): ReportNode {
  if (entry.state !== "available") return unavailableEntryNode(entry);
  const detail = entry.detail;
  const empty = detail.pathTotal === 0;
  return Callout({
    tone: detail.collection.state === "complete" ? "neutral" : "warning",
    title: `File Changes · ${entry.locator}`,
    children: [
      Table({
        caption: "File Changes collection",
        columns: [
          { key: "attribution", label: "Attribution" },
          { key: "state", label: "Collection" },
          { key: "windows", label: "Windows", align: "end" },
          { key: "paths", label: "Paths", align: "end" },
        ],
        rows: [{
          attribution: detail.attribution,
          state: detail.collection.state,
          windows: detail.windowTotal,
          paths: detail.pathTotal,
        }],
      }),
      ...collectionLimitationsNode(detail.collection),
      ...(empty ? [emptyCollectionNode(detail)] : []),
      trajectoryNode(detail),
      ...(empty ? [] : [pathSummaryNode(detail)]),
    ],
  });
}

function unavailableEntryNode(
  entry: Exclude<FileChangesDisplayEntry, { readonly state: "available" }>,
): ReportNode {
  const message = entry.state === "not-recorded"
    ? "File Changes were not recorded for this Attempt. This is not an empty change collection."
    : entry.state === "duplicate"
      ? "More than one closed File Changes entry matched this Attempt locator."
      : entry.state === "failed"
        ? entry.detail ?? "File Changes could not be closed for this Attempt."
        : `File Changes are ${entry.state} for this Attempt.`;
  return Callout({
    tone: entry.state === "invalid" || entry.state === "failed" || entry.state === "duplicate" ? "negative" : "warning",
    title: `File Changes ${entry.state} · ${entry.locator}`,
    children: [Text({ value: message })],
  });
}

function emptyCollectionNode(detail: FileChangesDisplayDetail): ReportNode {
  if (detail.collection.state === "complete") {
    return Callout({
      tone: "neutral",
      title: "Complete empty File Changes",
      children: [Text({
        value: detail.windowTotal === 0
          ? "Collection completed with no File Changes windows or paths."
          : `Collection completed with ${detail.windowTotal} zero-change window(s) and no changed paths.`,
      })],
    });
  }
  return Callout({
    tone: "warning",
    title: "Partial empty File Changes",
    children: [Text({
      value: detail.windowTotal === 0
        ? "File Changes capture is partial and retained no windows or paths."
        : `File Changes capture is partial; ${detail.windowTotal} retained window(s) contain no paths.`,
    })],
  });
}

function trajectoryNode(detail: FileChangesDisplayDetail): ReportNode {
  if (detail.trajectory.length === 0) {
    return Callout({
      tone: detail.collection.state === "complete" ? "neutral" : "warning",
      title: "File Changes trajectory",
      children: [Text({ value: "No trajectory windows were retained." })],
    });
  }
  return Callout({
    tone: detail.collection.state === "complete" ? "neutral" : "warning",
    title: "File Changes trajectory",
    children: [
      Table({
        caption: "Recorded windows",
        columns: [
          { key: "sequence", label: "Sequence", align: "end" },
          { key: "window", label: "Window" },
          { key: "changes", label: "Recorded changes", align: "end" },
          { key: "shown", label: "Shown changes", align: "end" },
          { key: "omitted", label: "Omitted change rows", align: "end" },
        ],
        rows: detail.trajectory.map((window) => ({
          sequence: window.sequence,
          window: window.windowId,
          changes: window.changeTotal,
          shown: window.changes.length,
          omitted: window.omittedChanges,
        })),
      }),
      ...(detail.trajectory.every((window) => window.changes.length === 0)
        ? [Text({ value: "Recorded zero-change window(s)." })]
        : [Table({
          caption: "Window change trajectory",
          columns: [
            { key: "sequence", label: "Window sequence", align: "end" },
            { key: "window", label: "Window" },
            { key: "change", label: "Change" },
            { key: "file", label: "Path" },
            { key: "kind", label: "Kind" },
            { key: "before", label: "Before" },
            { key: "after", label: "After" },
          ],
          rows: detail.trajectory.flatMap((window) => window.changes.map((change) => ({
            sequence: window.sequence,
            window: window.windowId,
            change: change.changeId,
            file: change.path,
            kind: change.kind,
            before: change.before.summary,
            after: change.after.summary,
          }))),
        })]),
      ...(detail.omittedWindows === 0
        ? []
        : [Text({ value: `${detail.omittedWindows} additional trajectory window(s) omitted by the display limit.` })]),
    ],
  });
}

function pathSummaryNode(detail: FileChangesDisplayDetail): ReportNode {
  return Callout({
    tone: detail.paths.some((path) => path.net.state === "indeterminate") ? "warning" : "neutral",
    title: "File Changes net summary",
    children: [
      Table({
        caption: "Path nets",
        columns: [
          { key: "file", label: "Path" },
          { key: "changes", label: "Window / change references" },
          { key: "omitted", label: "Omitted change references", align: "end" },
          { key: "net", label: "Net" },
        ],
        rows: detail.paths.map((path) => ({
          file: path.path,
          changes: path.changes,
          omitted: path.omittedChangeRefs,
          net: path.net.state === "available" ? path.net.kind : `indeterminate · ${path.net.reason}`,
        })),
      }),
      ...(detail.omittedPaths === 0
        ? []
        : [Text({ value: `${detail.omittedPaths} additional path row(s) omitted by the display limit.` })]),
    ],
  });
}

function collectionLimitationsNode(collection: FileChangesCollectionDisplay): readonly ReportNode[] {
  return Object.freeze([
    ...(collection.limitations.length === 0
      ? []
      : [Table({
        caption: "File Changes limitations",
        columns: [{ key: "limitation", label: "Limitation" }],
        rows: collection.limitations.map((limitation) => ({ limitation })),
      })]),
    ...(collection.omittedLimitations === 0
      ? []
      : [Text({ value: `${collection.omittedLimitations} additional collection limitation(s) omitted by the display limit.` })]),
  ]);
}

function limitationText(limitation: FileChangesDomainDetail["collection"]["limitations"][number]): string {
  switch (limitation.code) {
    case "capture-failed":
    case "capture-interrupted":
      return `${limitation.code} · ${limitation.stage} · ${limitation.atWindowId ?? "no window"}`;
    case "collection-cap-reached":
      return `${limitation.code} · ${limitation.target} · ${limitation.omittedAtLeast} omitted · ${limitation.atWindowId ?? "no window"}`;
    case "unsupported-input":
      return `${limitation.code} · ${limitation.target} · ${limitation.omittedAtLeast} omitted`;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Preserve a receipt when a valid but wide durable display field is shortened. */
function boundedText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum)}… ${value.length - maximum} character(s) omitted by the display limit.`;
}
