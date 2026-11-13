#!/usr/bin/env bash
set -euo pipefail

# This is a same-workflow transport for installed tools, not test evidence.
# The producer's digest travels through a job output, outside the archive.
mode="${1:?expected capture or restore}"
archive="${2:?expected archive path}"

case "$mode" in
  capture)
    stage="$(mktemp -d "${RUNNER_TEMP}/e2e-tools-capture.XXXXXX")"
    trap 'rm -rf "$stage"' EXIT
    mkdir "$stage/bin"
    cp -L "$(command -v node)" "$stage/bin/node"
    cp -L "$(command -v pnpm)" "$stage/bin/pnpm"
    # pnpm/setup links dist to the producer's tool cache. Materialize the
    # tree: preserving that absolute link passes capture on this runner but
    # leaves the archive unusable on another runner or inside a container.
    cp -RL "${PNPM_HOME:?expected pnpm/setup installation}/dist" "$stage/bin/dist"
    test ! -L "$stage/bin/dist"
    test -f "$stage/bin/dist/pnpm.mjs"
    cp -R "${CONCORD_PACKAGE_ROOT:?expected installed Concord package}" "$stage/concord"
    if [[ -f "$stage/concord/bin/concord" ]]; then
      ln -s ../concord/bin/concord "$stage/bin/concord"
      chmod +x "$stage/bin/node" "$stage/bin/pnpm" "$stage/concord/bin/concord"
    else
      ln -s ../concord/dist/entry.js "$stage/bin/concord"
      chmod +x "$stage/bin/node" "$stage/bin/pnpm" "$stage/concord/dist/entry.js"
    fi
    export PATH="$stage/bin:$PATH"
    node - "$stage/versions.json" <<'NODE'
const fs = require('node:fs');
const cp = require('node:child_process');
const version = command => {
  const actual = cp.execFileSync(command, ['--version'], { encoding: 'utf8' }).trim();
  console.log(`${command}: ${actual}`);
  return actual;
};
fs.writeFileSync(process.argv[2], JSON.stringify({
  platform: process.platform, arch: process.arch,
  node: version('node'), pnpm: version('pnpm'), concord: version('concord'),
}) + '\n');
NODE
    mkdir -p "$(dirname "$archive")"
    tar -czf "$archive" -C "$stage" bin concord versions.json
    digest="$(shasum -a 256 "$archive" | awk '{print $1}')"
    echo "sha256=$digest" >> "$GITHUB_OUTPUT"
    echo "[e2e] captured toolchain sha256=$digest"
    ;;
  restore)
    expected="${EXPECTED_TOOLCHAIN_SHA256:?expected producer digest}"
    [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid toolchain digest' >&2; exit 1; }
    actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
    [[ "$actual" == "$expected" ]] || { echo 'Toolchain digest mismatch' >&2; exit 1; }
    stage="$(mktemp -d "${RUNNER_TEMP}/e2e-tools.XXXXXX")"
    trap 'rm -rf "$stage"' EXIT
    tar -xzf "$archive" -C "$stage"
    export PATH="$stage/bin:$PATH"
    # pnpm/setup normally disables runtime shims after selecting Node. Keep
    # the transported Node authoritative instead of installing another one.
    export PNPM_CONFIG_GLOBAL_SHIMS='{"node":false}'
    node - "$stage/versions.json" <<'NODE'
const fs = require('node:fs');
const cp = require('node:child_process');
const saved = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (saved.platform !== process.platform || saved.arch !== process.arch) throw Error('Toolchain platform mismatch');
for (const name of ['node', 'pnpm', 'concord']) {
  const actual = cp.execFileSync(name, ['--version'], { encoding: 'utf8' }).trim();
  if (actual !== saved[name]) throw Error(`${name} version mismatch`);
  console.log(`${name}: ${actual}`);
}
const wanted = JSON.parse(fs.readFileSync('package.json', 'utf8')).packageManager;
if (wanted !== `pnpm@${saved.pnpm}`) throw Error('Toolchain does not match packageManager');
NODE
    git config --global --add safe.directory "$(pwd -P)"
    git rev-parse --show-toplevel
    concord --version
    echo "$stage/bin" >> "$GITHUB_PATH"
    echo 'PNPM_CONFIG_GLOBAL_SHIMS={"node":false}' >> "$GITHUB_ENV"
    store="$(pnpm store path --silent)"
    echo "store=$store" >> "$GITHUB_OUTPUT"
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
      {
        echo '### E2E environment preflight'
        echo
        echo "- Verified same-run toolchain SHA-256: \`$actual\`"
        echo '- Tool versions, platform, Git root and Concord engine: passed'
        echo '- pnpm and Concord bootstrap downloads in this cell: 0'
      } >> "$GITHUB_STEP_SUMMARY"
    fi
    trap - EXIT
    ;;
  *) echo "Unknown toolchain operation: $mode" >&2; exit 1 ;;
esac
