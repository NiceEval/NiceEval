/** One immutable app + RecordSnapshot generation owned by the CLI process. */
export interface ViewGeneration {
  readonly appRoot: string;
  readonly snapshotPath: string;
  readonly snapshotByteLength: number;
  readonly contentHash: string;
  readonly sourceCutoffIdentity: string;
}

export function makeViewGeneration(input: ViewGeneration): ViewGeneration {
  return Object.freeze({ ...input });
}
