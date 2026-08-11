/**
 * Retired with the legacy Record/Fact report component runtime.
 *
 * Current Report tests construct an AnalysisSampleHandle through the current
 * reader and exercise `executeReport`; a synthetic Record graph would forge
 * the capability boundary the production host relies on. This intentionally
 * exports no fixture constructors.
 */
export const legacyReportScopeHarnessRetired = true;
