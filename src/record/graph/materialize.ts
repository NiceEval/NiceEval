import { Effect } from "effect";
import type {
  CanonicalRadixBranch,
  CanonicalRadixChild,
  CanonicalRadixEntry,
  CanonicalRadixLeaf,
  CanonicalRadixNode,
} from "./radix.ts";

/**
 * Bottom-up bridge from the pure canonical radix shape to protocol-owned GraphNode descriptors.
 * Protocol provides the concrete entity/locator/committed-root payload writers; graph preserves
 * child order and never decides a reference identity itself.
 */
export interface CanonicalRadixMaterializer<Value, Reference, Failure, Requirements> {
  readonly leaf: (
    leaf: CanonicalRadixLeaf<Value>,
  ) => Effect.Effect<Reference, Failure, Requirements>;
  readonly branch: (
    branch: MaterializedCanonicalRadixBranch<Reference>,
  ) => Effect.Effect<Reference, Failure, Requirements>;
}

export interface MaterializedCanonicalRadixBranch<Reference> {
  readonly prefix: string;
  readonly children: readonly MaterializedCanonicalRadixChild<Reference>[];
}

export interface MaterializedCanonicalRadixChild<Reference> {
  readonly nibble: string;
  readonly node: Reference;
}

/** Materializes a canonical tree deterministically from leaves to root. */
export function materializeCanonicalRadix<Value, Reference, Failure, Requirements>(
  root: CanonicalRadixNode<Value>,
  materializer: CanonicalRadixMaterializer<Value, Reference, Failure, Requirements>,
): Effect.Effect<Reference, Failure, Requirements> {
  return materializeNode(root, materializer);
}

function materializeNode<Value, Reference, Failure, Requirements>(
  node: CanonicalRadixNode<Value>,
  materializer: CanonicalRadixMaterializer<Value, Reference, Failure, Requirements>,
): Effect.Effect<Reference, Failure, Requirements> {
  if (node.kind === "leaf") return materializer.leaf(node);
  return Effect.gen(function* () {
    const children: MaterializedCanonicalRadixChild<Reference>[] = [];
    for (const child of node.children) {
      const reference = yield* materializeNode(child.node, materializer);
      children.push(Object.freeze({ nibble: child.nibble, node: reference }));
    }
    return yield* materializer.branch({
      prefix: node.prefix,
      children: Object.freeze(children),
    });
  });
}

/** Reuses the entry shape at call sites without making materializers re-declare it. */
export type { CanonicalRadixEntry, CanonicalRadixBranch, CanonicalRadixChild };
