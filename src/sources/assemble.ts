import type {
  AssertionEntryId,
  AssertionEntryReadV1,
} from "../assertions/record/model.ts";
import type { RecordBlobRef } from "../record/attachment/index.ts";
import type { ProjectedRecordAttachmentResult } from "../projection/attachment-result.ts";
import type {
  AssertionSourceFileFrameV1,
  AssertionSourceFrameV1,
  AssertionSourceOccurrenceV1,
  AssertionSourcePackageFrameV1,
  AssertionSourceSendOccurrenceV1,
  AssertionSourceSendSiteV1,
  AssertionSourceSiteV1,
  AssertionSourceSitesEntryV1,
  AssertionSourceSitesDocumentV1,
  AttemptSourceAnnotationV1,
  AttemptSourceEntryUnmappedV1,
  AttemptSourceTreeAssemblyInputV1,
  AttemptSourceTreeAssemblyIssueV1,
  AttemptSourceTreeAssemblyResultV1,
  AttemptSourceTreeEntryV1,
  AttemptSourceTreeLineV1,
  AttemptSourceTreeNodeV1,
  AttemptSourceTreeSlotV1,
  AttemptSourceTreeSummaryV1,
  AttemptSourceTreeV1,
  AttemptSourceUnmappedReasonV1,
  AttemptSourceUnownedUnmappedV1,
  AssertionSourceSitesProjectionV1,
  AssertionsSourceProjectionV1,
  SourceCoordinateV1,
  SourceFileItemRefV1,
  SourceFileProjectionV1,
  SourcePackageItemRefV1,
  SourcePackageProjectionV1,
  SourcesProjectionV1,
} from "./model.ts";

const UTF8 = new TextEncoder();

interface MutableSourceTreeLineV1 {
  readonly line: number;
  readonly text: string;
  readonly annotations: AttemptSourceAnnotationV1[];
  readonly calls: MutableSourceTreeNodeV1[];
}

interface MutableSourceFileNodeV1 {
  readonly kind: "file";
  readonly file: SourceFileProjectionV1;
  readonly lines: MutableSourceTreeLineV1[];
}

interface MutableSourcePackageNodeV1 {
  readonly kind: "package";
  readonly package: SourcePackageProjectionV1;
  readonly calls: MutableSourceTreeNodeV1[];
}

type MutableSourceTreeNodeV1 =
  | MutableSourceFileNodeV1
  | MutableSourcePackageNodeV1;

interface EntryBuildV1 {
  readonly entry: AssertionEntryReadV1<RecordBlobRef>;
  readonly mappedSites: AssertionSourceSiteV1[];
  readonly unmapped: AttemptSourceEntryUnmappedV1[];
}

interface SourcesLookupV1 {
  readonly packages: ReadonlyMap<string, SourcePackageProjectionV1>;
  readonly files: ReadonlyMap<string, SourceFileProjectionV1>;
}

type TraceResolutionV1 =
  | {
      readonly state: "mapped";
      readonly line: MutableSourceTreeLineV1;
    }
  | {
      readonly state: "unmapped";
      readonly reason: AttemptSourceUnmappedReasonV1;
    };

function fileKey(packageItemId: string, fileItemId: string): string {
  return `${packageItemId}\u0000${fileItemId}`;
}

function isFileFrameV1(frame: AssertionSourceFrameV1): frame is AssertionSourceFileFrameV1 {
  return frame.target.kind === "file";
}

function isPackageFrameV1(
  frame: AssertionSourceFrameV1,
): frame is AssertionSourcePackageFrameV1 {
  return frame.target.kind === "package";
}

function isAvailable<Value>(
  result: ProjectedRecordAttachmentResult<Value>,
): result is { readonly state: "available"; readonly value: Value } {
  return result.state === "available";
}

function assertionUnavailableReason(
  result: Exclude<
    ProjectedRecordAttachmentResult<AssertionsSourceProjectionV1>,
    { readonly state: "available" }
  >,
): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({
    code: "attachment-not-available",
    attachment: Object.freeze({ attachment: "assertions", result }),
  });
}

