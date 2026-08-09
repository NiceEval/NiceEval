import { Either, Effect } from "effect";

/**
 * 协议适配器把 frozen core 的解码和已知 payload 的边契约留在 protocol 层。
 * 本模块只执行由该适配器提供的、已经规范排序的强闭包工作表。
 */
export interface StrongClosureProtocol<Reference, Expected, ProtocolFailure, Requirements> {
  /** 完整 typed reference 的规范身份；不得只使用 digest。 */
  readonly referenceKey: (reference: Reference) => string;
  /**
   * 验证 descriptor 与 bytes，并给出该对象必须继续读取的强边。
   * `next` 的顺序就是 canonical traversal 顺序。
   */
  readonly inspect: (
    reference: Reference,
    expected: Expected,
    bytes: Uint8Array,
  ) => Effect.Effect<StrongClosureInspection<Reference, Expected, ProtocolFailure>, ProtocolFailure, Requirements>;
  /**
   * Global typed-ref dedup normally permits immutable sharing. A protocol may reject a revisited
   * reference when the carried expectation proves that the revisit closes a forbidden local cycle.
   */
  readonly onRevisit?: (
    reference: Reference,
    expected: Expected,
  ) => ProtocolFailure | undefined;
}

/** Strong closure 本身不拥有 IO；Store、mirror 与 archive reader 各自提供该边界。 */
export interface StrongClosureReader<Reference, ReadFailure, Requirements> {
  readonly read: (reference: Reference) => Effect.Effect<Uint8Array | undefined, ReadFailure, Requirements>;
}

export interface StrongClosureStep<Reference, Expected> {
  readonly reference: Reference;
  readonly expected: Expected;
}

export type StrongClosureInspection<Reference, Expected, ProtocolFailure> =
  | {
      readonly state: "valid";
      readonly next: readonly StrongClosureStep<Reference, Expected>[];
    }
  | { readonly state: "invalid"; readonly failure: ProtocolFailure };

export interface StrongClosureResourceLimit<LimitName extends string> {
  readonly name: LimitName;
  readonly maximum: number;
}

export interface StrongClosureResourceLimits<LimitName extends string> {
  readonly objects?: StrongClosureResourceLimit<LimitName>;
  readonly depth?: StrongClosureResourceLimit<LimitName>;
  readonly bytes?: StrongClosureResourceLimit<LimitName>;
}

export interface StrongClosureUsage {
  readonly objects: number;
  readonly depth: number;
  readonly bytes: number;
}

export type StrongClosureFailure<
  Reference,
  Expected,
  ProtocolFailure,
  ReadFailure,
  LimitName extends string,
> =
  | {
      readonly kind: "missing-object";
      readonly reference: Reference;
      readonly expected: Expected;
    }
  | {
      readonly kind: "read-failure";
      readonly reference: Reference;
      readonly expected: Expected;
      readonly failure: ReadFailure;
    }
  | {
      readonly kind: "protocol-invalid";
      readonly reference: Reference;
      readonly expected: Expected;
      readonly failure: ProtocolFailure;
    }
  | {
      readonly kind: "resource-limit";
      readonly limit: StrongClosureResourceLimit<LimitName>;
      readonly observed: number;
    };

export type StrongClosureWalkResult<
  Reference,
  Expected,
  ProtocolFailure,
  ReadFailure,
  LimitName extends string,
> =
  | {
      readonly state: "complete";
      readonly usage: StrongClosureUsage;
      readonly visited: readonly StrongClosureStep<Reference, Expected>[];
    }
  | {
      readonly state: "invalid";
      readonly usage: StrongClosureUsage;
      readonly visited: readonly StrongClosureStep<Reference, Expected>[];
      readonly failures: readonly StrongClosureFailure<
        Reference,
        Expected,
        ProtocolFailure,
        ReadFailure,
        LimitName
      >[];
    };

export interface StrongClosureWalkInput<
  Reference,
  Expected,
  ProtocolFailure,
  ReadFailure,
  ReaderRequirements,
  ProtocolRequirements,
  LimitName extends string,
> {
  readonly root: StrongClosureStep<Reference, Expected>;
  readonly protocol: StrongClosureProtocol<Reference, Expected, ProtocolFailure, ProtocolRequirements>;
  readonly reader: StrongClosureReader<Reference, ReadFailure, ReaderRequirements>;
  readonly limits?: StrongClosureResourceLimits<LimitName>;
}

interface PendingStrongClosureStep<Reference, Expected> extends StrongClosureStep<Reference, Expected> {
  readonly depth: number;
}

/**
 * 用完整 typed reference 去重的 deterministic strong-closure walk。
 *
 * protocol `inspect` 负责 core media type、descriptor digest/size、edge-page 形状与强边
 * 顺序。它不假定 payload codec；codec-derived known-payload edge contract 由
 * `verifyRecordGraphCompleteV1` 在 core closure 完成后复核。因此 unknown payload 仍会按
 * descriptor-checked opaque bytes 继续遍历。
 */
