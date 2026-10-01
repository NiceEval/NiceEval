import type { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";

/** Services supplied once by the outer Node/application composition edge. */
export type ExperimentHostRequirements =
  | import("../../record/platform/services.ts").RecordFileSystem
  | import("../../record/platform/services.ts").RecordEntropy
  | import("../../coordination/record-leases.ts").RecordCoordination
  | ProjectStateDatabase;