function sourceSitesUnavailableReason(
  result: Exclude<
    ProjectedRecordAttachmentResult<AssertionSourceSitesProjectionV1>,
    { readonly state: "available" }
  >,
): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({
    code: "attachment-not-available",
    attachment: Object.freeze({ attachment: "source-sites", result }),
  });
}

function sourcesUnavailableReason(
  result: Exclude<
    ProjectedRecordAttachmentResult<SourcesProjectionV1>,
    { readonly state: "available" }
  >,
): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({
    code: "attachment-not-available",
    attachment: Object.freeze({ attachment: "sources", result }),
  });
}

function sourceSitesEntryMissingReason(): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({ code: "source-sites-entry-missing" });
}

function sourceSitesEntryDuplicateReason(): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({ code: "source-sites-entry-duplicate" });
}

function sourceSitesEntryOrphanReason(): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({ code: "source-sites-entry-orphan" });
}

function duplicateSourceOrderReason(sourceOrder: number): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({ code: "source-order-duplicate", sourceOrder });
}

function packageMissingReason(
  packageItemId: SourcePackageItemRefV1["packageItemId"],
): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({
    code: "package-item-missing",
    target: Object.freeze({ kind: "package", packageItemId }),
  });
}

function fileMissingReason(target: SourceFileItemRefV1): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({ code: "file-item-missing", target });
}

function digestMismatchReason(target: SourceFileItemRefV1): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({ code: "file-digest-mismatch", target });
}

function coordinateOutOfRangeReason(
  coordinate: SourceCoordinateV1,
): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({ code: "coordinate-out-of-range", coordinate });
}

function traceMalformedReason(): AttemptSourceUnmappedReasonV1 {
  return Object.freeze({ code: "trace-malformed" });
}

function addEntryUnmapped(
  build: EntryBuildV1,
  reason: AttemptSourceUnmappedReasonV1,
): void {
  build.unmapped.push(Object.freeze({
    kind: "assertion-entry",
    entry: build.entry,
    reason,
  }));
}

function addSiteUnmapped(
  build: EntryBuildV1,
  site: AssertionSourceSiteV1,
  reason: AttemptSourceUnmappedReasonV1,
): void {
  build.unmapped.push(Object.freeze({
    kind: "assertion-site",
    entryId: build.entry.entry.entryId,
    site,
    reason,
  }));
}

function addOrphanUnmapped(
  unmapped: AttemptSourceUnownedUnmappedV1[],
  entryId: AssertionEntryId,
  site: AssertionSourceSiteV1,
  reason: AttemptSourceUnmappedReasonV1,
): void {
  unmapped.push(Object.freeze({
    kind: "orphan-assertion-site",
    entryId,
    site,
    reason,
  }));
}

function addSendUnmapped(
  unmapped: AttemptSourceUnownedUnmappedV1[],
  site: AssertionSourceSendSiteV1,
  occurrence: AssertionSourceSendOccurrenceV1,
  reason: AttemptSourceUnmappedReasonV1,
): void {
  unmapped.push(Object.freeze({ kind: "send", site, occurrence, reason }));
}

function makeSourcesLookupV1(sources: SourcesProjectionV1): SourcesLookupV1 {
  const packages = new Map<string, SourcePackageProjectionV1>();
  const files = new Map<string, SourceFileProjectionV1>();
  for (const sourcePackage of sources.packages) {
    packages.set(sourcePackage.ref.packageItemId, sourcePackage);
    for (const file of sourcePackage.files) {
      files.set(fileKey(file.ref.packageItemId, file.ref.fileItemId), file);
    }
  }
  return Object.freeze({ packages, files });
}

