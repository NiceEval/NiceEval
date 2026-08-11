// Local Store 对 graph/protocol 的唯一默认验证桥。它只把 Promise 型对象读取映射成
// graph primitive 所需的 Effect reader；committed radix、strong closure 与 payload contract
// 始终由 graph/protocol 的既有实现负责。

import { Cause, Effect, Exit, Option } from "effect";
import {
  createRecordProtocolCodecRegistryV1,
  type RecordProtocolCodecRegistryV1,
} from "../protocol/codecs.ts";
import {
  ATTEMPT_LOCATOR_INDEX_MEDIA_TYPE,
  AttemptLocatorIndexPayloadV1Schema,
  ENTITY_CATALOG_MEDIA_TYPE,
  EntityCatalogPayloadV1Schema,
  RECORD_SUBJECT_MEDIA_TYPE,
  RecordSubjectV1Schema,
  recordSubjectStrongEdges,
  validateRecordSubjectV1,
  type RecordSubjectV1,
} from "../protocol/entities.ts";
import {
  GRAPH_ROOT_MEDIA_TYPE,
  GraphRootV1Schema,
  GraphRootRefV1Schema,
  LayoutV2Schema,
  decodeProtocolSchema,
  typedReferenceEquals,
  type DescriptorV1,
  type GraphRootRefV1,
  type LayoutV2,
  type NodeRefV1,
} from "../protocol/core.ts";
import { RecordProtocolError } from "../protocol/errors.ts";
import {
  verifyCommittedRootRadixV1,
  type CommittedRootRadixVerificationLimitsV1,
} from "../graph/committed-root-verify.ts";
import {
  readGraphNodePayloadV1,
  readTypedRecordGraphObjectV1,
  verifyKnownNodeStrongEdgesV1,
  type DependencyStrongEdgeReadLimitsV1,
  type RecordGraphObjectReaderV1,
} from "../graph/read.ts";
import {
  verifyRecordGraphCompleteV1,
  type RecordGraphVerificationLimitsV1,
} from "../graph/verification.ts";
import type {
  LocalBackendObjectReader,
  LocalGraphAccessResult,
  LocalRecordStoreGraphAccess,
} from "./backend.ts";

/** Stable, finite policy for the local Store's graph checks. */
export const DEFAULT_LOCAL_RECORD_STORE_GRAPH_VERIFICATION_LIMITS_V1: RecordGraphVerificationLimitsV1 =
  Object.freeze({
    objects: Object.freeze({ name: "objects", maximum: 4_096 }),
    depth: Object.freeze({ name: "depth", maximum: 4_096 }),
    bytes: Object.freeze({ name: "bytes", maximum: 64 * 1024 * 1024 }),
  });

/** The committed-root radix has at most 64 key nibbles; object count remains explicitly bounded. */
export const DEFAULT_LOCAL_RECORD_STORE_COMMITTED_ROOT_RADIX_VERIFICATION_LIMITS_V1: CommittedRootRadixVerificationLimitsV1 =
  Object.freeze({
    maximumObjects: 4_096,
    maximumDepth: 64,
  });

export interface LocalRecordStoreGraphAccessOptionsV1 {
  readonly codecRegistry?: RecordProtocolCodecRegistryV1;
  readonly graphVerificationLimits?: RecordGraphVerificationLimitsV1;
  readonly committedRootRadixVerificationLimits?: CommittedRootRadixVerificationLimitsV1;
}

export const DEFAULT_LOCAL_RECORD_STORE_GRAPH_ACCESS_OPTIONS_V1: LocalRecordStoreGraphAccessOptionsV1 =
  Object.freeze({});

/**
 * The protocol factory builds its no-extension registry from
 * RECORD_PROTOCOL_V1_PAYLOAD_CODECS. Evaluate it once so default Stores capture one stable
 * builtin registry instead of rebuilding codec maps for every factory call.
 */
export const LOCAL_RECORD_STORE_BUILTIN_CODEC_REGISTRY_V1: RecordProtocolCodecRegistryV1 =
  Effect.runSync(createRecordProtocolCodecRegistryV1());

