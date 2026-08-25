import type { RecordAttachmentMaintenanceFacet } from "../../../definition/attachment.ts";

import { assertionsV1Maintenance } from "./1-to-2.ts";
import { assertionsV2Maintenance } from "./2-to-3.ts";

/** The package-private adjacent Assertions migration chain. */
export const assertionsMaintenance: RecordAttachmentMaintenanceFacet = Object.freeze({
  historicalCodecs: Object.freeze([
    ...assertionsV1Maintenance.historicalCodecs,
    ...assertionsV2Maintenance.historicalCodecs,
  ]),
  adjacentMigrations: Object.freeze([
    ...assertionsV1Maintenance.adjacentMigrations,
    ...assertionsV2Maintenance.adjacentMigrations,
  ]),
});
