export {
  ERROR_ASSISTANCE_OVERFLOW_KEY,
  MAX_ERROR_ASSISTANCE_GROUPS,
  MAX_ERROR_ASSISTANCE_AFFECTED,
  MAX_ERROR_ASSISTANCE_SOURCES,
  appendErrorAssistanceAffected,
  errorDiagnosticGroupKey,
  mergeErrorAssistanceData,
  readErrorAssistanceData,
  toFeedbackDiagnostic,
} from "./diagnostic.ts";
export {
  MigrationRequiredError,
  collectMigrationOccurrences,
  collectMigrationRequiredErrors,
  isMigrationRequiredError,
  loadInstalledPackageVersion,
  loadMigrationGuide,
  type MigrationGuideLoadResult,
} from "./migration.ts";
export { captureMigrationSource } from "./source.ts";
export {
  renderAssistedDiagnosticDetails,
  renderErrorSource,
  renderMigrationAssistance,
  renderMigrationRequiredError,
} from "./render.ts";
export { ownErrorCode, sanitizeErrorText, summarizeUnknownError } from "./unknown.ts";
export type {
  ErrorAssistanceData,
  ErrorAffectedAttempt,
  ErrorDiagnostic,
  ErrorFeedbackDiagnostic,
  ErrorSource,
  MigrationGuide,
  MigrationOccurrence,
} from "./types.ts";
