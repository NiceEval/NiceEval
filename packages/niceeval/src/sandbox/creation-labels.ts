/** Creation provenance is runtime metadata, never a provider plan or cache input. */
export interface SandboxCreationProvenance {
  readonly attemptId?: string;
  readonly evalId?: string;
  readonly sandboxLabels?: "run-only";
}

export function sandboxCreationLabels(provenance: SandboxCreationProvenance): Record<string, string> {
  if (provenance.sandboxLabels === "run-only" || provenance.attemptId === undefined) return {};
  return {
    "niceeval.created_for_attempt": provenance.attemptId,
    ...(provenance.evalId === undefined ? {} : { "niceeval.created_for_eval": provenance.evalId }),
  };
}
