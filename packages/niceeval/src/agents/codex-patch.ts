// @concord-file
// @concord-implements docs/feature/adapters/library/sdk/codex-cli/README.md
import { defineSandboxCommand } from "../sandbox/commands.ts";
import { agentBin } from "./npm-staged.ts";
import { shellQuote } from "../sandbox/shell.ts";
import type { AgentInstall, AgentInstaller } from "./types.ts";

/** Arg0 dispatch belongs to the locked native Codex binary, including in login shells. */
export function withCodexPatch(install: AgentInstall, installer: Extract<AgentInstaller, { installMode: "staged" }>): { install: AgentInstall; installer: Extract<AgentInstaller, { installMode: "staged" }> } {
  // Resolve the installation, rather than equating the official npm JS launcher
  // with its optional platform binary. Both probe and repair validate the pin.
  const native = `set -eu
fail() { printf '%s\\n' "$1" >&2; exit 1; }
is_locked_native() {
  test -f "$1" && test -x "$1" || return 1
  magic=$(od -An -tx1 -N4 "$1" | tr -d ' \\n')
  case "$magic" in 7f454c46|cffaedfe|feedfacf|cafebabe|bebafeca) ;; *) return 1 ;; esac
  test "$("$1" --version)" = ${shellQuote(`codex-cli ${install.identity.version}`)}
}
codex_entry=$(readlink -f "${agentBin("codex")}")
codex_native=""
if is_locked_native "$codex_entry"; then
  codex_native=$codex_entry
else
  package_root=$(dirname "$(dirname "$codex_entry")")
  candidates=$(find "$package_root" -type f -path '*/vendor/*/bin/codex' -print)
  old_ifs=$IFS
  IFS='
'
  for candidate in $candidates; do
    if is_locked_native "$candidate"; then codex_native=$candidate; break; fi
  done
  IFS=$old_ifs
fi
test -n "$codex_native" || fail 'native binary for the locked Codex version was not found in the existing installation'`;
  const repair: NonNullable<AgentInstaller["repair"]> = async (sandbox, context) => {
    await install.probe(sandbox, {
      phase: "before", owner: { kind: "experiment", id: "codex.repair" },
      attempt: { id: "codex.repair", index: 0 }, signal: context.signal,
      progress: context.progress, diagnostic: () => {}, onCleanup: () => {},
    });
    await sandbox.runShellOrThrow(`${native}
login_path=$(bash -lc 'printf "%s" "$PATH"')
old_ifs=$IFS
IFS=:
for directory in $login_path; do
  if [ -n "$directory" ] && [ -d "$directory" ] && [ -w "$directory" ]; then
    ln -sf "$codex_native" "$directory/apply_patch"
    IFS=$old_ifs
    exit 0
  fi
done
IFS=$old_ifs
fail 'no existing writable directory on the login PATH can host apply_patch'`, { signal: context.signal });
  };
  const probe = defineSandboxCommand({
    id: "niceeval.agent.probe.codex-login-patch", revision: "1", inputs: { version: install.identity.version },
  }, async (sandbox, context) => {
    await install.probe(sandbox, context);
    await sandbox.runShellOrThrow(`${native}
patch_path=$(bash -lc 'command -v apply_patch') || fail 'apply_patch is missing from the login PATH'
test -n "$patch_path" || fail 'apply_patch is missing from the login PATH'
test "$(readlink -f "$patch_path")" = "$codex_native" || fail 'apply_patch on the login PATH is not the native Codex binary'`, { signal: context.signal });
  });
  return {
    install: { ...install, probe },
    installer: {
      ...installer,
      progress: { ...installer.progress, repairing: `repairing Codex CLI ${install.identity.version} apply_patch link` },
      repair,
      async install(sandbox, context) {
        await installer.install(sandbox, context);
        await repair(sandbox, context);
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
