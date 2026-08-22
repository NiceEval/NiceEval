// Internal home of the scoped Sample capability.  Selection is issued by
// RecordHostSDK and is intentionally not a portable or compatibility API.
export {
  decodeSampleSnapshot,
  decodeSampleSnapshotEither,
  encodeSampleSnapshot,
  narrowSample,
  openSample,
} from "./capability.ts";

export type {
  SampleClosedError,
  Sample,
  SampleCoverage,
  SampleSelector,
  SampleSnapshot,
  SampleSnapshotCodecError,
} from "../analysis/contracts.ts";
