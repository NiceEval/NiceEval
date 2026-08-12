import { Either } from "effect";

/**
 * Runtime brands for frozen reader capabilities deliberately live outside the
 * public objects. Type-level symbols alone cannot stop a JavaScript caller
 * from copying fields or casting an object into a handle.
 *
 * A lifecycle is shared by every registry belonging to one frozen snapshot.
 * Checking the lifecycle before the registry gives an escaped handle the
 * stable closed-reader failure after its Scope has released.
 */
export interface ReaderLifecycle<Error> {
  readonly close: () => void;
  readonly isClosed: () => boolean;
  readonly assertLive: () => Either.Either<void, Error>;
}

/** A package-private exact-identity registry for one handle kind. */
export interface ExactHandleRegistry<Handle extends object, Contents, Error> {
  readonly register: (handle: Handle, contents: Contents) => Handle;
  readonly resolve: (handle: Handle) => Either.Either<Contents, Error>;
}

export function makeReaderLifecycle<Error>(input: {
  readonly closed: () => Error;
}): ReaderLifecycle<Error> {
  let closed = false;
  const lifecycle: ReaderLifecycle<Error> = {
    close: (): void => {
      closed = true;
    },
    isClosed: (): boolean => closed,
    assertLive: (): Either.Either<void, Error> =>
      closed ? Either.left(input.closed()) : Either.right(undefined),
  };

  return Object.freeze(lifecycle);
}

/**
 * `WeakMap` rather than a field or symbol is the authority boundary: only the
 * exact object registered by this reader can resolve, and the registry itself
 * does not retain a leaked handle after its consumer drops it.
 */
export function makeExactHandleRegistry<
  Handle extends object,
  Contents,
  Error,
>(
  lifecycle: ReaderLifecycle<Error>,
  input: { readonly invalid: () => Error },
): ExactHandleRegistry<Handle, Contents, Error> {
  const contentsByHandle = new WeakMap<Handle, { readonly value: Contents }>();

  const registry: ExactHandleRegistry<Handle, Contents, Error> = {
    register: (handle: Handle, contents: Contents): Handle => {
      if (contentsByHandle.has(handle)) {
        throw new Error("Record reader attempted to register a handle twice");
      }
      contentsByHandle.set(handle, { value: contents });
      return handle;
    },
    resolve: (handle: Handle): Either.Either<Contents, Error> => {
      const live = lifecycle.assertLive();
      if (Either.isLeft(live)) {
        return Either.left(live.left);
      }
      const entry =
        typeof handle === "object" && handle !== null
          ? contentsByHandle.get(handle)
          : undefined;
      return entry === undefined
        ? Either.left(input.invalid())
        : Either.right(entry.value);
    },
  };

  return Object.freeze(registry);
}
