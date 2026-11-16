import * as Data from "effect/Data";
import { CurrentTargetUnavailable } from "../../experiment/host/current.ts";
import { normalizeExternalCause, type ExternalCause } from "../../shared/external-cause.ts";
import { isInspectionCodecError, type InspectionCodecError } from "../codec.ts";
import { InspectionOperationError } from "../select.ts";
import { InspectionIntegrityError, InspectionSourceError } from "../source.ts";

export class InspectionCodecFailure extends Data.TaggedError("InspectionCodecFailure")<{
  readonly error: InspectionCodecError;
}> {}

export type InspectionCliCause =
  | CurrentTargetUnavailable
  | InspectionOperationError
  | InspectionIntegrityError
  | InspectionSourceError
  | InspectionCodecFailure
  | ExternalCause;

/** Decode failures at the thrown-value boundary; renderers only receive this named union. */
export function normalizeInspectionCliCause(cause: unknown): InspectionCliCause {
  if (cause instanceof CurrentTargetUnavailable) return cause;
  if (cause instanceof InspectionOperationError) return cause;
  if (cause instanceof InspectionIntegrityError) return cause;
  if (cause instanceof InspectionSourceError) return cause;
  if (cause instanceof InspectionCodecFailure) return cause;
  if (isInspectionCodecError(cause)) return new InspectionCodecFailure({ error: cause });
  return normalizeExternalCause(cause);
}
