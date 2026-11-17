import * as Result from "effect/Result";
import { RecordAttachmentEncodingLimits } from "../../../record/attachment/protocol.ts";
import { canonicalizeRecordValue } from "../../../record/definition/canonical.ts";
import type { AgentTurnsAttachment } from "../../../record/family/agent-turns/definition.ts";
import { sourceCollection } from "../support.ts";

/** Retain a source prefix within the actual Record budget, including JSON escaping. */
export function retainAgentTurns(value: AgentTurnsAttachment): AgentTurnsAttachment {
  const fits = (candidate: AgentTurnsAttachment): boolean =>
    Result.isSuccess(
      canonicalizeRecordValue(
        {
          state: candidate.state,
          "collection-data": candidate.collection,
          "segments-data": candidate.segments,
        },
        RecordAttachmentEncodingLimits,
      ),
    );
  if (fits(value)) return value;
  let retained: AgentTurnsAttachment = {
    ...value,
    collection: sourceCollection(
      [],
      [...value.collection.limitations, { code: "collection-cap-reached", target: "value-byte", omittedAtLeast: 1 }],
    ),
  };
  const prefix = (count: number, select: (count: number) => AgentTurnsAttachment): void => {
    let low = 0;
    let high = count;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(select(middle))) low = middle;
      else high = middle - 1;
    }
    retained = select(low);
  };
  // Keep all Turn identities and terminal facts when possible. Retain a global
  // item prefix so an exact tool finish can never outlive its omitted start.
  const withItems = retained;
  prefix(
    value.segments.reduce((sum, turn) => sum + turn.items.length, 0),
    (count) => ({
      ...withItems,
      segments: withItems.segments.map((turn) => {
        const items = turn.items.slice(0, count);
        count -= items.length;
        return { ...turn, items };
      }),
    }),
  );
  if (fits(retained)) return retained;
  const withUsage = retained;
  prefix(
    value.segments.reduce((sum, turn) => sum + turn.usage.length, 0),
    (count) => ({
      ...withUsage,
      segments: withUsage.segments.map((turn) => {
        const usage = turn.usage.slice(0, count);
        count -= usage.length;
        return { ...turn, usage };
      }),
    }),
  );
  if (fits(retained)) return retained;
  const withTurns = retained;
  prefix(withTurns.segments.length, (count) => ({ ...withTurns, segments: withTurns.segments.slice(0, count) }));
  if (fits(retained)) return retained;
  const withLimitations = retained;
  prefix(withLimitations.collection.limitations.length, (count) => ({
    ...withLimitations,
    collection: sourceCollection(
      [],
      [
        ...withLimitations.collection.limitations.slice(0, count),
        { code: "collection-cap-reached", target: "value-byte", omittedAtLeast: 1 },
      ],
    ),
  }));
  return retained;
}
