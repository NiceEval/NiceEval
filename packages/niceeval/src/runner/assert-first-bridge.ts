/**
 * The Promise-shaped parts of the existing Attempt body (agent setup, sandbox
 * work, trace collection) need a narrow hand-off to the Effect-owned authoring
 * runtime. The bridge is a scoped Effect resource: the Queue worker is the
 * only executor, and public Promise values are only facade adapters.
 */

import { Cause, Deferred, Effect, Exit, Queue, Scope } from "effect";

import type {
  AssertionStopError,
  AssertionSealOptions,
  AssertionsRuntime,
  SealedAttemptAssertions,
} from "../assertions/api.ts";
import { AssertionAuthoringClosedError } from "../assertions/api.ts";
import type { AgentWorkspaceDiff } from "../assertions/workspace-diff.ts";
import { withCleanupTimeout } from "./cleanup-timeout.ts";

export type AttemptAuthorCompletion =
  | { readonly _tag: "succeeded" }
  | { readonly _tag: "stopped" }
  | { readonly _tag: "failed"; readonly error: unknown }
  | { readonly _tag: "defect"; readonly cause: unknown };

export interface AssertionSealRequest {
  readonly runtime: AssertionsRuntime<"pass" | "score">;
  readonly options: AssertionSealOptions;
  /** Frozen post-run evidence shared by evaluators and the Record adapter. */
  readonly workspaceDiff?: AgentWorkspaceDiff;
}

type AttemptEffectRequestKind = "assertion" | "operation";

/**
 * A request from the Promise-shaped Attempt body into its owning Effect Scope.
 * The resolver pair is deliberately the sole native-Promise state: it adapts
 * the public callback facade after the owner fiber has classified an Exit.
 */
