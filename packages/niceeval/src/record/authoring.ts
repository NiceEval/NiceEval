import { Schema } from "effect";

import {
  defineRecordAttachment,
  defineRecordAttachmentPersistence,
  isRecordAttachmentPersistence,
  recordAttachmentDefinitionHasOpaqueDeclarations,
  registerRecordAttachmentDefinitionAlias,
  type RecordAttachmentDefinition,
  type RecordAttachmentPersistence,
} from "./attachment/protocol.ts";
import {
  RecordAttachmentSpiDefinitionError,
  type RecordAttachmentIssue,
} from "./attachment/errors.ts";
import type { RecordAttachmentOwner } from "./model/core.ts";
import type {
  AttachedContentError,
  AttachedContentRequirements,
  RecordAttachmentSessionBuilder,
} from "./writer/current-attachment.ts";

const recordContributionTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordContribution",
);
const recordDefinitionTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordDefinition",
);
const recordWriteCommandTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordWriteCommand",
);
const attemptRecordCollectionDefinitionTypeId: unique symbol = Symbol(
  "@niceeval/record/AttemptRecordCollectionDefinition",
);
const attemptRecordAppendCommandTypeId: unique symbol = Symbol(
  "@niceeval/record/AttemptRecordAppendCommand",
);

type AnySchema = Schema.Schema.AnyNoContext;
type AnyAttachmentDefinition<Owner extends RecordAttachmentOwner = RecordAttachmentOwner> =
  RecordAttachmentDefinition<Owner, string, AnySchema>;
type AnyAttachmentPersistence = RecordAttachmentPersistence<AnyAttachmentDefinition, number>;

interface RecordContributionRuntime {
  readonly attachment: AnyAttachmentDefinition;
  readonly persistence: AnyAttachmentPersistence;
}

interface RecordCommandRuntime {
  readonly definition: object;
  readonly owner: RecordAttachmentOwner;
  readonly input: unknown;
}

export interface AttemptRecordCollectionRuntime {
  readonly definition: object;
  readonly attachment: AnyAttachmentDefinition<"attempt">;
  readonly persistence: AnyAttachmentPersistence;
  readonly item: AnySchema;
  readonly itemAttachment: AnyAttachmentDefinition<"attempt">;
}

interface AttemptRecordAppendCommandRuntime {
  readonly definition: object;
  readonly item: unknown;
}

const contributions = new WeakMap<object, RecordContributionRuntime>();
const commands = new WeakMap<object, RecordCommandRuntime>();
const attemptRecordCollections = new WeakMap<object, AttemptRecordCollectionRuntime>();
const attemptRecordAppendCommands = new WeakMap<object, AttemptRecordAppendCommandRuntime>();

/** One exact, immutable Record family contribution accepted by a Record Host. */
export interface RecordContribution {
  readonly family: string;
  readonly owner: RecordAttachmentOwner;
  readonly [recordContributionTypeId]: () => void;
}

/** A lazy create-once write command. Constructing it performs no Effect or I/O. */
export interface RecordWriteCommand<
  out Owner extends RecordAttachmentOwner,
  out Value,
  out Error,
  out Requirements,
> {
  readonly [recordWriteCommandTypeId]: () => {
    readonly owner: Owner;
    readonly value: Value;
    readonly error: Error;
    readonly requirements: Requirements;
  };
}

/** A lazy Attempt collection append command with a nominal boundary distinct from write. */
export interface AttemptRecordAppendCommand<out Item> {
  readonly [attemptRecordAppendCommandTypeId]: () => Item;
}

/** The result of one valid append after the collection's conservative cap is applied. */
export type AttemptRecordAppendReceipt =
  | { readonly state: "retained" }
  | { readonly state: "omitted"; readonly reason: "collection-cap-reached" };

export type AnyRecordDefinition<
  Owner extends RecordAttachmentOwner = RecordAttachmentOwner,
