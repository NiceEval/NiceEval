/** Shared bounds for runtime snapshots and their durable Assertion encoding. */
export const assertionRuntimeLimits = Object.freeze({
  entries: 4_096,
  groupDepth: 16,
  displayCodePoints: 256,
  jsonDepth: 8,
  jsonObjectKeys: 64,
  jsonArrayItems: 256,
  stringBytes: 8 * 1_024,
  diagnosticDepth: 2,
  diagnosticNodes: 64,
  diagnosticBytes: 64 * 1_024,
  collectionDiagnosticCandidates: 8,
});
