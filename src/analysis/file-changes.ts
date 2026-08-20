import type {
  ClosedBlobContent,
  ClosedFileChange,
  ClosedFileChangeEndpoint,
  ClosedFileChangeWindow,
  ClosedFileChangesAttribution,
  ClosedFileChangesCollection,
  ClosedFileChangesCollectionLimitation,
  ClosedFileRevision,
  FileChangesDomainDetail,
  FileChangesNet,
} from "./domain-view.ts";

/**
 * Package-private normalized input for the fixed FileChanges binding. The
 * binding supplies display-safe endpoint content; this module owns only the
 * pure trajectory closure and path-net derivation.
 */
export interface FileChangesProjectionInput {
  readonly attribution: ClosedFileChangesAttribution;
  readonly collection: ClosedFileChangesCollection;
  readonly windows: readonly FileChangesProjectionWindow[];
  /** Capture, window, change, or JSON structure was incomplete. */
  readonly structuralPartial: boolean;
}

export interface FileChangesProjectionWindow {
  readonly windowId: string;
  readonly sequence: number;
  readonly changes: readonly FileChangesProjectionChange[];
}

export interface FileChangesProjectionChange {
  readonly changeId: string;
  readonly path: string;
  readonly kind: ClosedFileChange["kind"];
  readonly before: ClosedFileChangeEndpoint;
  readonly after: ClosedFileChangeEndpoint;
}

/**
 * Defensively closes every value, preserves every retained send window, and
 * derives one net result per path without reading another attachment or tree.
 */
export function projectFileChangesDomainDetail(
  input: FileChangesProjectionInput,
): FileChangesDomainDetail {
  const windows = [...input.windows]
    .sort((left, right) => left.sequence - right.sequence || compareText(left.windowId, right.windowId))
    .map(closeWindow);
  return Object.freeze({
    attribution: closeAttribution(input.attribution),
    collection: closeCollection(input.collection),
    trajectory: Object.freeze(windows),
    paths: pathDetails(windows, input.structuralPartial),
  });
}

function closeAttribution(input: ClosedFileChangesAttribution): ClosedFileChangesAttribution {
  return Object.freeze({
    kind: "agent-send-window-endpoints" as const,
    policy: Object.freeze({
      defaultPolicy: "niceeval.sandbox-ledger/default-excludes/v1" as const,
      include: Object.freeze([...input.policy.include]),
      ignore: Object.freeze([...input.policy.ignore]),
    }),
  });
}

function closeWindow(input: FileChangesProjectionWindow): ClosedFileChangeWindow {
  return Object.freeze({
    windowId: input.windowId,
    sequence: input.sequence,
    changes: Object.freeze(input.changes
      .map(closeChange)
      .sort((left, right) => compareText(left.path, right.path) || compareText(left.changeId, right.changeId))),
  });
}

function closeChange(input: FileChangesProjectionChange): ClosedFileChange {
  return Object.freeze({
    changeId: input.changeId,
    path: input.path,
    kind: input.kind,
    before: closeEndpoint(input.before),
    after: closeEndpoint(input.after),
  });
}

function closeCollection(input: ClosedFileChangesCollection): ClosedFileChangesCollection {
  return Object.freeze({
    state: input.state,
    limitations: Object.freeze(input.limitations.map(closeLimitation)),
  });
}

function closeLimitation(
  limitation: ClosedFileChangesCollectionLimitation,
): ClosedFileChangesCollectionLimitation {
  switch (limitation.code) {
    case "capture-failed":
    case "capture-interrupted":
      return Object.freeze({
        code: limitation.code,
        stage: limitation.stage,
        atWindowId: limitation.atWindowId,
      });
    case "collection-cap-reached":
      return Object.freeze({
        code: "collection-cap-reached" as const,
        target: limitation.target,
        omittedAtLeast: limitation.omittedAtLeast,
        atWindowId: limitation.atWindowId,
      });
    case "unsupported-input":
      return Object.freeze({
        code: "unsupported-input" as const,
        target: "endpoint-metadata" as const,
        omittedAtLeast: limitation.omittedAtLeast,
      });
  }
}

function closeEndpoint(input: ClosedFileChangeEndpoint): ClosedFileChangeEndpoint {
  return input.state === "absent"
    ? Object.freeze({ state: "absent" as const })
    : Object.freeze({ state: "present" as const, revision: closeRevision(input.revision) });
}

function closeRevision(input: ClosedFileRevision): ClosedFileRevision {
  switch (input.kind) {
    case "text":
      return Object.freeze({
        kind: "text" as const,
        sha256: input.sha256,
        byteLength: input.byteLength,
        content: input.content.state === "available"
          ? Object.freeze({ state: "available" as const, content: closeBlobContent(input.content.content) })
          : Object.freeze({ state: "omitted" as const, reason: "collection-cap" as const }),
      });
    case "elided":
      return Object.freeze({
        kind: "elided" as const,
        reason: input.reason,
        byteLength: input.byteLength,
      });
    case "unavailable":
      return Object.freeze({ kind: "unavailable" as const, reason: input.reason });
  }
}

function closeBlobContent(input: ClosedBlobContent): ClosedBlobContent {
  return input.state === "available"
    ? Object.freeze({ state: "available" as const, text: input.text })
    : Object.freeze({ state: input.state });
}

interface PathChange {
  readonly windowId: string;
  readonly sequence: number;
  readonly change: ClosedFileChange;
}

