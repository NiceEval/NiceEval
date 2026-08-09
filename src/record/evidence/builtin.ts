import { Effect } from "effect";
import { decodeCanonicalJsonBytes } from "../protocol/canonical.ts";
import { decodeProtocolSchema } from "../protocol/core.ts";
import {
  RUN_MEDIA_TYPE,
  RunPayloadV1Schema,
  type RunPayloadV1,
  validateRunPayloadV1,
} from "../protocol/entities.ts";
import type { JsonValue } from "../protocol/json.ts";
import {
  createRecordEvidenceRegistryV1,
  defineRecordEvidenceObjectRepresentationV1,
  defineRecordEvidenceSelectorCodecV1,
  type RecordEvidenceSelectionResultV1,
} from "./registry.ts";

export const EXPECTED_MEMBERSHIP_SLOT_SELECTOR_SCHEMA: "niceeval.expected-membership-slot-selector/1" =
  "niceeval.expected-membership-slot-selector/1";

const expectedMembershipSlotSelectorCodec = defineRecordEvidenceSelectorCodecV1({
  selectorSchema: EXPECTED_MEMBERSHIP_SLOT_SELECTOR_SCHEMA,
  validate: (value) => expectedMembershipSlotSelectorValue(value) === undefined
    ? Object.freeze({ kind: "invalid" })
    : Object.freeze({ kind: "valid" }),
});

const expectedMembershipSlotObjectRepresentation =
  defineRecordEvidenceObjectRepresentationV1({
    selectorSchema: EXPECTED_MEMBERSHIP_SLOT_SELECTOR_SCHEMA,
    mediaType: RUN_MEDIA_TYPE,
    select: (input) => {
      if (input.selector === undefined) return notSelected();
      if (input.selector.schema !== EXPECTED_MEMBERSHIP_SLOT_SELECTOR_SCHEMA) {
        return notSelected();
      }
      const selector = expectedMembershipSlotSelectorValue(input.selector.value);
      if (selector === undefined) return notSelected();
      const run = parseRunPayload(input.payload);
      if (run === undefined || run.runId !== selector.runId) return notSelected();
      const matchingSlots = run.expectedMembershipSlots.filter((slot) =>
        slot.membershipSlot === selector.membershipSlot && slot.evalId === selector.evalId
      );
      if (matchingSlots.length !== 1) return notSelected();
      if (run.contributions.some((contribution) =>
        contribution.membershipSlot === selector.membershipSlot
      )) {
        return notSelected();
      }
      return Object.freeze({ kind: "selected", value: input.selector.value });
    },
    confirmSameLogicalRoot: () => Object.freeze({ kind: "unsupported" }),
    classifyTransformation: () => Object.freeze({ kind: "unsupported" }),
    measureTransformation: () => Object.freeze({ kind: "unsupported" }),
  });

/** The single default registry captured by future create/open callers that omit an override. */
export const BUILTIN_RECORD_EVIDENCE_REGISTRY_V1 = createRecordEvidenceRegistryV1({
  selectorCodecs: [expectedMembershipSlotSelectorCodec],
  representations: [expectedMembershipSlotObjectRepresentation],
  filters: [],
  redactionPolicies: [],
});

interface ExpectedMembershipSlotSelectorValue {
  readonly runId: string;
  readonly membershipSlot: string;
  readonly evalId: string;
}

function expectedMembershipSlotSelectorValue(
  value: JsonValue,
): ExpectedMembershipSlotSelectorValue | undefined {
  const members = exactPlainRecord(value, ["runId", "membershipSlot", "evalId"]);
  if (members === undefined) return undefined;
  const runId = members.get("runId");
  const membershipSlot = members.get("membershipSlot");
  const evalId = members.get("evalId");
  if (
    !isNonEmptyProtocolString(runId)
    || !isNonEmptyProtocolString(membershipSlot)
    || !isNonEmptyProtocolString(evalId)
  ) {
    return undefined;
  }
  return Object.freeze({ runId, membershipSlot, evalId });
}

function parseRunPayload(bytes: Uint8Array): RunPayloadV1 | undefined {
  try {
    return Effect.runSync(
      decodeCanonicalJsonBytes(bytes).pipe(
        Effect.flatMap((value) =>
          decodeProtocolSchema(
            RunPayloadV1Schema,
            value,
            "decode-expected-membership-slot-run",
          )
        ),
        Effect.tap(validateRunPayloadV1),
      ),
    );
  } catch {
    return undefined;
  }
}

function notSelected(): RecordEvidenceSelectionResultV1 {
  return Object.freeze({ kind: "not-selected" });
}

function exactPlainRecord(
  value: unknown,
  expected: readonly string[],
): ReadonlyMap<string, unknown> | undefined {
  const members = plainRecord(value);
  if (members === undefined || members.size !== expected.length) return undefined;
  for (const key of expected) {
    if (!members.has(key)) return undefined;
  }
  return members;
}

function plainRecord(value: unknown): ReadonlyMap<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) return undefined;
    const members = new Map<string, unknown>();
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !("value" in descriptor)
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      ) {
        return undefined;
      }
      members.set(key, descriptor.value);
    }
    return members;
  } catch {
    return undefined;
  }
}

function isNonEmptyProtocolString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\u0000");
}
