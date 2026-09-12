import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { defineApplication, defineApplicationContract, type Reporter } from "niceeval";

export const customApplicationContract = "e2e/native-workflow/v1";
export const customLifecycleContract = "e2e/custom-lifecycle/v1";
export const customLifecycleJournal = "custom-lifecycle.journal.jsonl";

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

function nativeApplication(implementation: "alpha" | "beta") {
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
          if (Object.hasOwn(this, "check")) throw new Error("application this must not contain evaluator methods");
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

const nativeContract = defineApplicationContract<NativeWorkflow>({ name: customApplicationContract });

// The Eval is intentionally defined from alpha while the beta Experiment uses
// a distinct factory object with the same contract. This catches a bound Eval
// that incorrectly closes over alpha.create().
export const customAlpha = nativeApplication("alpha");
export const customBeta = nativeApplication("beta");

type JournalEntry = Readonly<Record<string, string | number>>;
let journalWrites: Promise<void> = Promise.resolve();

function writeJournal(entry: JournalEntry): Promise<void> {
  const path = join(process.cwd(), customLifecycleJournal);
  journalWrites = journalWrites.then(() => appendFile(path, `${JSON.stringify(entry)}\n`, "utf8"));
  return journalWrites;
}

export interface CustomLifecycleApplication {
  waitForCancellation(): Promise<void>;
  onCancellation(callback: () => void): void;
  observations: {
    recordAbortCheck(boundary: "check" | "handle" | "method", outcome: "accepted" | "rejected"): Promise<void>;
    recordLateAssertion(outcome: "accepted" | "rejected"): Promise<void>;
  };
}

const lifecycleContract = defineApplicationContract<CustomLifecycleApplication>({ name: customLifecycleContract });

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
    context.onCleanup(() => writeJournal({
      scenario: "create-failure", event: "cleanup-outer", attempt: context.attempt,
    }));
    context.onCleanup(async () => {
      await writeJournal({ scenario: "create-failure", event: "cleanup-inner", attempt: context.attempt });
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
    context.onCleanup(async () => {
      await writeJournal({ scenario: "timeout", event: "cleanup-outer", attempt: context.attempt });
      // Keep the external fixture journal alive until its late continuation
      // has observed the closed evaluator. No process-exit timing assumption.
      await lateObservation;
    });
    context.onCleanup(() => writeJournal({
      scenario: "timeout", event: "cleanup-inner", attempt: context.attempt,
    }));
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

export const successfulSlowCleanup = defineApplication({
  name: "successful-slow-cleanup",
  create(context) {
    context.onCleanup(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5_100));
      await writeJournal({ scenario: "success", event: "cleanup-finished", attempt: context.attempt });
      throw new Error("successful Application cleanup fixture failure");
    });
    return { value: () => 42 };
  },
});
