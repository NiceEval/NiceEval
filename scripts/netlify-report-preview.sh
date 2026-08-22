#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly NICEEVAL_ROOT="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"
readonly MEMORYBENCH_REPOSITORY="https://github.com/NiceEval/MemoryBench.git"
# Keep the preview on a reviewed, immutable fixture while exercising current
# Assertions v2 evidence. This commit contains the focused 12-attempt rerun.
readonly MEMORYBENCH_COMMIT="55dbfb00b39ff9405902f8d966e9eda03affe8b2"
readonly PUBLISH_DIRECTORY="$NICEEVAL_ROOT/netlify-report-preview"

if [[ "${CONTEXT:-}" != "deploy-preview" ]]; then
  echo "report previews only build in Netlify's deploy-preview context" >&2
  exit 1
fi

if [[ -e "$PUBLISH_DIRECTORY" ]]; then
  echo "report preview target already exists: $PUBLISH_DIRECTORY" >&2
  exit 1
fi

PREVIEW_SCRATCH="$(mktemp -d)"
mkdir -p "$NICEEVAL_ROOT/.netlify"
PACKAGE_SCRATCH="$(mktemp -d "$NICEEVAL_ROOT/.netlify/package-runtime.XXXXXX")"
trap 'rm -rf "$PREVIEW_SCRATCH" "$PACKAGE_SCRATCH"' EXIT
readonly MEMORYBENCH_ROOT="$PREVIEW_SCRATCH/MemoryBench"

git clone --filter=blob:none --no-checkout "$MEMORYBENCH_REPOSITORY" "$MEMORYBENCH_ROOT"
git -C "$MEMORYBENCH_ROOT" checkout --detach "$MEMORYBENCH_COMMIT"

# Netlify installs the isolated netlify-preview base, not the repository root.
# Build the linked candidate from a lockfile-complete root instead of relying
# on a stale dependency cache (the Report SPA has its own build dependencies).
corepack pnpm@11.18.0 --dir "$NICEEVAL_ROOT" install --frozen-lockfile --ignore-scripts
corepack pnpm@11.10.0 --dir "$MEMORYBENCH_ROOT" install --frozen-lockfile
TMPDIR="$PACKAGE_SCRATCH" \
corepack pnpm@11.18.0 --dir "$NICEEVAL_ROOT" dev:link "$MEMORYBENCH_ROOT"

corepack pnpm@11.10.0 --dir "$MEMORYBENCH_ROOT" exec niceeval --version
# Keep V8's old-space collector inside the preview's fixed Report RSS budget;
# the product budget remains unchanged and still rejects real excess output.
NODE_OPTIONS="--max-old-space-size=1024" \
CODEX_BASE_URL="https://preview.invalid/v1" \
CODEX_API_KEY="netlify-report-preview-no-secret" \
corepack pnpm@11.10.0 --dir "$MEMORYBENCH_ROOT" exec niceeval view \
  --out "$PUBLISH_DIRECTORY"
