import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { experimentPresentationRecordAttachment } from "./definition.ts";

export const experimentPresentationRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: experimentPresentationRecordAttachment,
});