export function walkStrongClosure<
  Reference,
  Expected,
  ProtocolFailure,
  ReadFailure,
  ReaderRequirements,
  ProtocolRequirements,
  LimitName extends string,
>(
  input: StrongClosureWalkInput<
    Reference,
    Expected,
    ProtocolFailure,
    ReadFailure,
    ReaderRequirements,
    ProtocolRequirements,
    LimitName
  >,
): Effect.Effect<
  StrongClosureWalkResult<Reference, Expected, ProtocolFailure, ReadFailure, LimitName>,
  never,
  ReaderRequirements | ProtocolRequirements
> {
  return Effect.gen(function* () {
    const pending: PendingStrongClosureStep<Reference, Expected>[] = [{
      reference: input.root.reference,
      expected: input.root.expected,
      depth: 0,
    }];
    const visited: StrongClosureStep<Reference, Expected>[] = [];
    const seen = new Set<string>();
    const failures: StrongClosureFailure<Reference, Expected, ProtocolFailure, ReadFailure, LimitName>[] = [];
    let bytes = 0;
    let greatestDepth = 0;

    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const current = pending[cursor];
      if (current === undefined) continue;

      greatestDepth = Math.max(greatestDepth, current.depth);
      const depthLimit = input.limits?.depth;
      if (depthLimit !== undefined && current.depth > depthLimit.maximum) {
        failures.push({ kind: "resource-limit", limit: depthLimit, observed: current.depth });
        return invalidWalkResult(visited, failures, bytes, greatestDepth);
      }

      const key = input.protocol.referenceKey(current.reference);
      if (seen.has(key)) {
        const revisitFailure = input.protocol.onRevisit?.(current.reference, current.expected);
        if (revisitFailure !== undefined) {
          failures.push({
            kind: "protocol-invalid",
            reference: current.reference,
            expected: current.expected,
            failure: revisitFailure,
          });
        }
        continue;
      }

      const objectLimit = input.limits?.objects;
      const nextObjectCount = seen.size + 1;
      if (objectLimit !== undefined && nextObjectCount > objectLimit.maximum) {
        failures.push({ kind: "resource-limit", limit: objectLimit, observed: nextObjectCount });
        return invalidWalkResult(visited, failures, bytes, greatestDepth);
      }

      seen.add(key);
      visited.push({ reference: current.reference, expected: current.expected });

      const read = yield* Effect.either(input.reader.read(current.reference));
      if (Either.isLeft(read)) {
        failures.push({
          kind: "read-failure",
          reference: current.reference,
          expected: current.expected,
          failure: read.left,
        });
        continue;
      }
      if (read.right === undefined) {
        failures.push({
          kind: "missing-object",
          reference: current.reference,
          expected: current.expected,
        });
        continue;
      }

      bytes += read.right.byteLength;
      const byteLimit = input.limits?.bytes;
      if (byteLimit !== undefined && bytes > byteLimit.maximum) {
        failures.push({ kind: "resource-limit", limit: byteLimit, observed: bytes });
        return invalidWalkResult(visited, failures, bytes, greatestDepth);
      }

      const inspection: Either.Either<
        StrongClosureInspection<Reference, Expected, ProtocolFailure>,
        ProtocolFailure
      > = yield* Effect.either(input.protocol.inspect(current.reference, current.expected, read.right));
      if (Either.isLeft(inspection)) {
        failures.push({
          kind: "protocol-invalid",
          reference: current.reference,
          expected: current.expected,
          failure: inspection.left,
        });
        continue;
      }
      if (inspection.right.state === "invalid") {
        failures.push({
          kind: "protocol-invalid",
          reference: current.reference,
          expected: current.expected,
          failure: inspection.right.failure,
        });
        continue;
      }

      for (const next of inspection.right.next) {
        pending.push({
          reference: next.reference,
          expected: next.expected,
          depth: current.depth + 1,
        });
      }
    }

    if (failures.length === 0) {
      return {
        state: "complete",
        usage: usageOf(visited.length, greatestDepth, bytes),
        visited: Object.freeze(visited),
      };
    }
    return invalidWalkResult(visited, failures, bytes, greatestDepth);
  });
}

function invalidWalkResult<Reference, Expected, ProtocolFailure, ReadFailure, LimitName extends string>(
  visited: readonly StrongClosureStep<Reference, Expected>[],
  failures: readonly StrongClosureFailure<Reference, Expected, ProtocolFailure, ReadFailure, LimitName>[],
  bytes: number,
  depth: number,
): StrongClosureWalkResult<Reference, Expected, ProtocolFailure, ReadFailure, LimitName> {
  return {
    state: "invalid",
    usage: usageOf(visited.length, depth, bytes),
    visited: Object.freeze([...visited]),
    failures: Object.freeze([...failures]),
  };
}

function usageOf(objects: number, depth: number, bytes: number): StrongClosureUsage {
  return Object.freeze({ objects, depth, bytes });
}
