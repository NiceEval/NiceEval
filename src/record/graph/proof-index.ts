import { paginateCanonicalSequence } from "./radix.ts";

/**
 * The proof-index engine intentionally knows neither Record payloads nor archive storage. Protocol
 * supplies JCS identities, SHA-256 keys and proof-specific `basedOn` extraction; this module owns
 * the deterministic closure, cycle detection, resource accounting, collision checks and paging.
 */
export interface EvidenceProofIndexProtocol<Evidence, Proof, Failure> {
  /** Exact JCS UTF-8 identity, used for deduplication and cycle detection. */
  readonly evidenceIdentity: (evidence: Evidence) => string;
  /** RFC 8785 UTF-8 ordering for `EvidenceRef`. */
  readonly compareEvidence: (left: Evidence, right: Evidence) => number;
  /** Fixed-format SHA-256 key for one evidence identity. */
  readonly proofKey: (evidence: Evidence) => string;
  /** Protocol-defined canonical ordering for proof keys. */
  readonly compareProofKey: (left: string, right: string) => number;
  /** Produces and validates the proof for exactly one evidence item. */
  readonly buildProof: (evidence: Evidence) => EvidenceProofBuildResult<Proof, Failure>;
  /** The proof must describe exactly the entry evidence. */
  readonly proofMatchesEvidence: (proof: Proof, evidence: Evidence) => boolean;
  /** Claim proofs expose their direct bases; other proof kinds return an empty sequence. */
  readonly basedOn: (proof: Proof) => readonly Evidence[];
}

export type EvidenceProofBuildResult<Proof, Failure> =
  | {
      readonly state: "valid";
      readonly proof: Proof;
      /**
       * Exact raw bytes consumed by this adapter while building this proof. The graph layer does
       * not estimate object size; a source/archive adapter must charge every raw read it performs.
       */
      readonly bytesRead: number;
    }
  | { readonly state: "invalid"; readonly failure: Failure };

export interface EvidenceProofIndexResourceLimit {
  readonly name: "objects" | "depth" | "bytes";
  readonly maximum: number;
}

export interface EvidenceProofIndexLimits {
  /** Distinct EvidenceRef/proof objects admitted to the closure. */
  readonly objects: EvidenceProofIndexResourceLimit;
  /** Maximum Claim-basis distance from one direct EvidenceRef. */
  readonly depth: EvidenceProofIndexResourceLimit;
  /** Sum of adapter-reported exact raw bytes read while building admitted proofs. */
  readonly bytes: EvidenceProofIndexResourceLimit;
}

export const DEFAULT_EVIDENCE_PROOF_INDEX_LIMITS: EvidenceProofIndexLimits = Object.freeze({
  objects: Object.freeze({ name: "objects", maximum: 4_096 }),
  depth: Object.freeze({ name: "depth", maximum: 256 }),
  bytes: Object.freeze({ name: "bytes", maximum: 64 * 1024 * 1024 }),
});

export interface EvidenceProofIndexEntry<Evidence, Proof> {
  readonly key: string;
  readonly evidence: Evidence;
  readonly proof: Proof;
}

export type EvidenceProofIndexIssue<Evidence, Failure> =
  | { readonly kind: "proof-build-failed"; readonly evidence: Evidence; readonly failure: Failure }
  | { readonly kind: "proof-evidence-mismatch"; readonly evidence: Evidence }
  | { readonly kind: "proof-cycle"; readonly evidence: Evidence }
  | {
      readonly kind: "proof-resource-limit";
      readonly limit: EvidenceProofIndexResourceLimit;
      readonly observed: number;
    }
  | { readonly kind: "invalid-limits"; readonly detail: string }
  | { readonly kind: "invalid-proof-bytes"; readonly evidence: Evidence; readonly observed: number }
  | {
      readonly kind: "proof-key-collision";
      readonly key: string;
      readonly left: Evidence;
      readonly right: Evidence;
    }
  | { readonly kind: "invalid-page-size"; readonly pageSize: number };

