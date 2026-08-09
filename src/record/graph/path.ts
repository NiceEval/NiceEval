/**
 * Selects the canonical evidence path when a target has more than one authenticated strong path.
 * The protocol adapter owns GraphRoot/GraphNode/EdgePage decoding and JCS comparison of concrete
 * `RecordEvidencePathStepV1` values; this engine owns the simple-path and tie-break rule.
 */
export interface CanonicalStrongPathProtocol<Node, Step> {
  /** Full descriptor identity, never a digest-only key. */
  readonly nodeIdentity: (node: Node) => string;
  /** Outgoing steps must each describe one legal strong-path transition. */
  readonly outgoing: (node: Node) => readonly CanonicalStrongPathEdge<Node, Step>[];
  /** JCS UTF-8 ordering of individual discriminated path steps. */
  readonly compareStep: (left: Step, right: Step) => number;
  /** JCS UTF-8 ordering of full path arrays for equal-length tie breaking. */
  readonly comparePath: (left: readonly Step[], right: readonly Step[]) => number;
}

export interface CanonicalStrongPathEdge<Node, Step> {
  readonly to: Node;
  readonly step: Step;
}

export interface CanonicalStrongPathLimit {
  readonly maximumStates: number;
  readonly maximumDepth: number;
}

export type CanonicalStrongPathResult<Node, Step> =
  | {
      readonly state: "found";
      readonly nodes: readonly Node[];
      readonly path: readonly Step[];
    }
  | { readonly state: "not-found" }
  | { readonly state: "resource-limit"; readonly name: "states" | "depth"; readonly observed: number };

/**
 * Finds the shortest simple path. Equal-length candidates are ordered by the JCS bytes of their
 * complete step sequence, matching the frozen proof selection rule.
 */
export function selectCanonicalStrongPath<Node, Step>(
  start: Node,
  isTarget: (node: Node) => boolean,
  protocol: CanonicalStrongPathProtocol<Node, Step>,
  limit: CanonicalStrongPathLimit,
): CanonicalStrongPathResult<Node, Step> {
  if (!isPositiveSafeInteger(limit.maximumStates) || !isPositiveSafeInteger(limit.maximumDepth)) {
    return { state: "resource-limit", name: "states", observed: 0 };
  }

  const pathNodes: Node[] = [start];
  const pathSteps: Step[] = [];
  const seen = new Set<string>([protocol.nodeIdentity(start)]);
  let states = 1;
  let best: { readonly nodes: readonly Node[]; readonly path: readonly Step[] } | undefined;
  let depthLimitObserved: number | undefined;
  let stateLimitObserved: number | undefined;

  const considerCurrentPath = (): void => {
    const candidate = {
      nodes: Object.freeze([...pathNodes]),
      path: Object.freeze([...pathSteps]),
    };
    if (
      best === undefined
      || candidate.path.length < best.path.length
      || (candidate.path.length === best.path.length && protocol.comparePath(candidate.path, best.path) < 0)
    ) {
      best = candidate;
    }
  };

  if (isTarget(start)) {
    considerCurrentPath();
  } else if (pathSteps.length >= limit.maximumDepth) {
    depthLimitObserved = pathSteps.length + 1;
  } else {
    const stack: CanonicalStrongPathFrame<Node, Step>[] = [frameFor(start, true, protocol)];
    while (stack.length > 0 && stateLimitObserved === undefined) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      if (best !== undefined && pathSteps.length > best.path.length) {
        removeCompletedFrame(stack, pathNodes, pathSteps, seen);
        continue;
      }
      const edge = frame.edges[frame.nextEdge];
      if (edge === undefined) {
        removeCompletedFrame(stack, pathNodes, pathSteps, seen);
        continue;
      }
      frame.nextEdge += 1;

      const identity = protocol.nodeIdentity(edge.to);
      if (seen.has(identity)) continue;
      const nextStateCount = states + 1;
      if (!Number.isSafeInteger(nextStateCount) || nextStateCount > limit.maximumStates) {
        stateLimitObserved = nextStateCount;
        break;
      }
      states = nextStateCount;
      seen.add(identity);
      pathNodes.push(edge.to);
      pathSteps.push(edge.step);

      if (isTarget(edge.to)) {
        considerCurrentPath();
        removeCurrentChild(pathNodes, pathSteps, seen, identity);
        continue;
      }
      if (pathSteps.length >= limit.maximumDepth) {
        depthLimitObserved = Math.max(depthLimitObserved ?? 0, pathSteps.length + 1);
        removeCurrentChild(pathNodes, pathSteps, seen, identity);
        continue;
      }
      stack.push(frameFor(edge.to, false, protocol));
    }
  }
  if (stateLimitObserved !== undefined) {
    return { state: "resource-limit", name: "states", observed: stateLimitObserved };
  }
  if (depthLimitObserved !== undefined && best === undefined) {
    return { state: "resource-limit", name: "depth", observed: depthLimitObserved };
  }
  if (best === undefined) return { state: "not-found" };
  return { state: "found", nodes: best.nodes, path: best.path };
}

interface CanonicalStrongPathFrame<Node, Step> {
  readonly node: Node;
  readonly identity: string;
  readonly root: boolean;
  readonly edges: readonly CanonicalStrongPathEdge<Node, Step>[];
  nextEdge: number;
}

function frameFor<Node, Step>(
  node: Node,
  root: boolean,
  protocol: CanonicalStrongPathProtocol<Node, Step>,
): CanonicalStrongPathFrame<Node, Step> {
  return {
    node,
    identity: protocol.nodeIdentity(node),
    root,
    edges: Object.freeze([...protocol.outgoing(node)].sort((left, right) =>
      protocol.compareStep(left.step, right.step)
    )),
    nextEdge: 0,
  };
}

function removeCompletedFrame<Node, Step>(
  stack: CanonicalStrongPathFrame<Node, Step>[],
  pathNodes: Node[],
  pathSteps: Step[],
  seen: Set<string>,
): void {
  const completed = stack.pop();
  if (completed === undefined || completed.root) return;
  removeCurrentChild(pathNodes, pathSteps, seen, completed.identity);
}

function removeCurrentChild<Node, Step>(
  pathNodes: Node[],
  pathSteps: Step[],
  seen: Set<string>,
  identity: string,
): void {
  pathNodes.pop();
  pathSteps.pop();
  seen.delete(identity);
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
