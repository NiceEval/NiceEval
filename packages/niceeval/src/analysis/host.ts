import type { Effect, Scope } from "effect";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import type {
  RecordReadSession,
  RecordSelection,
} from "../record/host/types.ts";
import { openSample as openScopedSample } from "../sample/capability.ts";
import type { AnalysisSelectionRequest, Sample } from "./contracts.ts";

/**
 * Public, supported high-level Host composition surface. A caller first uses
 * Record Host to open one scoped reader and choose a closed `RecordSelection`,
 * then this SDK issues the non-constructible Sample capability. Analysis and
 * Report authors use their author APIs and never receive that Record reader.
 */
export interface AnalysisHostSDK {
  readonly openSample: (input: {
    readonly reader: RecordReadSession;
    readonly selection: RecordSelection;
    /** Original policy input; RecordSelection alone cannot reconstruct it. */
    readonly selectionRequest: AnalysisSelectionRequest;
  }) => Effect.Effect<Sample, RecordReaderReadError, Scope.Scope>;
}

export const analysisHost: AnalysisHostSDK = Object.freeze({
  openSample: openScopedSample,
});
