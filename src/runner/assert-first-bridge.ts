/**
 * The Promise-shaped parts of the existing Attempt body (agent setup, sandbox
 * work, trace collection) need a narrow hand-off to the Effect-owned authoring
 * runtime. This bridge only coordinates ownership; it never runs an Effect.
 */

import type { Effect } from "effect";

import type {
  AssertionStopErrorV1,
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

/** A request from the Promise-shaped Attempt body into its owning Effect Scope. */
export interface AttemptEffectRequestV1 {
  readonly kind: "assertion" | "operation";
  readonly effect: Effect.Effect<unknown, unknown, never>;
}

/** One `orStop()` barrier handed from ordinary author Promise code to the Attempt Effect. */
export interface AssertionExecutionRequestV1 extends AttemptEffectRequestV1 {
  readonly kind: "assertion";
  readonly effect: Effect.Effect<unknown, AssertionStopErrorV1, never>;
}

export type AttemptEffectCompletionV1 =
  | { readonly _tag: "succeeded"; readonly value: unknown }
  | { readonly _tag: "failed"; readonly error: unknown };

export type AssertionExecutionCompletionV1 = AttemptEffectCompletionV1;

export interface AssertFirstAttemptBridgeV1<Context> {
  offerContext(context: Context): void;
  failBeforeContext(error: unknown): void;
  awaitContext(signal: AbortSignal): Promise<Context>;
  completeAuthor(completion: AttemptAuthorCompletionV1): void;
  awaitAuthor(signal: AbortSignal): Promise<AttemptAuthorCompletionV1>;
  requestAssertion<Value>(
    effect: Effect.Effect<Value, AssertionStopErrorV1, never>,
  ): Promise<Value>;
  /** Executes an internal body operation in the existing Attempt Effect Scope. */
  requestEffect<Value, Error>(
    effect: Effect.Effect<Value, Error, never>,
  ): Promise<Value>;
  awaitEffectRequest(signal: AbortSignal): Promise<AttemptEffectRequestV1>;
  completeEffectRequest(
    request: AttemptEffectRequestV1,
    completion: AttemptEffectCompletionV1,
  ): void;
  /** Rejects only `orStop()` barriers after authoring has closed. */
  closeAssertionRequests(error: unknown): void;
  /** Rejects every queued / in-flight bridge request during Scope release. */
  closeEffectRequests(error: unknown): void;
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

function rejected<Value>(error: unknown): Promise<Value> {
  const promise = Promise.reject(error) as Promise<Value>;
  void promise.catch(() => undefined);
  return promise;
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
  const effectRequests: AttemptEffectRequestV1[] = [];
  const effectResponses = new Map<AttemptEffectRequestV1, Deferred<unknown>>();
  let effectWaiter: Deferred<void> | undefined;
  let assertionRequestsClosed: unknown | undefined;
  let effectRequestsClosed: unknown | undefined;
  let contextOffered = false;
  let authorCompleted = false;
  let requestedSeal: AssertionSealRequestV1 | undefined;
  let sealCompleted = false;

  const enqueueEffect = <Value, Error>(
    effect: Effect.Effect<Value, Error, never>,
    kind: AttemptEffectRequestV1["kind"],
  ): Promise<Value> => {
    if (effectRequestsClosed !== undefined) {
      return rejected<Value>(effectRequestsClosed);
    }
    const response = deferred<unknown>();
    const request: AttemptEffectRequestV1 = Object.freeze({ kind, effect });
    effectResponses.set(request, response);
    effectRequests.push(request);
    const waiter = effectWaiter;
    effectWaiter = undefined;
    waiter?.resolve();
    return response.promise as Promise<Value>;
  };

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
    requestAssertion<Value>(effect: Effect.Effect<Value, AssertionStopErrorV1, never>) {
      if (assertionRequestsClosed !== undefined) {
        return rejected<Value>(assertionRequestsClosed);
      }
      return enqueueEffect(effect, "assertion");
    },
    requestEffect<Value, Error>(effect: Effect.Effect<Value, Error, never>) {
      return enqueueEffect(effect, "operation");
    },
    async awaitEffectRequest(signal: AbortSignal) {
      if (effectRequests.length > 0) return effectRequests.shift()!;
      if (effectRequestsClosed !== undefined) {
        throw effectRequestsClosed;
      }
      if (effectWaiter !== undefined) {
        throw new Error("Assert-first Attempt has more than one Effect request waiter");
      }
      const waiter = deferred<void>();
      effectWaiter = waiter;
      try {
        await awaitWithAbort(waiter.promise, signal);
      } finally {
        if (effectWaiter === waiter) effectWaiter = undefined;
      }
      if (effectRequests.length > 0) return effectRequests.shift()!;
      if (effectRequestsClosed !== undefined) throw effectRequestsClosed;
      throw new Error("Assert-first Effect request wakeup had no request");
    },
    completeEffectRequest(request, completion) {
      const response = effectResponses.get(request);
      if (response === undefined) return;
      effectResponses.delete(request);
      if (completion._tag === "succeeded") {
        response.resolve(completion.value);
      } else {
        response.reject(completion.error);
      }
    },
    closeAssertionRequests(error) {
      if (assertionRequestsClosed !== undefined) return;
      assertionRequestsClosed = error;
      const pending = effectRequests.filter((request) => request.kind === "assertion");
      for (const request of pending) {
        const index = effectRequests.indexOf(request);
        if (index >= 0) effectRequests.splice(index, 1);
        const response = effectResponses.get(request);
        effectResponses.delete(request);
        response?.reject(error);
      }
      for (const [request, response] of effectResponses) {
        if (request.kind !== "assertion") continue;
        effectResponses.delete(request);
        response.reject(error);
      }
    },
    closeEffectRequests(error) {
      if (effectRequestsClosed !== undefined) return;
      effectRequestsClosed = error;
      effectRequests.length = 0;
      const waiter = effectWaiter;
      effectWaiter = undefined;
      waiter?.reject(error);
      for (const response of effectResponses.values()) response.reject(error);
      effectResponses.clear();
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
