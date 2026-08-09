import { Either, Effect } from "effect";

/**
 * The ordered edge sequence is protocol-owned: different known payloads have different frozen
 * relation/ordinal rules. This module only gives that sequence its unique 128-style page chain.
 */
export interface StrongEdgeSequenceProtocol<Edge, Failure> {
  readonly validate: (edges: readonly Edge[]) => StrongEdgeSequenceValidation<Failure>;
}

export type StrongEdgeSequenceValidation<Failure> =
  | { readonly state: "valid" }
  | { readonly state: "invalid"; readonly failure: Failure };

export interface StrongEdgePageMaterializer<Edge, PageReference, Failure, Requirements> {
  readonly page: (
    input: MaterializedStrongEdgePage<Edge, PageReference>,
  ) => Effect.Effect<PageReference, Failure, Requirements>;
}

export interface MaterializedStrongEdgePage<Edge, PageReference> {
  readonly edges: readonly Edge[];
  /** A non-final page has exactly one child; a final page has `next: null`. */
  readonly next: PageReference | null;
}

export type StrongEdgePageBuildResult<PageReference, Failure> =
  | { readonly state: "valid"; readonly first: PageReference | null }
  | { readonly state: "invalid"; readonly failure: Failure }
  | { readonly state: "invalid-page-size"; readonly pageSize: number };

/**
 * Partitions a canonical edge sequence from the front, then materializes those fixed partitions
 * from the tail only to establish successor references. Every non-final page is full and points to
 * exactly one successor. Empty sequences are represented only by `null`, never an empty page.
 */
export function materializeStrongEdgePages<Edge, PageReference, Failure, Requirements>(
  edges: Iterable<Edge>,
  pageSize: number,
  protocol: StrongEdgeSequenceProtocol<Edge, Failure>,
  materializer: StrongEdgePageMaterializer<Edge, PageReference, Failure, Requirements>,
): Effect.Effect<StrongEdgePageBuildResult<PageReference, Failure>, Failure, Requirements> {
  const sequence = [...edges];
  const validation = protocol.validate(sequence);
  if (validation.state === "invalid") {
    return Effect.succeed({ state: "invalid", failure: validation.failure });
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    return Effect.succeed({ state: "invalid-page-size", pageSize });
  }
  if (sequence.length === 0) {
    return Effect.succeed({ state: "valid", first: null });
  }

  return Effect.gen(function* () {
    const partitions: (readonly Edge[])[] = [];
    for (let offset = 0; offset < sequence.length; offset += pageSize) {
      partitions.push(Object.freeze(sequence.slice(offset, offset + pageSize)));
    }

    let next: PageReference | null = null;
    for (const partition of [...partitions].reverse()) {
      next = yield* materializer.page({
        edges: partition,
        next,
      });
    }
    return { state: "valid", first: next };
  });
}

export interface StrongEdgePageReader<PageReference, Edge, ReadFailure, Requirements> {
  readonly identity: (reference: PageReference) => string;
  readonly read: (
    reference: PageReference,
  ) => Effect.Effect<DecodedStrongEdgePage<PageReference, Edge>, ReadFailure, Requirements>;
}

export interface DecodedStrongEdgePage<PageReference, Edge> {
  readonly edges: readonly Edge[];
  /** Decoded `EdgePageV1.pages`; valid dependency chains only use zero or one item. */
  readonly pages: readonly PageReference[];
}

export type StrongEdgePageVerification<
  PageReference,
  Edge,
  ReadFailure,
  SequenceFailure,
> =
  | { readonly state: "valid"; readonly edges: readonly Edge[] }
  | { readonly state: "invalid"; readonly failure: StrongEdgePageFailure<PageReference, ReadFailure, SequenceFailure> };

export type StrongEdgePageFailure<PageReference, ReadFailure, SequenceFailure> =
  | { readonly kind: "read-failure"; readonly page: PageReference; readonly failure: ReadFailure }
  | { readonly kind: "cycle"; readonly page: PageReference }
  | { readonly kind: "page-shape"; readonly page: PageReference; readonly detail: string }
  | { readonly kind: "invalid-page-size"; readonly pageSize: number }
  | { readonly kind: "edge-sequence"; readonly failure: SequenceFailure };

/**
 * Validates the unique dependency page form and returns its flattened edge ordinal sequence.
 * `sequenceProtocol` performs payload-specific relation, ordering and duplicate validation.
 */
export function verifyStrongEdgePages<PageReference, Edge, ReadFailure, Requirements, SequenceFailure>(
  first: PageReference | null,
  pageSize: number,
  reader: StrongEdgePageReader<PageReference, Edge, ReadFailure, Requirements>,
  sequenceProtocol: StrongEdgeSequenceProtocol<Edge, SequenceFailure>,
): Effect.Effect<
  StrongEdgePageVerification<PageReference, Edge, ReadFailure, SequenceFailure>,
  never,
  Requirements
> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    return Effect.succeed({
      state: "invalid",
      failure: {
        kind: "invalid-page-size",
        pageSize,
      },
    });
  }
  if (first === null) {
    const validation = sequenceProtocol.validate([]);
    return validation.state === "valid"
      ? Effect.succeed({ state: "valid", edges: Object.freeze([]) })
      : Effect.succeed({ state: "invalid", failure: { kind: "edge-sequence", failure: validation.failure } });
  }

  return Effect.gen(function* () {
    const edges: Edge[] = [];
    const seen = new Set<string>();
    let current: PageReference | null = first;
    while (current !== null) {
      const page: PageReference = current;
      const identity = reader.identity(page);
      if (seen.has(identity)) {
        return { state: "invalid", failure: { kind: "cycle", page } };
      }
      seen.add(identity);

      const decoded: Either.Either<DecodedStrongEdgePage<PageReference, Edge>, ReadFailure> = yield* Effect.either(
        reader.read(page),
      );
      if (Either.isLeft(decoded)) {
        return {
          state: "invalid",
          failure: { kind: "read-failure", page, failure: decoded.left },
        };
      }
      const isFinal = decoded.right.pages.length === 0;
      if (isFinal) {
        if (decoded.right.edges.length < 1 || decoded.right.edges.length > pageSize) {
          return {
            state: "invalid",
            failure: {
              kind: "page-shape",
              page,
              detail: "final edge page must contain between one and pageSize edges",
            },
          };
        }
      } else if (decoded.right.pages.length !== 1 || decoded.right.edges.length !== pageSize) {
        return {
          state: "invalid",
          failure: {
            kind: "page-shape",
            page,
            detail: "non-final edge page must be full and have exactly one child page",
          },
        };
      }

      edges.push(...decoded.right.edges);
      if (isFinal) {
        current = null;
      } else {
        const next = decoded.right.pages[0];
        if (next === undefined) {
          return {
            state: "invalid",
            failure: {
              kind: "page-shape",
              page,
              detail: "non-final edge page must have exactly one child page",
            },
          };
        }
        current = next;
      }
    }

    const validation = sequenceProtocol.validate(edges);
    if (validation.state === "invalid") {
      return { state: "invalid", failure: { kind: "edge-sequence", failure: validation.failure } };
    }
    return { state: "valid", edges: Object.freeze(edges) };
  });
}
