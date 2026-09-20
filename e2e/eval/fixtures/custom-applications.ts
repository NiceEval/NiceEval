import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { defineAdapter, defineAdapterContract, type Reporter } from "niceeval";

export const customAdapterContract = "e2e/native-workflow/v1";
export const customLifecycleContract = "e2e/custom-lifecycle/v1";
export const customLifecycleJournal = "custom-lifecycle.journal.jsonl";
export const customIdentityJournal = "custom-identity.journal.jsonl";

export interface NativeWorkflow {
  readonly implementation: "alpha" | "beta";
  readonly calls: number;
  begin(title: string): { readonly sequence: number; readonly title: string };
  append(value: number): { readonly sequence: number; readonly total: number };
  finish(): { readonly sequence: number; readonly summary: string };
}

class Workflow {
  private sequence = 0;
  private total = 0;

  constructor(readonly implementation: "alpha" | "beta") {}

  begin(title: string) {
    this.sequence += 1;
    return { sequence: this.sequence, title: `${this.implementation}:${title}` };
  }

  append(value: number) {
    this.sequence += 1;
    this.total += value;
    return { sequence: this.sequence, total: this.total };
  }

  finish() {
    this.sequence += 1;
    return {
      sequence: this.sequence,
      summary: `${this.implementation}:${this.total}`,
    };
  }
}

function nativeAdapter(implementation: "alpha" | "beta") {
  return nativeContract.implement({
    name: `custom-${implementation}`,
    behaviorRevision: "1",
    create() {
      const workflow = new Workflow(implementation);
      const context = {
        implementation,
        count: 0,
        get calls() { return this.count; },
        begin(title: string) {
          if (Object.hasOwn(this, "check")) throw new Error("Adapter this must not contain evaluator methods");
          this.count += 1;
          return workflow.begin(title);
        },
        append(value: number) {
          this.count += 1;
          return workflow.append(value);
        },
        finish() {
          this.count += 1;
          return workflow.finish();
        },
      };
      return context;
    },
  });
}

const nativeContract = defineAdapterContract<NativeWorkflow>({ name: customAdapterContract });

// The Eval is intentionally defined from alpha while the beta Experiment uses
// a distinct factory object with the same contract. This catches a bound Eval
// that incorrectly closes over alpha.create().
export const customAlpha = nativeAdapter("alpha");
export const customBeta = nativeAdapter("beta");

type JournalEntry = Readonly<Record<string, string | number>>;
let journalWrites: Promise<void> = Promise.resolve();

function writeJournal(entry: JournalEntry): Promise<void> {
  const path = join(process.cwd(), customLifecycleJournal);
  journalWrites = journalWrites.then(() => appendFile(path, `${JSON.stringify(entry)}\n`, "utf8"));
  return journalWrites;
}

export const customIdentityReporter: Reporter = {
  onEvent(event) {
    if (event.type !== "eval:start") return;
    const path = join(process.cwd(), customIdentityJournal);
    journalWrites = journalWrites.then(() => appendFile(path, `${JSON.stringify({
      source: "event",
      experimentId: event.experimentId ?? "",
      attempt: event.attempt,
      adapter: event.adapter,
    })}\n`, "utf8"));
    return journalWrites;
  },
  onEvalComplete(result) {
    const path = join(process.cwd(), customIdentityJournal);
    journalWrites = journalWrites.then(() => appendFile(path, `${JSON.stringify({
      source: "result",
      experimentId: result.experimentId ?? "",
      attempt: result.attempt,
      adapter: result.adapter,
    })}\n`, "utf8"));
    return journalWrites;
  },
};

export interface CustomLifecycleAdapter {
  waitForCancellation(): Promise<void>;
  onCancellation(callback: () => void): void;
  observations: {
    recordAbortCheck(boundary: "check" | "handle" | "method", outcome: "accepted" | "rejected"): Promise<void>;
    recordLateAssertion(outcome: "accepted" | "rejected"): Promise<void>;
  };
}

const lifecycleContract = defineAdapterContract<CustomLifecycleAdapter>({ name: customLifecycleContract });

let registerAfterTimeout: (() => void) | undefined;
export const timeoutClosedRegistrationReporter: Reporter = {
  async onEvalComplete(result) {
    if (registerAfterTimeout === undefined) throw new Error("fixture did not retain its registration callback");
    let outcome = "accepted";
    try { registerAfterTimeout(); } catch { outcome = "rejected"; }
    await writeJournal({ scenario: "timeout", event: `closed-registration-${outcome}`, attempt: result.attempt });
  },
};