interface RecordSubjectGraphV1 {
  readonly graph: GraphRootRefV1;
  readonly subject: NodeRefV1;
  readonly payload: RecordSubjectV1;
}

interface LocalGraphContractFailure {
  readonly kind: "store-graph-contract";
  readonly detail: string;
}

type LocalGraphReaderFailure =
  | {
      readonly kind: "local-object-corrupt";
      readonly reference: DescriptorV1;
      readonly detail: string;
    }
  | {
      readonly kind: "local-object-read-rejected";
      readonly reference: DescriptorV1;
      readonly cause: unknown;
    };

/**
 * Creates the default local Store adapter and snapshots its configuration. Passing a custom
 * registry or limits is intentional dependency injection; later mutation of the limits object
 * cannot change this adapter's verification policy.
 */
export function createLocalRecordStoreGraphAccessV1(
  options: LocalRecordStoreGraphAccessOptionsV1 = DEFAULT_LOCAL_RECORD_STORE_GRAPH_ACCESS_OPTIONS_V1,
): LocalRecordStoreGraphAccess {
  const registry = options.codecRegistry ?? LOCAL_RECORD_STORE_BUILTIN_CODEC_REGISTRY_V1;
  const graphVerificationLimits = captureGraphVerificationLimits(
    options.graphVerificationLimits ?? DEFAULT_LOCAL_RECORD_STORE_GRAPH_VERIFICATION_LIMITS_V1,
  );
  const committedRootRadixVerificationLimits = captureCommittedRootRadixVerificationLimits(
    options.committedRootRadixVerificationLimits
      ?? DEFAULT_LOCAL_RECORD_STORE_COMMITTED_ROOT_RADIX_VERIFICATION_LIMITS_V1,
  );
  const dependencyLimits: DependencyStrongEdgeReadLimitsV1 = Object.freeze({
    maximumObjects: graphVerificationLimits.objects.maximum,
    maximumBytes: graphVerificationLimits.bytes.maximum,
  });

  const access: LocalRecordStoreGraphAccess = {
    committedGraphs: async (layout, reader) => runGraphAccess(
      committedGraphsEffect(
        layout,
        localGraphReader(reader),
        committedRootRadixVerificationLimits,
      ),
    ),
    validateCommit: async (input) => runGraphAccess(
      validateCommitEffect(
        input,
        registry,
        graphVerificationLimits,
        committedRootRadixVerificationLimits,
        dependencyLimits,
      ),
    ),
    validateMirrorInstall: async (input) => runGraphAccess(
      validateMirrorInstallEffect(
        input,
        registry,
        graphVerificationLimits,
        committedRootRadixVerificationLimits,
        dependencyLimits,
      ),
    ),
  };
  return Object.freeze(access);
}

/** The internal Store entry may use this captured default without exposing backend SPI publicly. */
export const DEFAULT_LOCAL_RECORD_STORE_GRAPH_ACCESS_V1: LocalRecordStoreGraphAccess =
  createLocalRecordStoreGraphAccessV1();

function committedGraphsEffect(
  layoutInput: LayoutV2,
  reader: RecordGraphObjectReaderV1<LocalGraphReaderFailure, never>,
  limits: CommittedRootRadixVerificationLimitsV1,
) {
  return decodeProtocolSchema(
    LayoutV2Schema,
    layoutInput,
    "local-store-committed-graphs-layout",
  ).pipe(
    Effect.flatMap((layout) =>
      verifyCommittedRootRadixV1(layout.committedRoots, reader, limits)
    ),
  );
}

