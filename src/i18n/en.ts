import type { Messages } from "./zh-CN.ts";

export const en = {
  "agent.installFailed": "Install failed: {{key}}\n{{tail}}",
  "agent.unknown": "Unknown agent \"{{name}}\". Registered agents: {{known}}.",
  "agent.diagnose.exitCode": "agent run exited with code {{code}}",
  "agent.diagnose.lastError": "last error: {{message}}",
  "agent.diagnose.noTranscript": "transcript was not generated",
  "agent.diagnose.outputTail": "output tail: {{tail}}",
  "agent.diagnose.zeroEvents": "transcript exists but contains 0 events",
  "bub.homeDetectFailed": "Failed to detect sandbox $HOME (empty output from `printf $HOME`). Refusing to fall back to a provider-specific path; check the sandbox provider.",
  "bub.checkpointCaptureFailed": "bub checkpoint cache backfill failed (this sandbox is unaffected; later sandboxes will reinstall): {{error}}",
  "bub.checkpointRestoreFailed": "bub checkpoint restore failed, falling back to a full install: {{error}}",
  "bub.installFailed": "bub install failed after {{attempts}} attempts:\n{{tail}}",
  "bub.setupNotRun": "bub adapter setup() has not run in this sandbox (missing home/workspace info). The runner must call setup before send.",
  "checkpoint.emptyTar": "checkpoint: tar is empty (paths: {{paths}})",
  "checkpoint.archiveFailed": "checkpoint archive failed (exit {{exitCode}}): {{detail}}",
  "checkpoint.restoreFailed": "checkpoint restore failed (exit {{exitCode}}): {{detail}}",
  "skill.localMissing": "Local skill path \"{{path}}\" does not exist (resolved to {{resolved}}). Paths are resolved from the project root you run niceeval in.",
  "skill.localDirNoSkillFile": "Local skill directory \"{{path}}\" has no SKILL.md. A directory-shaped skill must contain SKILL.md at its root.",
  "skill.localUnsupportedShape": "Local skill path \"{{path}}\" has an unsupported shape. Accepted: a directory containing SKILL.md, or a single .md file.",
  "skill.repoCloneFailed": "Could not fetch repo skill {{source}} (ref: {{ref}}):\n{{tail}}",
  "skill.repoNoSkills": "Repo skill {{source}} contains no SKILL.md.",
  "skill.repoAmbiguous": "Repo skill {{source}} contains multiple skills; select which ones to enable with `skills: [...]`. Available: {{available}}.",
  "skill.repoUnknownSkill": "Repo skill {{source}} (ref: {{ref}}) has no skill named \"{{skill}}\". Available: {{available}}.",
  "skill.copyFailed": "Could not install skill \"{{name}}\" into {{dest}}:\n{{tail}}",
  "mcp.ambiguousTransport":
    "MCP server \"{{name}}\" specifies both \"command\" and \"url\" — pick one transport: \"command\" for a local stdio server, \"url\" for a remote Streamable HTTP endpoint.",
  "plugin.marketplaceFailed": "Could not connect {{agent}} marketplace \"{{name}}\" (source: {{source}}, ref: {{ref}}):\n{{tail}}",
  "plugin.marketplaceVerifyFailed": "Could not read back the registered marketplace list after adding {{agent}} marketplace \"{{name}}\" ({{command}}):\n{{tail}}",
  "plugin.marketplaceNameMismatch":
    "{{agent}} marketplace name mismatch: the configured name \"{{expected}}\" (source: {{source}}) is not in the registered list after add; actually registered: {{actual}}. " +
    "marketplace.name must equal the name declared in the target repo's manifest — use the real name.",
  "plugin.installFailed": "Could not install {{agent}} plugin \"{{name}}\" (marketplace: {{marketplace}}):\n{{tail}}",
  "nativeConfig.pathNotProjectRelative":
    "{{agent}} {{field}} only accepts relative paths inside the project root, got \"{{path}}\". Absolute paths, `..` segments and `~` paths are rejected; copy configs from outside the project into it first.",
  "nativeConfig.missing":
    "{{agent}} {{field}} points to a missing file: \"{{path}}\" (resolved to {{resolved}}). Paths resolve from the project root you run niceeval in (the directory containing niceeval.config.ts), not from eval / experiment source files.",
  "nativeConfig.escapesRoot": "{{agent}} {{field}} \"{{path}}\" resolves through a symlink to outside the project root ({{resolved}}). The config file must physically live inside the project root.",
  "nativeConfig.notFile": "{{agent}} {{field}} \"{{path}}\" is not a regular file. Point it at a complete official config file.",
  "nativeConfig.invalidSyntax": "{{agent}} {{field}} \"{{path}}\" is not valid {{format}}: {{detail}}",
  "nativeConfig.reservedKeys":
    "{{agent}} {{field}} \"{{path}}\" contains reserved keys: {{keys}}. These keys are owned by the experiment and the Adapter (model, auth, MCP and OTel are layered separately) — remove them from the file.",
  "nativeConfig.uploadFailed": "Could not upload native config file \"{{path}}\" into the sandbox ({{dest}}):\n{{tail}}",
  "cli.all": "(all)",
  "cli.browserOpenFailed": "Could not open the browser automatically. Open manually: {{url}}\n",
  "cli.clean.done": "Deleted .niceeval/ historical run artifacts.\n",
  "cli.config.missing":
    "Could not find niceeval.config.ts.\n" +
    "Ways to fix:\n" +
    "  - [init] Run `npx niceeval init` to scaffold niceeval.config.ts and evals/\n" +
    "  - [cd] Run from the project root that contains niceeval.config.ts\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/tutorials/quickstart.mdx",
  "cli.config.noDefault": "niceeval.config.ts must default export defineConfig(...).",
  "cli.dry.header": "\n[dry] {{evals}} evals × {{configs}} run configs:\n",
  "cli.dry.noMatches": "(no matches)",
  "cli.dry.row": "  {{who}}{{experiment}}: {{evals}}  ×{{runs}}\n",
  "cli.error": "niceeval error: {{error}}\n",
  "cli.flag.invalidNumber": "Flag --{{flag}} expects a number, got \"{{value}}\".\n",
  "cli.flag.invalidOutput": "Flag --output expects one of auto|human|agent|ci, got \"{{value}}\".\n",
  "runner.budgetUnenforceable":
    "budget for {{budgetKey}}: several attempts completed without any cost data (agent reports no usage and the model is not in the price table) — the budget cannot be enforced for this agent; continuing without the guard.\n",
  "runner.experimentTeardownFailed":
    "cleanup returned by experiment {{experimentId}}'s setup failed: {{message}}. Results are unaffected, but host-side resources started by this experiment may not have been released; check manually.\n",
  "judge.modelMissing":
    "No judge model configured. Set it in defineConfig({ judge: { model: \"...\" } }), the eval's judge config, or the NICEEVAL_JUDGE_MODEL environment variable (there is no built-in default model).\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/tutorials/scoring-guide.mdx",
  "loaders.yamlMissing":
    "loadYaml(\"{{path}}\") needs a YAML parser: run `pnpm add yaml` first (or switch to loadJson with a JSON dataset).",
  "cli.flag.parseError": "{{message}}\nRun `niceeval --help` for usage.\n",
  "cli.envInvalidNumber": "Environment variable {{name}} is not a number: \"{{value}}\".\n",
  "cli.help":
    "niceeval — agent-native evals\n\n" +
    "Usage:\n" +
    "  niceeval exp [group|experiment] [eval-id-prefix…]   run experiments\n" +
    "  niceeval show [eval-id-prefix… | @<locator>]        read results in the terminal\n" +
    "      bare: current verdicts per experiment (composed across runs), each row\n" +
    "        with a compact attempt index (locator + failure reason)\n" +
    "      a single eval id: attempts + assertion details\n" +
    "      @<locator>  exactly one attempt: no flag -> compact overview;\n" +
    "        with a flag -> that evidence slice\n" +
    "      --source      the Eval source captured when this attempt ran,\n" +
    "        assertions mapped back to source lines\n" +
    "      --execution   this attempt's execution event stream (messages/thinking/\n" +
    "        Skill loads/tool calls); OTel adds timing to the same node when present\n" +
    "      --timing      unified timing tree for the attempt (phases + hooks/commands/turns + per-turn OTel)\n" +
    "      --diff[=file] sandbox workspace file-change summary; =file expands one file\n" +
    "      --history   per experiment × eval execution timeline (mutually exclusive with --report)\n" +
    "      --results <dir>   pin a results root    --exp <id>   one experiment\n" +
    "      --report <file>   custom report    --page <id>   pick the initial page (multi-page\n" +
    "        reports render it, then list the rest as a page index with copyable commands)\n" +
    "  niceeval list                                       list discovered evals\n" +
    "  niceeval view [eval-id-prefix…] [--out dir] [--port n] [--no-open]\n" +
    "      report pages + evidence rooms; --report <file> swaps in your report\n" +
    "      (same file as show); --page <id> picks the initial page;\n" +
    "      --results <dir> pins a results root; --snapshot <file> opens exactly\n" +
    "      one snapshot; --exp <id> one experiment\n" +
    "      --out <dir> exports a static site: index.html plus the viewer\n" +
    "      artifacts, ready for any static host\n" +
    "  niceeval sandbox list|enter|history|diff|stop  inspect & destroy sandboxes kept by --keep-sandbox\n" +
    "  niceeval clean                                      delete .niceeval/ artifacts\n" +
    "  niceeval init                                       scaffold config + evals/\n\n" +
    "Flags:\n" +
    "  --runs n  --max-concurrency n  --timeout ms  --budget usd  --tag t\n" +
    "  --early-exit / --no-early-exit  --strict  --force  --dry\n" +
    "  --output auto|human|agent|ci\n" +
    "  --junit path  --json path  --out dir  --port n  --open / --no-open  -h, --help  -v, --version\n\n" +
    "Positional args only select which evals to run (id prefixes); which agent and\n" +
    "how to run come from experiments/ + flags. Env overrides (flag > env > config):\n" +
    "  NICEEVAL_RUNS  NICEEVAL_MAX_CONCURRENCY  NICEEVAL_TIMEOUT  NICEEVAL_BUDGET\n",
  "cli.show.noResults": "No results found under {{root}}. Run `niceeval exp` first, then `niceeval show`.\n",
  "cli.show.runDirMissing": "Results directory not found: {{dir}}\n",
  "cli.show.noEvalMatch": "No results matched: {{patterns}}. Evals with results: {{evals}}\n",
  "cli.show.noExperimentMatch": "No experiment matched --exp {{arg}}. Experiments with results: {{experiments}}\n",
  "cli.show.historyReportConflict":
    "`--history` and `--report` are mutually exclusive: both take over the main output. --history is the host's per-attempt execution timeline; for snapshot-level trends, compose exp.snapshots inside your report file instead.\n",
  "cli.show.evidenceNeedsEval":
    "--source / --execution / --diff show one attempt's evidence, but the selection matched {{matched}} evals. Pick an attempt locator from the index below:\n{{index}}\n",
  "cli.show.locatorMalformed": "{{message}}\n",
  "cli.show.locatorNotFound": "{{message}}\n",
  "cli.eval.noMatch": "No eval matched: {{patterns}}.\n",
  "cli.eval.noMatchHintExperiment": "Hint: \"{{pattern}}\" is an experiment{{kind}}; you probably meant: niceeval exp {{pattern}}\n",
  "cli.eval.noMatchKnown": "Discovered {{count}} evals: {{evals}}\n",
  "cli.exp.agentModelFlagUnsupported": "experiment runs do not support --agent / --model. Add or copy an experiment file and change its model instead.\n",
  "cli.exp.viewerFlagUnsupported": "`{{flag}}` only applies to niceeval {{command}}, not niceeval exp.\n",
  "cli.experiment.noMatch": "No experiment matched: {{arg}}. Discovered: {{experiments}}\n",
  "cli.experiment.viewerCommandHint": "Did you mean: niceeval {{command}}{{args}}\n",
  "cli.experiment.noEvalsSelected": "No evals selected: {{selection}} matched 0 evals. Available experiments: {{experiments}}.\n",
  "cli.experimentGroup": " group",
  "cli.fallbackCleanupTimeout": "\ngraceful cleanup timed out; force-cleaning sandboxes...\n",
  "cli.forceCleanupExit": "\nForce-cleaning sandboxes and exiting...\n",
  "cli.init.done": "Ready: evals/, niceeval.config.ts, and the niceeval agent-rules block in AGENTS.md (points coding agents at node_modules/niceeval/docs-site/zh).\n",
  "cli.interruptCleanup": "\nInterrupted; cleaning up sandbox containers... (press again to force cleanup and exit)\n",
  "cli.list.header": "Discovered {{count}} evals:\n",
  "cli.noAgent": "No agent specified (use --agent <name>).\n",
  "cli.none": "(none)",
  "cli.pressCtrlC": "Press Ctrl+C to exit.\n",
  "cli.resultsPath": "Structured results: {{path}} (snapshot.json + per-attempt result.json / events.json / trace.json / diff.json)\n",
  "cli.run.experimentRequired":
    "Run evals through an experiment: use `niceeval exp [group|config] [eval id prefix]`.\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/how-to/write-experiment.mdx\n",
  "cli.run.experimentRequiredHint": "Hint: \"{{pattern}}\" is an experiment{{kind}}; you probably meant: niceeval exp {{pattern}}\n",
  "cli.run.experimentRequiredKnown": "Discovered experiments: {{experiments}}\n",
  "cli.unimplemented": "Command \"{{command}}\" is not implemented yet (MVP).\n",
  "cli.view.exportedDir": "Exported static report site: {{out}} (serve the whole directory with any static host; opening index.html via file:// cannot fetch artifacts)\n",
  "cli.view.incompatible": "{{dir}}: written by niceeval {{producer}} (schemaVersion {{schemaVersion}}); this CLI reads schemaVersion {{supported}}.\nRun `{{command}}` to view it.\n",
  "cli.view.noResults": "No results found under {{root}}. Run `niceeval exp` first, then `niceeval view`.\n",
  "cli.view.incompatibleForeign": "{{dir}}: written by {{name}} {{version}} (schemaVersion {{schemaVersion}}); this CLI reads schemaVersion {{supported}}.\nOpen this report with the tool that produced it.\n",
  "cli.view.url": "niceeval view: {{url}}\n",
  "context.capabilityMissing":
    "Agent \"{{agent}}\" is not sandbox-backed (built with defineSandboxAgent), so t.{{method}} is unavailable. Use an agent built with defineSandboxAgent, or drop this assertion.\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/how-to/sandbox-agent.mdx",
  "context.skipEmpty": "skip() requires a non-empty reason.",
  "context.turnFailed": "This send returned failed (turn status = failed): {{message}}",
  "context.turnFailedDefault": "This send returned failed (turn status = failed)",
  "define.agentNameRequired": "defineAgent requires name.",
  "define.evalIdRejected": "defineEval does not accept id; ids are derived from file paths.",
  "define.evalEnvironmentEmpty": "defineEval environment must be a non-empty profile id when provided.",
  "define.evalTestRequired": "defineEval requires an async test(t) function.",
  "define.experimentAgentRequired": "defineExperiment requires agent.",
  "define.experimentFlagNotJson": "experiment.flags.{{key}} is not JSON-serializable (functions / undefined / cycles / bigint are not allowed); flags are persisted verbatim into result snapshots and must be plain JSON.",
  "define.experimentSetupNotFunction": "experiment.setup must be a function ((ctx) => void | cleanup); to prepare the in-sandbox environment per experiment, chain .setup() hooks on the sandbox spec instead.",
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
  "feedback.human.active": "ACTIVE",
  "feedback.human.budgetExhausted": "budget exhausted for {{experimentId}} (spent {{spent}}, unstarted {{unstarted}})",
  "feedback.human.compare": "Compare: niceeval view {{group}}",
  "feedback.human.counts": "{{total}} total · {{reused}} reused · {{running}} running · {{queued}} queued · {{completed}} completed",
  "feedback.human.diffHint": "Diff:    niceeval show {{locator}} --diff",
  "feedback.human.evalHint": "Eval:    niceeval show {{locator}} --source",
  "feedback.human.failuresHeader": "FAILURES",
  "feedback.human.heartbeat": "{{elapsed}} elapsed · {{counts}}",
  "feedback.human.inspect": "Inspect: niceeval show {{locator}}",
  "feedback.human.moreActive": "… {{count}} more active",
  "feedback.human.plan": "Plan: {{total}} attempts · {{evals}} evals × {{configs}} configs · concurrency {{concurrency}}",
  "feedback.human.resultFailed": "FAILED",
  "feedback.human.resultIncomplete": "INCOMPLETE",
  "feedback.human.resultInterrupted": "INTERRUPTED",
  "feedback.human.resultPassed": "PASSED",
  "feedback.human.resultsHeader": "Results:",
  "feedback.human.resultsMore": "… {{count}} more",
  "feedback.human.reuse": "Reuse: {{reused}} of {{total}} carried in from cache · {{toRun}} to run",
  "feedback.human.summaryLine": "{{passed}} passed · {{failed}} failed · {{errored}} errored  ({{reused}} reused)",
  "feedback.human.summaryAllReusedLine": "{{passed}} passed · {{failed}} failed · {{errored}} errored  (all {{reused}} reused)",
  "feedback.human.suppressedFailures": "… {{count}} more failures suppressed",
  "feedback.human.trace": "Trace:   niceeval show {{locator}} --execution",
  "feedback.phase.agentSetup": "agent setup",
  "feedback.phase.evalRun": "running eval",
  "feedback.phase.evalSetup": "eval setup",
  "feedback.phase.sandboxCreate": "creating sandbox",
  "feedback.phase.sandboxQueue": "queued for sandbox",
  "feedback.phase.experimentSetup": "experiment setup",
  "feedback.phase.sandboxSetup": "sandbox setup",
  "feedback.phase.scoring": "scoring",
  "feedback.phase.teardown": "cleaning up",
  "feedback.phase.telemetryCollect": "collecting trace",
  "feedback.phase.telemetryConfigure": "configuring telemetry",
  "feedback.phase.workspaceBaseline": "preparing workspace",
  "feedback.phase.workspaceDiff": "capturing diff",
  "feedback.rendererError": "  · [feedback] renderer failed while handling {{context}} (ignored): {{message}}\n",
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
  "runner.failFast": "error {{code}} recurred consecutively on {{evalId}}; treating it as deterministic and skipping the remaining attempts for this config (fail-fast).",
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
  "runner.startSandboxSetup": "sandbox setup (environment provisioning hooks)...",
  "runner.startSandboxTeardown": "sandbox teardown (environment provisioning hooks)...",
  "runner.timeout": "attempt timed out ({{timeoutMs}}ms)\nRecent progress:\n{{recentLogs}}",
  "runner.traceSelected": " -> kept {{count}} semantic spans",
  "runner.resumeCarry": "  · reusing {{carried}} settled results from last run, re-running {{retry}} evals\n",
  "runner.resumeCarryDetail": "      carried [{{experiment}}] {{evals}}\n",
  "runner.useRemoteAgent": "using remote agent (no sandbox created)...",
  "sandbox.providerNotImplemented": "{{provider}} sandbox provider is not implemented; use docker, vercel, or e2b",
  "sandbox.missingSpec":
    "sandbox agent needs a sandbox, but none was given. niceeval no longer picks a default — set `sandbox` in defineExperiment()/defineConfig() to dockerSandbox() / vercelSandbox() / e2bSandbox() (import from \"niceeval/sandbox\").\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/how-to/sandbox-providers.mdx",
  "sandbox.dependencyMissing.docker": "Docker sandbox requires 'dockerode'. Install it with: pnpm add dockerode @types/dockerode",
  "sandbox.dependencyMissing.e2b": "E2B sandbox requires 'e2b'. Install it with: pnpm add e2b",
  "sandbox.dependencyMissing.vercel": "Vercel sandbox requires '@vercel/sandbox'. Install it with: pnpm add @vercel/sandbox",
  "sandbox.forceCleanup": "  · [sandbox] force-cleaning {{count}} sandboxes...\n",
  "sandbox.provisionReconcileFailed": "  · [sandbox] provision reconcile failed, aborting retry (a possibly-created instance could not be verified/killed): {{error}}\n",
  "sandbox.provisionRetry": "  · [sandbox] provisioning rate-limited, retrying in {{delayMs}}ms (attempt {{attempt}}/{{maxAttempts}})...\n",
  "sandbox.stopFailed": "  · [sandbox] failed to stop sandbox {{id}} (ignored; provider TTL should clean it up): {{message}}\n",
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
