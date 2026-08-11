/**
 * The Promise-shaped parts of the existing Attempt body (agent setup, sandbox
 * work, trace collection) need a narrow hand-off to the Effect-owned authoring
 * runtime. This bridge only coordinates ownership; it never runs an Effect.
 */

import type {
  AssertionSealOptionsV1,
  AssertionsRuntimeV1,
} from "../assertions/api.ts";
import type { SealedAttemptAssertionsV1 } from "./assertions.ts";

export type AttemptAuthorCompletionV1 =
  | { readonly _tag: "succeeded" }
  | { readonly _tag: "stopped" }
  | { readonly _tag: "failed"; readonly error: unknown }
  | { readonly _tag: "defect"; readonly cause: unknown };

export interface AssertionSealRequestV1 {
  readonly runtime: AssertionsRuntimeV1<"pass" | "score">;
  readonly options: AssertionSealOptionsV1;
}

export interface AssertFirstAttemptBridgeV1<Context> {
  offerContext(context: Context): void;
  failBeforeContext(error: unknown): void;
  awaitContext(signal: AbortSignal): Promise<Context>;
  completeAuthor(completion: AttemptAuthorCompletionV1): void;
  awaitAuthor(signal: AbortSignal): Promise<AttemptAuthorCompletionV1>;
  requestSeal(
    request: AssertionSealRequestV1,
    signal: AbortSignal,
  ): Promise<SealedAttemptAssertionsV1>;
  awaitSealRequest(signal: AbortSignal): Promise<AssertionSealRequestV1>;
  completeSeal(sealed: SealedAttemptAssertionsV1): void;
  failSeal(error: unknown): void;
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // A body can fail before its peer begins waiting. Mark the deferred as
  // observed here; callers still receive the original rejection when awaited.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function awaitWithAbort<Value>(
  promise: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Attempt interrupted"));
  }
  return new Promise<Value>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("Attempt interrupted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * One bridge exists for exactly one Attempt. Its one-shot checks make an
 * accidental second author runtime or second seal an explicit invariant
 * violation instead of silently changing declaration order.
 */
export function createAssertFirstAttemptBridgeV1<Context>():
  AssertFirstAttemptBridgeV1<Context> {
  const context = deferred<Context>();
  const author = deferred<AttemptAuthorCompletionV1>();
  const sealRequest = deferred<AssertionSealRequestV1>();
  const sealed = deferred<SealedAttemptAssertionsV1>();
  let contextOffered = false;
  let authorCompleted = false;
  let requestedSeal: AssertionSealRequestV1 | undefined;
  let sealCompleted = false;

  const bridge: AssertFirstAttemptBridgeV1<Context> = {
    offerContext(value: Context) {
      if (contextOffered) throw new Error("Assert-first Context was offered twice");
      contextOffered = true;
      context.resolve(value);
    },
    failBeforeContext(error: unknown) {
      if (contextOffered) return;
      contextOffered = true;
      context.reject(error);
    },
    awaitContext(signal: AbortSignal) {
      return awaitWithAbort(context.promise, signal);
    },
    completeAuthor(completion: AttemptAuthorCompletionV1) {
      if (authorCompleted) throw new Error("Assert-first author completion was delivered twice");
      authorCompleted = true;
      author.resolve(completion);
    },
    awaitAuthor(signal: AbortSignal) {
      return awaitWithAbort(author.promise, signal);
    },
    requestSeal(request: AssertionSealRequestV1, signal: AbortSignal) {
      if (requestedSeal === undefined) {
        requestedSeal = request;
        sealRequest.resolve(request);
      } else if (requestedSeal.runtime !== request.runtime) {
        return Promise.reject(new Error("Assert-first Attempt requested a second runtime seal"));
      }
      return awaitWithAbort(sealed.promise, signal);
    },
    awaitSealRequest(signal: AbortSignal) {
      return awaitWithAbort(sealRequest.promise, signal);
    },
    completeSeal(value: SealedAttemptAssertionsV1) {
      if (sealCompleted) throw new Error("Assert-first Attempt seal was completed twice");
      sealCompleted = true;
      sealed.resolve(value);
    },
    failSeal(error: unknown) {
      if (sealCompleted) return;
      sealCompleted = true;
      sealed.reject(error);
    },
  };
  return Object.freeze(bridge);
}
