// Minimal-injection secret env construction for the e2e orchestrator.
//
// A repo must only ever see the secrets it declared in its own e2e.json —
// never another repo's secrets, even though the orchestrator's own process
// env holds the whole matrix's worth of keys (CI injects them all once).

/**
 * Build the environment a single repo's isolated command runs under.
 *
 * Starts from the orchestrator's own process env (so PATH/HOME/etc. and
 * ordinary operational env survive), strips every secret name declared by
 * *any* discovered repo (so a repo can never see a sibling repo's secret by
 * accident), then adds back only this repo's own declared secrets — and only
 * the ones actually set in the orchestrator's env (never invents empty
 * values for unset ones).
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
  for (const name of thisRepoSecrets) {
    const value = baseEnv[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}
