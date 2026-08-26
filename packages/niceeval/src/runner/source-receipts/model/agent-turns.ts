import { Schema } from "effect";

import {
  CallIdSchema,
  CollectionSchema,
  ConversationReferencesSchema,
  CurrencyCodeSchema,
  ItemIdSchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
  SourceNativeToolNameSchema,
  TurnIdSchema,
  UsageObservationIdSchema,
  UsageReferencesSchema,
  boundedSafeTextSchema,
} from "../../../record/family/source-receipt/codec.ts";
import {
  MAX_CONVERSATION_ATTACHMENT_BYTES,
  MAX_CONVERSATION_ITEMS,
  MAX_CONVERSATION_TEXT_BYTES,
  MAX_CONVERSATION_TURNS,
  MAX_USAGE_ATTACHMENT_BYTES,
  MAX_USAGE_OBSERVATIONS,
} from "../../../record/family/source-receipt/limits.ts";
import { compareObservabilityText } from "../../../record/family/source-receipt/model.ts";
import {
  freezeArray,
  isAllowedCollection,
  isStrictlyOrderedById,
  payloadFits,
} from "./common.ts";

const ConversationItemBaseFields = {
  itemId: ItemIdSchema,
  turnId: TurnIdSchema,
  sequence: PositiveSafeIntegerSchema,
  refs: ConversationReferencesSchema,
} as const;

export const ConversationTurnSchema = Schema.Struct({
  turnId: TurnIdSchema,
  sequence: PositiveSafeIntegerSchema,
  outcome: Schema.Literal("completed", "failed", "cancelled", "interrupted"),
  refs: ConversationReferencesSchema,
});

export const ConversationItemSchema = Schema.Union(
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("message"),
    role: Schema.Literal("user", "assistant"),
    text: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("tool-call"),
    callId: CallIdSchema,
    tool: SourceNativeToolNameSchema,
    inputSummary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("tool-result"),
    callId: CallIdSchema,
    outcome: Schema.Literal("completed", "rejected", "failed", "cancelled"),
    outputSummary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("thinking-summary"),
    summary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("subagent"),
    state: Schema.Literal("started", "completed", "failed"),
    label: SafeIdentifierSchema,
    summary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("input-request"),
    state: Schema.Literal("requested", "answered", "cancelled"),
    promptSummary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
    responseSummary: Schema.NullOr(
      boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
    ),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("skill-load"),
    skill: SafeIdentifierSchema,
    outcome: Schema.Literal("loaded", "failed"),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("context-injection"),
    source: Schema.Literal("system", "memory", "skill", "user"),
    summary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("compaction"),
    summary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
    compactedItemCount: NonNegativeSafeIntegerSchema,
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("conversation-error"),
    code: SafeIdentifierSchema,
    summary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
);

export type ConversationTurn = Schema.Schema.Type<typeof ConversationTurnSchema>;
export type ConversationItem = Schema.Schema.Type<typeof ConversationItemSchema>;

function conversationTextLengths(item: ConversationItem): readonly number[] {
  switch (item.kind) {
    case "message":
      return freezeArray([new TextEncoder().encode(item.text).byteLength]);
    case "tool-call":
      return freezeArray([new TextEncoder().encode(item.inputSummary).byteLength]);
    case "tool-result":
      return freezeArray([new TextEncoder().encode(item.outputSummary).byteLength]);
    case "thinking-summary":
    case "subagent":
    case "context-injection":
    case "compaction":
    case "conversation-error":
      return freezeArray([new TextEncoder().encode(item.summary).byteLength]);
    case "input-request":
      return freezeArray([
        new TextEncoder().encode(item.promptSummary).byteLength,
        ...(item.responseSummary === null
          ? []
          : [new TextEncoder().encode(item.responseSummary).byteLength]),
      ]);
    case "skill-load":
      return freezeArray([]);
  }
}

