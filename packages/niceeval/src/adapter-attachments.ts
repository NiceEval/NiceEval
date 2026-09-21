/** Attempt-owned bytes copied synchronously by `ctx.attach`. Names are labels, not paths. */
export interface AdapterAttachmentInput {
  readonly name: string;
  readonly mediaType: string;
  readonly body: Uint8Array | string;
}

/** Acceptance receipt. Durable publication happens when the Attempt is published. */
export interface AdapterAttachmentReceipt {
  readonly artifactId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
}
