import type { StateManifest } from "../state/protocol.ts";

export interface SandboxStateCapture {
  readonly manifest: StateManifest;
  readonly chunks: AsyncIterable<Uint8Array>;
}

/** Provider-only file authority, with layout and writer-quiescence proof bound to one instance. */
export interface SandboxStateFiles {
  readonly resolve: (paths: readonly string[], signal: AbortSignal) => Promise<StateManifest>;
  readonly restore: (manifest: StateManifest, chunks: AsyncIterable<Uint8Array>, signal: AbortSignal) => Promise<void>;
  readonly capture: (manifest: StateManifest, signal: AbortSignal) => Promise<SandboxStateCapture>;
  readonly withQuiescence: (signal: AbortSignal, capture: () => Promise<void>) => Promise<boolean>;
}

export class StateFileError extends Error {
  readonly code: "state-root-preexisting" | "state-path-conflict" | "state-path-in-workdir";

  constructor(code: StateFileError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export class StateRootPreexistingError extends StateFileError {
  constructor(path: string) {
    super("state-root-preexisting", `The State root ${JSON.stringify(path)} already exists in the new Sandbox.`);
  }
}

export class StateQuiescenceError extends Error {}