function validateCommitEffect(
  input: Parameters<LocalRecordStoreGraphAccess["validateCommit"]>[0],
  registry: RecordProtocolCodecRegistryV1,
  graphVerificationLimits: RecordGraphVerificationLimitsV1,
  committedRootRadixVerificationLimits: CommittedRootRadixVerificationLimitsV1,
  dependencyLimits: DependencyStrongEdgeReadLimitsV1,
) {
  const reader = localGraphReader(input.reader);
  return Effect.gen(function* () {
    const layout = yield* decodeProtocolSchema(
      LayoutV2Schema,
      input.layout,
      "local-store-commit-layout",
    );
    const next = yield* decodeProtocolSchema(
      GraphRootRefV1Schema,
      input.next,
      "local-store-commit-next",
    );
    let current: LayoutV2 | null = null;
    if (input.current !== null) {
      current = yield* decodeProtocolSchema(
        LayoutV2Schema,
        input.current,
        "local-store-commit-current-layout",
      );
    }
    let expected: GraphRootRefV1 | null = null;
    if (input.expected !== null) {
      expected = yield* decodeProtocolSchema(
        GraphRootRefV1Schema,
        input.expected,
        "local-store-commit-expected",
      );
    }

    yield* requireContract(
      typedReferenceEquals(layout.head, next),
      "commit Layout head must exactly equal next",
    );
    if (current === null) {
      yield* requireContract(
        expected === null,
        "an unbound Store commit requires expected=null",
      );
    } else {
      yield* requireContract(
        expected !== null && typedReferenceEquals(expected, current.head),
        "commit expected must exactly equal the current Layout head",
      );
      yield* requireContract(
        current.recordId === layout.recordId,
        "a bound commit must retain the Layout recordId",
      );
      yield* requireContract(
        layout.generation === current.generation + 1,
        "a bound commit must increase Layout generation by exactly one",
      );
    }

    const nextCommitted = yield* verifyCommittedRootRadixV1(
      layout.committedRoots,
      reader,
      committedRootRadixVerificationLimits,
    );
    yield* requireContract(
      containsReference(nextCommitted, layout.head),
      "next Layout head must be a member of its committed-root radix",
    );
    yield* requireContract(
      containsReference(nextCommitted, next),
      "next GraphRootRef must be a member of the next committed-root radix",
    );

    let currentCommitted: readonly GraphRootRefV1[] = Object.freeze([]);
    if (current !== null) {
      currentCommitted = yield* verifyCommittedRootRadixV1(
        current.committedRoots,
        reader,
        committedRootRadixVerificationLimits,
      );
      yield* requireContract(
        containsReference(currentCommitted, current.head),
        "current Layout head must be a member of its committed-root radix",
      );
    }
    yield* verifySingleCommittedAddition(
      currentCommitted,
      nextCommitted,
      next,
    );

    yield* requireCompleteGraph(
      { recordId: layout.recordId, graph: next },
      reader,
      registry,
      graphVerificationLimits,
      "next graph",
    );

    const nextSubject = yield* readRecordSubjectGraphV1(
      next,
      reader,
      dependencyLimits,
    );
    let currentSubject: RecordSubjectGraphV1 | undefined;
    if (current !== null) {
      currentSubject = yield* readRecordSubjectGraphV1(
        current.head,
        reader,
        dependencyLimits,
      );
    }
    yield* validateCommitSubjects(
      layout,
      current,
      expected,
      currentSubject,
      nextSubject,
    );
    yield* validateAvailableCommitBoundary(
      currentSubject,
      nextSubject,
      reader,
      dependencyLimits,
    );
  });
}

function validateMirrorInstallEffect(
  input: Parameters<LocalRecordStoreGraphAccess["validateMirrorInstall"]>[0],
  registry: RecordProtocolCodecRegistryV1,
  graphVerificationLimits: RecordGraphVerificationLimitsV1,
  committedRootRadixVerificationLimits: CommittedRootRadixVerificationLimitsV1,
  dependencyLimits: DependencyStrongEdgeReadLimitsV1,
) {
  const reader = localGraphReader(input.reader);
  return Effect.gen(function* () {
    const layout = yield* decodeProtocolSchema(
      LayoutV2Schema,
      input.layout,
      "local-store-mirror-layout",
    );
    const committed = yield* verifyCommittedRootRadixV1(
      layout.committedRoots,
      reader,
      committedRootRadixVerificationLimits,
    );
    yield* requireContract(
      containsReference(committed, layout.head),
      "mirror Layout head must be a member of its committed-root radix",
    );

    const subjects: RecordSubjectGraphV1[] = [];
    for (const graph of committed) {
      yield* requireCompleteGraph(
        { recordId: layout.recordId, graph },
        reader,
        registry,
        graphVerificationLimits,
        "mirror committed graph",
      );
      subjects.push(yield* readRecordSubjectGraphV1(
        graph,
        reader,
        dependencyLimits,
      ));
    }
    yield* validateMirrorRecordHistory(layout, subjects);
  });
}

