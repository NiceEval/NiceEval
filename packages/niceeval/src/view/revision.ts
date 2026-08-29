import { randomBytes } from "node:crypto";

/** One immutable app + pinned Record generation owned by the CLI process. */
export interface ViewGeneration {
  readonly generationId: string;
  readonly appRoot: string;
  readonly recordPath: string;
  readonly recordByteLength: number;
  readonly contentHash: string;
  readonly sourceCutoffIdentity: string;
  /** Idempotently releases the private imported Record generation. */
  readonly retire: () => Promise<void>;
}

export function makeViewGeneration(input: ViewGeneration): ViewGeneration {
  return Object.freeze({ ...input });
}

export function newViewGenerationId(): string {
  return randomBytes(24).toString("base64url");
}
