import { Effect } from "effect";
import {
  COMMITTED_ROOT_PAGE_MEDIA_TYPE,
  CommittedRootKeyV1Schema,
  CommittedRootPageRefV1Schema,
  CommittedRootPageV1Schema,
  RadixNibbleV1Schema,
  RadixPathV1Schema,
  decodeProtocolSchema,
  encodeTypedJsonObject,
  typedReferenceEquals,
  type CommittedRootPageRefV1,
  type GraphRootRefV1,
  type RadixPathV1,
  type RecordProtocolError,
} from "../protocol/core.ts";
import { recordProtocolError } from "../protocol/errors.ts";
import { canonicalRadixKeyContractV1, radixPathForCanonicalPreimageV1 } from "./keys.ts";
import { materializeCanonicalRadix } from "./materialize.ts";
import type { RecordGraphEncodedObjectV1 } from "./objects.ts";
import {
  buildCanonicalRadix,
  type CanonicalRadixBuildIssue,
  type CanonicalRadixEntry,
} from "./radix.ts";

export interface EncodedCommittedRootRadixV1 {
  readonly root: CommittedRootPageRefV1;
  readonly objects: readonly RecordGraphEncodedObjectV1[];
}

export function committedRootKeyPathV1(
  graph: GraphRootRefV1,
): Effect.Effect<RadixPathV1, RecordProtocolError> {
  return radixPathForCanonicalPreimageV1({
    schema: "niceeval.committed-root-key/1",
    graph,
  });
}

/**
 * Adds one committed root to an append-only logical set. Re-adding the exact GraphRootRef is a
 * no-op; the same canonical key with a different typed graph reference is rejected.
 */
export function addCommittedRootV1(
  existing: Iterable<GraphRootRefV1>,
  graph: GraphRootRefV1,
): Effect.Effect<readonly GraphRootRefV1[], RecordProtocolError> {
  return Effect.gen(function* () {
    const roots: GraphRootRefV1[] = [];
    const byKey = new Map<string, GraphRootRefV1>();
    for (const candidate of existing) {
      const key = yield* committedRootKeyPathV1(candidate);
      const previous = byKey.get(key);
      if (previous === undefined) {
        byKey.set(key, candidate);
        roots.push(candidate);
        continue;
      }
      if (!typedReferenceEquals(previous, candidate)) {
        return yield* Effect.fail(recordProtocolError({
          code: "payload-invariant-invalid",
          operation: "add-committed-root",
          message: "A committed-root radix key cannot identify two different GraphRootRefs",
        }));
      }
    }

    const key = yield* committedRootKeyPathV1(graph);
    const previous = byKey.get(key);
    if (previous === undefined) {
      roots.push(graph);
      return Object.freeze(roots);
    }
    if (!typedReferenceEquals(previous, graph)) {
      return yield* Effect.fail(recordProtocolError({
        code: "payload-invariant-invalid",
        operation: "add-committed-root",
        message: "A committed-root radix key cannot be rebound to a different GraphRootRef",
      }));
    }
    return Object.freeze(roots);
  });
}

/** Builds the frozen bootstrap radix directly; committed-root pages are not GraphNode payloads. */
export function buildCommittedRootRadixV1(
  input: Iterable<GraphRootRefV1>,
): Effect.Effect<EncodedCommittedRootRadixV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const entries: CanonicalRadixEntry<GraphRootRefV1>[] = [];
    for (const graph of input) {
      entries.push({ key: yield* committedRootKeyPathV1(graph), value: graph });
    }
    const built = buildCanonicalRadix(entries, yield* canonicalRadixKeyContractV1());
    if (built.state === "invalid") {
      return yield* Effect.fail(recordProtocolError({
        code: "payload-invariant-invalid",
        operation: "build-committed-root-radix",
        message: built.issues.map(radixIssueLabel).join(", "),
      }));
    }

    const objects: RecordGraphEncodedObjectV1[] = [];
    const root = yield* materializeCanonicalRadix(built.root, {
      leaf: (leaf) => encodeCommittedRootLeaf(leaf.key, leaf.value, objects),
      branch: (branch) => encodeCommittedRootBranch(branch.prefix, branch.children, objects),
    });
    return Object.freeze({ root, objects: Object.freeze(objects) });
  });
}

function encodeCommittedRootLeaf(
  key: string,
  graph: GraphRootRefV1,
  objects: RecordGraphEncodedObjectV1[],
): Effect.Effect<CommittedRootPageRefV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const keyPreimage = yield* decodeProtocolSchema(
      CommittedRootKeyV1Schema,
      { schema: "niceeval.committed-root-key/1", graph },
      "encode-committed-root-leaf-key-preimage",
    );
    const encoded = yield* encodeTypedJsonObject(
      CommittedRootPageV1Schema,
      COMMITTED_ROOT_PAGE_MEDIA_TYPE,
      {
        schema: "niceeval.committed-root-page/1",
        node: "leaf",
        key: yield* decodeProtocolSchema(RadixPathV1Schema, key, "encode-committed-root-leaf-key"),
        keyPreimage,
        owner: { kind: "committed-root", graph },
        graph,
      },
    );
    return yield* appendCommittedRootPage(encoded.descriptor, encoded.bytes, objects);
  });
}

function encodeCommittedRootBranch(
  prefix: string,
  children: readonly { readonly nibble: string; readonly node: CommittedRootPageRefV1 }[],
  objects: RecordGraphEncodedObjectV1[],
): Effect.Effect<CommittedRootPageRefV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const encodedChildren: { readonly nibble: string; readonly page: CommittedRootPageRefV1 }[] = [];
    for (const child of children) {
      encodedChildren.push(Object.freeze({
        nibble: yield* decodeProtocolSchema(
          RadixNibbleV1Schema,
          child.nibble,
          "encode-committed-root-branch-nibble",
        ),
        page: child.node,
      }));
    }
    const encoded = yield* encodeTypedJsonObject(
      CommittedRootPageV1Schema,
      COMMITTED_ROOT_PAGE_MEDIA_TYPE,
      {
        schema: "niceeval.committed-root-page/1",
        node: "branch",
        prefix: yield* decodeProtocolSchema(
          RadixPathV1Schema,
          prefix,
          "encode-committed-root-branch-prefix",
        ),
        children: Object.freeze(encodedChildren),
      },
    );
    return yield* appendCommittedRootPage(encoded.descriptor, encoded.bytes, objects);
  });
}

function appendCommittedRootPage(
  descriptor: RecordGraphEncodedObjectV1["descriptor"],
  bytes: Uint8Array,
  objects: RecordGraphEncodedObjectV1[],
): Effect.Effect<CommittedRootPageRefV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const reference = yield* decodeProtocolSchema(
      CommittedRootPageRefV1Schema,
      descriptor,
      "encode-committed-root-page-ref",
    );
    objects.push(Object.freeze({ descriptor, bytes }));
    return reference;
  });
}

function radixIssueLabel(issue: CanonicalRadixBuildIssue): string {
  switch (issue.kind) {
    case "invalid-key-contract":
      return issue.detail;
    case "invalid-key":
    case "duplicate-key":
      return issue.key;
  }
}
