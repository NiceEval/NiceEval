import type { Effect } from "effect";

import { runPrBody } from "./domain.js";
import type { PrBodyError } from "./errors.js";
import type { PrBodyInput, PrBodyOutcome } from "./model.js";
import { renderPrBodyError, renderPrBodyOutcome } from "./presentation.js";
import { PrBodyInputSchema } from "./schema.js";
import type { PrBodyRequirements } from "./services.js";

export interface PrBodyOperationContribution {
  readonly name: PrBodyInput["command"];
  readonly summary: string;
  readonly remote: "never" | "optional" | "mutation";
}

export interface PrBodyCommandContribution {
  readonly name: "pr";
  readonly summary: string;
  readonly family: "body";
  readonly input: typeof PrBodyInputSchema;
  readonly operations: readonly PrBodyOperationContribution[];
  readonly run: (
    input: unknown,
  ) => Effect.Effect<PrBodyOutcome, PrBodyError, PrBodyRequirements>;
  readonly renderOutcome: (outcome: PrBodyOutcome) => string;
  readonly renderError: (error: PrBodyError) => string;
}

const operation = (
  name: PrBodyInput["command"],
  summary: string,
  remote: PrBodyOperationContribution["remote"],
): PrBodyOperationContribution => Object.freeze({ name, summary, remote });

/**
 * Immutable feature contribution. It exposes an Effect program and pure
 * presentation functions, but does not provide Layers or start a runtime.
 */
export const prBodyCommandContribution: PrBodyCommandContribution = Object.freeze({
  name: "pr",
  summary: "Maintain pull requests.",
  family: "body",
  input: PrBodyInputSchema,
  operations: Object.freeze([
    operation("init", "Create or initialize a managed PR body draft.", "never"),
    operation("edit", "Set or remove structured template content.", "never"),
    operation("render", "Expand directives and render final Markdown.", "never"),
    operation("check", "Validate locally; compare with GitHub only when explicitly requested.", "optional"),
    operation("apply", "Verify HEAD and update an existing GitHub pull request.", "mutation"),
    operation("create", "Create, apply, and verify a GitHub pull request from pushed HEAD.", "mutation"),
  ]),
  run: runPrBody,
  renderOutcome: renderPrBodyOutcome,
  renderError: renderPrBodyError,
});
