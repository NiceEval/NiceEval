import type { RecordAttachmentMaintenanceFacet } from "../../../definition/attachment.ts";

import { agentTurnsV1Maintenance } from "./1-to-2.ts";

export const agentTurnsMaintenance: RecordAttachmentMaintenanceFacet = Object.freeze({
  historicalCodecs: agentTurnsV1Maintenance.historicalCodecs,
  adjacentMigrations: agentTurnsV1Maintenance.adjacentMigrations,
});
