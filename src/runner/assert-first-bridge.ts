/**
 * The Promise-shaped parts of the existing Attempt body (agent setup, sandbox
 * work, trace collection) need a narrow hand-off to the Effect-owned authoring
 * runtime. The bridge is a scoped Effect resource: the Queue worker is the
 * only executor, and public Promise values are only facade adapters.
 */

import { Cause, Deferred, Effect, Exit, Queue, Scope } from "effect";

import type {
  AssertionStopErrorV1,
  AssertionSealOptionsV1,
  AssertionsRuntimeV1,
} from "../assertions/api.ts";
import { AssertionAuthoringClosedErrorV1 } from "../assertions/api.ts";
import type { RecordAttachmentWrite } from "../record/attachment/index.ts";
import type { SealedAttemptAssertionsV1 } from "./assertions.ts";

export type AttemptAuthorCompletionV1 =
  | { readonly _tag: "succeeded" }
  | { readonly _tag: "stopped" }
  | { readonly _tag: "failed"; readonly error: unknown }
  | { readonly _tag: "defect"; readonly cause: unknown };

export interface AssertionSealRequestV1 {
  readonly runtime: AssertionsRuntimeV1<"pass" | "score">;
  readonly options: AssertionSealOptionsV1;
  /** Post-run evidence writes built from the same frozen semantic document as evaluators. */
  readonly additionalAttemptWrites?: readonly RecordAttachmentWrite<"attempt", never, never>[];
}

type AttemptEffectRequestKindV1 = "assertion" | "operation";

/**
 * A request from the Promise-shaped Attempt body into its owning Effect Scope.
 * The resolver pair is deliberately the sole native-Promise state: it adapts
 * the public callback facade after the owner fiber has classified an Exit.
 */
interface AttemptEffectRequestV1 {
  readonly kind: AttemptEffectRequestKindV1;
  readonly effect: Effect.Effect<unknown, unknown, never>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

interface PromiseFacade<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (error: unknown) => void;
}

/** This is a facade adapter, not a bridge lifecycle primitive. */
function promiseFacade<Value>(): PromiseFacade<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // A detached author continuation may intentionally observe its failure
  // later. Keep Node from treating the named lifecycle rejection as unhandled.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export interface AssertFirstAttemptBridgeV1<Context> {
  /** The Promise body submits Context completion through the owner Queue. */
  offerContext(context: Context): Effect.Effect<void>;
  failBeforeContext(error: unknown): Effect.Effect<void>;
  awaitContext(): Effect.Effect<Context, unknown>;
  completeAuthor(completion: AttemptAuthorCompletionV1): Effect.Effect<void>;
  awaitAuthor(): Effect.Effect<AttemptAuthorCompletionV1, unknown>;
  requestAssertion<Value>(
    effect: Effect.Effect<Value, AssertionStopErrorV1, never>,
  ): Promise<Value>;
  /** Executes an internal body operation in the existing Attempt Effect Scope. */
  requestEffect<Value, Error>(
    effect: Effect.Effect<Value, Error, never>,
  ): Promise<Value>;
  /** Rejects only `orStop()` barriers after authoring has closed. */
  closeAssertionRequests(error: unknown): Effect.Effect<void>;
  /** Rejects every queued / in-flight bridge request during Scope release. */
  closeEffectRequests(error: unknown): Effect.Effect<void>;
  requestSeal(request: AssertionSealRequestV1): Effect.Effect<SealedAttemptAssertionsV1, unknown>;
  awaitSealRequest(): Effect.Effect<AssertionSealRequestV1, unknown>;
  completeSeal(sealed: SealedAttemptAssertionsV1): Effect.Effect<void>;
  failSeal(error: unknown): Effect.Effect<void>;
}

function completeRequest(
  request: AttemptEffectRequestV1,
  exit: Exit.Exit<unknown, unknown>,
  failureOverride?: unknown,
): Effect.Effect<void> {
  return Effect.sync(() => {
    if (failureOverride !== undefined) {
      request.reject(failureOverride);
    } else if (Exit.isSuccess(exit)) {
      request.resolve(exit.value);
    } else {
      // This is the sole Effect → Promise conversion. Until this boundary the
      // full Cause remains in the owner Effect tree.
      request.reject(failureOverride ?? Cause.squash(exit.cause));
    }
  });
}