function readRecordSubjectGraphV1(
  graph: GraphRootRefV1,
  reader: RecordGraphObjectReaderV1<LocalGraphReaderFailure, never>,
  dependencyLimits: DependencyStrongEdgeReadLimitsV1,
) {
  return Effect.gen(function* () {
    const root = yield* readTypedRecordGraphObjectV1(
      graph,
      GraphRootV1Schema,
      GRAPH_ROOT_MEDIA_TYPE,
      reader,
    );
    const decoded = yield* readGraphNodePayloadV1(
      root.subject,
      RecordSubjectV1Schema,
      RECORD_SUBJECT_MEDIA_TYPE,
      reader,
    );
    yield* validateRecordSubjectV1(decoded.payload);
    yield* verifyKnownNodeStrongEdgesV1(
      decoded.node,
      recordSubjectStrongEdges(decoded.payload),
      reader,
      dependencyLimits,
    );
    return Object.freeze({
      graph,
      subject: root.subject,
      payload: decoded.payload,
    });
  });
}

function requireCompleteGraph(
  source: { readonly recordId: string; readonly graph: GraphRootRefV1 },
  reader: RecordGraphObjectReaderV1<LocalGraphReaderFailure, never>,
  registry: RecordProtocolCodecRegistryV1,
  limits: RecordGraphVerificationLimitsV1,
  phase: string,
) {
  return verifyRecordGraphCompleteV1({
    source,
    registry,
    reader,
    limits,
  }).pipe(
    Effect.flatMap((verification) => verification.state === "complete"
      ? Effect.void
      : Effect.fail(contractFailure(
        `${phase} strong closure or known payload edge contract is invalid: ${describeFailures(verification.failures)}`,
      ))),
  );
}

function verifySingleCommittedAddition(
  previous: readonly GraphRootRefV1[],
  next: readonly GraphRootRefV1[],
  added: GraphRootRefV1,
) {
  return Effect.gen(function* () {
    yield* requireContract(
      !containsReference(previous, added),
      "next GraphRootRef is already present in the previous committed-root set",
    );
    yield* requireContract(
      next.length === previous.length + 1,
      "next committed-root set must contain exactly one more GraphRootRef",
    );
    for (const graph of previous) {
      yield* requireContract(
        containsReference(next, graph),
        "next committed-root set removed a previously committed GraphRootRef",
      );
    }
    const additions = next.filter((graph) => !containsReference(previous, graph));
    yield* requireContract(
      additions.length === 1 && typedReferenceEquals(additions[0], added),
      "next committed-root set contains an extra GraphRootRef or omits next",
    );
  });
}

function validateCommitSubjects(
  layout: LayoutV2,
  current: LayoutV2 | null,
  expected: GraphRootRefV1 | null,
  currentSubject: RecordSubjectGraphV1 | undefined,
  nextSubject: RecordSubjectGraphV1,
) {
  return Effect.gen(function* () {
    yield* requireContract(
      nextSubject.payload.recordId === layout.recordId,
      "next RecordSubject recordId must equal the next Layout recordId",
    );
    yield* requireContract(
      layout.generation === nextSubject.payload.revision + 1,
      "next Layout generation must equal next RecordSubject revision plus one",
    );
    if (current === null) {
      yield* requireContract(
        expected === null,
        "an unbound Store has no expected committed graph",
      );
      yield* requireContract(
        layout.generation === 1,
        "the first bound Layout must use generation 1",
      );
      yield* requireContract(
        nextSubject.payload.revision === 0 && nextSubject.payload.previous === null,
        "the first RecordSubject must use revision 0 and previous=null",
      );
      return;
    }

    if (currentSubject === undefined) {
      return yield* Effect.fail(contractFailure(
        "current Layout exists but its RecordSubject was not available for commit validation",
      ));
    }
    yield* requireContract(
      expected !== null && typedReferenceEquals(expected, current.head),
      "commit expected must identify the current Layout head",
    );
    yield* requireContract(
      currentSubject.payload.recordId === current.recordId
        && current.recordId === layout.recordId,
      "current and next Layouts and RecordSubjects must retain one recordId",
    );
    yield* requireContract(
      current.generation === currentSubject.payload.revision + 1,
      "current Layout generation must equal current RecordSubject revision plus one",
    );
    yield* requireContract(
      nextSubject.payload.revision === currentSubject.payload.revision + 1,
      "next RecordSubject revision must be the direct successor of the current subject",
    );
    yield* requireContract(
      nextSubject.payload.previous !== null
        && typedReferenceEquals(nextSubject.payload.previous, currentSubject.subject),
      "next RecordSubject previous must exactly identify the current head subject",
    );
  });
}

