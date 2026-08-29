import { Schema } from "effect";

/** Versioned lifecycle stream written by `niceeval view --json`. */
export const VIEW_LIFECYCLE_PROTOCOL = "niceeval.view/v1" as const;

export const ViewReadyLifecycleEventSchema = Schema.Struct({
  protocol: Schema.Literal(VIEW_LIFECYCLE_PROTOCOL),
  event: Schema.Literal("ready"),
  url: Schema.String,
});

export const ViewClosedLifecycleEventSchema = Schema.Struct({
  protocol: Schema.Literal(VIEW_LIFECYCLE_PROTOCOL),
  event: Schema.Literal("closed"),
});

export const ViewLifecycleEventSchema = Schema.Union([
  ViewReadyLifecycleEventSchema,
  ViewClosedLifecycleEventSchema,
]);

export type ViewReadyLifecycleEvent = Schema.Schema.Type<typeof ViewReadyLifecycleEventSchema>;
export type ViewClosedLifecycleEvent = Schema.Schema.Type<typeof ViewClosedLifecycleEventSchema>;
export type ViewLifecycleEvent = Schema.Schema.Type<typeof ViewLifecycleEventSchema>;

/** Serialize one lifecycle event as the single NDJSON line owned by the View CLI. */
export function renderViewLifecycleEvent(event: ViewLifecycleEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Strictly decode the lifecycle stream emitted by `niceeval view --json`.
 *
 * Startup failures have no lifecycle event because a usable View was never
 * published, so their empty stdout is a valid empty stream.
 */
export function decodeViewLifecycle(input: string): readonly ViewLifecycleEvent[] {
  if (input === "") return Object.freeze([]);
  if (!input.endsWith("\n")) {
    throw new Error("niceeval.view/v1 lifecycle output must end with a newline.");
  }
  const events: ViewLifecycleEvent[] = [];
  for (const [index, line] of input.slice(0, -1).split("\n").entries()) {
    if (line.length === 0) {
      throw new Error(`niceeval.view/v1 lifecycle output has a blank line at ${index + 1}.`);
    }
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`niceeval.view/v1 lifecycle output has invalid JSON at ${index + 1}: ${reason}`, { cause });
    }
    try {
      events.push(Schema.decodeUnknownSync(ViewLifecycleEventSchema, {
        errors: "all",
        onExcessProperty: "error",
      })(value));
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`niceeval.view/v1 lifecycle output has an invalid event at ${index + 1}: ${reason}`, { cause });
    }
  }
  return Object.freeze(events);
}