interface AttemptEffectRequest {
  readonly kind: AttemptEffectRequestKind;
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

export interface AssertFirstAttemptBridge<Context> {
  /** The Promise body submits Context completion through the owner Queue. */
  offerContext(context: Context): Effect.Effect<void>;
  failBeforeContext(error: unknown): Effect.Effect<void>;
  awaitContext(): Effect.Effect<Context, unknown>;
  completeAuthor(completion: AttemptAuthorCompletion): Effect.Effect<void>;
  awaitAuthor(): Effect.Effect<AttemptAuthorCompletion, unknown>;
  requestAssertion<Value>(
    effect: Effect.Effect<Value, AssertionStopError, never>,
  ): Promise<Value>;
  /** Executes an internal body operation in the existing Attempt Effect Scope. */
  requestEffect<Value, Error>(
    effect: Effect.Effect<Value, Error, never>,
  ): Promise<Value>;
  /** Marks that the Promise body has entered and therefore owes its ordered cleanup. */
  expectCleanup(): void;
  /** Atomically enters cleanup unless the owner has already abandoned the body. */
  beginCleanup(): boolean;
  /** Executes teardown after the forward authoring bridge has closed. */
  requestCleanup<Value, Error>(
    effect: Effect.Effect<Value, Error, never>,
  ): Promise<Value>;
  /** Completes the Promise body's cleanup obligation after its final teardown. */
  completeCleanup(): void;
  /** Waits for an expected Promise cleanup without accepting forward work. */
  awaitCleanup(): Effect.Effect<void>;
  /** Rejects only `orStop()` barriers after authoring has closed. */
  closeAssertionRequests(error: unknown): Effect.Effect<void>;
  /** Rejects every queued / in-flight forward request during Scope release. */
  closeEffectRequests(error: unknown): Effect.Effect<void>;
  requestSeal(request: AssertionSealRequest): Effect.Effect<SealedAttemptAssertions, unknown>;
  awaitSealRequest(): Effect.Effect<AssertionSealRequest, unknown>;
  completeSeal(sealed: SealedAttemptAssertions): Effect.Effect<void>;
  failSeal(error: unknown): Effect.Effect<void>;
}

function completeRequest(
  request: AttemptEffectRequest,
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
export function makeAssertFirstAttemptBridge<Context>():
  Effect.Effect<AssertFirstAttemptBridge<Context>, never, import("effect").Scope.Scope> {
  return Effect.gen(function* () {
    const context = yield* Deferred.make<Context, unknown>();
    const author = yield* Deferred.make<AttemptAuthorCompletion, unknown>();
    const sealRequest = yield* Deferred.make<AssertionSealRequest, unknown>();
    const sealed = yield* Deferred.make<SealedAttemptAssertions, unknown>();
    const assertionRequestsClosed = yield* Deferred.make<never, unknown>();
    const effectRequestsClosed = yield* Deferred.make<never, unknown>();
    const requests = yield* Queue.unbounded<AttemptEffectRequest>();
    // Each taken request runs independently in this child Scope. The dispatcher
    // must never await a control barrier such as awaitAuthor(), otherwise an
    // author assertion queued behind it cannot make the barrier complete.
    const requestScope = yield* Scope.make();
    const cleanupCompleted = yield* Deferred.make<void>();
    const cleanupRequests = yield* Queue.unbounded<AttemptEffectRequest>();
    const cleanupRequestScope = yield* Scope.make();
    let terminalError: unknown | undefined;
    let assertionCloseError: unknown | undefined;
    let cleanupExpected = false;
    let cleanupStarted = false;
    let cleanupTerminalError: unknown | undefined;

    const closeReason = (): unknown =>
      terminalError ?? new AssertionAuthoringClosedError("attempt-sealed");

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
              const pending = yield* Queue.clear(requests);
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

    const awaitClose = (kind: AttemptEffectRequestKind) =>
      Effect.raceFirst(
        Deferred.await(effectRequestsClosed),
        kind === "assertion" ? Deferred.await(assertionRequestsClosed) : Effect.never,
      ).pipe(Effect.exit);

    const closeCleanupRequestsNow = (error: unknown): Effect.Effect<void> => {
      if (cleanupTerminalError !== undefined) return Effect.void;
      cleanupTerminalError = error;
      return Effect.gen(function* () {
        yield* Scope.close(cleanupRequestScope, Exit.fail(error));
        const pending = yield* Queue.clear(cleanupRequests);
        yield* Effect.forEach(
          pending,
          (request) => completeRequest(request, Exit.fail(error)),
          { discard: true },
        );
        yield* Queue.shutdown(cleanupRequests);
      });
    };
    const closeCleanupRequests = (error: unknown): Effect.Effect<void> =>
      Effect.suspend(() => closeCleanupRequestsNow(error));

    const runRequest = (request: AttemptEffectRequest): Effect.Effect<void> => {
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
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : closeEffectRequests(Cause.squash(cause))),
    );
    yield* Effect.forkScoped(worker);

    const cleanupWorker = Effect.forever(
      Queue.take(cleanupRequests).pipe(
        Effect.flatMap((request) =>
          Effect.forkIn(
            request.effect.pipe(
              Effect.exit,
              Effect.flatMap((exit) => completeRequest(request, exit, cleanupTerminalError)),
              Effect.onExit((workerExit) =>
                Exit.isFailure(workerExit)
                  ? completeRequest(
                      request,
                      Exit.failCause(workerExit.cause),
                      cleanupTerminalError,
                    )
                  : Effect.void),
            ),
            cleanupRequestScope,
          ).pipe(Effect.asVoid)),
      ),
    ).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : closeCleanupRequests(Cause.squash(cause))),
    );
    yield* Effect.forkScoped(cleanupWorker);

    const enqueue = <Value, Error>(
      effect: Effect.Effect<Value, Error, never>,
      kind: AttemptEffectRequestKind,
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
      const request: AttemptEffectRequest = {
        kind,
        effect,
        resolve: facade.resolve as (value: unknown) => void,
        reject: facade.reject,
      };
      if (!Queue.offerUnsafe(requests, request)) {
        // Once the Queue is shut down there is no owner fiber left to consume
        // this facade. Return its named terminal outcome without a second
        // lifecycle implementation.
        facade.reject(closeReason());
      }
      return facade.promise;
    };

    const enqueueCleanup = <Value, Error>(
      effect: Effect.Effect<Value, Error, never>,
    ): Promise<Value> => {
      const facade = promiseFacade<Value>();
      if (cleanupTerminalError !== undefined) {
        facade.reject(cleanupTerminalError);
        return facade.promise;
      }
      const request: AttemptEffectRequest = {
        kind: "operation",
        effect,
        resolve: facade.resolve as (value: unknown) => void,
        reject: facade.reject,
      };
      if (!Queue.offerUnsafe(cleanupRequests, request)) {
        facade.reject(
          cleanupTerminalError ?? new AssertionAuthoringClosedError("attempt-sealed"),
        );
      }
      return facade.promise;
    };

    const bridge: AssertFirstAttemptBridge<Context> = {
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
      expectCleanup() {
        cleanupExpected = true;
      },
      beginCleanup() {
        if (cleanupTerminalError !== undefined || cleanupStarted) return false;
        cleanupStarted = true;
        return true;
      },
      requestCleanup(effect) {
        return enqueueCleanup(effect);
      },
      completeCleanup() {
        // The Promise body's outer finally must acknowledge completion even
        // when a dispatcher has failed. This does not submit another request.
        Deferred.doneUnsafe(cleanupCompleted, Effect.void);
      },
      awaitCleanup() {
        return Effect.suspend(() => {
          const close = () => closeCleanupRequestsNow(closeReason());
          if (!cleanupExpected) return close();
          return withCleanupTimeout(Deferred.await(cleanupCompleted).pipe(Effect.interruptible)).pipe(
            Effect.catchTag("CleanupTimeoutError", () => Effect.suspend(() =>
              // Each started callback has its own deadline. The join may only
              // abandon a body that has not entered cleanup. Both this decision
              // and closeCleanupRequests' terminal guard run before yielding,
              // so a late finally cannot race resource release.
              cleanupStarted ? Deferred.await(cleanupCompleted) : close())),
          );
        });
      },
      closeAssertionRequests(error) {
        return Effect.suspend(() => {
          if (assertionCloseError !== undefined) return Effect.void;
          assertionCloseError = error;
          return Deferred.fail(assertionRequestsClosed, error).pipe(
            Effect.flatMap((firstClose) => {
              if (!firstClose) return Effect.void;
              return Effect.gen(function* () {
                const pending = yield* Queue.clear(requests);
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
    yield* Effect.addFinalizer((exit) => {
      const reason = Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
        ? new AssertionAuthoringClosedError("attempt-interrupted")
        : closeReason();
      return closeEffectRequests(reason).pipe(
        Effect.andThen(closeCleanupRequests(reason)),
      );
    });
    return Object.freeze(bridge);
  });
}