/**
 * The graph catalog APIs validate supplied leaf replacements and accept a CatalogCommitBoundaryV1
 * port for stream-prefix and adopted-Attempt proofs. This Store SPI supplies only Layout roots,
 * expected/next GraphRootRefs and raw-object reads: it has neither an authenticated catalog or
 * locator delta nor implementations of those two boundary proofs. Rebuilding either traversal in
 * Store would create a second graph algorithm, so changed catalog/locator roots fail closed.
 *
 * A genesis whose two indexes are verified canonical empty roots, or a later revision retaining
 * both exact roots, has no unproved catalog/locator mutation and can proceed through this bridge.
 */
function validateAvailableCommitBoundary(
  current: RecordSubjectGraphV1 | undefined,
  next: RecordSubjectGraphV1,
  reader: RecordGraphObjectReaderV1<LocalGraphReaderFailure, never>,
  dependencyLimits: DependencyStrongEdgeReadLimitsV1,
) {
  if (current !== undefined) {
    return typedReferenceEquals(current.payload.catalog, next.payload.catalog)
      && typedReferenceEquals(current.payload.locatorIndex, next.payload.locatorIndex)
      ? Effect.void
      : Effect.fail(contractFailure(
        "catalog/locator commit boundary is unproven: this SPI lacks an authenticated radix delta plus stream-append and adopted-Attempt membership proof inputs",
      ));
  }
  return verifyEmptyGenesisIndexes(next, reader, dependencyLimits);
}

function verifyEmptyGenesisIndexes(
  subject: RecordSubjectGraphV1,
  reader: RecordGraphObjectReaderV1<LocalGraphReaderFailure, never>,
  dependencyLimits: DependencyStrongEdgeReadLimitsV1,
) {
  return Effect.gen(function* () {
    const catalog = yield* readGraphNodePayloadV1(
      subject.payload.catalog,
      EntityCatalogPayloadV1Schema,
      ENTITY_CATALOG_MEDIA_TYPE,
      reader,
    );
    yield* verifyKnownNodeStrongEdgesV1(
      catalog.node,
      [],
      reader,
      dependencyLimits,
    );
    yield* requireContract(
      catalog.payload.node === "branch"
        && catalog.payload.prefix === ""
        && catalog.payload.children.length === 0,
      "genesis catalog must be the canonical empty root until catalog commit-boundary proofs are available",
    );

    const locator = yield* readGraphNodePayloadV1(
      subject.payload.locatorIndex,
      AttemptLocatorIndexPayloadV1Schema,
      ATTEMPT_LOCATOR_INDEX_MEDIA_TYPE,
      reader,
    );
    yield* verifyKnownNodeStrongEdgesV1(
      locator.node,
      [],
      reader,
      dependencyLimits,
    );
    yield* requireContract(
      locator.payload.node === "branch"
        && locator.payload.prefix === ""
        && locator.payload.children.length === 0,
      "genesis locator index must be the canonical empty root until catalog commit-boundary proofs are available",
    );
  });
}

