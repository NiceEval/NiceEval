#!/usr/bin/env bash
set -euo pipefail

candidate="$(realpath "${1:?expected NiceEval tarball}")"
version="${2:?expected NiceEval version}"
consumer="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/niceeval-package-smoke.XXXXXX")"
trap 'rm -rf "$consumer"' EXIT

cd "$consumer"
pnpm init
pnpm add "$candidate"
pnpm --silent exec niceeval --help
test "$(pnpm --silent exec niceeval --version)" = "$version"
pnpm --silent exec niceeval init

mkdir -p agents evals experiments
cat > agents/smoke.ts <<'EOF'
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
export const smokeAgent = defineAgent({
  name: "smoke",
  evidenceCoverage: completeEvidenceCoverage,
  async send() {
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "smoke" }] };
  },
});
EOF
cat > evals/smoke.eval.ts <<'EOF'
import { defineEval } from "niceeval";
import { isTrue } from "niceeval/expect";
export default defineEval({
  async test(t) { t.check(true, isTrue("NiceEval can load an installed package")); },
});
EOF
cat > experiments/smoke.ts <<'EOF'
import { defineExperiment } from "niceeval";
import { smokeAgent } from "../agents/smoke.ts";
export default defineExperiment({ adapter: smokeAgent, evals: ["smoke"] });
EOF

pnpm --silent exec niceeval list
pnpm --silent exec niceeval exp smoke --dry
