/** Creation provenance is runtime metadata, never a provider plan or cache input. */
export interface SandboxCreationProvenance {
  readonly attemptId: string | undefined;
  readonly evalId: string | undefined;
  readonly sandboxLabels: "run-only" | undefined;
}

export function sandboxCreationLabels(provenance: SandboxCreationProvenance): Record<string, string> {
  if (provenance.sandboxLabels === "run-only" || provenance.attemptId === undefined) return {};
  return {
    "niceeval.created_for_attempt": provenance.attemptId,
    ...(provenance.evalId === undefined ? {} : { "niceeval.created_for_eval": provenance.evalId }),
  };
}
