#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly NICEEVAL_ROOT="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"
readonly MEMORYBENCH_REPOSITORY="https://github.com/NiceEval/MemoryBench.git"
readonly MEMORYBENCH_COMMIT="9f2a67d26b243902e8cd1c07af1effc9f752fff1"
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

corepack pnpm@11.10.0 --dir "$MEMORYBENCH_ROOT" install --frozen-lockfile
TMPDIR="$PACKAGE_SCRATCH" \
corepack pnpm@11.18.0 --dir "$NICEEVAL_ROOT" dev:link "$MEMORYBENCH_ROOT"

corepack pnpm@11.10.0 --dir "$MEMORYBENCH_ROOT" exec niceeval --version
CODEX_BASE_URL="https://preview.invalid/v1" \
CODEX_API_KEY="netlify-report-preview-no-secret" \
corepack pnpm@11.10.0 --dir "$MEMORYBENCH_ROOT" exec niceeval view \
  --experiment compare \
  --report standard \
  --out "$PUBLISH_DIRECTORY"
