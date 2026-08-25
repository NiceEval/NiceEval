import { Command } from "@effect/cli";

import type {
  DocsCommandContribution,
  MountedDocsCommand,
  TerminalDeliverySink,
} from "./contribution.js";

export class DuplicateDocsContributionError extends Error {
  readonly name = "DuplicateDocsContributionError";

  constructor(readonly commandName: string) {
    super(`Docs command contribution ${JSON.stringify(commandName)} is registered more than once.`);
  }
}

function rejectDuplicateNames(contributions: readonly DocsCommandContribution[]): void {
  const seen = new Set<string>();
  for (const contribution of contributions) {
    if (seen.has(contribution.name)) {
      throw new DuplicateDocsContributionError(contribution.name);
    }
    seen.add(contribution.name);
  }
}

/**
 * Compose immutable Docs contributions in the caller-supplied help order.
 * Duplicate detection deliberately runs before command builders and runtime I/O.
 */
export function makeDocsCommand(
  contributions: readonly [DocsCommandContribution, ...DocsCommandContribution[]],
  deliver: TerminalDeliverySink,
) {
  rejectDuplicateNames(contributions);
  const commands = contributions.map((contribution) => contribution.makeCommand(deliver)) as [
    MountedDocsCommand,
    ...MountedDocsCommand[],
  ];
  return Command.make("docs").pipe(
    Command.withDescription("Maintain repository design and public documentation."),
    Command.withSubcommands(commands),
  );
}
