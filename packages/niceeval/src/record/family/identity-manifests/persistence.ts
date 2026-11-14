import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { identityManifestsRecordAttachment } from "./definition.ts";
export const identityManifestsRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({ attachment: identityManifestsRecordAttachment, });