> = RecordDefinition<Owner, string, AnySchema>;

export type RecordDefinitionValue<Definition extends AnyRecordDefinition> =
  Schema.Schema.Type<Definition["schema"]>;

export interface RecordWriteCommandPayload<
  Owner extends RecordAttachmentOwner,
  Value,
> {
  readonly definition: RecordAttachmentDefinition<Owner, string, AnySchema>;
  readonly input: Value | ((build: RecordAttachmentSessionBuilder) => Value);
}

export interface RecordDefinition<
  out Owner extends RecordAttachmentOwner,
  out Family extends string,
  ValueSchema extends AnySchema,
> extends RecordContribution {
  readonly owner: Owner;
  readonly family: Family;
  readonly schema: ValueSchema;
  readonly [recordDefinitionTypeId]: () => { readonly owner: Owner; readonly family: Family };
  <Value extends Schema.Schema.Type<ValueSchema>>(
    input: Value | ((build: RecordAttachmentSessionBuilder) => Value),
  ): RecordWriteCommand<
    Owner,
    Value,
    AttachedContentError<Value>,
    AttachedContentRequirements<Value>
  >;
}

export type AttemptRecordDefinition<
  Family extends string,
  ValueSchema extends AnySchema,
> = RecordDefinition<"attempt", Family, ValueSchema>;

export type RunRecordDefinition<
  Family extends string,
  ValueSchema extends AnySchema,
> = RecordDefinition<"run", Family, ValueSchema>;

type AttemptRecordCollectionLimitation =
  | {
      readonly code: "capture-interrupted";
      readonly stage: "attempt-finalizer";
    }
  | {
      readonly code: "collection-cap-reached";
      readonly omittedAtLeast: number;
    };

type AttemptRecordCollectionValue<Item> = {
  readonly collection:
    | { readonly state: "complete"; readonly limitations: readonly [] }
    | {
        readonly state: "partial";
        readonly limitations: readonly [
          AttemptRecordCollectionLimitation,
          ...AttemptRecordCollectionLimitation[],
        ];
      };
  readonly items: readonly Item[];
};

/**
 * One exact Attempt-owned collection. It is callable as an append-command
 * factory while remaining a Host contribution, reader selector, and reference target.
 */
export interface AttemptRecordCollectionDefinition<
  out Family extends string,
  ItemSchema extends AnySchema,
> extends RecordContribution {
  readonly owner: "attempt";
  readonly family: Family;
  readonly item: ItemSchema;
  readonly schema: Schema.Schema<
    AttemptRecordCollectionValue<Schema.Schema.Type<ItemSchema>>,
    AttemptRecordCollectionValue<Schema.Schema.Encoded<ItemSchema>>,
    never
  >;
  readonly [attemptRecordCollectionDefinitionTypeId]: () => {
    readonly family: Family;
    readonly item: Schema.Schema.Type<ItemSchema>;
  };
  <Item extends Schema.Schema.Type<ItemSchema>>(
    item: Item,
  ): AttemptRecordAppendCommand<Item>;
}

const PositiveSafeIntegerSchema = Schema.Number.pipe(
  Schema.filter(
    (value) => Number.isSafeInteger(value) && value > 0,
    { identifier: "AttemptRecordCollectionPositiveSafeInteger" },
  ),
);
const EmptyCollectionLimitationsSchema = Schema.Tuple();
const AttemptRecordCollectionLimitationSchema = Schema.Union(
  Schema.Struct({
    code: Schema.Literal("capture-interrupted"),
    stage: Schema.Literal("attempt-finalizer"),
  }),
  Schema.Struct({
    code: Schema.Literal("collection-cap-reached"),
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
);
const AttemptRecordCollectionStateSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyCollectionLimitationsSchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(AttemptRecordCollectionLimitationSchema),
  }),
);

function defineRecord<
  const Owner extends RecordAttachmentOwner,
  const Family extends string,
  const ValueSchema extends AnySchema,
