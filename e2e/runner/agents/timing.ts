import { Effect } from "effect";
import { appendFile, truncate } from "node:fs/promises";
import { join } from "node:path";
import {
  completeEvidenceCoverage,
  defineAgent,
  type AgentContext,
} from "niceeval/adapter";

const evidenceCoverage = {
  ...completeEvidenceCoverage,
  usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
} as const;

function lifecycleReceipt(context: AgentContext, event: string): Effect.Effect<void, unknown> {
  const path = context.flags.lifecycleReceipt;
  if (typeof path !== "string") {
    return Effect.die(new Error("runner lifecycle fixture requires flags.lifecycleReceipt"));
  }
  return Effect.tryPromise({
    try: () => appendFile(path, `${event}\n`, { encoding: "utf8", signal: context.signal }),
    catch: (cause) => cause,
  });
}

export const timingAgent = defineAgent({
  name: "runner-timing",
  evidenceCoverage,
  setup: (ctx) => Effect.sync(() => {
    if (ctx.signal.aborted) throw new Error("runner timing fixture setup aborted");
  }),
  send: (_input, ctx) => Effect.sync(() => {
    if (ctx.signal.aborted) throw new Error("runner timing fixture send aborted");
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "runner-timing-ok" }],
    };
  }),
});

export const setupFailureAgent = defineAgent({
  name: "runner-setup-failure",
  evidenceCoverage,
  setup: (context) => lifecycleReceipt(context, "setup").pipe(
    Effect.andThen(Effect.fail(new Error("runner lifecycle setup primary failure"))),
  ),
  send: () => Effect.die(new Error("setup failure fixture unexpectedly reached send")),
  teardown: (context) => lifecycleReceipt(context, "teardown"),
});

export const noSetupAgent = defineAgent({
  name: "runner-no-setup",
  evidenceCoverage,
  send: (_input, context) => lifecycleReceipt(context, "send").pipe(
    Effect.as({
      status: "completed" as const,
      events: [{ type: "message" as const, role: "assistant" as const, text: "no-setup-ok" }],
    }),
  ),
  teardown: (context) => lifecycleReceipt(context, "teardown"),
});

export const setupAndTeardownFailureAgent = defineAgent({
  name: "runner-setup-and-teardown-failure",
  evidenceCoverage,
  setup: (context) => lifecycleReceipt(context, "setup").pipe(
    Effect.andThen(Effect.fail(new Error("runner lifecycle setup retained failure"))),
  ),
  send: () => Effect.die(new Error("setup failure fixture unexpectedly reached send")),
  teardown: (context) => lifecycleReceipt(context, "teardown").pipe(
    Effect.andThen(Effect.fail(new Error("runner lifecycle teardown secondary failure"))),
  ),
});

export const sendAndTeardownFailureAgent = defineAgent({
  name: "runner-send-and-teardown-failure",
  evidenceCoverage,
  send: (_input, context) => lifecycleReceipt(context, "send").pipe(
    Effect.andThen(Effect.fail(new Error("runner lifecycle send retained failure"))),
  ),
  teardown: (context) => lifecycleReceipt(context, "teardown").pipe(
    Effect.andThen(Effect.fail(new Error("runner lifecycle teardown secondary failure"))),
  ),
});

export const completionPersistenceFailureAgent = defineAgent({
  name: "runner-completion-persistence-failure",
  evidenceCoverage,
  send: (_input, ctx) => Effect.sync(() => {
    if (ctx.signal.aborted) throw new Error("runner persistence fixture send aborted");
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "runner-persistence-ok" }],
    };
  }),
  teardown: () => Effect.tryPromise({
    try: async () => {
      const projectRoot = process.cwd();
      await truncate(join(projectRoot, ".niceeval", "record.sqlite"), 0);
    },
    catch: (cause) => cause,
  }),
});