function isCanonicalConversationAttachment(
  value: Schema.Schema.Type<typeof ConversationAttachmentStructuralSchema>,
): boolean {
  if (
    value.turns.length > MAX_CONVERSATION_TURNS ||
    value.items.length > MAX_CONVERSATION_ITEMS ||
    !payloadFits(value, MAX_CONVERSATION_ATTACHMENT_BYTES) ||
    !isAllowedCollection(value.collection, ["conversation-item", "conversation-text"])
  ) {
    return false;
  }
  if (!isStrictlyOrderedById(value.turns, (turn) => turn.turnId)) return false;
  const turnIds = new Set<string>();
  const turnSequences = new Set<number>();
  for (const turn of value.turns) {
    turnIds.add(turn.turnId);
    if (turnSequences.has(turn.sequence)) return false;
    turnSequences.add(turn.sequence);
  }

  const itemIds = new Set<string>();
  const itemSequences = new Set<number>();
  const callIds = new Set<string>();
  const resultCallIds = new Set<string>();
  let previous: ConversationItem | undefined;
  for (const item of value.items) {
    if (
      itemIds.has(item.itemId) ||
      itemSequences.has(item.sequence) ||
      !turnIds.has(item.turnId)
    ) {
      return false;
    }
    if (
      previous !== undefined &&
      (previous.sequence > item.sequence ||
        (previous.sequence === item.sequence &&
          compareObservabilityText(previous.itemId, item.itemId) >= 0))
    ) {
      return false;
    }
    itemIds.add(item.itemId);
    itemSequences.add(item.sequence);
    if (item.kind === "tool-call") {
      if (callIds.has(item.callId)) return false;
      callIds.add(item.callId);
    }
    if (item.kind === "tool-result") {
      if (!callIds.has(item.callId) || resultCallIds.has(item.callId)) return false;
      resultCallIds.add(item.callId);
    }
    previous = item;
  }
  if (
    value.collection.state === "complete" &&
    [...callIds].some((callId) => !resultCallIds.has(callId))
  ) {
    return false;
  }
  return value.collection.limitations.every((limitation) => {
    if (limitation.code !== "text-truncated" || limitation.target !== "conversation-text") {
      return true;
    }
    const item = value.items.find((candidate) => candidate.itemId === limitation.itemId);
    return item !== undefined && conversationTextLengths(item).some(
      (length) => length === limitation.retainedBytes,
    );
  });
}

const ConversationAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  turns: Schema.Array(ConversationTurnSchema),
  items: Schema.Array(ConversationItemSchema),
});

export const ConversationAttachmentSchema = ConversationAttachmentStructuralSchema.pipe(
  Schema.filter(isCanonicalConversationAttachment, {
    identifier: "ObservabilityConversationAttachment",
    description: "a canonical, bounded conversation attachment",
  }),
);

export type ConversationAttachment = Schema.Schema.Type<
  typeof ConversationAttachmentSchema
>;

export const UsageObservationSchema = Schema.Union(
  Schema.Struct({
    usageObservationId: UsageObservationIdSchema,
    provider: SafeIdentifierSchema,
    refs: UsageReferencesSchema,
    kind: Schema.Literal("token-bucket"),
    bucket: Schema.Literal(
      "input",
      "output",
      "cache-read",
      "cache-write",
      "reasoning",
      "other",
    ),
    tokens: NonNegativeSafeIntegerSchema,
  }),
  Schema.Struct({
    usageObservationId: UsageObservationIdSchema,
    provider: SafeIdentifierSchema,
    refs: UsageReferencesSchema,
    kind: Schema.Literal("request"),
    requestKind: Schema.Literal("model", "tool"),
  }),
  Schema.Struct({
    usageObservationId: UsageObservationIdSchema,
    provider: SafeIdentifierSchema,
    refs: UsageReferencesSchema,
    kind: Schema.Literal("provider-cost"),
    amount: Schema.String.pipe(
      Schema.filter(
        (value) =>
          /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value) &&
          new TextEncoder().encode(value).byteLength <= 64,
        {
          identifier: "ObservabilityCanonicalDecimal",
          description: "a non-negative canonical decimal string",
        },
      ),
    ),
    currency: CurrencyCodeSchema,
  }),
);

const UsageAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  observations: Schema.Array(UsageObservationSchema),
});

export type UsageObservation = Schema.Schema.Type<typeof UsageObservationSchema>;

function isCanonicalUsageAttachment(
  value: Schema.Schema.Type<typeof UsageAttachmentStructuralSchema>,
): boolean {
  return (
    value.observations.length <= MAX_USAGE_OBSERVATIONS &&
    payloadFits(value, MAX_USAGE_ATTACHMENT_BYTES) &&
    isAllowedCollection(value.collection, ["usage-observation"]) &&
    isStrictlyOrderedById(value.observations, (observation) => observation.usageObservationId)
  );
}

export const UsageAttachmentSchema = UsageAttachmentStructuralSchema.pipe(
  Schema.filter(isCanonicalUsageAttachment, {
    identifier: "ObservabilityUsageAttachment",
    description: "a canonical, bounded usage attachment",
  }),
);

export type UsageAttachment = Schema.Schema.Type<typeof UsageAttachmentSchema>;