>(owner: Owner, input: {
  readonly family: Family;
  readonly schema: ValueSchema;
  readonly validate?: (
    value: Schema.Schema.Type<ValueSchema>,
  ) => readonly RecordAttachmentIssue[];
}): RecordDefinition<Owner, Family, ValueSchema> {
  const attachment = defineRecordAttachment({ owner, ...input });
  const persistence = defineRecordAttachmentPersistence({
    attachment,
    revision: 1,
    migrations: [],
  });
  const definition = Object.assign(
    (commandInput: unknown) => {
      const command = Object.freeze({
        [recordWriteCommandTypeId]: () => ({
          owner,
          value: undefined,
          error: undefined,
          requirements: undefined,
        }),
      });
      commands.set(command, Object.freeze({
        definition,
        owner,
        input: commandInput,
      }));
      return command;
    },
    {
      owner,
      family: input.family,
      schema: input.schema,
      [recordContributionTypeId]: () => undefined,
      [recordDefinitionTypeId]: () => ({ owner, family: input.family }),
    },
  ) as RecordDefinition<Owner, Family, ValueSchema>;
  Object.freeze(definition);
  registerRecordAttachmentDefinitionAlias(definition, attachment);
  contributions.set(definition, Object.freeze({
    attachment,
    persistence,
  }) as RecordContributionRuntime);
  return definition;
}

export function defineAttemptRecord<
  const Family extends string,
  const ValueSchema extends AnySchema,
>(input: {
  readonly family: Family;
  readonly schema: ValueSchema;
  readonly validate?: (
    value: Schema.Schema.Type<ValueSchema>,
  ) => readonly RecordAttachmentIssue[];
}): AttemptRecordDefinition<Family, ValueSchema> {
  return defineRecord("attempt", input);
}

export function defineRunRecord<
  const Family extends string,
  const ValueSchema extends AnySchema,
>(input: {
  readonly family: Family;
  readonly schema: ValueSchema;
  readonly validate?: (
    value: Schema.Schema.Type<ValueSchema>,
  ) => readonly RecordAttachmentIssue[];
}): RunRecordDefinition<Family, ValueSchema> {
  return defineRecord("run", input);
}

/** Defines one append-oriented, plain-data Attempt collection at revision 1. */
export function defineAttemptRecordCollection<
  const Family extends string,
  const ItemSchema extends AnySchema,
>(input: {
  readonly family: Family;
  readonly item: ItemSchema;
}): AttemptRecordCollectionDefinition<Family, ItemSchema> {
  const itemAttachment = defineRecordAttachment({
    owner: "attempt",
    family: input.family,
    schema: input.item,
  });
  if (recordAttachmentDefinitionHasOpaqueDeclarations(itemAttachment)) {
    throw new RecordAttachmentSpiDefinitionError("invalid-family-definition");
  }
  const itemSchema = input.item as Schema.Schema<
    Schema.Schema.Type<ItemSchema>,
    Schema.Schema.Encoded<ItemSchema>,
    never
  >;
  const schema = Schema.Struct({
    collection: AttemptRecordCollectionStateSchema,
    items: Schema.Array(itemSchema),
  });
  const attachment = defineRecordAttachment({
    owner: "attempt",
    family: input.family,
    schema,
  });
  const persistence = defineRecordAttachmentPersistence({
    attachment,
    revision: 1,
    migrations: [],
  });
  let definition: AttemptRecordCollectionDefinition<Family, ItemSchema>;
  definition = Object.assign(
    (item: unknown) => {
      const command = Object.freeze({
        [attemptRecordAppendCommandTypeId]: () => undefined,
      });
      attemptRecordAppendCommands.set(command, Object.freeze({ definition, item }));
      return command;
    },
    {
      owner: "attempt" as const,
      family: input.family,
      item: input.item,
      schema,
      [recordContributionTypeId]: () => undefined,
      [attemptRecordCollectionDefinitionTypeId]: () => ({
        family: input.family,
        item: undefined as Schema.Schema.Type<ItemSchema>,
      }),
    },
  ) as unknown as AttemptRecordCollectionDefinition<Family, ItemSchema>;
  Object.freeze(definition);
  registerRecordAttachmentDefinitionAlias(definition, attachment);
  contributions.set(definition, Object.freeze({ attachment, persistence }));
  attemptRecordCollections.set(definition, Object.freeze({
    definition,
    attachment,
    persistence,
    item: input.item,
    itemAttachment,
  }));
  return definition;
}

