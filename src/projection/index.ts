export {
  attemptOriginRunProjection,
  attemptSlotProjection,
  defineRecordAttachmentProjector,
  selectedRunProjection,
} from "./projector.ts";
export type {
  RecordAttachmentProjector,
  RecordProjection,
} from "./projector.ts";
export { projectAnalysisSample } from "./runtime.ts";
export type { ProjectedRecordAttachmentResult } from "./attachment-result.ts";
export type { ProjectionCoverage } from "./coverage.ts";
export type {
  AttemptAttachmentOwner,
  AttemptOriginRunProjectedEntry,
  AttemptSlotProjectedEntry,
  ProjectedEntry,
  ProjectedSample,
  ProjectedSlotEntry,
  ProjectionAccess,
  ProjectionLimitError,
  RunAttachmentOwner,
  SelectedRunProjectedEntry,
} from "./model.ts";

export {
  assertionSourceSitesProjector,
  assertionsProjector,
  sourcesProjector,
} from "../sources/projector.ts";
export { assembleAttemptSourceTree } from "../sources/assemble.ts";
export type {
  AssertionSourceDisplay,
  AssertionSourceEntry,
  AssertionSourceEntryValue,
  AssertionSourceFileFrame,
  AssertionSourceFrame,
  AssertionSourceOccurrence,
  AssertionSourcePackageFrame,
  AssertionSourceRole,
  AssertionSourceSendOccurrence,
  AssertionSourceSendSite,
  AssertionSourceSendStatus,
  AssertionSourceSite,
  AssertionSourceSitesEntry,
  AssertionSourceSitesProjection,
  AssertionSourceTrace,
  AssertionSourceResult,
  AssertionSourceScore,
  AssertionsSourceProjection,
  AttemptSourceAnnotation,
  AttemptSourceAssertionsAttachment,
  AttemptSourceEntryUnmapped,
  AttemptSourceFileNode,
  AttemptSourcePackageNode,
  AttemptSourceSitesAttachment,
  AttemptSourceTreeAssemblyInput,
  AttemptSourceTreeAssemblyIssue,
  AttemptSourceTreeAssemblyResult,
  AttemptSourceTreeEntry,
  AttemptSourceTreeLine,
  AttemptSourceTreeNode,
  AttemptSourceTreeSample,
  AttemptSourceTreeSlot,
  AttemptSourceTreeSummary,
  AttemptSourceTree,
  AttemptSourceUnavailableAttachment,
  AttemptSourceUnmappedReason,
  AttemptSourceUnmapped,
  AttemptSourceUnownedUnmapped,
  AttemptSourcesAttachment,
  SourceCoordinate,
  SourceFileItemRef,
  SourceFileProjection,
  SourcePackageItemRef,
  SourcePackageProjection,
  SourcesProjection,
} from "../sources/projection-model.ts";
export type {
  Sha256Digest,
  SourceFileItemId,
  SourcePackageItemId,
} from "../sources/identity.ts";