export type EvidenceProofIndexBuildResult<Evidence, Proof, Failure> =
  | {
      readonly state: "valid";
      readonly entries: readonly EvidenceProofIndexEntry<Evidence, Proof>[];
      readonly pages: readonly (readonly EvidenceProofIndexEntry<Evidence, Proof>[])[];
    }
  | {
      readonly state: "invalid";
      readonly issues: readonly EvidenceProofIndexIssue<Evidence, Failure>[];
    };

interface EnterEvidenceFrame<Evidence> {
  readonly phase: "enter";
  readonly evidence: Evidence;
  readonly identity: string;
  readonly depth: number;
}

interface CompleteEvidenceFrame<Evidence, Proof> {
  readonly phase: "complete";
  readonly evidence: Evidence;
  readonly identity: string;
  readonly depth: number;
  readonly proof: Proof;
}

type EvidenceFrame<Evidence, Proof> =
  | EnterEvidenceFrame<Evidence>
  | CompleteEvidenceFrame<Evidence, Proof>;

/**
 * Computes the transitive Claim-basis closure from direct reader traces without relying on the JS
 * call stack. A valid result is complete; every budget or cycle failure returns no partial index.
 */
export function buildEvidenceProofIndex<Evidence, Proof, Failure>(
  direct: readonly Evidence[],
  pageSize: number,
  protocol: EvidenceProofIndexProtocol<Evidence, Proof, Failure>,
  limits: EvidenceProofIndexLimits = DEFAULT_EVIDENCE_PROOF_INDEX_LIMITS,
): EvidenceProofIndexBuildResult<Evidence, Proof, Failure> {
  const limitsIssue = validateLimits(limits);
  if (limitsIssue !== undefined) {
    return invalidResult([{ kind: "invalid-limits", detail: limitsIssue }]);
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    return invalidResult([{ kind: "invalid-page-size", pageSize }]);
  }

  const entriesByIdentity = new Map<string, EvidenceProofIndexEntry<Evidence, Proof>>();
  const admitted = new Set<string>();
  const issues: EvidenceProofIndexIssue<Evidence, Failure>[] = [];
  let bytesRead = 0;

  const roots = uniqueSorted(direct, protocol);
  for (const root of roots) {
    const visiting = new Set<string>();
    const stack: EvidenceFrame<Evidence, Proof>[] = [{
      phase: "enter",
      evidence: root,
      identity: protocol.evidenceIdentity(root),
      depth: 0,
    }];

    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame === undefined) continue;
      if (frame.phase === "complete") {
        visiting.delete(frame.identity);
        entriesByIdentity.set(frame.identity, Object.freeze({
          key: protocol.proofKey(frame.evidence),
          evidence: frame.evidence,
          proof: frame.proof,
        }));
        continue;
      }

      if (visiting.has(frame.identity)) {
        issues.push(Object.freeze({ kind: "proof-cycle", evidence: frame.evidence }));
        break;
      }
      if (frame.depth > limits.depth.maximum) {
        issues.push(resourceLimitIssue(limits.depth, frame.depth));
        break;
      }
      if (entriesByIdentity.has(frame.identity)) continue;
      if (!admitted.has(frame.identity)) {
        const observedObjects = admitted.size + 1;
        if (observedObjects > limits.objects.maximum) {
          issues.push(resourceLimitIssue(limits.objects, observedObjects));
          break;
        }
        admitted.add(frame.identity);
      }

      const built = protocol.buildProof(frame.evidence);
      if (built.state === "invalid") {
        issues.push(Object.freeze({
          kind: "proof-build-failed",
          evidence: frame.evidence,
          failure: built.failure,
        }));
        break;
      }
      if (!isNonNegativeSafeInteger(built.bytesRead)) {
        issues.push(Object.freeze({
          kind: "invalid-proof-bytes",
          evidence: frame.evidence,
          observed: built.bytesRead,
        }));
        break;
      }
      bytesRead += built.bytesRead;
      if (!Number.isSafeInteger(bytesRead) || bytesRead > limits.bytes.maximum) {
        issues.push(resourceLimitIssue(limits.bytes, bytesRead));
        break;
      }
      if (!protocol.proofMatchesEvidence(built.proof, frame.evidence)) {
        issues.push(Object.freeze({ kind: "proof-evidence-mismatch", evidence: frame.evidence }));
        break;
      }

      visiting.add(frame.identity);
      stack.push(Object.freeze({
        phase: "complete",
        evidence: frame.evidence,
        identity: frame.identity,
        depth: frame.depth,
        proof: built.proof,
      }));

      const bases = uniqueSorted(protocol.basedOn(built.proof), protocol);
      for (let index = bases.length - 1; index >= 0; index -= 1) {
        const evidence = bases[index];
        if (evidence === undefined) continue;
        stack.push(Object.freeze({
          phase: "enter",
          evidence,
          identity: protocol.evidenceIdentity(evidence),
          depth: frame.depth + 1,
        }));
      }
    }
    if (issues.length > 0) return invalidResult(issues);
  }

  const entries = [...entriesByIdentity.values()].sort((left, right) => {
    const keyOrder = protocol.compareProofKey(left.key, right.key);
    if (keyOrder !== 0) return keyOrder;
    return protocol.compareEvidence(left.evidence, right.evidence);
  });
  const collision = firstKeyCollision(entries, protocol);
  if (collision !== undefined) return invalidResult([collision]);

  const pagination = paginateCanonicalSequence(entries, pageSize);
  if (pagination.state === "invalid-page-size") {
    return invalidResult([{ kind: "invalid-page-size", pageSize: pagination.pageSize }]);
  }
  return {
    state: "valid",
    entries: Object.freeze(entries),
    pages: pagination.pages,
  };
}

