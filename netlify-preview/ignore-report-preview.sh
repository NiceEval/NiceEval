#!/usr/bin/env bash
set -euo pipefail

# Netlify interprets 0 as "skip" and any non-zero status as "build". Keep
# this list at the current `niceeval view` consumption boundary: producer-only
# changes are covered by package/type/E2E checks and do not need MemoryBench's
# persisted Record fixture.
readonly REPORT_PREVIEW_PATHS=(
  ':(top)package.json'
  ':(top)pnpm-lock.yaml'
  ':(top)packages/niceeval/package.json'
  ':(top)packages/niceeval/bin/**'
  ':(top)packages/niceeval/scripts/package-runtime/**'
  ':(top)packages/niceeval/src/analysis/**'
  ':(top)packages/niceeval/src/assertions/**'
  ':(top)packages/niceeval/src/attempt-locator.ts'
  ':(top)packages/niceeval/src/attempt-locator-resolution.ts'
  ':(top)packages/niceeval/src/cli/**'
  ':(top)packages/niceeval/src/coordination/**'
  ':(top,glob)packages/niceeval/src/o11y/*.ts'
  ':(top)packages/niceeval/src/o11y/record/codec.ts'
  ':(top)packages/niceeval/src/o11y/record/errors.ts'
  ':(top)packages/niceeval/src/o11y/record/limits.ts'
  ':(top)packages/niceeval/src/o11y/record/model.ts'
  ':(top)packages/niceeval/src/record/**'
  ':(top)packages/niceeval/src/report/**'
  ':(top)packages/niceeval/src/sample/**'
  ':(top)packages/niceeval/src/sources/**'
  ':(top)packages/niceeval/src/view/**'
  ':(top)netlify-preview/build-report-preview.sh'
)

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "$#" -eq 2 ]]; then
  readonly BASE_REF="$1"
  readonly HEAD_REF="$2"
else
  readonly HEAD_REF="${COMMIT_REF:?Netlify must provide COMMIT_REF}"
  readonly MAIN_REF="refs/remotes/origin/main"
  if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
    git fetch --quiet --no-tags --unshallow origin "$HEAD_REF" "main:$MAIN_REF"
  else
    git fetch --quiet --no-tags origin "main:$MAIN_REF"
  fi
  readonly BASE_REF="$(git merge-base "$HEAD_REF" "$MAIN_REF")"
fi

git diff --quiet "$BASE_REF" "$HEAD_REF" -- "${REPORT_PREVIEW_PATHS[@]}"