export const customCreateFailure = lifecycleContract.implement({
  name: "custom-create-failure",
  behaviorRevision: "1",
  async create(context) {
    await writeJournal({ scenario: "create-failure", event: "acquired", attempt: context.attempt });
    let cleanupWindowSignal: AbortSignal | undefined;
    context.onCleanup((cleanupContext) => writeJournal({
      scenario: "create-failure",
      event: cleanupContext.signal === cleanupWindowSignal && !cleanupContext.signal.aborted && Object.isFrozen(cleanupContext)
        ? "cleanup-outer-shared-live-frozen"
        : "cleanup-outer-invalid-context",
      attempt: context.attempt,
    }));
    context.onCleanup(async (cleanupContext) => {
      cleanupWindowSignal = cleanupContext.signal;
      await writeJournal({
        scenario: "create-failure",
        event: !cleanupContext.signal.aborted && Object.isFrozen(cleanupContext)
          ? "cleanup-inner-live-frozen"
          : "cleanup-inner-invalid-context",
        attempt: context.attempt,
      });
      throw new Error("fixture resource release failure must not skip outer cleanup");
    });
    throw new Error("custom fixture fails after acquiring its resource");
  },
});

export const customTimeoutCancellation = lifecycleContract.implement({
  name: "custom-timeout-cancellation",
  behaviorRevision: "1",
  async create(context) {
    await writeJournal({ scenario: "timeout", event: "acquired", attempt: context.attempt });
    registerAfterTimeout = () => context.onCleanup(() => {});
    let acknowledgeLateObservation!: () => void;
    const lateObservation = new Promise<void>((resolve) => { acknowledgeLateObservation = resolve; });
    let cleanupWindowSignal: AbortSignal | undefined;
    context.onCleanup(async (cleanupContext) => {
      await writeJournal({
        scenario: "timeout",
        event: cleanupContext.signal === cleanupWindowSignal && !cleanupContext.signal.aborted && Object.isFrozen(cleanupContext)
          ? "cleanup-outer-shared-live-frozen"
          : "cleanup-outer-invalid-context",
        attempt: context.attempt,
      });
      // Keep the external fixture journal alive until its late continuation
      // has observed the closed evaluator. No process-exit timing assumption.
      await lateObservation;
      await new Promise<void>((resolve) => {
        if (cleanupContext.signal.aborted) resolve();
        else cleanupContext.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      // The reporter's later write is chained behind this append, so process
      // completion observes a durable terminal event without a timing sleep.
      await writeJournal({ scenario: "timeout", event: "cleanup-window-aborted", attempt: context.attempt });
    });
    context.onCleanup((cleanupContext) => {
      cleanupWindowSignal = cleanupContext.signal;
      return writeJournal({
        scenario: "timeout",
        event: context.signal.aborted && !cleanupContext.signal.aborted && Object.isFrozen(cleanupContext)
          ? "cleanup-inner-attempt-aborted-window-live-frozen"
          : "cleanup-inner-invalid-context",
        attempt: context.attempt,
      });
    });
    return {
      onCancellation(callback: () => void) {
        context.signal.addEventListener("abort", callback, { once: true });
      },
      async waitForCancellation() {
        if (!context.signal.aborted) {
          await new Promise<void>((resolve) => {
            context.signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        // The timer deliberately outlives cancellation. NiceEval cannot stop a
        // plain Promise, so the sealed Assertion boundary must reject its work.
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      },
      observations: {
        recordAbortCheck(boundary, outcome) {
          return writeJournal({ scenario: "timeout", event: `abort-${boundary}-${outcome}`, attempt: context.attempt });
        },
        async recordLateAssertion(outcome) {
          await writeJournal({ scenario: "timeout", event: `late-assertion-${outcome}`, attempt: context.attempt });
          acknowledgeLateObservation();
        },
      },
    };
  },
});

export const successfulSlowCleanup = defineAdapter({
  name: "successful-slow-cleanup",
  create(context) {
    context.onCleanup(async (cleanupContext) => {
      await writeJournal({
        scenario: "success",
        event: !cleanupContext.signal.aborted && Object.isFrozen(cleanupContext)
          ? "cleanup-live-frozen"
          : "cleanup-invalid-context",
        attempt: context.attempt,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 5_100));
      await writeJournal({ scenario: "success", event: "cleanup-finished", attempt: context.attempt });
      throw new Error("successful Adapter cleanup fixture failure");
    });
    return { value: () => 42 };
  },
});