function exactlyOnce(
  completed: Effect.Effect<boolean>,
  message: string,
): Effect.Effect<void> {
  return completed.pipe(
    Effect.flatMap((accepted) =>
      accepted ? Effect.void : Effect.die(new Error(message))),
    Effect.asVoid,
  );
}

/**
 * Creates exactly one scoped bridge for one Attempt. No method starts a
 * runtime: public Promise methods only offer work, and the scoped worker
 * performs every Effect, response, interruption and finalization transition.
 */
export function makeAssertFirstAttemptBridgeV1<Context>():
  Effect.Effect<AssertFirstAttemptBridgeV1<Context>, never, import("effect").Scope.Scope> {
  return Effect.gen(function* () {
    const context = yield* Deferred.make<Context, unknown>();
    const author = yield* Deferred.make<AttemptAuthorCompletionV1, unknown>();
    const sealRequest = yield* Deferred.make<AssertionSealRequestV1, unknown>();
    const sealed = yield* Deferred.make<SealedAttemptAssertionsV1, unknown>();
    const assertionRequestsClosed = yield* Deferred.make<never, unknown>();
    const effectRequestsClosed = yield* Deferred.make<never, unknown>();
    const requests = yield* Queue.unbounded<AttemptEffectRequestV1>();
    // Each taken request runs independently in this child Scope. The dispatcher
    // must never await a control barrier such as awaitAuthor(), otherwise an
    // author assertion queued behind it cannot make the barrier complete.
    const requestScope = yield* Scope.make();
    let terminalError: unknown | undefined;
    let assertionCloseError: unknown | undefined;

    const closeReason = (): unknown =>
      terminalError ?? new AssertionAuthoringClosedErrorV1("attempt-sealed");

    const closeEffectRequests = (error: unknown): Effect.Effect<void> =>
      Effect.suspend(() => {
        // This synchronous guard is intentionally the first close transition.
        // Promise callers can run between later queue operations, so they must
        // see a terminal outcome before any draining or shutdown can yield.
        if (terminalError !== undefined) return Effect.void;
        terminalError = error;
        return Deferred.fail(effectRequestsClosed, error).pipe(
          Effect.flatMap((firstClose) => {
            if (!firstClose) return Effect.void;
            return Effect.gen(function* () {
              // Wake every owner-side Deferred before removing pending work. The
              // worker races in-flight requests against this same close signal.
              yield* Deferred.fail(context, error);
              yield* Deferred.fail(author, error);
              yield* Deferred.fail(sealRequest, error);
              yield* Deferred.fail(sealed, error);
              yield* Deferred.fail(assertionRequestsClosed, error);
              // `terminalError` is already visible before this close. Every
              // in-flight child therefore settles its Promise facade by the
              // onExit path with the named terminal reason.
              yield* Scope.close(requestScope, Exit.fail(error));
              const pending = yield* Queue.takeAll(requests);
              yield* Effect.forEach(
                pending,
                (request) => completeRequest(request, Exit.fail(error)),
                { discard: true },
              );
              yield* Queue.shutdown(requests);
            });
          }),
        );
      });

    const awaitClose = (kind: AttemptEffectRequestKindV1) =>
      Effect.raceFirst(
        Deferred.await(effectRequestsClosed),
        kind === "assertion" ? Deferred.await(assertionRequestsClosed) : Effect.never,
      ).pipe(Effect.exit);

    const runRequest = (request: AttemptEffectRequestV1): Effect.Effect<void> => {
      const closureError = (): unknown | undefined =>
        terminalError ?? (request.kind === "assertion" ? assertionCloseError : undefined);
      return Effect.raceFirst(
        request.effect.pipe(Effect.exit),
        awaitClose(request.kind),
      ).pipe(
        Effect.flatMap((exit) => completeRequest(request, exit, closureError())),
        // Scope interruption can arrive while the Queue worker is running the
        // race. This finalizer is the in-flight counterpart to Queue.takeAll:
        // it settles the sole Promise facade even when the worker itself is
        // interrupted before its normal response continuation runs.
        Effect.onExit((workerExit) =>
          Exit.isFailure(workerExit)
            ? completeRequest(request, Exit.failCause(workerExit.cause), closureError())
            : Effect.void),
      );
    };

    const worker = Effect.forever(
      Queue.take(requests).pipe(
        Effect.flatMap((request) =>
          Effect.forkIn(runRequest(request), requestScope).pipe(Effect.asVoid)),
      ),
    ).pipe(
      Effect.catchAllCause((cause) =>
        Cause.isInterruptedOnly(cause)
          ? Effect.void
          : closeEffectRequests(Cause.squash(cause))),
    );
    yield* Effect.forkScoped(worker);

    const enqueue = <Value, Error>(
      effect: Effect.Effect<Value, Error, never>,
      kind: AttemptEffectRequestKindV1,
    ): Promise<Value> => {
      const facade = promiseFacade<Value>();
      if (terminalError !== undefined) {
        facade.reject(terminalError);
        return facade.promise;
      }
      if (kind === "assertion" && assertionCloseError !== undefined) {
        facade.reject(assertionCloseError);
        return facade.promise;
      }
      const request: AttemptEffectRequestV1 = {
        kind,
        effect,
        resolve: facade.resolve as (value: unknown) => void,
        reject: facade.reject,
      };
      if (!Queue.unsafeOffer(requests, request)) {
        // Once the Queue is shut down there is no owner fiber left to consume
        // this facade. Return its named terminal outcome without a second
        // lifecycle implementation.
        facade.reject(closeReason());
      }
      return facade.promise;
    };

    const bridge: AssertFirstAttemptBridgeV1<Context> = {
      offerContext(value) {
        return exactlyOnce(
          Deferred.succeed(context, value),
          "Assert-first Context was offered twice",
        );
      },
      failBeforeContext(error) {
        return Deferred.fail(context, error).pipe(Effect.asVoid);
      },
      awaitContext() {
        return Deferred.await(context);
      },
      completeAuthor(completion) {
        return exactlyOnce(
          Deferred.succeed(author, completion),
          "Assert-first author completion was delivered twice",
        );
      },
      awaitAuthor() {
        return Deferred.await(author);
      },
      requestAssertion(effect) {
        return enqueue(effect, "assertion");
      },
      requestEffect(effect) {
        return enqueue(effect, "operation");
      },
      closeAssertionRequests(error) {
        return Effect.suspend(() => {
          if (assertionCloseError !== undefined) return Effect.void;
          assertionCloseError = error;
          return Deferred.fail(assertionRequestsClosed, error).pipe(
            Effect.flatMap((firstClose) => {
              if (!firstClose) return Effect.void;
              return Effect.gen(function* () {
                const pending = yield* Queue.takeAll(requests);
                yield* Effect.forEach(
                  pending,
                  (request) =>
                    request.kind === "assertion"
                      ? completeRequest(request, Exit.fail(error))
                      : Queue.offer(requests, request).pipe(Effect.asVoid),
                  { discard: true },
                );
              });
            }),
          );
        });
      },
      closeEffectRequests,
      requestSeal(request) {
        return Effect.gen(function* () {
          const firstRequest = yield* Deferred.succeed(sealRequest, request);
          if (!firstRequest) {
            const prior = yield* Deferred.await(sealRequest);
            if (prior.runtime !== request.runtime) {
              return yield* Effect.die(new Error("Assert-first Attempt requested a second runtime seal"));
            }
          }
          return yield* Deferred.await(sealed);
        });
      },
      awaitSealRequest() {
        return Deferred.await(sealRequest);
      },
      completeSeal(value) {
        return exactlyOnce(
          Deferred.succeed(sealed, value),
          "Assert-first Attempt seal was completed twice",
        );
      },
      failSeal(error) {
        return Deferred.fail(sealed, error).pipe(Effect.asVoid);
      },
    };

    // This fallback is intentionally after the worker is scoped. Attempt's
    // more specific finalizer runs first and supplies timeout/interruption
    // detail; this one closes any exceptional construction path.
    yield* Effect.addFinalizer((exit) =>
      closeEffectRequests(
        Exit.isFailure(exit) && Cause.isInterruptedOnly(exit.cause)
          ? new AssertionAuthoringClosedErrorV1("attempt-interrupted")
          : closeReason(),
      ));
    return Object.freeze(bridge);
  });
}
