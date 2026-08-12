import type { AssertionEntryId } from "../assertions/record/model.ts";
import type { ProjectedRecordAttachmentResult } from "../projection/attachment-result.ts";
import type {
  AssertionSourceEntry,
  AssertionSourceFileFrame,
  AssertionSourceFrame,
  AssertionSourceOccurrence,
  AssertionSourcePackageFrame,
  AssertionSourceSendOccurrence,
  AssertionSourceSendSite,
  AssertionSourceSite,
  AssertionSourceSitesEntry,
  AssertionSourceSitesProjection,
  AssertionsSourceProjection,
  AttemptSourceAnnotation,
  AttemptSourceEntryUnmapped,
  AttemptSourceTreeAssemblyInput,
  AttemptSourceTreeAssemblyIssue,
  AttemptSourceTreeAssemblyResult,
  AttemptSourceTreeEntry,
  AttemptSourceTreeLine,
  AttemptSourceTreeNode,
  AttemptSourceTreeSlot,
  AttemptSourceTreeSummary,
  AttemptSourceTree,
  AttemptSourceUnmappedReason,
  AttemptSourceUnownedUnmapped,
  SourceCoordinate,
  SourceFileItemRef,
  SourceFileProjection,
  SourcePackageItemRef,
  SourcePackageProjection,
  SourcesProjection,
} from "./projection-model.ts";

const UTF8 = new TextEncoder();

interface MutableSourceTreeLine {
  readonly line: number;
  readonly text: string;
  readonly annotations: AttemptSourceAnnotation[];
  readonly calls: MutableSourceTreeNode[];
}

interface MutableSourceFileNode {
  readonly kind: "file";
  readonly file: SourceFileProjection;
  readonly lines: MutableSourceTreeLine[];
}

interface MutableSourcePackageNode {
  readonly kind: "package";
  readonly package: SourcePackageProjection;
  readonly calls: MutableSourceTreeNode[];
}

type MutableSourceTreeNode =
  | MutableSourceFileNode
  | MutableSourcePackageNode;

interface EntryBuild {
  readonly entry: AssertionSourceEntry;
  readonly mappedSites: AssertionSourceSite[];
  readonly unmapped: AttemptSourceEntryUnmapped[];
}

interface SourcesLookup {
  readonly packages: ReadonlyMap<string, SourcePackageProjection>;
  readonly files: ReadonlyMap<string, SourceFileProjection>;
}

type TraceResolution =
  | {
      readonly state: "mapped";
      readonly line: MutableSourceTreeLine;
    }
  | {
      readonly state: "unmapped";
      readonly reason: AttemptSourceUnmappedReason;
    };

function fileKey(packageItemId: string, fileItemId: string): string {
  return `${packageItemId}\u0000${fileItemId}`;
}

function isFileFrame(frame: AssertionSourceFrame): frame is AssertionSourceFileFrame {
  return frame.target.kind === "file";
}

function isPackageFrame(
  frame: AssertionSourceFrame,
): frame is AssertionSourcePackageFrame {
  return frame.target.kind === "package";
}

function isAvailable<Value>(
  result: ProjectedRecordAttachmentResult<Value>,
): result is { readonly state: "available"; readonly value: Value } {
  return result.state === "available";
}

function assertionUnavailableReason(
  result: Exclude<
    ProjectedRecordAttachmentResult<AssertionsSourceProjection>,
    { readonly state: "available" }
  >,
): AttemptSourceUnmappedReason {
  return Object.freeze({
    code: "attachment-not-available",
    attachment: Object.freeze({ attachment: "assertions", result }),
  });
}

function sourceSitesUnavailableReason(
  result: Exclude<
    ProjectedRecordAttachmentResult<AssertionSourceSitesProjection>,
    { readonly state: "available" }
  >,
): AttemptSourceUnmappedReason {
  return Object.freeze({
    code: "attachment-not-available",
    attachment: Object.freeze({ attachment: "source-sites", result }),
  });
}

function sourcesUnavailableReason(
  result: Exclude<
    ProjectedRecordAttachmentResult<SourcesProjection>,
    { readonly state: "available" }
  >,
): AttemptSourceUnmappedReason {
  return Object.freeze({
    code: "attachment-not-available",
    attachment: Object.freeze({ attachment: "sources", result }),
  });
}

