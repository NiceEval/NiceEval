import {
  defineRecordAttachmentProjector,
  type RecordAttachmentProjector,
} from "../../projection/projector.ts";
import type { RecordAttachmentValue } from "../../record/attachment/index.ts";
import { sandboxAttachmentFamily } from "./attachment.ts";
import type { SandboxAttachmentPayloadV1 } from "./model.ts";

/** A durable execution fact projected without Record schema-version terminology. */
export type SandboxView =
  | { readonly state: "not-used" }
  | {
      readonly state: "assigned";
      readonly provider: string;
      readonly sandboxId: string;
      readonly reuse:
        | { readonly kind: "fresh" }
        | {
            readonly kind: "pooled";
            readonly sandbox: number;
            readonly ordinal: number;
          };
    };

function projectSandboxAttachment(
  value: RecordAttachmentValue<SandboxAttachmentPayloadV1>,
): SandboxView {
  const payload = value.payload;
  if (payload.state === "not-used") {
    return Object.freeze({ state: "not-used" as const });
  }

  return Object.freeze({
    state: "assigned" as const,
    provider: payload.provider,
    sandboxId: payload.sandboxId,
    reuse:
      payload.reuse.kind === "fresh"
        ? Object.freeze({ kind: "fresh" as const })
        : Object.freeze({
            kind: "pooled" as const,
            sandbox: payload.reuse.sandbox,
            ordinal: payload.reuse.ordinal,
          }),
  });
}

/** The public semantic projection for the Attempt-owned Sandbox family. */
export const sandboxProjector: RecordAttachmentProjector<"attempt", SandboxView> =
  defineRecordAttachmentProjector({
    attachment: sandboxAttachmentFamily,
    project: projectSandboxAttachment,
  });
