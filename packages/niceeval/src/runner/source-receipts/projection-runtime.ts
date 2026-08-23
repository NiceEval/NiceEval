import type {
  CallId,
  ObservabilityEntityIdForKind,
  SafeIdentifier,
  TurnId,
} from "../../record/family/source-receipt/model.ts";
import type { ConversationItem } from "./model.ts";
import type { RunnerCollectionLimitations } from "./support.ts";

export interface ProjectedConversationTurn {
  readonly turnId: TurnId;
  readonly items: ConversationItem[];
}

export interface CommandProjectionRuntime {
  readonly sensitiveValues: ReadonlySet<string>;
  readonly commandLimitations: RunnerCollectionLimitations;
}

export interface EventProjectionRuntime extends CommandProjectionRuntime {
  readonly providerName: string;
  readonly conversationTurns: readonly ProjectedConversationTurn[];
  readonly conversationLimitations: RunnerCollectionLimitations;
  readonly mintEntity: <Kind extends "call" | "item">(
    kind: Kind,
  ) => ObservabilityEntityIdForKind<Kind> | undefined;
}

export type OpenConversationTools = Map<string, CallId>;
export type OpenConversationSubagents = Map<string, SafeIdentifier>;
