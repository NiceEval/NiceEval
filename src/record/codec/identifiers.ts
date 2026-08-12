import { Schema } from "effect";
import {
  ATTEMPT_ID_BRAND,
  isPortableSegment,
  isRecordAttachmentName,
  isRecordAttachmentSchemaId,
  isRecordFormatId,
  isUtcMillis,
  RECORD_ATTACHMENT_NAME_BRAND,
  RECORD_ATTACHMENT_SCHEMA_ID_BRAND,
  RECORD_FORMAT_ID_BRAND,
  RECORD_FORMAT_V1,
  RECORD_ID_BRAND,
  RUN_ID_BRAND,
  SLOT_ID_BRAND,
  UTC_MILLIS_BRAND,
  type AttemptId,
  type RecordAttachmentName,
  type RecordAttachmentSchemaId,
  type RecordFormatId,
  type RecordFormatV1,
  type RecordId,
  type RunId,
  type SlotId,
  type UtcMillis,
} from "../model/identifiers.ts";

const PortableSegmentTextSchema = Schema.String.pipe(
  Schema.filter(isPortableSegment, {
    identifier: "RecordPortableSegment",
    description:
      "an ASCII portable file-name segment without path separators or reserved device names",
  }),
);

export const RecordIdSchema: Schema.Schema<RecordId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(RECORD_ID_BRAND));

export const RunIdSchema: Schema.Schema<RunId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(RUN_ID_BRAND));

export const SlotIdSchema: Schema.Schema<SlotId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(SLOT_ID_BRAND));

export const AttemptIdSchema: Schema.Schema<AttemptId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(ATTEMPT_ID_BRAND));

export const UtcMillisSchema: Schema.Schema<UtcMillis, number> =
  Schema.Number.pipe(
    Schema.filter(isUtcMillis, {
      identifier: "UtcMillis",
      description: "a non-negative JSON-safe Unix-epoch millisecond value",
    }),
    Schema.brand(UTC_MILLIS_BRAND),
  );

export const RecordAttachmentNameSchema: Schema.Schema<
  RecordAttachmentName,
  string
> = Schema.String.pipe(
  Schema.filter(isRecordAttachmentName, {
    identifier: "RecordAttachmentName",
    description: "a lowercase reverse-domain portable Attachment name",
  }),
  Schema.brand(RECORD_ATTACHMENT_NAME_BRAND),
);

export const RecordAttachmentSchemaIdSchema: Schema.Schema<
  RecordAttachmentSchemaId,
  string
> = Schema.String.pipe(
  Schema.filter(isRecordAttachmentSchemaId, {
    identifier: "RecordAttachmentSchemaId",
    description: "a RecordAttachment name followed by /vN",
  }),
  Schema.brand(RECORD_ATTACHMENT_SCHEMA_ID_BRAND),
);

export const RecordFormatIdSchema: Schema.Schema<RecordFormatId, string> =
  Schema.String.pipe(
    Schema.filter(isRecordFormatId, {
      identifier: "RecordFormatId",
      description: "a niceeval.record/vN format identity",
    }),
    Schema.brand(RECORD_FORMAT_ID_BRAND),
  );

export const RecordFormatV1Schema: Schema.Schema<
  RecordFormatV1,
  typeof RECORD_FORMAT_V1
> = Schema.Literal(RECORD_FORMAT_V1).pipe(Schema.brand(RECORD_FORMAT_ID_BRAND));
