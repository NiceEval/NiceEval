import { CliFeatureError } from "./contribution.ts";
import { normalizeExternalCause, type ExternalCause } from "../shared/external-cause.ts";
import { ownErrorCode, renderMigrationAssistance, summarizeUnknownError } from "../error-assistance/index.ts";

/** Completed CLI presentation before an external throwable is reduced to its diagnostic snapshot. */
export function cliFailureDisplay(
  cause: unknown,
  input: {
    readonly feature: string;
    readonly operation: string;
    readonly display: string | undefined;
  },
): string {
  const migration = renderMigrationAssistance(cause);
  if (migration !== undefined) return migration;
  if (input.display !== undefined) return input.display;
  if (ownErrorCode(cause)?.startsWith("ERR_PARSE_ARGS_") === true) {
    return `${summarizeUnknownError(cause)}
Run \`niceeval --help\` for usage.
`;
  }
  return `${input.feature} ${input.operation} failed: ${summarizeUnknownError(cause)}\n`;
}

/** The CLI is the final domain-result boundary; the original throwable never enters its result. */
export function externalCliFailure(
  cause: unknown,
  input: {
    readonly feature: string;
    readonly operation: string;
    readonly exitCode: number;
    readonly display: string | undefined;
  },
): CliFeatureError<ExternalCause> {
  return new CliFeatureError({
    feature: input.feature,
    operation: input.operation,
    cause: normalizeExternalCause(cause),
    exitCode: input.exitCode,
    display: cliFailureDisplay(cause, input),
  });
}

/** Root composition carries feature-owned tagged failures without knowing their domain payloads. */
export type AnyCliFeatureError = CliFeatureError<ExternalCause | { readonly _tag: string }>;
