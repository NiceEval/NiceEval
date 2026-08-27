import type {
  RecordAttachmentOwner,
  RecordAttachmentBytePointer,
  RecordAttachmentContentPointer,
} from "./core.ts";

export const RECORD_ATTACHMENT_FORMAT = "niceeval.record-attachment" as const;

/** Core-private durable commit record. Logical family values never contain it. */
export interface DurableRecordAttachmentEnvelope {
  readonly format: typeof RECORD_ATTACHMENT_FORMAT;
  readonly ownerKind: RecordAttachmentOwner;
  readonly family: string;
  readonly revision: number;
  readonly payload: RecordAttachmentBytePointer;
  readonly contents: readonly RecordAttachmentContentPointer[];
  readonly references: readonly {
    readonly owner: RecordAttachmentOwner;
    readonly family: string;
  }[];
}