function validateMirrorRecordHistory(
  layout: LayoutV2,
  subjects: readonly RecordSubjectGraphV1[],
) {
  return Effect.gen(function* () {
    yield* requireContract(
      subjects.length === layout.generation,
      "mirror committed-root count must equal Layout generation",
    );

    const byRevision = new Map<number, RecordSubjectGraphV1>();
    for (const subject of subjects) {
      yield* requireContract(
        subject.payload.recordId === layout.recordId,
        "every mirror committed RecordSubject must use the Layout recordId",
      );
      yield* requireContract(
        subject.payload.revision < layout.generation,
        "every mirror RecordSubject revision must be below Layout generation",
      );
      yield* requireContract(
        !byRevision.has(subject.payload.revision),
        "mirror committed roots must not contain duplicate RecordSubject revisions",
      );
      byRevision.set(subject.payload.revision, subject);
    }

    for (let revision = 0; revision < layout.generation; revision += 1) {
      yield* requireContract(
        byRevision.has(revision),
        "mirror committed roots must contain every revision from 0 through Layout generation minus one",
      );
    }

    const head = subjects.find((subject) =>
      typedReferenceEquals(subject.graph, layout.head)
    );
    if (head === undefined) {
      return yield* Effect.fail(contractFailure(
        "mirror Layout head did not identify a decoded committed RecordSubject",
      ));
    }
    yield* requireContract(
      head.payload.revision === layout.generation - 1,
      "mirror Layout head must identify the latest RecordSubject revision",
    );

    for (const subject of subjects) {
      if (subject.payload.revision === 0) {
        yield* requireContract(
          subject.payload.previous === null,
          "mirror genesis RecordSubject must use previous=null",
        );
        continue;
      }
      const previous = subject.payload.previous;
      if (previous === null) {
        return yield* Effect.fail(contractFailure(
          "a non-genesis mirror RecordSubject must identify its direct predecessor",
        ));
      }
      const predecessor = subjects.find((candidate) =>
        typedReferenceEquals(candidate.subject, previous)
      );
      if (predecessor === undefined) {
        return yield* Effect.fail(contractFailure(
          "mirror RecordSubject previous must identify another committed subject",
        ));
      }
      yield* requireContract(
        predecessor.payload.recordId === subject.payload.recordId
          && predecessor.payload.revision === subject.payload.revision - 1,
        "mirror RecordSubject previous must identify the direct preceding revision of the same Record",
      );
    }
  });
}

function containsReference(
  references: readonly GraphRootRefV1[],
  target: GraphRootRefV1,
): boolean {
  return references.some((reference) => typedReferenceEquals(reference, target));
}

function requireContract(
  condition: boolean,
  detail: string,
): Effect.Effect<void, LocalGraphContractFailure> {
  return condition ? Effect.void : Effect.fail(contractFailure(detail));
}

function contractFailure(detail: string): LocalGraphContractFailure {
  return Object.freeze({ kind: "store-graph-contract", detail });
}

function localGraphReader(
  reader: LocalBackendObjectReader,
): RecordGraphObjectReaderV1<LocalGraphReaderFailure, never> {
  return Object.freeze({
    read: (reference: DescriptorV1) => Effect.tryPromise({
      try: () => reader.read(reference),
      catch: (cause) => localObjectReadRejected(reference, cause),
    }).pipe(
      Effect.flatMap((result) => {
        switch (result.state) {
          case "available":
            return Effect.succeed(result.bytes);
          case "missing":
            return Effect.succeed(undefined);
          case "corrupt":
            return Effect.fail(localObjectCorrupt(result.ref, result.detail));
        }
      }),
    ),
  });
}

function localObjectReadRejected(
  reference: DescriptorV1,
  cause: unknown,
): LocalGraphReaderFailure {
  return Object.freeze({
    kind: "local-object-read-rejected",
    reference,
    cause,
  });
}

function localObjectCorrupt(
  reference: DescriptorV1,
  detail: string,
): LocalGraphReaderFailure {
  return Object.freeze({
    kind: "local-object-corrupt",
    reference,
    detail,
  });
}

function captureGraphVerificationLimits(
  limits: RecordGraphVerificationLimitsV1,
): RecordGraphVerificationLimitsV1 {
  return Object.freeze({
    objects: Object.freeze({
      name: limits.objects.name,
      maximum: limits.objects.maximum,
    }),
    depth: Object.freeze({
      name: limits.depth.name,
      maximum: limits.depth.maximum,
    }),
    bytes: Object.freeze({
      name: limits.bytes.name,
      maximum: limits.bytes.maximum,
    }),
  });
}

