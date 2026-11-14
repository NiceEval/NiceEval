export default {
  "testRoots": ["e2e"],
  "sourceRoots": ["packages/niceeval/src"],
  "testAdapters": [{
    "id": "niceeval-e2e",
    "include": [
      "e2e/adapter/ai-sdk", "e2e/adapter/ai-sdk-direct", "e2e/adapter/bub",
      "e2e/adapter/claude-agent-sdk", "e2e/adapter/claude-code", "e2e/adapter/codex-cli",
      "e2e/adapter/codex-sdk", "e2e/adapter/deepseek-harness", "e2e/adapter/hermes",
      "e2e/adapter/local-protocol", "e2e/adapter/omp", "e2e/adapter/openai-compat",
      "e2e/adapter/openclaw", "e2e/adapter/opencode", "e2e/adapter/sdk-converters",
      "e2e/agent-judge", "e2e/cli", "e2e/eval", "e2e/insight", "e2e/inspection", "e2e/lifecycle",
      "e2e/migrate", "e2e/package", "e2e/plugins", "e2e/record", "e2e/runner"
    ],
    "argv": ["pnpm", "exec", "tsx", "packages/e2e-runner/src/concord-adapter.ts"],
    "implementationFiles": ["packages/e2e-runner/src/concord-adapter.ts", "packages/e2e-runner/src/adapter-host.ts", "packages/e2e-runner/src/adapter-wire.ts", "packages/e2e-runner/src/adapter-observation.ts", "packages/e2e-runner/src/adapter-range.ts", "packages/e2e-runner/package.json", "packages/testkit/package.json"],
    "inputRoots": ["packages/e2e-runner/src", "packages/repo-tools/src", "e2e", "packages/niceeval/src", "packages/niceeval/bin", "packages/niceeval/scripts", "packages/niceeval/package.json", "packages/niceeval/vite.config.ts", "packages/niceeval/tsconfig.package-types.json", "packages/niceeval/tsconfig.json", "packages/niceeval/docs-source/stage-docs.mjs", "packages/testkit/src", "packages/testkit/package.json", "apps/docs-site/en", "apps/docs-site/zh", "apps/docs-site/docs.json", "concord.repository.json", "nx.json", "package.json"],
    "lockFiles": ["pnpm-lock.yaml"],
    "frameworkVersion": "niceeval-e2e/1",
    "envNames": ["PATH", "HOME", "TMPDIR", "CI"],
    "collectTimeoutMs": 600000,
    "wallTimeoutMs": 7200000
  }],
  "feedbackConnections": [
    {
      "id": "niceeval-github",
      "provider": "github",
      "owner": "NiceEval",
      "repo": "NiceEval",
      "repositoryId": "1283126461",
      "transport": "gh"
    }
  ]
} as const;
