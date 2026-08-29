import type { PrBodyError } from "./errors.js";
import type { PrBodyOutcome } from "./model.js";

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Pure presentation: the application root remains the sole stdout/stderr writer. */
export function renderPrBodyOutcome(outcome: PrBodyOutcome): string {
  switch (outcome._tag) {
    case "DraftCreated":
      return `Created ${outcome.path}\n`;
    case "DraftInitialized":
      return `Initialized existing draft ${outcome.path}\n`;
    case "DraftStatus":
      return `${outcome.path}: ${outcome.state}\n`;
    case "DraftDiscarded":
      return `Discarded ${outcome.path}\n`;
    case "DraftEdited":
      return `Updated ${outcome.path} (${outcome.sections} sections, ${outcome.cases} cases, ${outcome.tests} tests)\n`;
    case "BodyRendered":
      return outcome.destination === "stdout"
        ? outcome.body
        : `Rendered ${outcome.destination} (${outcome.bytes} bytes)\n`;
    case "BodyChecked":
      return `${outcome.report.text}\nPR body check passed.\n`;
    case "BodyApplied":
      return `${outcome.report.text}\nPR body check passed.\nUpdated PR #${outcome.pr} from ${outcome.source}\n`;
    case "PullRequestCreated":
      return [
        outcome.report.text,
        "PR body check passed.",
        `Created ${outcome.url}`,
        `Updated PR #${outcome.pr} from ${outcome.source}`,
        "",
      ].join("\n");
  }
}

/** Pure failure presentation for the root failure renderer. */
export function renderPrBodyError(error: PrBodyError): string {
  switch (error._tag) {
    case "PrInputInvalid":
      return error.message;
    case "PrFileFailure":
      return `${error.operation} ${error.path} failed: ${causeMessage(error.cause)}`;
    case "PrGitFailure":
      return `git ${error.args.join(" ")} failed: ${causeMessage(error.cause)}`;
    case "PrGitHubFailure":
      return `gh pr ${error.operation} failed: ${causeMessage(error.cause)}`;
    case "PrDraftInvalid":
      return error.message;
    case "PrBodyCheckFailed":
      return `${error.report}\nPR body check failed:\n${error.findings.map((finding) => `- ${finding}`).join("\n")}`;
    case "PrTestRelationInvalid":
      return `test relation ${error.selector} is invalid: ${error.message}`;
    case "PrRemoteHeadMismatch":
      return `refusing to apply: GitHub PR head ${error.remoteHead} does not match local HEAD ${error.localHead}`;
    case "PrMutationRejected":
      return error.message;
    case "PrInternalFailure":
      return `${error.operation} failed: ${causeMessage(error.cause)}`;
  }
}
