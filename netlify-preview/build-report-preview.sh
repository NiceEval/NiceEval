#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly NICEEVAL_ROOT="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"
readonly PREVIEW_REPOSITORY="${NICEEVAL_PREVIEW_REPOSITORY:-https://github.com/NiceEval/NiceEval-Preview.git}"
readonly PREVIEW_REF="${NICEEVAL_PREVIEW_REF:-main}"
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
readonly PREVIEW_ROOT="$PREVIEW_SCRATCH/NiceEval-Preview"

git clone --filter=blob:none --single-branch --branch "$PREVIEW_REF" \
  "$PREVIEW_REPOSITORY" "$PREVIEW_ROOT"
echo "NiceEval preview fixture: $(git -C "$PREVIEW_ROOT" rev-parse HEAD)"

# Netlify installs the isolated netlify-preview base, not the repository root.
# Build the linked candidate from the root lockfile rather than a stale cache.
corepack pnpm@11.18.0 --dir "$NICEEVAL_ROOT" install --frozen-lockfile --ignore-scripts
corepack pnpm@11.18.0 --dir "$PREVIEW_ROOT" install --frozen-lockfile
TMPDIR="$PACKAGE_SCRATCH" \
corepack pnpm@11.18.0 --dir "$NICEEVAL_ROOT" consumer:link apply "$PREVIEW_ROOT"

corepack pnpm@11.18.0 --dir "$PREVIEW_ROOT" exec niceeval --version
# Keep V8's old-space collector inside the preview's fixed Report RSS budget;
# the product budget remains unchanged and still rejects real excess output.
NODE_OPTIONS="--max-old-space-size=1024" \
corepack pnpm@11.18.0 --dir "$PREVIEW_ROOT" exec niceeval view \
  --out "$PUBLISH_DIRECTORY"