function pathDetails(
  windows: readonly ClosedFileChangeWindow[],
  structuralPartial: boolean,
): FileChangesDomainDetail["paths"] {
  const byPath = new Map<string, PathChange[]>();
  for (const window of windows) {
    for (const change of window.changes) {
      const changes = byPath.get(change.path) ?? [];
      changes.push(Object.freeze({ windowId: window.windowId, sequence: window.sequence, change }));
      byPath.set(change.path, changes);
    }
  }
  return Object.freeze([...byPath.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([path, changes]) => {
      const trajectory = [...changes].sort((left, right) =>
        left.sequence - right.sequence
        || compareText(left.windowId, right.windowId)
        || compareText(left.change.changeId, right.change.changeId)
      );
      return Object.freeze({
        path,
        changes: Object.freeze(trajectory.map(({ windowId, change }) => Object.freeze({
          windowId,
          changeId: change.changeId,
        }))),
        net: deriveNet(trajectory, structuralPartial),
      });
    }));
}

function deriveNet(
  trajectory: readonly PathChange[],
  structuralPartial: boolean,
): FileChangesNet {
  if (structuralPartial) return indeterminate("collection-partial");
  const first = trajectory[0];
  const last = trajectory.at(-1);
  if (first === undefined || last === undefined) return indeterminate("collection-partial");

  let hasUnavailableEndpoint = false;
  let hasUnprovableEquality = false;
  for (let index = 1; index < trajectory.length; index += 1) {
    const comparison = compareEndpoints(
      trajectory[index - 1]!.change.after,
      trajectory[index]!.change.before,
    );
    if (comparison.state === "different") return indeterminate("window-discontinuity");
    if (comparison.state === "unknown") {
      if (comparison.reason === "endpoint-unavailable") hasUnavailableEndpoint = true;
      else hasUnprovableEquality = true;
    }
  }
  if (hasUnavailableEndpoint) return indeterminate("endpoint-unavailable");
  if (hasUnprovableEquality) return indeterminate("endpoint-equality-unprovable");

  const net = endpointNet(first.change.before, last.change.after);
  // A single modified window makes an elided, otherwise unprovable endpoint
  // pair useful. It never overrides a digest-proven no-op or an unavailable
  // endpoint, both of which are decided by endpointNet above.
  if (
    net.state === "indeterminate"
    && net.reason === "endpoint-equality-unprovable"
    && trajectory.length === 1
    && first.change.kind === "modified"
  ) {
    return available("modified", first.change.before, first.change.after);
  }
  return net;
}

function endpointNet(
  before: ClosedFileChangeEndpoint,
  after: ClosedFileChangeEndpoint,
): FileChangesNet {
  if (before.state === "absent" && after.state === "absent") return available("none", before, after);
  if (before.state === "absent" && after.state === "present") {
    return unavailableRevision(after.revision) ? indeterminate("endpoint-unavailable") : available("created", before, after);
  }
  if (before.state === "present" && after.state === "absent") {
    return unavailableRevision(before.revision) ? indeterminate("endpoint-unavailable") : available("deleted", before, after);
  }
  const comparison = compareEndpoints(before, after);
  if (comparison.state === "equal") return available("none", before, after);
  if (comparison.state === "different") return available("modified", before, after);
  return indeterminate(comparison.reason);
}

type EndpointComparison =
  | { readonly state: "equal" }
  | { readonly state: "different" }
  | {
      readonly state: "unknown";
      readonly reason: "endpoint-unavailable" | "endpoint-equality-unprovable";
    };

function compareEndpoints(
  left: ClosedFileChangeEndpoint,
  right: ClosedFileChangeEndpoint,
): EndpointComparison {
  if (left.state === "present" && unavailableRevision(left.revision)) {
    return Object.freeze({ state: "unknown" as const, reason: "endpoint-unavailable" as const });
  }
  if (right.state === "present" && unavailableRevision(right.revision)) {
    return Object.freeze({ state: "unknown" as const, reason: "endpoint-unavailable" as const });
  }
  if (left.state === "absent" && right.state === "absent") return Object.freeze({ state: "equal" as const });
  if (left.state === "absent" || right.state === "absent") return Object.freeze({ state: "different" as const });
  const leftRevision = left.revision;
  const rightRevision = right.revision;
  if (leftRevision.kind === "text" && rightRevision.kind === "text") {
    return leftRevision.sha256 === rightRevision.sha256 && leftRevision.byteLength === rightRevision.byteLength
      ? Object.freeze({ state: "equal" as const })
      : Object.freeze({ state: "different" as const });
  }
  const leftLength = revisionByteLength(leftRevision);
  const rightLength = revisionByteLength(rightRevision);
  if (leftLength !== undefined && rightLength !== undefined && leftLength !== rightLength) {
    return Object.freeze({ state: "different" as const });
  }
  return Object.freeze({ state: "unknown" as const, reason: "endpoint-equality-unprovable" as const });
}

function unavailableRevision(revision: ClosedFileRevision): boolean {
  return revision.kind === "unavailable";
}

function revisionByteLength(revision: ClosedFileRevision): number | undefined {
  return revision.kind === "unavailable" ? undefined : revision.byteLength;
}

function available(
  kind: Extract<FileChangesNet, { readonly state: "available" }>["kind"],
  before: ClosedFileChangeEndpoint,
  after: ClosedFileChangeEndpoint,
): FileChangesNet {
  return Object.freeze({ state: "available" as const, kind, before, after });
}

function indeterminate(
  reason: Extract<FileChangesNet, { readonly state: "indeterminate" }>["reason"],
): FileChangesNet {
  return Object.freeze({ state: "indeterminate" as const, reason });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