function sourceSitesEntryMissingReason(): AttemptSourceUnmappedReason {
  return Object.freeze({ code: "source-sites-entry-missing" });
}

function sourceSitesEntryDuplicateReason(): AttemptSourceUnmappedReason {
  return Object.freeze({ code: "source-sites-entry-duplicate" });
}

function sourceSitesEntryOrphanReason(): AttemptSourceUnmappedReason {
  return Object.freeze({ code: "source-sites-entry-orphan" });
}

function duplicateSourceOrderReason(sourceOrder: number): AttemptSourceUnmappedReason {
  return Object.freeze({ code: "source-order-duplicate", sourceOrder });
}

function packageMissingReason(
  packageItemId: SourcePackageItemRef["packageItemId"],
): AttemptSourceUnmappedReason {
  return Object.freeze({
    code: "package-item-missing",
    target: Object.freeze({ kind: "package", packageItemId }),
  });
}

function fileMissingReason(target: SourceFileItemRef): AttemptSourceUnmappedReason {
  return Object.freeze({ code: "file-item-missing", target });
}

function digestMismatchReason(target: SourceFileItemRef): AttemptSourceUnmappedReason {
  return Object.freeze({ code: "file-digest-mismatch", target });
}

function coordinateOutOfRangeReason(
  coordinate: SourceCoordinate,
): AttemptSourceUnmappedReason {
  return Object.freeze({ code: "coordinate-out-of-range", coordinate });
}

function traceMalformedReason(): AttemptSourceUnmappedReason {
  return Object.freeze({ code: "trace-malformed" });
}

function addEntryUnmapped(
  build: EntryBuild,
  reason: AttemptSourceUnmappedReason,
): void {
  build.unmapped.push(Object.freeze({
    kind: "assertion-entry",
    entry: build.entry,
    reason,
  }));
}

function addSiteUnmapped(
  build: EntryBuild,
  site: AssertionSourceSite,
  reason: AttemptSourceUnmappedReason,
): void {
  build.unmapped.push(Object.freeze({
    kind: "assertion-site",
    entryId: build.entry.entry.entryId,
    site,
    reason,
  }));
}

function addOrphanUnmapped(
  unmapped: AttemptSourceUnownedUnmapped[],
  entryId: AssertionEntryId,
  site: AssertionSourceSite,
  reason: AttemptSourceUnmappedReason,
): void {
  unmapped.push(Object.freeze({
    kind: "orphan-assertion-site",
    entryId,
    site,
    reason,
  }));
}

function addSendUnmapped(
  unmapped: AttemptSourceUnownedUnmapped[],
  site: AssertionSourceSendSite,
  occurrence: AssertionSourceSendOccurrence,
  reason: AttemptSourceUnmappedReason,
): void {
  unmapped.push(Object.freeze({ kind: "send", site, occurrence, reason }));
}

function makeSourcesLookup(sources: SourcesProjection): SourcesLookup {
  const packages = new Map<string, SourcePackageProjection>();
  const files = new Map<string, SourceFileProjection>();
  for (const sourcePackage of sources.packages) {
    packages.set(sourcePackage.ref.packageItemId, sourcePackage);
    for (const file of sourcePackage.files) {
      files.set(fileKey(file.ref.packageItemId, file.ref.fileItemId), file);
    }
  }
  return Object.freeze({ packages, files });
}

function coordinateIsValid(
  text: string,
  coordinate: SourceCoordinate,
): boolean {
  if (text.includes("\r")) return false;
  const lines = text.split("\n");
  const line = lines[coordinate.line - 1];
  if (line === undefined) return false;
  const bytes = UTF8.encode(line);
  if (coordinate.column > bytes.byteLength + 1) return false;
  if (coordinate.column === bytes.byteLength + 1) return true;
  const byte = bytes[coordinate.column - 1];
  return byte !== undefined && (byte < 0x80 || byte > 0xbf);
}

function makeMutableFileNode(file: SourceFileProjection): MutableSourceFileNode {
  const lines = file.text.split("\n").map((text, index) => ({
    line: index + 1,
    text,
    annotations: [],
    calls: [],
  }));
  return { kind: "file", file, lines };
}

