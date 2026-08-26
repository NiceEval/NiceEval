import { Either } from "effect";
import { isAbsolute, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A host-local Record root. The durable format never receives either of these
 * host paths; portable layout code addresses files with root-relative segments.
 */
export interface RecordRoot {
  readonly [recordRootTypeId]: typeof recordRootTypeId;
}

export type RecordRootInput = string | URL;

export type RecordRootConstructionError =
  | { readonly code: "record-root-empty" }
  | { readonly code: "record-root-relative" }
  | {
      readonly code: "record-root-non-file-url";
      readonly protocol: string;
    }
  | { readonly code: "record-root-file-url-invalid" };

export interface RecordRootPaths {
  /** The Host-owned project storage directory containing `record.sqlite`. */
  readonly portableRoot: string;
}

const recordRootTypeId: unique symbol = Symbol("@niceeval/record/RecordRoot");
const roots = new WeakMap<object, RecordRootPaths>();

function makeRoot(portableRoot: string): RecordRoot {
  const issued: RecordRoot = {
    [recordRootTypeId]: recordRootTypeId,
  };
  const root = Object.freeze(issued);

  roots.set(
    root,
    Object.freeze({
      portableRoot,
    }),
  );

  return root;
}

function normalizeAbsolutePath(input: string): string | undefined {
  if (!isAbsolute(input)) {
    return undefined;
  }

  const normalized = normalize(input);
  return isAbsolute(normalized) ? normalized : undefined;
}

/**
 * Lexically normalizes an absolute host path without touching the filesystem.
 * In particular it intentionally does not call realpath or claim hostile
 * symlink protection.
 */
export function makeRecordRoot(
  input: RecordRootInput,
): Either.Either<RecordRoot, RecordRootConstructionError> {
  if (input instanceof URL) {
    if (input.protocol !== "file:") {
      return Either.left({
        code: "record-root-non-file-url",
        protocol: input.protocol,
      });
    }

    if (input.search !== "" || input.hash !== "") {
      return Either.left({ code: "record-root-file-url-invalid" });
    }

    try {
      const path = normalizeAbsolutePath(fileURLToPath(input));
      return path === undefined
        ? Either.left({ code: "record-root-file-url-invalid" })
        : Either.right(makeRoot(path));
    } catch {
      return Either.left({ code: "record-root-file-url-invalid" });
    }
  }

  if (input.trim() === "") {
    return Either.left({ code: "record-root-empty" });
  }

  const path = normalizeAbsolutePath(input);
  return path === undefined
    ? Either.left({ code: "record-root-relative" })
    : Either.right(makeRoot(path));
}

/** Internal Node-platform access; callers cannot manufacture an issued root. */
export function recordRootPaths(root: unknown): RecordRootPaths | undefined {
  if (typeof root !== "object" || root === null) {
    return undefined;
  }

  return roots.get(root);
}