function coordinateIsValidV1(
  text: string,
  coordinate: SourceCoordinateV1,
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

function makeMutableFileNodeV1(file: SourceFileProjectionV1): MutableSourceFileNodeV1 {
  const lines = file.text.split("\n").map((text, index) => ({
    line: index + 1,
    text,
    annotations: [],
    calls: [],
  }));
  return { kind: "file", file, lines };
}

function sameFileRefV1(left: SourceFileProjectionV1, right: SourceFileProjectionV1): boolean {
  return (
    left.ref.packageItemId === right.ref.packageItemId &&
    left.ref.fileItemId === right.ref.fileItemId &&
    left.ref.sha256 === right.ref.sha256
  );
}

function samePackageRefV1(
  left: SourcePackageProjectionV1,
  right: SourcePackageProjectionV1,
): boolean {
  return left.ref.packageItemId === right.ref.packageItemId;
}

function ensureRootFileV1(
  roots: MutableSourceTreeNodeV1[],
  file: SourceFileProjectionV1,
): MutableSourceFileNodeV1 {
  const existing = roots.find(
    (node): node is MutableSourceFileNodeV1 =>
      node.kind === "file" && sameFileRefV1(node.file, file),
  );
  if (existing !== undefined) return existing;
  const created = makeMutableFileNodeV1(file);
  roots.push(created);
  return created;
}

function ensureFileCallV1(
  calls: MutableSourceTreeNodeV1[],
  file: SourceFileProjectionV1,
): MutableSourceFileNodeV1 {
  const existing = calls.find(
    (node): node is MutableSourceFileNodeV1 =>
      node.kind === "file" && sameFileRefV1(node.file, file),
  );
  if (existing !== undefined) return existing;
  const created = makeMutableFileNodeV1(file);
  calls.push(created);
  return created;
}

function ensurePackageCallV1(
  calls: MutableSourceTreeNodeV1[],
  sourcePackage: SourcePackageProjectionV1,
): MutableSourcePackageNodeV1 {
  const existing = calls.find(
    (node): node is MutableSourcePackageNodeV1 =>
      node.kind === "package" && samePackageRefV1(node.package, sourcePackage),
  );
  if (existing !== undefined) return existing;
  const created: MutableSourcePackageNodeV1 = {
    kind: "package",
    package: sourcePackage,
    calls: [],
  };
  calls.push(created);
  return created;
}

function resolveTraceV1(
  trace: AssertionSourceSiteV1["trace"],
  lookup: SourcesLookupV1,
  roots: MutableSourceTreeNodeV1[],
): TraceResolutionV1 {
  const frames = trace.frames;
  const first = frames[0];
  const last = frames.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    !isFileFrameV1(first) ||
    !isFileFrameV1(last)
  ) {
    return Object.freeze({ state: "unmapped", reason: traceMalformedReason() });
  }

  const files: (SourceFileProjectionV1 | undefined)[] = [];
  const packages: (SourcePackageProjectionV1 | undefined)[] = [];
  for (const frame of frames) {
    if (isPackageFrameV1(frame)) {
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
    if (!isFileFrameV1(frame)) {
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
    if (!coordinateIsValidV1(file.text, frame.coordinate)) {
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
  if (firstFile === undefined || firstFrame === undefined || !isFileFrameV1(firstFrame)) {
    return Object.freeze({ state: "unmapped", reason: traceMalformedReason() });
  }
  let current = ensureRootFileV1(roots, firstFile);
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
    if (isPackageFrameV1(frame)) {
      calls = ensurePackageCallV1(calls, sourcePackage).calls;
      continue;
    }
    if (!isFileFrameV1(frame) || file === undefined) {
      return Object.freeze({ state: "unmapped", reason: traceMalformedReason() });
    }
    current = ensureFileCallV1(calls, file);
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
  const leaf = leafFrame !== undefined && isFileFrameV1(leafFrame)
    ? current.lines[leafFrame.coordinate.line - 1]
    : undefined;
  return leaf === undefined
    ? Object.freeze({ state: "unmapped", reason: traceMalformedReason() })
    : Object.freeze({ state: "mapped", line: leaf });
}

function countSourceOrdersV1(document: AssertionSourceSitesDocumentV1): ReadonlyMap<number, number> {
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

function sourceOrderIsUniqueV1(
  counts: ReadonlyMap<number, number>,
  sourceOrder: number,
): boolean {
  return counts.get(sourceOrder) === 1;
}

function sourceSiteRowsByEntryIdV1(
  document: AssertionSourceSitesDocumentV1,
): ReadonlyMap<string, readonly AssertionSourceSitesEntryV1[]> {
  const rows = new Map<string, AssertionSourceSitesEntryV1[]>();
  for (const row of document.entries) {
    const entryRows = rows.get(row.entryId) ?? [];
    entryRows.push(row);
    rows.set(row.entryId, entryRows);
  }
  return rows;
}

function addAssertionSiteV1(input: {
  readonly build: EntryBuildV1;
  readonly site: AssertionSourceSiteV1;
  readonly roots: MutableSourceTreeNodeV1[];
  readonly lookup: SourcesLookupV1;
  readonly sourceOrders: ReadonlyMap<number, number>;
}): void {
  const uniqueOccurrences: AssertionSourceOccurrenceV1[] = [];
  for (const occurrence of input.site.occurrences) {
    if (!sourceOrderIsUniqueV1(input.sourceOrders, occurrence.sourceOrder)) {
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

  const resolution = resolveTraceV1(input.site.trace, input.lookup, input.roots);
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

function addSendSiteV1(input: {
  readonly site: AssertionSourceSendSiteV1;
  readonly roots: MutableSourceTreeNodeV1[];
  readonly lookup: SourcesLookupV1;
  readonly sourceOrders: ReadonlyMap<number, number>;
  readonly unmapped: AttemptSourceUnownedUnmappedV1[];
}): void {
  const uniqueOccurrences: AssertionSourceSendOccurrenceV1[] = [];
  for (const occurrence of input.site.occurrences) {
    if (!sourceOrderIsUniqueV1(input.sourceOrders, occurrence.sourceOrder)) {
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

  const resolution = resolveTraceV1(input.site.trace, input.lookup, input.roots);
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

function freezeTreeNodeV1(node: MutableSourceTreeNodeV1): AttemptSourceTreeNodeV1 {
  if (node.kind === "package") {
    return Object.freeze({
      kind: "package",
      package: node.package,
      calls: Object.freeze(node.calls.map(freezeTreeNodeV1)),
    });
  }
  return Object.freeze({
    kind: "file",
    file: node.file,
    lines: Object.freeze(node.lines.map((line): AttemptSourceTreeLineV1 => {
      const annotations = [...line.annotations].sort(
        (left, right) => left.occurrence.sourceOrder - right.occurrence.sourceOrder,
      );
      return Object.freeze({
        line: line.line,
        text: line.text,
        annotations: Object.freeze(annotations),
        calls: Object.freeze(line.calls.map(freezeTreeNodeV1)),
      });
    })),
  });
}

function makeSummaryV1(
  entries: readonly EntryBuildV1[],
): AttemptSourceTreeSummaryV1 {
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

function buildTreeV1(input: {
  readonly assertions: ProjectedRecordAttachmentResult<AssertionsSourceProjectionV1>;
  readonly sourceSites: ProjectedRecordAttachmentResult<AssertionSourceSitesProjectionV1>;
  readonly sources: ProjectedRecordAttachmentResult<SourcesProjectionV1>;
}): AttemptSourceTreeV1 {
  const roots: MutableSourceTreeNodeV1[] = [];
  const unmapped: AttemptSourceUnownedUnmappedV1[] = [];
  const builds: EntryBuildV1[] = [];
  const buildsByEntryId = new Map<string, EntryBuildV1>();

  if (isAvailable(input.assertions)) {
    for (const entry of input.assertions.value.entries) {
      if (buildsByEntryId.has(entry.entry.entryId)) continue;
      const build: EntryBuildV1 = {
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
      const sourceOrders = countSourceOrdersV1(document);
      const lookup = makeSourcesLookupV1(input.sources.value);
      for (const site of document.sendSites) {
        addSendSiteV1({ site, roots, lookup, sourceOrders, unmapped });
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
    const rowsByEntryId = sourceSiteRowsByEntryIdV1(input.sourceSites.value);
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
    const sourceOrders = countSourceOrdersV1(document);
    const lookup = makeSourcesLookupV1(input.sources.value);
    const rowsByEntryId = sourceSiteRowsByEntryIdV1(document);
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
        addAssertionSiteV1({ build, site, roots, lookup, sourceOrders });
      }
    }
    for (const row of document.entries) {
      if (buildsByEntryId.has(row.entryId)) continue;
      for (const site of row.sites) {
        addOrphanUnmapped(unmapped, row.entryId, site, sourceSitesEntryOrphanReason());
      }
    }
    for (const site of document.sendSites) {
      addSendSiteV1({ site, roots, lookup, sourceOrders, unmapped });
    }
  }

  const entries: AttemptSourceTreeEntryV1[] = builds.map((build) => Object.freeze({
    entry: build.entry,
    mappedSites: Object.freeze([...build.mappedSites]),
    unmapped: Object.freeze([...build.unmapped]),
  }));
  return Object.freeze({
    roots: Object.freeze(roots.map(freezeTreeNodeV1)),
    entries: Object.freeze(entries),
    unmapped: Object.freeze(unmapped),
    summary: makeSummaryV1(builds),
  });
}

function entrySlotIdV1(entry: { readonly slot: { readonly slotId: string } }): string {
  return entry.slot.slotId;
}

function entryMatchesSampleSlotV1(
  state: AttemptSourceTreeSlotV1["state"] | "attachment-result",
  sampleState: AttemptSourceTreeSlotV1["state"] | "included",
): boolean {
  if (sampleState === "included") return state === "attachment-result";
  return state === sampleState;
}

function alignmentIssuesV1(
  input: AttemptSourceTreeAssemblyInputV1,
): readonly AttemptSourceTreeAssemblyIssueV1[] {
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
  const issues: AttemptSourceTreeAssemblyIssueV1[] = [];
  for (const [index, slot] of sample.slots.entries()) {
    const assertions = input.assertions.entries[index];
    const sourceSites = input.sourceSites.entries[index];
    const sources = input.sources.entries[index];
    if (assertions === undefined || sourceSites === undefined || sources === undefined) {
      issues.push(Object.freeze({ code: "slot-alignment-mismatch", slotId: slot.slotId }));
      continue;
    }
    if (
      entrySlotIdV1(assertions) !== slot.slotId ||
      entrySlotIdV1(sourceSites) !== slot.slotId ||
      entrySlotIdV1(sources) !== slot.slotId ||
      entrySlotIdV1(assertions) !== entrySlotIdV1(sourceSites) ||
      entrySlotIdV1(assertions) !== entrySlotIdV1(sources) ||
      !entryMatchesSampleSlotV1(assertions.state, slot.state) ||
      assertions.state !== sourceSites.state ||
      assertions.state !== sources.state
    ) {
      issues.push(Object.freeze({ code: "slot-alignment-mismatch", slotId: slot.slotId }));
    }
  }
  return Object.freeze(issues);
}

function nonEmptyAssemblyIssuesV1(
  issues: readonly AttemptSourceTreeAssemblyIssueV1[],
): readonly [
  AttemptSourceTreeAssemblyIssueV1,
  ...AttemptSourceTreeAssemblyIssueV1[],
] {
  const [first, ...rest] = issues;
  if (first === undefined) {
    throw new Error("Source tree assembly issue list was unexpectedly empty");
  }
  const nonEmpty: [
    AttemptSourceTreeAssemblyIssueV1,
    ...AttemptSourceTreeAssemblyIssueV1[],
  ] = [first, ...rest];
  return Object.freeze(nonEmpty);
}

/**
 * Purely combines already-projected values. It never retains a reader, opens a
 * blob, follows a path, or recalculates an Assertion result.
 */
export function assembleAttemptSourceTreeV1(
  input: AttemptSourceTreeAssemblyInputV1,
): AttemptSourceTreeAssemblyResultV1 {
  const issues = alignmentIssuesV1(input);
  if (issues.length > 0) {
    return Object.freeze({
      state: "input-invalid",
      issues: nonEmptyAssemblyIssuesV1(issues),
    });
  }

  const slots: AttemptSourceTreeSlotV1[] = [];
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
          tree: buildTreeV1({
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