function sameFileRef(left: SourceFileProjection, right: SourceFileProjection): boolean {
  return (
    left.ref.packageItemId === right.ref.packageItemId &&
    left.ref.fileItemId === right.ref.fileItemId &&
    left.ref.sha256 === right.ref.sha256
  );
}

function samePackageRef(
  left: SourcePackageProjection,
  right: SourcePackageProjection,
): boolean {
  return left.ref.packageItemId === right.ref.packageItemId;
}

function ensureRootFile(
  roots: MutableSourceTreeNode[],
  file: SourceFileProjection,
): MutableSourceFileNode {
  const existing = roots.find(
    (node): node is MutableSourceFileNode =>
      node.kind === "file" && sameFileRef(node.file, file),
  );
  if (existing !== undefined) return existing;
  const created = makeMutableFileNode(file);
  roots.push(created);
  return created;
}

function ensureFileCall(
  calls: MutableSourceTreeNode[],
  file: SourceFileProjection,
): MutableSourceFileNode {
  const existing = calls.find(
    (node): node is MutableSourceFileNode =>
      node.kind === "file" && sameFileRef(node.file, file),
  );
  if (existing !== undefined) return existing;
  const created = makeMutableFileNode(file);
  calls.push(created);
  return created;
}

function ensurePackageCall(
  calls: MutableSourceTreeNode[],
  sourcePackage: SourcePackageProjection,
): MutableSourcePackageNode {
  const existing = calls.find(
    (node): node is MutableSourcePackageNode =>
      node.kind === "package" && samePackageRef(node.package, sourcePackage),
  );
  if (existing !== undefined) return existing;
  const created: MutableSourcePackageNode = {
    kind: "package",
    package: sourcePackage,
    calls: [],
  };
  calls.push(created);
  return created;
}

function resolveTrace(
  trace: AssertionSourceSite["trace"],
  lookup: SourcesLookup,
  roots: MutableSourceTreeNode[],
): TraceResolution {
  const frames = trace.frames;
  const first = frames[0];
  const last = frames.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    !isFileFrame(first) ||
    !isFileFrame(last)
  ) {
    return Object.freeze({ state: "unmapped", reason: traceMalformedReason() });
  }

  const files: (SourceFileProjection | undefined)[] = [];
  const packages: (SourcePackageProjection | undefined)[] = [];
  for (const frame of frames) {
    if (isPackageFrame(frame)) {
      const sourcePackage = lookup.packages.get(frame.target.packageItemId);
      if (sourcePackage === undefined) {
        return Object.freeze({
          state: "unmapped",
          reason: packageMissingReason(frame.target.packageItemId),
        });
      }
      packages.push(sourcePackage);
      files.push(undefined);
      continue;
    }
    if (!isFileFrame(frame)) {
      return Object.freeze({ state: "unmapped", reason: traceMalformedReason() });
    }
    const sourcePackage = lookup.packages.get(frame.target.packageItemId);
    if (sourcePackage === undefined) {
      return Object.freeze({
        state: "unmapped",
        reason: packageMissingReason(frame.target.packageItemId),
      });
    }
    const file = lookup.files.get(fileKey(frame.target.packageItemId, frame.target.fileItemId));
    if (file === undefined) {
      return Object.freeze({ state: "unmapped", reason: fileMissingReason(frame.target) });
    }
    if (file.ref.sha256 !== frame.target.sha256) {
      return Object.freeze({ state: "unmapped", reason: digestMismatchReason(frame.target) });
    }
    if (!coordinateIsValid(file.text, frame.coordinate)) {
      return Object.freeze({
        state: "unmapped",
        reason: coordinateOutOfRangeReason(frame.coordinate),
      });
    }
    packages.push(sourcePackage);
    files.push(file);
  }

  const firstFile = files[0];
  const firstFrame = frames[0];
  if (firstFile === undefined || firstFrame === undefined || !isFileFrame(firstFrame)) {
    return Object.freeze({ state: "unmapped", reason: traceMalformedReason() });
  }
  let current = ensureRootFile(roots, firstFile);
  let calls = current.lines[firstFrame.coordinate.line - 1]?.calls;
  if (calls === undefined) {
    return Object.freeze({
      state: "unmapped",
      reason: coordinateOutOfRangeReason(firstFrame.coordinate),
    });
  }

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const sourcePackage = packages[index];
    const file = files[index];
    if (frame === undefined || sourcePackage === undefined) {
      return Object.freeze({ state: "unmapped", reason: traceMalformedReason() });
    }
    if (isPackageFrame(frame)) {
      calls = ensurePackageCall(calls, sourcePackage).calls;
      continue;
    }
    if (!isFileFrame(frame) || file === undefined) {
      return Object.freeze({ state: "unmapped", reason: traceMalformedReason() });
    }
    current = ensureFileCall(calls, file);
    const line = current.lines[frame.coordinate.line - 1];
    if (line === undefined) {
      return Object.freeze({
        state: "unmapped",
        reason: coordinateOutOfRangeReason(frame.coordinate),
      });
    }
    calls = line.calls;
  }

  const leafFrame = frames.at(-1);
  const leaf = leafFrame !== undefined && isFileFrame(leafFrame)
    ? current.lines[leafFrame.coordinate.line - 1]
    : undefined;
  return leaf === undefined
    ? Object.freeze({ state: "unmapped", reason: traceMalformedReason() })
    : Object.freeze({ state: "mapped", line: leaf });
}