function captureCommittedRootRadixVerificationLimits(
  limits: CommittedRootRadixVerificationLimitsV1,
): CommittedRootRadixVerificationLimitsV1 {
  return Object.freeze({
    maximumObjects: limits.maximumObjects,
    maximumDepth: limits.maximumDepth,
  });
}

async function runGraphAccess<A>(
  effect: Effect.Effect<A, unknown>,
): Promise<LocalGraphAccessResult<A>> {
  const exit = await Effect.runPromiseExit(effect.pipe(
    Effect.mapError((failure) => Object.freeze({
      kind: "store-graph-effect-failure",
      failure,
    })),
  ));
  if (Exit.isSuccess(exit)) return graphAccessValid(exit.value);
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    return graphAccessInvalid(`graph validation failed: ${describeDiagnostic(failure.value)}`);
  }
  return graphAccessInvalid(
    `graph validation defect: ${describeDiagnostic(Cause.squash(exit.cause))}`,
  );
}

function graphAccessValid<A>(value: A): LocalGraphAccessResult<A> {
  return Object.freeze({ state: "valid", value });
}

function graphAccessInvalid(detail: string): LocalGraphAccessResult<never> {
  return Object.freeze({ state: "invalid", detail });
}

function describeFailures(failures: readonly unknown[]): string {
  const visible = failures.slice(0, 8).map((failure) => describeDiagnostic(failure));
  const suffix = failures.length > visible.length
    ? `; ${String(failures.length - visible.length)} additional failure(s)`
    : "";
  return `${visible.join(" | ")}${suffix}`;
}

function describeDiagnostic(
  value: unknown,
  seen: Set<object> = new Set<object>(),
  depth = 0,
): string {
  if (depth >= 4) return "diagnostic cause depth exceeded";
  if (value instanceof RecordProtocolError) {
    return `protocol ${value.code} at ${value.operation}: ${value.message}`;
  }
  if (value instanceof Error) {
    const nested = propertyOf(value, "cause");
    const suffix = nested === undefined
      ? ""
      : `; cause: ${describeDiagnostic(nested, seen, depth + 1)}`;
    return `${value.name}: ${value.message || "no message"}${suffix}`;
  }
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function failure";
  if (seen.has(value)) return "cyclic diagnostic object";
  seen.add(value);

  const kind = stringProperty(value, "kind");
  const code = stringProperty(value, "code");
  const detail = stringProperty(value, "detail");
  const message = stringProperty(value, "message");
  const reference = propertyOf(value, "reference") ?? propertyOf(value, "ref");
  const nested = propertyOf(value, "failure") ?? propertyOf(value, "cause");
  const components: string[] = [kind ?? code ?? "unclassified failure"];
  if (detail !== undefined) components.push(detail);
  else if (message !== undefined) components.push(message);
  if (reference !== undefined) components.push(`reference ${describeReference(reference)}`);
  const limit = propertyOf(value, "limit");
  if (limit !== undefined) components.push(`limit ${describeLimit(limit)}`);
  const observed = numberProperty(value, "observed");
  if (observed !== undefined) components.push(`observed ${String(observed)}`);
  if (nested !== undefined) {
    components.push(`cause: ${describeDiagnostic(nested, seen, depth + 1)}`);
  }
  return components.join("; ");
}

function describeReference(value: unknown): string {
  if (typeof value !== "object" || value === null) return "unavailable";
  const mediaType = stringProperty(value, "mediaType");
  const digest = stringProperty(value, "digest");
  const size = numberProperty(value, "size");
  if (mediaType === undefined || digest === undefined || size === undefined) {
    return "invalid";
  }
  return `${mediaType} ${digest} (${String(size)} bytes)`;
}

function describeLimit(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return "invalid";
  const name = stringProperty(value, "name");
  const maximum = numberProperty(value, "maximum");
  if (name === undefined || maximum === undefined) return "invalid";
  return `${name}=${String(maximum)}`;
}

function propertyOf(value: object, key: string): unknown | undefined {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function stringProperty(value: object, key: string): string | undefined {
  const property = propertyOf(value, key);
  return typeof property === "string" ? property : undefined;
}

function numberProperty(value: object, key: string): number | undefined {
  const property = propertyOf(value, key);
  return typeof property === "number" ? property : undefined;
}