function invalidResult<Evidence, Proof, Failure>(
  issues: readonly EvidenceProofIndexIssue<Evidence, Failure>[],
): EvidenceProofIndexBuildResult<Evidence, Proof, Failure> {
  return { state: "invalid", issues: Object.freeze([...issues]) };
}

function resourceLimitIssue<Evidence, Failure>(
  limit: EvidenceProofIndexResourceLimit,
  observed: number,
): EvidenceProofIndexIssue<Evidence, Failure> {
  return Object.freeze({ kind: "proof-resource-limit", limit, observed });
}

function uniqueSorted<Evidence, Proof, Failure>(
  values: readonly Evidence[],
  protocol: EvidenceProofIndexProtocol<Evidence, Proof, Failure>,
): readonly Evidence[] {
  const uniqueByIdentity = new Map<string, Evidence>();
  for (const value of values) {
    const identity = protocol.evidenceIdentity(value);
    const prior = uniqueByIdentity.get(identity);
    if (prior === undefined || protocol.compareEvidence(value, prior) < 0) {
      uniqueByIdentity.set(identity, value);
    }
  }
  const sorted = [...uniqueByIdentity.values()].sort(protocol.compareEvidence);
  return Object.freeze(sorted);
}

function firstKeyCollision<Evidence, Proof, Failure>(
  entries: readonly EvidenceProofIndexEntry<Evidence, Proof>[],
  protocol: EvidenceProofIndexProtocol<Evidence, Proof, Failure>,
): EvidenceProofIndexIssue<Evidence, Failure> | undefined {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous === undefined || current === undefined) continue;
    if (previous.key !== current.key) continue;
    if (protocol.compareEvidence(previous.evidence, current.evidence) === 0) continue;
    return {
      kind: "proof-key-collision",
      key: current.key,
      left: previous.evidence,
      right: current.evidence,
    };
  }
  return undefined;
}

function validateLimits(limits: EvidenceProofIndexLimits): string | undefined {
  for (const limit of [limits.objects, limits.depth, limits.bytes]) {
    if (!isNonNegativeSafeInteger(limit.maximum) || limit.maximum < 1) {
      return `${limit.name}.maximum must be a positive JSON-safe integer`;
    }
  }
  if (limits.objects.name !== "objects") return "objects limit name must be objects";
  if (limits.depth.name !== "depth") return "depth limit name must be depth";
  if (limits.bytes.name !== "bytes") return "bytes limit name must be bytes";
  return undefined;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
