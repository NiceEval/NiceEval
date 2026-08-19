const DECLARED_SECRETS_READY_ENV = "NICEEVAL_E2E_DECLARED_SECRETS_READY";

/**
 * Confirms the root runner already validated every secret declared by this
 * Repo's manifest. Product owners stay independent from CI secret names.
 */
export function requireDeclaredLiveSecrets(repoId: string): void {
  if (process.env[DECLARED_SECRETS_READY_ENV] !== "1") {
    throw new Error(
      `[configuration] live ${repoId} E2E requires all secrets declared by e2e.json; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}
