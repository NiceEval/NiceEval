/** Attempt-owned content copied by `ctx.attach`. Names are labels, not paths. */
export interface AdapterAttachmentInput {
  readonly name: string;
  readonly mediaType: string;
  /**
   * Strings/arrays are copied before return. A stream is consumed once with
   * backpressure into Attempt-owned storage before the Promise resolves.
   * Chunks must be Uint8Array values of at most 1 MiB, stable until the next pull.
   * The producer must observe signal and release its own resources on cancellation.
   */
  readonly body: Uint8Array | string | {
    readonly stream: (signal: AbortSignal) => AsyncIterable<Uint8Array>;
  };
  /** Optional transfer cancellation. Cleanup may supply its independent signal. */
  readonly signal?: AbortSignal;
}

/** Acceptance receipt. Durable publication happens when the Attempt is published. */
export interface AdapterAttachmentReceipt {
  readonly artifactId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
}