function countSourceOrders(document: AssertionSourceSitesProjection): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  const count = (sourceOrder: number): void => {
    counts.set(sourceOrder, (counts.get(sourceOrder) ?? 0) + 1);
  };
  for (const entry of document.entries) {
    for (const site of entry.sites) {
      for (const occurrence of site.occurrences) count(occurrence.sourceOrder);
    }
  }
  for (const site of document.sendSites) {
    for (const occurrence of site.occurrences) count(occurrence.sourceOrder);
  }
  return counts;
}

function sourceOrderIsUnique(
  counts: ReadonlyMap<number, number>,
  sourceOrder: number,
): boolean {
  return counts.get(sourceOrder) === 1;
}

function sourceSiteRowsByEntryId(
  document: AssertionSourceSitesProjection,
): ReadonlyMap<string, readonly AssertionSourceSitesEntry[]> {
  const rows = new Map<string, AssertionSourceSitesEntry[]>();
  for (const row of document.entries) {
    const entryRows = rows.get(row.entryId) ?? [];
    entryRows.push(row);
    rows.set(row.entryId, entryRows);
  }
  return rows;
}

function addAssertionSite(input: {
  readonly build: EntryBuild;
  readonly site: AssertionSourceSite;
  readonly roots: MutableSourceTreeNode[];
  readonly lookup: SourcesLookup;
  readonly sourceOrders: ReadonlyMap<number, number>;
}): void {
  const uniqueOccurrences: AssertionSourceOccurrence[] = [];
  for (const occurrence of input.site.occurrences) {
    if (!sourceOrderIsUnique(input.sourceOrders, occurrence.sourceOrder)) {
      addSiteUnmapped(
        input.build,
        input.site,
        duplicateSourceOrderReason(occurrence.sourceOrder),
      );
      continue;
    }
    uniqueOccurrences.push(occurrence);
  }
  if (uniqueOccurrences.length === 0) return;

  const resolution = resolveTrace(input.site.trace, input.lookup, input.roots);
  if (resolution.state === "unmapped") {
    addSiteUnmapped(input.build, input.site, resolution.reason);
    return;
  }
  for (const occurrence of uniqueOccurrences) {
    resolution.line.annotations.push(Object.freeze({
      kind: "assertion",
      entryId: input.build.entry.entry.entryId,
      occurrence,
    }));
  }
  input.build.mappedSites.push(input.site);
}

