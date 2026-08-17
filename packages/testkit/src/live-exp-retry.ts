import type { ExpEvalEvent, ProcessReceipt } from "./process.js";

export interface RetriedExpEval {
  readonly target: ExpEvalEvent;
  readonly event: ExpEvalEvent;
  readonly receipt: ProcessReceipt;
}

export interface RetryFailedExpEvalsOnceResult {
  readonly events: readonly ExpEvalEvent[];
  readonly retries: readonly RetriedExpEval[];
}

function identityOf(event: Pick<ExpEvalEvent, "experimentId" | "evalId">): string {
  return JSON.stringify([event.experimentId, event.evalId]);
}

function labelOf(event: Pick<ExpEvalEvent, "experimentId" | "evalId">): string {
  return `${event.experimentId}/${event.evalId}`;
}

function fail(message: string, receipt?: ProcessReceipt): never {
  throw new Error(
    receipt === undefined ? message : `${message}\n\n${receipt.diagnostic()}`,
  );
}

/**
 * Execute caller-selected live Eval retries serially and replace only the
 * matching effective conclusion. The caller owns retry eligibility, argv,
 * timeout, and the final expected matrix.
 */
export async function retryFailedExpEvalsOnce(
  options: {
    readonly events: readonly ExpEvalEvent[];
    readonly targets: readonly ExpEvalEvent[];
    readonly runRetry: (target: ExpEvalEvent) => Promise<ProcessReceipt>;
  },
): Promise<RetryFailedExpEvalsOnceResult> {
  const eventIdentities = new Set<string>();
  for (const event of options.events) {
    const identity = identityOf(event);
    if (eventIdentities.has(identity)) {
      fail(`retryFailedExpEvalsOnce(): duplicate initial Eval identity ${labelOf(event)}`);
    }
    eventIdentities.add(identity);
  }

  const targetIdentities = new Set<string>();
  for (const target of options.targets) {
    const identity = identityOf(target);
    if (targetIdentities.has(identity)) {
      fail(`retryFailedExpEvalsOnce(): duplicate retry target ${labelOf(target)}`);
    }
    if (!eventIdentities.has(identity)) {
      fail(
        `retryFailedExpEvalsOnce(): retry target is absent from initial events: ${labelOf(target)}`,
      );
    }
    if (target.verdict !== "failed") {
      fail(
        `retryFailedExpEvalsOnce(): retry target ${labelOf(target)} has verdict ${target.verdict}, expected failed`,
      );
    }
    if (target.attempts !== 1) {
      fail(
        `retryFailedExpEvalsOnce(): retry target ${labelOf(target)} has ${target.attempts} attempts, expected 1`,
      );
    }
    targetIdentities.add(identity);
  }

  const replacements = new Map<string, ExpEvalEvent>();
  const retries: RetriedExpEval[] = [];
  for (const target of options.targets) {
    const receipt = await options.runRetry(target);
    const invocation = receipt.expReceipt();
    if (invocation.completion !== "completed") {
      fail(
        `retryFailedExpEvalsOnce(): retry ${labelOf(target)} completed as ${invocation.completion}`,
        receipt,
      );
    }
    const events = receipt.expEvalEvents();
    if (events.length !== 1) {
      fail(
        `retryFailedExpEvalsOnce(): retry ${labelOf(target)} produced ${events.length} Eval conclusions, expected 1`,
        receipt,
      );
    }
    const event = events[0]!;
    if (identityOf(event) !== identityOf(target)) {
      fail(
        `retryFailedExpEvalsOnce(): retry ${labelOf(target)} returned ${labelOf(event)}`,
        receipt,
      );
    }
    if (event.verdict !== "passed") {
      fail(
        `retryFailedExpEvalsOnce(): retry ${labelOf(target)} has verdict ${event.verdict}, expected passed`,
        receipt,
      );
    }
    if (receipt.exitCode !== 0) {
      fail(
        `retryFailedExpEvalsOnce(): retry ${labelOf(target)} exited ${receipt.exitCode}, expected 0`,
        receipt,
      );
    }
    replacements.set(identityOf(target), event);
    retries.push({ target, event, receipt });
  }

  return {
    events: options.events.map((event) => replacements.get(identityOf(event)) ?? event),
    retries,
  };
}
