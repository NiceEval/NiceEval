import type { SandboxAttachmentPayload } from "./model.ts";

/** A detached transient view; Sandbox assignment is not a Record projection. */
export type SandboxView = SandboxAttachmentPayload;

export function projectSandboxCapture(value: SandboxAttachmentPayload): SandboxView {
  return value.state === "not-used"
    ? { state: "not-used" as const }
    : {
        state: "assigned" as const,
        provider: value.provider,
        sandboxId: value.sandboxId,
        reuse:
          value.reuse.kind === "fresh"
            ? { kind: "fresh" as const }
            : {
                kind: "pooled" as const,
                sandbox: value.reuse.sandbox,
                ordinal: value.reuse.ordinal,
              },
      };
}
