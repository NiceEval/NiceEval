// Current Record v1 capability facade. Legacy Graph/Store, fact-record,
// locator, and snapshot APIs deliberately remain internal while the Runner is
// still converging; beta consumers get only the v1 durable Record contract.

export * from "./attachment/index.ts";
export * from "./codec/index.ts";
export * from "./errors/index.ts";
export * from "./maintenance/index.ts";
export * from "./model/index.ts";
export * from "./platform/index.ts";
export * from "./reader/index.ts";
export * from "./writer/index.ts";

// Migration's sentinel type has the same user-visible code as reader open's
// `RecordMigrationInterruptedState`; the reader form above is the canonical
// facade export. The remaining migration capability surface is explicit here
// to prevent a wildcard conflict while keeping every current operation public.
export {
  areAdjacentRecordFormats,
  assertRecordMigrationNotInterrupted,
  CurrentRecordCoreMigrationRegistry,
  makeCurrentRecordMigrationRegistry,
  makeRecordCoreMigrationPlan,
  makeRecordCoreMigrationRegistry,
  migrateRecord,
  planRecordMigration,
  recordAttachmentMigrationStepFailed,
  recordCoreMigrationPlanInvalid,
  recordCoreMigrationRegistryInvalid,
  recordCoreMigrationRegistryIssue,
  recordCoreMigrationStepFailed,
  recordFormatMajor,
  recordMigrationAuthorizationInvalid,
  recordMigrationConfirmationRequired,
  recordMigrationPlanStale,
  RecordCoreMigrationRegistry,
  RecordMigrationRegistry,
} from "./migration/index.ts";

export { RecordCoreMigrationPlan } from "./migration/plan.ts";

export type {
  RecordAttachmentMigrationStepFailed,
  RecordCoreMigrationEdge,
  RecordCoreMigrationPlanInvalid,
  RecordCoreMigrationPlanIssue,
  RecordCoreMigrationPlanStep,
  RecordCoreMigrationPlanSummary,
  RecordCoreMigrationRegistryInput,
  RecordCoreMigrationRegistryInvalid,
  RecordCoreMigrationRegistryIssue,
  RecordCoreMigrationRegistryIssueCode,
  RecordCoreMigrationResolution,
  RecordCoreMigrationStepFailed,
  RecordMigrationAttachmentPlanState,
  RecordMigrationAttachmentPlanSummary,
  RecordMigrationAuthorization,
  RecordMigrationAuthorizationInvalid,
  RecordMigrationConfirmationRequired,
  RecordMigrationError,
  RecordMigrationPlanError,
  RecordMigrationPlanStale,
  RecordMigrationPlanSummary,
  RecordMigrationReceipt,
  RecordMigrationRegistryService,
} from "./migration/index.ts";