function addSendSite(input: {
  readonly site: AssertionSourceSendSite;
  readonly roots: MutableSourceTreeNode[];
  readonly lookup: SourcesLookup;
  readonly sourceOrders: ReadonlyMap<number, number>;
  readonly unmapped: AttemptSourceUnownedUnmapped[];
}): void {
  const uniqueOccurrences: AssertionSourceSendOccurrence[] = [];
  for (const occurrence of input.site.occurrences) {
    if (!sourceOrderIsUnique(input.sourceOrders, occurrence.sourceOrder)) {
      addSendUnmapped(
        input.unmapped,
        input.site,
        occurrence,
        duplicateSourceOrderReason(occurrence.sourceOrder),
      );
      continue;
    }
    uniqueOccurrences.push(occurrence);
  }
  if (uniqueOccurrences.length === 0) return;

  const resolution = resolveTrace(input.site.trace, input.lookup, input.roots);
  if (resolution.state === "unmapped") {
    for (const occurrence of uniqueOccurrences) {
      addSendUnmapped(input.unmapped, input.site, occurrence, resolution.reason);
    }
    return;
  }
  for (const occurrence of uniqueOccurrences) {
    resolution.line.annotations.push(Object.freeze({ kind: "send", occurrence }));
  }
}

function freezeTreeNode(node: MutableSourceTreeNode): AttemptSourceTreeNode {
  if (node.kind === "package") {
    return Object.freeze({
      kind: "package",
      package: node.package,
      calls: Object.freeze(node.calls.map(freezeTreeNode)),
    });
  }
  return Object.freeze({
    kind: "file",
    file: node.file,
    lines: Object.freeze(node.lines.map((line): AttemptSourceTreeLine => {
      const annotations = [...line.annotations].sort(
        (left, right) => left.occurrence.sourceOrder - right.occurrence.sourceOrder,
      );
      return Object.freeze({
        line: line.line,
        text: line.text,
        annotations: Object.freeze(annotations),
        calls: Object.freeze(line.calls.map(freezeTreeNode)),
      });
    })),
  });
}

function makeSummary(
  entries: readonly EntryBuild[],
): AttemptSourceTreeSummary {
  let matched = 0;
  let mismatched = 0;
  let unavailable = 0;
  let errored = 0;
  let notApplicable = 0;
  let earnedPoints = 0;
  let earned = 0;
  let unavailablePoints = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    const sealed = entry.entry.entry;
    if (seen.has(sealed.entryId)) continue;
    seen.add(sealed.entryId);
    switch (sealed.result.state) {
      case "matched":
        matched += 1;
        break;
      case "mismatched":
        mismatched += 1;
        break;
      case "unavailable":
        unavailable += 1;
        break;
      case "errored":
        errored += 1;
        break;
      case "not-applicable":
        notApplicable += 1;
        break;
    }
    switch (sealed.result.score.state) {
      case "earned":
        earnedPoints += sealed.result.score.points;
        earned += sealed.result.score.earned;
        break;
      case "unavailable":
        unavailablePoints += sealed.result.score.points;
        break;
      case "not-scored":
        break;
    }
  }
  return Object.freeze({
    entries: seen.size,
    results: Object.freeze({ matched, mismatched, unavailable, errored, notApplicable }),
    score: Object.freeze({ earnedPoints, earned, unavailablePoints }),
  });
}

