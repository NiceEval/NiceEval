// Minimal-injection secret env construction for the e2e orchestrator.
//
// A repo must only ever see the secrets it declared in its own e2e.json —
// never another repo's secrets, even though the orchestrator's own process
// env holds the whole matrix's worth of keys (CI injects them all once).

/**
 * Conservative name-only deny rule. It never inspects values, so it is safe
 * to apply to local .env and CI environments alike. Ordinary execution state
 * such as PATH, HOME, locale, proxy routing, and Node/pnpm configuration is
 * preserved unless its name itself identifies authentication material.
 */
const SENSITIVE_NAME_SEGMENT = /(?:^|_)(?:token|key|secret|password|passwd|credential|credentials|auth|authorization|jwt)(?:_|$)/i;
const SENSITIVE_COMPOUND_MARKER = /(?:token|secret|password|passwd|credential|credentials|auth|authorization|jwt)/i;
const SENSITIVE_KEY_COMPOUND = /^(?:(?:api|access|private|public|signing|encryption|client|ssh|aws|github|gh|npm|database|db)_?)?key$/i;
const SENSITIVE_CONNECTION_SEGMENT = /(?:^|_)(?:db|database|postgres(?:ql)?|mysql|mariadb|mongodb|redis|amqp|kafka)(?:_|$)/i;

function normalizedSensitiveName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Exported for smoke/audit tooling; never returns or logs a variable value. */
export function isSensitiveEnvName(name: string): boolean {
  const normalized = normalizedSensitiveName(name);
  if (SENSITIVE_NAME_SEGMENT.test(normalized)) return true;

  // CI systems and local tools sometimes omit separators (for example
  // GITHUBTOKEN or apiToken). Treat recognized credential suffixes as
  // sensitive too, while avoiding unrelated words such as MONKEY.
  const compact = normalized.replaceAll("_", "");
  return (
    SENSITIVE_COMPOUND_MARKER.test(compact) ||
    SENSITIVE_KEY_COMPOUND.test(normalized) ||
    SENSITIVE_CONNECTION_SEGMENT.test(normalized)
  );
}

/**
 * Build the environment a single repo's isolated command runs under.
 *
 * Starts from the orchestrator's own process env (so PATH/HOME/etc. and
 * ordinary operational env survive), strips every declared matrix secret and
 * every sensitive-name variable that this repo did not declare, then adds
 * back only this repo's own declared values. This makes unknown local/CI
 * credentials fail closed without needing to enumerate their values.
 */
export function buildChildEnv(
  baseEnv: NodeJS.ProcessEnv,
  allDeclaredSecretNames: ReadonlySet<string>,
  thisRepoSecrets: readonly string[],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const name of allDeclaredSecretNames) {
    delete env[name];
  }
  const allowed = new Set(thisRepoSecrets);
  for (const name of Object.keys(env)) {
    if (isSensitiveEnvName(name) && !allowed.has(name)) delete env[name];
  }
  for (const name of thisRepoSecrets) {
    const value = baseEnv[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  if (
    thisRepoSecrets.length > 0 &&
    thisRepoSecrets.every((name) => typeof baseEnv[name] === "string" && baseEnv[name]!.length > 0)
  ) {
    env.NICEEVAL_E2E_DECLARED_SECRETS_READY = "1";
  } else {
    delete env.NICEEVAL_E2E_DECLARED_SECRETS_READY;
  }
  return env;
}
