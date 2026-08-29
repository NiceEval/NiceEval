/** One immutable app + pinned Record generation owned by the CLI process. */
export interface ViewGeneration {
  readonly appRoot: string;
  readonly recordPath: string;
  readonly recordByteLength: number;
  readonly contentHash: string;
  readonly sourceCutoffIdentity: string;
}

export function makeViewGeneration(input: ViewGeneration): ViewGeneration {
  return Object.freeze({ ...input });
}
