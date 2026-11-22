/** Shared bounds for runtime snapshots and their durable Assertion encoding. */
export const assertionRuntimeLimits = Object.freeze({
  displayCodePoints: 256,
  jsonDepth: 8,
  jsonObjectKeys: 64,
  jsonArrayItems: 256,
  stringBytes: 8 * 1_024,
  diagnosticNodes: 64,
  collectionDiagnosticCandidates: 8,
});