function buildTree(input: {
  readonly assertions: ProjectedRecordAttachmentResult<AssertionsSourceProjection>;
  readonly sourceSites: ProjectedRecordAttachmentResult<AssertionSourceSitesProjection>;
  readonly sources: ProjectedRecordAttachmentResult<SourcesProjection>;
}): AttemptSourceTree {
  const roots: MutableSourceTreeNode[] = [];
  const unmapped: AttemptSourceUnownedUnmapped[] = [];
  const builds: EntryBuild[] = [];
  const buildsByEntryId = new Map<string, EntryBuild>();

  if (isAvailable(input.assertions)) {
    for (const entry of input.assertions.value.entries) {
      if (buildsByEntryId.has(entry.entry.entryId)) continue;
      const build: EntryBuild = {
        entry,
        mappedSites: [],
        unmapped: [],
      };
      buildsByEntryId.set(entry.entry.entryId, build);
      builds.push(build);
    }
  }

  if (!isAvailable(input.sourceSites)) {
    if (isAvailable(input.assertions)) {
      const reason = sourceSitesUnavailableReason(input.sourceSites);
      for (const build of builds) addEntryUnmapped(build, reason);
    }
  } else if (!isAvailable(input.assertions)) {
    const reason = assertionUnavailableReason(input.assertions);
    for (const row of input.sourceSites.value.entries) {
      for (const site of row.sites) addOrphanUnmapped(unmapped, row.entryId, site, reason);
    }
    if (isAvailable(input.sources)) {
      const document = input.sourceSites.value;
      const sourceOrders = countSourceOrders(document);
      const lookup = makeSourcesLookup(input.sources.value);
      for (const site of document.sendSites) {
        addSendSite({ site, roots, lookup, sourceOrders, unmapped });
      }
    } else {
      const reason = sourcesUnavailableReason(input.sources);
      for (const site of input.sourceSites.value.sendSites) {
        for (const occurrence of site.occurrences) {
          addSendUnmapped(unmapped, site, occurrence, reason);
        }
      }
    }
  } else if (!isAvailable(input.sources)) {
    const sourceReason = sourcesUnavailableReason(input.sources);
    const rowsByEntryId = sourceSiteRowsByEntryId(input.sourceSites.value);
    for (const build of builds) {
      const rows = rowsByEntryId.get(build.entry.entry.entryId);
      if (rows === undefined) {
        addEntryUnmapped(build, sourceSitesEntryMissingReason());
        continue;
      }
      if (rows.length !== 1) {
        addEntryUnmapped(build, sourceSitesEntryDuplicateReason());
        continue;
      }
      const row = rows[0];
      if (row === undefined) continue;
      for (const site of row.sites) addSiteUnmapped(build, site, sourceReason);
    }
    for (const row of input.sourceSites.value.entries) {
      if (buildsByEntryId.has(row.entryId)) continue;
      for (const site of row.sites) {
        addOrphanUnmapped(unmapped, row.entryId, site, sourceSitesEntryOrphanReason());
      }
    }
    for (const site of input.sourceSites.value.sendSites) {
      for (const occurrence of site.occurrences) addSendUnmapped(unmapped, site, occurrence, sourceReason);
    }
  } else {
    const document = input.sourceSites.value;
    const sourceOrders = countSourceOrders(document);
    const lookup = makeSourcesLookup(input.sources.value);
    const rowsByEntryId = sourceSiteRowsByEntryId(document);
    for (const build of builds) {
      const rows = rowsByEntryId.get(build.entry.entry.entryId);
      if (rows === undefined) {
        addEntryUnmapped(build, sourceSitesEntryMissingReason());
        continue;
      }
      if (rows.length !== 1) {
        addEntryUnmapped(build, sourceSitesEntryDuplicateReason());
        continue;
      }
      const row = rows[0];
      if (row === undefined) continue;
      for (const site of row.sites) {
        addAssertionSite({ build, site, roots, lookup, sourceOrders });
      }
    }
    for (const row of document.entries) {
      if (buildsByEntryId.has(row.entryId)) continue;
      for (const site of row.sites) {
        addOrphanUnmapped(unmapped, row.entryId, site, sourceSitesEntryOrphanReason());
      }
    }
    for (const site of document.sendSites) {
      addSendSite({ site, roots, lookup, sourceOrders, unmapped });
    }
  }

  const entries: AttemptSourceTreeEntry[] = builds.map((build) => Object.freeze({
    entry: build.entry,
    mappedSites: Object.freeze([...build.mappedSites]),
    unmapped: Object.freeze([...build.unmapped]),
  }));
  return Object.freeze({
    roots: Object.freeze(roots.map(freezeTreeNode)),
    entries: Object.freeze(entries),
    unmapped: Object.freeze(unmapped),
    summary: makeSummary(builds),
  });
}

function entrySlotId(entry: { readonly slot: { readonly slotId: string } }): string {
  return entry.slot.slotId;
}

function entryMatchesSampleSlot(
  state: AttemptSourceTreeSlot["state"] | "attachment-result",
  sampleState: AttemptSourceTreeSlot["state"] | "included",
): boolean {
  if (sampleState === "included") return state === "attachment-result";
  return state === sampleState;
}

