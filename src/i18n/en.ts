import type { Messages } from "./zh-CN.ts";

export const en = {
  "agent.installFailed": "Install failed: {{key}}\n{{tail}}",
  "agent.unknown": "Unknown agent \"{{name}}\". Registered agents: {{known}}.",
  "agent.diagnose.exitCode": "agent run exited with code {{code}}",
  "agent.diagnose.lastError": "last error: {{message}}",
  "agent.diagnose.noTranscript": "transcript was not generated",
  "agent.diagnose.outputTail": "output tail: {{tail}}",
  "agent.diagnose.zeroEvents": "transcript exists but contains 0 events",
  "agent.registerMcpNotSandbox": 'registerMcp: "{{name}}" is not a sandbox agent, there is no config file to write MCP into',
  "agent.registerMcpUnsupported": 'registerMcp: agent "{{name}}" does not support MCP (only claude-code / codex)',
  "bub.homeDetectFailed": "Failed to detect sandbox $HOME (empty output from `printf $HOME`). Refusing to fall back to a backend-specific path; check the sandbox backend.",
  "bub.installFailed": "bub install failed after {{attempts}} attempts:\n{{tail}}",
  "bub.setupNotRun": "bub adapter setup() has not run in this sandbox (missing home/workspace info). The runner must call setup before send.",
  "checkpoint.emptyTar": "checkpoint: tar is empty (paths: {{paths}})",
  "cli.all": "(all)",
  "cli.browserOpenFailed": "Could not open the browser automatically. Open manually: {{url}}\n",
  "cli.clean.done": "Deleted .niceeval/ historical run artifacts.\n",
  "cli.config.missing":
    "Could not find niceeval.config.ts.\n" +
    "Ways to fix:\n" +
    "  - [init] Run `npx niceeval init` to scaffold niceeval.config.ts and evals/\n" +
    "  - [cd] Run from the project root that contains niceeval.config.ts\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/quickstart.mdx",
  "cli.config.noDefault": "niceeval.config.ts must default export defineConfig(...).",
  "cli.dry.header": "\n[dry] {{evals}} evals × {{configs}} run configs:\n",
  "cli.dry.noMatches": "(no matches)",
  "cli.dry.row": "  {{who}}{{experiment}}: {{evals}}  ×{{runs}}\n",
  "cli.error": "niceeval error: {{error}}\n",
  "cli.flag.invalidNumber": "Flag --{{flag}} expects a number, got \"{{value}}\".\n",
  "runner.budgetUnenforceable":
    "budget for {{budgetKey}}: several attempts completed without any cost data (agent reports no usage and the model is not in the price table) — the budget cannot be enforced for this agent; continuing without the guard.\n",
  "judge.modelMissing":
    "No judge model configured. Set it in defineConfig({ judge: { model: \"...\" } }), the eval's judge config, or the NICEEVAL_JUDGE_MODEL environment variable (there is no built-in default model).\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/guides/scoring-guide.mdx",
  "loaders.yamlMissing":
    "loadYaml(\"{{path}}\") needs a YAML parser: run `pnpm add yaml` first (or switch to loadJson with a JSON dataset).",
  "cli.flag.parseError": "{{message}}\nRun `niceeval --help` for usage.\n",
  "cli.envInvalidNumber": "Environment variable {{name}} is not a number: \"{{value}}\".\n",
  "cli.help":
    "niceeval — agent-native evals\n\n" +
    "Usage:\n" +
    "  niceeval exp [group|experiment] [eval-id-prefix…]   run experiments\n" +
    "  niceeval show [eval-id-prefix…]                     read results in the terminal\n" +
    "      bare: current verdicts per experiment (composed across runs);\n" +
    "      a single eval id: attempts + assertion details\n" +
    "      --transcript / --trace / --diff[=file]   evidence slices of one eval\n" +
    "      --history   cross-run timeline (mutually exclusive with --report)\n" +
    "      --run <dir>   pin a results dir    --experiment <id>   one experiment\n" +
    "      --attempt <n>   pick an attempt    --report <file>   custom report\n" +
    "  niceeval list                                       list discovered evals\n" +
    "  niceeval view [eval-id-prefix…|summary.json] [--out dir] [--port n] [--no-open]\n" +
    "      report slot + evidence rooms; --report <file> swaps in your report\n" +
    "      (same file as show); --run <dir> pins a results dir;\n" +
    "      --experiment <id> one experiment\n" +
    "      --out <dir> exports a static site: index.html plus the viewer\n" +
    "      artifacts, ready for any static host\n" +
    "  niceeval clean                                      delete .niceeval/ artifacts\n" +
    "  niceeval init                                       scaffold config + evals/\n\n" +
    "Flags:\n" +
    "  --runs n  --max-concurrency n  --timeout ms  --budget usd  --tag t\n" +
    "  --early-exit / --no-early-exit  --strict  --force  --dry  --quiet\n" +
    "  --junit path  --json path  --out dir  --port n  --open / --no-open  -h, --help  -v, --version\n\n" +
    "Positional args only select which evals to run (id prefixes); which agent and\n" +
    "how to run come from experiments/ + flags. Env overrides (flag > env > config):\n" +
    "  NICEEVAL_RUNS  NICEEVAL_MAX_CONCURRENCY  NICEEVAL_TIMEOUT  NICEEVAL_BUDGET\n",
  "cli.show.noResults": "No results found under {{root}}. Run `niceeval exp` first, then `niceeval show`.\n",
  "cli.show.runDirMissing": "Results directory not found: {{dir}}\n",
  "cli.show.noEvalMatch": "No results matched: {{patterns}}. Evals with results: {{evals}}\n",
  "cli.show.noExperimentMatch": "No experiment matched --experiment {{arg}}. Experiments with results: {{experiments}}\n",
  "cli.show.historyReportConflict":
    "`--history` and `--report` are mutually exclusive: --history is the built-in trend view. For a custom trend, compose exp.snapshots inside your report file instead.\n",
  "cli.show.evidenceNeedsEval":
    "--transcript / --trace / --diff show one eval's evidence, but the selection matched {{matched}} evals. Narrow to a single eval id first: niceeval show <eval id> --transcript\n",
  "cli.show.attemptNeedsEval":
    "--attempt picks one attempt of a single eval; pass a full eval id (and --experiment when several experiments ran it).\n",
  "cli.show.attemptNotFound": "Attempt {{attempt}} not found for {{evalId}}. Available attempts: {{available}}\n",
  "cli.eval.noMatch": "No eval matched: {{patterns}}.\n",
  "cli.eval.noMatchHintExperiment": "Hint: \"{{pattern}}\" is an experiment{{kind}}; you probably meant: niceeval exp {{pattern}}\n",
  "cli.eval.noMatchKnown": "Discovered {{count}} evals: {{evals}}\n",
  "cli.exp.agentModelFlagUnsupported": "`--agent` / `--model` cannot override an experiment. Add or copy a config file under experiments/ instead.\n",
  "cli.experiment.noMatch": "No experiment matched: {{arg}}. Discovered: {{experiments}}\n",
  "cli.experimentGroup": " group",
  "cli.fallbackCleanupTimeout": "\ngraceful cleanup timed out; force-cleaning sandboxes...\n",
  "cli.forceCleanupExit": "\nForce-cleaning sandboxes and exiting...\n",
  "cli.init.done": "Ready: evals/, niceeval.config.ts, and the niceeval agent-rules block in AGENTS.md (points coding agents at node_modules/niceeval/docs-site/zh).\n",
  "cli.interruptCleanup": "\nInterrupted; cleaning up sandbox containers... (press again to force cleanup and exit)\n",
  "cli.list.header": "Discovered {{count}} evals:\n",
  "cli.noAgent": "No agent specified (use --agent <name>).\n",
  "cli.none": "(none)",
  "cli.pressCtrlC": "Press Ctrl+C to exit.\n",
  "cli.resultsPath": "Structured results: {{path}} (each result's artifactsDir holds that attempt's events.json / trace.json / diff.json)\n",
  "cli.run.experimentRequired":
    "Run evals through an experiment: use `niceeval exp [group|config] [eval id prefix]`.\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/guides/write-experiment.mdx\n",
  "cli.run.experimentRequiredHint": "Hint: \"{{pattern}}\" is an experiment{{kind}}; you probably meant: niceeval exp {{pattern}}\n",
  "cli.run.experimentRequiredKnown": "Discovered experiments: {{experiments}}\n",
  "cli.unimplemented": "Command \"{{command}}\" is not implemented yet (MVP).\n",
  "cli.view.exportedDir": "Exported static report site: {{out}} (serve the whole directory with any static host; opening index.html via file:// cannot fetch artifacts)\n",
  "cli.view.incompatible": "{{dir}}: written by niceeval {{producer}} (schemaVersion {{schemaVersion}}); this CLI reads schemaVersion {{supported}}.\nRun `{{command}}` to view it.\n",
  "cli.view.incompatibleForeign": "{{dir}}: written by {{name}} {{version}} (schemaVersion {{schemaVersion}}); this CLI reads schemaVersion {{supported}}.\nOpen this report with the tool that produced it.\n",
  "cli.view.url": "niceeval view: {{url}}\n",
  "context.capabilityMissing":
    "Agent \"{{agent}}\" is not sandbox-backed (built with defineSandboxAgent), so t.{{method}} is unavailable. Use an agent built with defineSandboxAgent, or drop this assertion.\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/guides/sandbox-agent.mdx",
  "context.skipEmpty": "skip() requires a non-empty reason.",
  "context.turnFailed": "This send returned failed (turn status = failed): {{message}}",
  "context.turnFailedDefault": "This send returned failed (turn status = failed)",
  "define.agentNameRequired": "defineAgent requires name.",
  "define.evalIdRejected": "defineEval does not accept id; ids are derived from file paths.",
  "define.evalTestRequired": "defineEval requires an async test(t) function.",
  "define.experimentAgentRequired": "defineExperiment requires agent.",
  "define.experimentIdRejected": "defineExperiment does not accept id; ids are derived from file paths.",
  "define.sandboxAgentNameRequired": "defineSandboxAgent requires name.",
  "define.sandboxCreateRequired": "defineSandbox requires a create() function.",
  "define.sandboxNameRequired": "defineSandbox requires name.",
  "docker.commandTimeout": "Command timed out after {{timeoutMs}}ms",
  "docker.containerNotInitialized": "Container not initialized",
  "docker.imagePullDone": "Docker image ready: {{image}}",
  "docker.imagePullStart": "Pulling Docker image: {{image}}...",
  "docker.readFileFailed": "Failed to read file {{path}}: {{stderr}}",
  "docker.unsupportedRuntime": "Unsupported runtime: {{runtime}}",
  "hitl.answerNeedsOptionOrText": "The object form of t.respond needs either optionId or text (neither was given).",
  "hitl.invalidOption": "Answer \"{{optionId}}\" is not an option of request {{requestId}} ({{options}}).",
  "hitl.noOptions": "this request has no options",
  "hitl.requestMissingId": "This input.requested request has no stable id, so a response cannot be built — the adapter must give every pending request a stable id.",
  "hitl.respondAllEmpty": "There is no pending input.requested request; respond() / respondAll() cannot work. Confirm the turn parked with t.parked(), then answer via t.requireInputRequest() or t.respond().",
  "hitl.respondEmpty": "t.respond(...) requires at least one answer.",
  "hitl.stringAmbiguous": "There are {{count}} pending input requests; a plain-string answer cannot be matched to one. Use the { request, optionId } or { request, text } object form to name it explicitly.",
  "judge.apiKeyMissing": "judge is missing an API key (CODEX_API_KEY / OPENAI_API_KEY).",
  "judge.httpError": "judge HTTP {{status}}: {{body}}",
  "judge.probeFailed": "judge precheck failed ({{model}}): {{error}}",
  "judge.probeMissingKey": "judge model {{model}} is missing an API key; configure {{envHint}}",
  "live.more": "… {{hidden}} more ({{running}} running · {{waiting}} waiting · {{done}} done)",
  "live.running": "  Running {{totalRuns}} attempts ({{evals}} evals × {{configs}} configs, concurrency {{concurrency}})       {{completed}}/{{total}} done",
  "live.runningUnknown": "  Running...  {{completed}}/{{total}} done",
  "live.waiting": "waiting for a slot...",
  "report.assertionThreshold": " (got {{score}} < {{threshold}})",
  "report.error": "error",
  "report.errored": "errored",
  "report.failed": "failed",
  "report.gate": "gate",
  "report.passed": "passed",
  "report.result": "\nResult: {{parts}}  ({{duration}} · {{tokens}}{{cost}})\n\n",
  "report.runStart": "\nRunning {{count}} evals{{extra}} (concurrency {{concurrency}})\n\n",
  "report.runStartExtra": " × {{configs}} configs = {{totalRuns}} runs",
  "report.viewHint": "Run `pnpm exec niceeval view` to see the results in the graphical viewer.\n",
  "report.skipped": "skipped",
  "report.soft": "soft",
  "report.summary.errored": "{{count}} errored",
  "report.summary.failed": "{{count}} failed",
  "report.summary.passed": "{{count}} passed",
  "report.summary.skipped": "{{count}} skipped",
  "report.table.agent": "Agent",
  "report.table.avgDuration": "Avg Duration",
  "report.table.cost": "Cost",
  "report.table.default": "default",
  "report.table.duration": "Duration",
  "report.table.eval": "Eval",
  "report.table.evalTitle": "Eval Results:",
  "report.table.experiment": "Experiment",
  "report.table.experimentsTitle": "Experiments",
  "report.table.model": "Model",
  "report.table.reason": "Reason",
  "report.table.result": "Result",
  "report.table.runs": "Runs",
  "report.table.status": "Status",
  "report.table.successRate": "Success Rate",
  "report.table.tokens": "Tokens",
  "otel.noSpans": "otel: 0 spans this turn — endpoint not wired? (env not injected / service not restarted / no flush)",
  "otel.portInUse": "OTLP receiver port {{port}} is already in use (another process is bound to it). Pick a free port in defineConfig({ telemetry: { port } }), or stop whatever is using {{port}} and retry.",
  "otel.windowAttribution": "otel: spans missing our traceparent, attributing by time window (turns for this agent serialized; concurrency resumes once W3C propagation is confirmed)",
  "runner.diffProgress": "captured diff: {{changed}} changed / {{deleted}} deleted",
  "runner.driveAgent": "driving agent...",
  "runner.evalSetup": "eval setup (installing dependencies)...",
  "runner.interrupted": "  · interrupted: sandbox containers cleaned up; printing partial results completed so far.\n",
  "runner.judgePrecheck": "  · prechecking judge config...\n",
  "runner.otlpInSandbox": "OTLP in-sandbox collector -> {{endpoint}}{{proto}}",
  "runner.otlpOverride": "OTLP receiver (host override) -> {{endpoint}}",
  "runner.otlpReceiver": "OTLP receiver -> {{endpoint}}{{proto}}",
  "runner.otlpShared": "OTLP shared receiver (run-scoped) -> {{endpoint}}",
  "runner.remoteSandboxUnavailable": "remote agents do not have sandbox.{{method}}; use a sandbox agent or remove workspace assertions.",
  "runner.reporterDiagnostic": "  · [diagnostic] {{stage}} failed (ignored): {{message}}\n",
  "runner.scoreJudge": "scoring / judge...",
  "runner.skip": "skip: {{reason}}",
  "runner.startAgentSetup": "agent setup (install CLI / write config)...",
  "runner.startAgentTracing": "agent tracing (write OTEL export config)...",
  "runner.startSandbox": "starting sandbox...",
  "runner.timeout": "attempt timed out ({{timeoutMs}}ms)\nRecent progress:\n{{recentLogs}}",
  "runner.traceSelected": " -> kept {{count}} semantic spans",
  "runner.resumeCarry": "  · reusing {{carried}} passing results from last run, re-running {{retry}} evals\n",
  "runner.resumeCarryDetail": "      carried [{{experiment}}] {{evals}}\n",
  "runner.useRemoteAgent": "using remote agent (no sandbox created)...",
  "sandbox.backendNotImplemented": "{{backend}} sandbox backend is not implemented; use docker, vercel, or e2b",
  "sandbox.missingSpec":
    "sandbox agent needs a sandbox, but none was given. niceeval no longer picks a default — set `sandbox` in defineExperiment()/defineConfig() to dockerSandbox() / vercelSandbox() / e2bSandbox() (import from \"niceeval/sandbox\").\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/guides/sandbox-backends.mdx",
  "sandbox.dependencyMissing.docker": "Docker sandbox requires 'dockerode'. Install it with: pnpm add dockerode @types/dockerode",
  "sandbox.dependencyMissing.e2b": "E2B sandbox requires 'e2b'. Install it with: pnpm add e2b",
  "sandbox.dependencyMissing.vercel": "Vercel sandbox requires '@vercel/sandbox'. Install it with: pnpm add @vercel/sandbox",
  "sandbox.forceCleanup": "  · [sandbox] force-cleaning {{count}} sandboxes...\n",
  "sandbox.stopFailed": "  · [sandbox] failed to stop sandbox {{id}} (ignored; backend TTL should clean it up): {{message}}\n",
  "sandbox.stopTimeout": "stop timed out ({{timeoutMs}}ms)",
  "scoring.evalError": "evaluation error: {{error}}",
  "session.fileFallback": "[file]",
  "session.tools": "{{count}} tools",
  "session.turn.primary": "turn {{turn}}",
  "session.turn.secondary": "session {{session}} · turn {{turn}}",
  "util.requiredEnv": "Missing required environment variable {{name}} (configure it in .env).",
  "vercel.fileNotFound": "File not found: {{path}}",
  "vercel.rotateFailed": "[VercelSandbox] session rotate failed ({{seconds}}s): {{error}}",
  "vercel.rotated": "[VercelSandbox] session rotated after {{seconds}}s -> {{sessionId}}",
} satisfies Messages;
