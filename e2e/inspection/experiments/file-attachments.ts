import { defineExperiment } from "niceeval";
import { fileAttachmentAdapter } from "../adapters/file-attachments.ts";
export default defineExperiment({ adapter: fileAttachmentAdapter, evals: ["file-attachments"] });