function alignmentIssues(
  input: AttemptSourceTreeAssemblyInput,
): readonly AttemptSourceTreeAssemblyIssue[] {
  const sample = input.assertions.sample;
  if (sample !== input.sourceSites.sample || sample !== input.sources.sample) {
    return Object.freeze([Object.freeze({ code: "sample-mismatch" as const })]);
  }
  if (
    input.assertions.entries.length !== sample.slots.length ||
    input.sourceSites.entries.length !== sample.slots.length ||
    input.sources.entries.length !== sample.slots.length
  ) {
    return Object.freeze([Object.freeze({ code: "sample-mismatch" as const })]);
  }
  const issues: AttemptSourceTreeAssemblyIssue[] = [];
  for (const [index, slot] of sample.slots.entries()) {
    const assertions = input.assertions.entries[index];
    const sourceSites = input.sourceSites.entries[index];
    const sources = input.sources.entries[index];
    if (assertions === undefined || sourceSites === undefined || sources === undefined) {
      issues.push(Object.freeze({ code: "slot-alignment-mismatch", slotId: slot.slotId }));
      continue;
    }
    if (
      entrySlotId(assertions) !== slot.slotId ||
      entrySlotId(sourceSites) !== slot.slotId ||
      entrySlotId(sources) !== slot.slotId ||
      entrySlotId(assertions) !== entrySlotId(sourceSites) ||
      entrySlotId(assertions) !== entrySlotId(sources) ||
      !entryMatchesSampleSlot(assertions.state, slot.state) ||
      assertions.state !== sourceSites.state ||
      assertions.state !== sources.state
    ) {
      issues.push(Object.freeze({ code: "slot-alignment-mismatch", slotId: slot.slotId }));
    }
  }
  return Object.freeze(issues);
}

function nonEmptyAssemblyIssues(
  issues: readonly AttemptSourceTreeAssemblyIssue[],
): readonly [
  AttemptSourceTreeAssemblyIssue,
  ...AttemptSourceTreeAssemblyIssue[],
] {
  const [first, ...rest] = issues;
  if (first === undefined) {
    throw new Error("Source tree assembly issue list was unexpectedly empty");
  }
  const nonEmpty: [
    AttemptSourceTreeAssemblyIssue,
    ...AttemptSourceTreeAssemblyIssue[],
  ] = [first, ...rest];
  return Object.freeze(nonEmpty);
}

/**
 * Purely combines already-projected values. It never retains a reader, opens a
 * blob, follows a path, or recalculates an Assertion result.
 */
export function assembleAttemptSourceTree(
  input: AttemptSourceTreeAssemblyInput,
): AttemptSourceTreeAssemblyResult {
  const issues = alignmentIssues(input);
  if (issues.length > 0) {
    return Object.freeze({
      state: "input-invalid",
      issues: nonEmptyAssemblyIssues(issues),
    });
  }

  const slots: AttemptSourceTreeSlot[] = [];
  for (const [index, assertions] of input.assertions.entries.entries()) {
    const sourceSites = input.sourceSites.entries[index];
    const sources = input.sources.entries[index];
    if (sourceSites === undefined || sources === undefined) {
      throw new Error("Validated source tree inputs lost a projected slot");
    }
    switch (assertions.state) {
      case "excluded":
        slots.push(Object.freeze({ state: "excluded", slot: assertions.slot }));
        break;
      case "not-recorded":
        slots.push(Object.freeze({ state: "not-recorded", slot: assertions.slot }));
        break;
      case "core-invalid":
        slots.push(Object.freeze({ state: "core-invalid", slot: assertions.slot }));
        break;
      case "attachment-result":
        if (sourceSites.state !== "attachment-result" || sources.state !== "attachment-result") {
          throw new Error("Validated source tree inputs lost attachment-result alignment");
        }
        slots.push(Object.freeze({
          state: "attachment-result",
          slot: assertions.slot,
          assertions,
          sourceSites,
          sources,
          tree: buildTree({
            assertions: assertions.attachment,
            sourceSites: sourceSites.attachment,
            sources: sources.attachment,
          }),
        }));
        break;
    }
  }
  return Object.freeze({
    state: "assembled",
    value: Object.freeze({
      sample: input.assertions.sample,
      slots: Object.freeze(slots),
    }),
  });
}
