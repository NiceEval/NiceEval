import type { Command } from "@effect/cli";
import type { FileSystem } from "@effect/platform";
import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Effect } from "effect";

/** A complete terminal decision made by one repository-tools domain. */
export interface TerminalDelivery {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type TerminalDeliverySink = (
  delivery: TerminalDelivery,
) => Effect.Effect<void>;

// @effect/cli intentionally erases heterogeneous subcommand types in
// Command.withSubcommands. Keep that existential type in this composition seam.
export type MountedDocsCommand = Command.Command<
  any,
  FileSystem.FileSystem | CommandExecutor,
  never,
  any
>;

export interface DocsCommandContribution<Name extends string = string> {
  readonly name: Name;
  readonly summary: string;
  readonly makeCommand: (deliver: TerminalDeliverySink) => MountedDocsCommand;
}

export function defineDocsCommandContribution<const Name extends string>(
  contribution: DocsCommandContribution<Name>,
): DocsCommandContribution<Name> {
  return Object.freeze(contribution);
}

export function stdoutDelivery(stdout: string): TerminalDelivery {
  return { stdout, stderr: "", exitCode: 0 };
}

export function stderrDelivery(stderr: string): TerminalDelivery {
  return { stdout: "", stderr, exitCode: 1 };
}

export function jsonDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

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
    onFailure: (error) => deliver(stderrDelivery(presentation.failure(error, json))),
    onSuccess: (value) => deliver(stdoutDelivery(presentation.success(value, json))),
  });
}
