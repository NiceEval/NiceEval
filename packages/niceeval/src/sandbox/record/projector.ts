import type { SandboxAttachmentPayload } from "./model.ts";

/** A detached transient view; Sandbox assignment is not a Record projection. */
export type SandboxView = SandboxAttachmentPayload;

export function projectSandboxCapture(value: SandboxAttachmentPayload): SandboxView {
  return value.state === "not-used"
    ? Object.freeze({ state: "not-used" as const })
    : Object.freeze({
        state: "assigned" as const,
        provider: value.provider,
        sandboxId: value.sandboxId,
        reuse: value.reuse.kind === "fresh"
          ? Object.freeze({ kind: "fresh" as const })
          : Object.freeze({
              kind: "pooled" as const,
              sandbox: value.reuse.sandbox,
              ordinal: value.reuse.ordinal,
            }),
      });
}