/** Explicitly adapts the low-level Attachment persistence SPI to Host composition. */
export function recordContributionFromAttachmentPersistence<
  const Definition extends AnyAttachmentDefinition,
  const Revision extends number,
>(
  persistence: RecordAttachmentPersistence<Definition, Revision>,
): RecordContribution {
  if (!isRecordAttachmentPersistence(persistence)) {
    throw new TypeError("Record contribution requires an exact Attachment persistence");
  }
  const contribution = Object.freeze({
    owner: persistence.attachment.owner,
    family: persistence.attachment.family,
    [recordContributionTypeId]: () => undefined,
  });
  contributions.set(contribution, Object.freeze({
    attachment: persistence.attachment,
    persistence,
  }) as RecordContributionRuntime);
  return contribution;
}

/** @internal Host boundary: structural lookalikes never unwrap. */
export function recordContributionRuntime(
  contribution: unknown,
): RecordContributionRuntime | undefined {
  return typeof contribution === "object" || typeof contribution === "function"
    ? contribution !== null ? contributions.get(contribution) : undefined
    : undefined;
}

/** @internal Reader boundary: returns only the private exact Attachment definition. */
export function recordDefinitionAttachment(
  definition: unknown,
): AnyAttachmentDefinition | undefined {
  const runtime = recordContributionRuntime(definition);
  return typeof definition === "function" ? runtime?.attachment : undefined;
}

/** @internal Writer boundary: structural lookalikes never unwrap. */
export function recordWriteCommandRuntime(
  command: unknown,
): RecordCommandRuntime | undefined {
  return typeof command === "object" && command !== null
    ? commands.get(command)
    : undefined;
}

/** @internal Attempt writer boundary: structural collection lookalikes never unwrap. */
export function attemptRecordCollectionRuntime(
  definition: unknown,
): AttemptRecordCollectionRuntime | undefined {
  return typeof definition === "function"
    ? attemptRecordCollections.get(definition)
    : undefined;
}

/** @internal Attempt writer boundary: normal write commands never unwrap as appends. */
export function attemptRecordAppendCommandRuntime(
  command: unknown,
): AttemptRecordAppendCommandRuntime | undefined {
  return typeof command === "object" && command !== null
    ? attemptRecordAppendCommands.get(command)
    : undefined;
}

/** @internal Writer boundary: validates command and exact originating definition together. */
export function recordWriteCommandPayload<
  Owner extends RecordAttachmentOwner,
  Value,
  Error,
  Requirements,
>(
  command: RecordWriteCommand<Owner, Value, Error, Requirements>,
  expectedOwner: Owner,
): RecordWriteCommandPayload<Owner, Value> | undefined {
  const runtime = recordWriteCommandRuntime(command);
  const definition = runtime === undefined
    ? undefined
    : recordDefinitionAttachment(runtime.definition);
  if (
    runtime === undefined ||
    definition === undefined ||
    runtime.owner !== expectedOwner ||
    definition.owner !== expectedOwner
  ) return undefined;
  return Object.freeze({
    definition: definition as RecordAttachmentDefinition<Owner, string, AnySchema>,
    input: runtime.input as Value | ((build: RecordAttachmentSessionBuilder) => Value),
  });
}
