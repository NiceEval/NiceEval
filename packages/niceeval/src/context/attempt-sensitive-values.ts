import { Context } from "effect";
import { knownSensitiveValues, rememberSensitiveValues } from "../sandbox/redaction.ts";

export type RememberAttemptCredentials = (...values: readonly (string | undefined)[]) => void;

/** Private registration capability for built-in transports running inside an Attempt. */
export const CurrentAttemptCredentials = Context.Reference<RememberAttemptCredentials>(
  "niceeval/CurrentAttemptCredentials",
  { defaultValue: () => () => {} },
);

export function attemptCredentialRegistration(sensitiveValues: Set<string>): RememberAttemptCredentials {
  return (...values) => rememberSensitiveValues(sensitiveValues, knownSensitiveValues(...values));
}
