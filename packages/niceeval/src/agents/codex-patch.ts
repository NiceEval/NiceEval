// @concord-file
// @concord-implements docs/feature/adapters/library/sdk/codex-cli/README.md
import { defineSandboxCommand } from "../sandbox/commands.ts";
import { agentBin } from "./npm-staged.ts";
import type { AgentEnsure, AgentInstaller } from "./types.ts";

/** Arg0 dispatch belongs to the locked native Codex binary, including in login shells. */
export function withCodexPatch(ensure: AgentEnsure, installer: Extract<AgentInstaller, { installMode: "staged" }>): { ensure: AgentEnsure; installer: Extract<AgentInstaller, { installMode: "staged" }> } {
  const probe = defineSandboxCommand({
    id: "niceeval.agent.probe.codex-login-patch", revision: "1", inputs: { version: ensure.identity.version },
  }, async (sandbox, context) => {
    await ensure.probe(sandbox, context);
    await sandbox.runShellOrThrow(`set -eu
codex_native=$(readlink -f "${agentBin("codex")}")
patch_path=$(bash -lc 'command -v apply_patch')
test -n "$patch_path"
test "$(readlink -f "$patch_path")" = "$codex_native"`, { signal: context.signal });
  });
  return {
    ensure: { ...ensure, probe },
    installer: {
      ...installer,
      async install(sandbox, context) {
        await installer.install(sandbox, context);
        // Staged installation above always provides the native platform binary.
        // Only an existing login-PATH directory is used; profiles and PATH stay intact.
        await sandbox.runShellOrThrow(`set -eu
codex_native=$(readlink -f "$HOME/.local/bin/codex")
login_path=$(bash -lc 'printf "%s" "$PATH"')
installed=false
old_ifs=$IFS
IFS=:
for directory in $login_path; do
  if [ -n "$directory" ] && [ -d "$directory" ] && [ -w "$directory" ]; then
    ln -sf "$codex_native" "$directory/apply_patch"
    installed=true
    break
  fi
done
IFS=$old_ifs
test "$installed" = true`, { signal: context.signal });
      },
    } satisfies Extract<AgentInstaller, { installMode: "staged" }>,
  };
}

/** Native npm optional dependency; linking the JavaScript launcher would break arg0 dispatch. */
export const CODEX_NPM_PATCH_SETUP = `set -eu
codex_native=$(find "$(npm root -g)/@openai/codex" -type f -path '*/vendor/*/bin/codex' -print -quit)
test -n "$codex_native"
ln -sf "$codex_native" /usr/local/bin/apply_patch
bash -lc 'command -v apply_patch'`;
