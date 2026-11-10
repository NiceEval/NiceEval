import type * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { Command } from "effect/cli";

export interface TerminalDelivery {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type TerminalDeliverySink = (delivery: TerminalDelivery) => Effect.Effect<void>;

interface DocsCommandContribution<Name extends string = string> {
  readonly name: Name;
  readonly summary: string;
  readonly makeCommand: (deliver: TerminalDeliverySink) => Command.Command<any, never, unknown, never, NodeServices.NodeServices>;
}

export function defineDocsCommandContribution<const Name extends string>(
  contribution: DocsCommandContribution<Name>,
): DocsCommandContribution<Name> {
  return Object.freeze(contribution);
}

export function jsonDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Each contribution owns its result and error presentation. */
export function deliverDomainResult<A, E, R>(
  program: Effect.Effect<A, E, R>,
  json: boolean,
  presentation: {
    readonly success: (value: A, json: boolean) => string;
    readonly failure: (error: E, json: boolean) => string;
  },
  deliver: TerminalDeliverySink,
): Effect.Effect<void, never, R> {
  return Effect.matchEffect(program, {
    onFailure: (error) => deliver({ stdout: "", stderr: presentation.failure(error, json), exitCode: 1 }),
    onSuccess: (value) => deliver({ stdout: presentation.success(value, json), stderr: "", exitCode: 0 }),
  });
}

class DuplicateDocsContributionError extends Error {
  override readonly name = "DuplicateDocsContributionError";

  constructor(readonly commandName: string) {
    super(`Docs command contribution ${JSON.stringify(commandName)} is registered more than once.`);
  }
}

/** Preserve the explicit caller's help order, rejecting duplicates before building commands. */
export function makeDocsCommand(
  contributions: readonly DocsCommandContribution[],
  deliver: TerminalDeliverySink,
) {
  const names = new Set<string>();
  for (const contribution of contributions) {
    if (names.has(contribution.name)) throw new DuplicateDocsContributionError(contribution.name);
    names.add(contribution.name);
  }
  return Command.make("docs").pipe(
    Command.withDescription("Maintain repository design and public documentation."),
    Command.withSubcommands(contributions.map((contribution) => contribution.makeCommand(deliver))),
  );
}
