import { Schema } from "effect";

import { createAssertionsRecordSchemas } from "../../../assertions/record/codec.ts";
import { AssertionMaterialSchema } from "./content.ts";
import { AssertionSourceSiteSchema } from "./reference.ts";

const assertionSchemas = createAssertionsRecordSchemas(
  AssertionMaterialSchema,
);

export const AssertionsEntriesSchema = assertionSchemas.entries;
export const AssertionSourceSitesSchema = Schema.Array(AssertionSourceSiteSchema);

/** Current logical Assertions fact. Durable revision belongs to persistence.ts. */
export const AssertionsAttachmentSchema = Schema.Struct({
  entries: AssertionsEntriesSchema,
  sourceSites: AssertionSourceSitesSchema,
}).pipe(Schema.encodeKeys({ entries: "entries-data", sourceSites: "source-sites-data" }));

export type AssertionsAttachment = typeof AssertionsAttachmentSchema.Type;
