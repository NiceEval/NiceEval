import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  completeEvidenceCoverage,
  defineAgent,
  type AgentContext,
} from "niceeval/adapter";

const evidenceCoverage = {
  ...completeEvidenceCoverage,
  usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
} as const;

async function lifecycleReceipt(context: AgentContext, event: string): Promise<void> {
  const path = context.flags.lifecycleReceipt;
  if (typeof path !== "string") {
    throw new Error("runner lifecycle fixture requires flags.lifecycleReceipt");
  }
  await writeFile(path, `${event}\n`, {
    encoding: "utf8",
    flag: "a",
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });
}

export const timingAgent = defineAgent({
  name: "runner-timing",
  evidenceCoverage,
  setup: async (ctx) => {
    if (ctx.signal.aborted) throw new Error("runner timing fixture setup aborted");
  },
  send: async (_input, ctx) => {
    if (ctx.signal.aborted) throw new Error("runner timing fixture send aborted");
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "runner-timing-ok" }],
    };
  },
});

export const setupFailureAgent = defineAgent({
  name: "runner-setup-failure",
  evidenceCoverage,
  setup: async (context) => {
    await lifecycleReceipt(context, "setup");
    throw new Error("runner lifecycle setup primary failure");
  },
  send: async () => {
    throw new Error("setup failure fixture unexpectedly reached send");
  },
  teardown: (context) => lifecycleReceipt(context, "teardown"),
});

export const noSetupAgent = defineAgent({
  name: "runner-no-setup",
  evidenceCoverage,
  send: async (_input, context) => {
    await lifecycleReceipt(context, "send");
    return {
      status: "completed" as const,
      events: [{ type: "message" as const, role: "assistant" as const, text: "no-setup-ok" }],
    };
  },
  teardown: (context) => lifecycleReceipt(context, "teardown"),
});

export const setupAndTeardownFailureAgent = defineAgent({
  name: "runner-setup-and-teardown-failure",
  evidenceCoverage,
  setup: async (context) => {
    await lifecycleReceipt(context, "setup");
    throw new Error("runner lifecycle setup retained failure");
  },
  send: async () => {
    throw new Error("setup failure fixture unexpectedly reached send");
  },
  teardown: async (context) => {
    await lifecycleReceipt(context, "teardown");
    throw new Error("runner lifecycle teardown secondary failure");
  },
});

export const sendAndTeardownFailureAgent = defineAgent({
  name: "runner-send-and-teardown-failure",
  evidenceCoverage,
  send: async (_input, context) => {
    await lifecycleReceipt(context, "send");
    throw new Error("runner lifecycle send retained failure");
  },
  teardown: async (context) => {
    await lifecycleReceipt(context, "teardown");
    throw new Error("runner lifecycle teardown secondary failure");
  },
});

export const completionPersistenceFailureAgent = defineAgent({
  name: "runner-completion-persistence-failure",
  evidenceCoverage,
  send: async (_input, ctx) => {
    if (ctx.signal.aborted) throw new Error("runner persistence fixture send aborted");
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "runner-persistence-ok" }],
    };
  },
  teardown: async () => {
    const database = new DatabaseSync(join(process.cwd(), ".niceeval", "record.sqlite"));
    database.exec("BEGIN EXCLUSIVE");
    setTimeout(() => {
      try {
        database.exec("ROLLBACK");
      } finally {
        database.close();
      }
    }, 15_000);
  },
});

export const attemptPublicationFailureAgent = defineAgent({
  name: "runner-attempt-publication-failure",
  evidenceCoverage,
  send: async (_input, ctx) => {
    if (ctx.signal.aborted) throw new Error("runner publication fixture send aborted");
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "runner-timing-ok" }],
    };
  },
  teardown: async () => {
    const database = new DatabaseSync(join(process.cwd(), ".niceeval", "record.sqlite"));
    try {
      database.exec(`CREATE TRIGGER reject_attempt_publication
        BEFORE INSERT ON attempt_publications
        BEGIN SELECT RAISE(ABORT, 'fixture rejected attempt publication'); END`);
    } finally {
      database.close();
    }
  },
});
