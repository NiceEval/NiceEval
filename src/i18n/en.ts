import type { Messages } from "./zh-CN.ts";

export const en = {
  "agent.installFailed": "Install failed: {{key}}\n{{tail}}",
  "agent.unknown": "Unknown agent \"{{name}}\". Registered agents: {{known}}.",
  "agent.diagnose.exitCode": "agent run exited with code {{code}}",
  "agent.diagnose.lastError": "last error: {{message}}",
  "agent.diagnose.noTranscript": "transcript was not generated",
  "agent.diagnose.outputTail": "output tail:\n{{tail}}",
  "agent.diagnose.zeroEvents": "transcript exists but contains 0 events",
  "agent.ensure.identityMissingAgent": "AgentProvisioner.identity.agent must not be empty.",
  "agent.ensure.identityMissingRevision": "AgentProvisioner.identity.revision must not be empty (agent={{agent}}).",
  "agent.ensure.unstableVersion":
    "AgentProvisioner.identity.version must be an exact pin, not \"{{version}}\" (agent={{agent}}). Unpinned installs cannot participate in carry.",
  "agent.ensure.stagedNeedsPrepare":
    "A staged AgentProvisioner ({{agent}}) must provide prepare() to materialize a locked artifact outside the task network.",
  "agent.ensure.verifyOnlyHasPrepare":
    "verifyOnly mode never installs; AgentProvisioner ({{agent}}) must not also provide prepare().",
  "agent.ensure.prepareWrongMode":
    "prepare() is only valid for staged mode (agent={{agent}}, mode={{mode}}).",
  "agent.ensure.artifactMissingDigest": "staged artifact is missing digest (agent={{agent}}).",
  "agent.ensure.stagedMissingArtifact":
    "staged install is missing a prepared artifact (agent={{agent}}). The runner should prepare at Run scope, or ensure via the coordinator.",
  "agent.ensure.failed":
    "Agent Ensure failed (agent={{agent}}, phase={{phase}}): expected {{expected}}, actual {{actual}}. {{detail}}\nNext: {{next}}",
  "agent.ensure.nextVerifyOnly": "Preinstall a matching Agent, or switch to a staged / sandbox-network provisioner.",
  "agent.ensure.nextInstallerMissing": "Use a prebuilt environment with this exact Agent identity, or install it explicitly in the Experiment layer with installTool().",
  "agent.ensure.nextRecheck": "Fix the install prefix, PATH, and exact version, then rerun; do not hand a broken environment to the task.",
  "agent.ensure.missingBin": "Command {{bin}} not found. {{tail}}",
  "agent.ensure.versionUnparseable": "Could not parse a version from `{{bin}} --version`: {{stdout}}",
  "agent.ensure.versionMismatch": "{{bin}} version mismatch: expected {{expected}}, actual {{actual}}.",
  "agent.ensure.digestMismatch":
    "staged artifact digest mismatch (agent={{agent}}): expected {{expected}}, actual {{actual}}.",
  "agent.ensure.npmPackFailed": "Host npm pack {{packageName}}@{{version}} failed:\n{{tail}}",
  "agent.ensure.npmPackEmpty": "Host npm pack {{packageName}}@{{version}} produced no .tgz (dir {{dest}}).",
  "agent.ensure.npmInstallFailed": "In-sandbox install of {{agent}} from staged tarball failed:\n{{tail}}",
  "agent.ensure.platformDetectFailed":
    "Could not detect the target platform from the main Sandbox (uname / ldd): {{tail}}",
  "agent.ensure.selfContainedInstallFailed":
    "Unpacking the {{agent}} self-contained package inside the sandbox failed (needs tar + gzip):\n{{tail}}",
  "agent.ensure.npmMissingInSandbox":
    "The sandbox has no npm, and {{agent}} only publishes a Node-dependent npm package for this platform. When the task image ships no Node toolchain, publish a self-contained native package for that platform or supply a custom provisioner.",
  "agent.ensure.homeDetectFailed": "Could not detect sandbox $HOME; staged install needs to expand the user prefix.",
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
  "plugin.listFailed": "Could not read the installed {{agent}} plugin list ({{command}}):\n{{tail}}",
  "plugin.removeFailed":
    "Could not remove the same-named installed {{agent}} plugin \"{{name}}\":\n{{tail}}\n" +
    "Installation converges the sandbox to the declaration: a leftover install under the same name is removed first, then reinstalled from the declared marketplace.",
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
  "cli.dry.header": "plan: {{attempts}} · {{evals}} × {{configs}} · attempts {{attemptCount}}",
  "cli.dry.unit.attempt": "attempt",
  "cli.dry.unit.attempts": "attempts",
  "cli.dry.unit.eval": "eval",
  "cli.dry.unit.evals": "evals",
  "cli.dry.unit.config": "config",
  "cli.dry.unit.configs": "configs",
  "cli.dry.affects": "affects {{evals}} · {{ids}}",
  "cli.dry.acceptHint": "accept:  {{command}}",
  "cli.accept.choiceHeader": "stale  {{selector}}{{change}}  ({{evals}} evals)\n",
  "cli.accept.prompt": "  reuse these results? [y/N] ",
  "cli.accept.nothingToAccept":
    "No difference in this plan can be accepted (nothing is blocked by the fingerprint gate).\n" +
    "Running as planned.\n",
  "cli.accept.equivalent": "equivalent command:  {{command}}\n",
  "cli.accept.noneChosen": "Nothing accepted; running as planned.\n",
  "cli.error": "niceeval error: {{error}}\n",
  "cli.flag.acceptNeedsSelector":
    "error: --accept needs a selector, for example --accept config:judge.model\n" +
    "  fix: run `niceeval exp <selection> --dry` first; every `stale` line prints the selectors it can accept, copy one verbatim\n" +
    "  differences you can accept in this plan: {{available}}\n",
  "cli.flag.acceptWithRerunAll":
    "--accept cannot be combined with --rerun all: one says trust nothing from cache, the other says trust this difference anyway.\n" +
    "Drop --rerun all to accept the difference, or drop --accept to rerun everything.\n",
  "cli.flag.acceptNoSuchDifference":
    "No such difference in this plan: {{selectors}}.\n" +
    "Differences you can accept here: {{available}}.\n" +
    "Run `niceeval exp <selection> --dry` to see which entries each one blocks.\n",
  "cli.flag.invalidNumber": "Flag --{{flag}} expects a number, got \"{{value}}\".\n",
  "cli.flag.outputRemoved":
    "error: unknown option '--output'\n  fix: run without a flag for human text; use --json for the machine feed\n",
  "runner.budgetUnenforceable":
    "budget for {{budgetKey}}: several attempts completed without any cost data (agent reports no usage and the model is not in the price table) — the budget cannot be enforced for this agent; continuing without the guard.\n",
  "runner.experimentTeardownFailed":
    "teardown for experiment {{experimentId}} failed: {{message}}. Record are unaffected, but host-side resources started by this experiment may not have been released; check manually.\n",
  "runner.cleanupTimeout": "cleanup timed out after {{timeoutMs}}ms\n",
  "runner.setupReturnedCleanup":
    "{{layer}} returned a function. setup does not carry cleanup and the returned value will not be executed — put the cleanup in the paired teardown of the same layer ({{hint}}); see the experiments tutorial on docs-site or docs/runner.md.\n",
  "runner.experimentTeardownLate":
    "experiment {{experimentId}}'s teardown was not triggered by the normal countdown path; it has been executed by the end-of-run sweep instead. Record are unaffected; seeing this line means an unlocated intermittent scheduling issue fired — please record this run in the memory ledger.\n",
  "runner.teardownRegistrationWriteFailed":
    "writing the crash-recovery teardown registration for experiment {{experimentId}} failed: {{message}}. The run continues normally, but a SIGKILL during this run cannot be recovered via `niceeval exp --teardown` or the startup self-heal — check disk space/permissions under .niceeval/teardowns/.\n",
  "runner.lockTakenOver":
    "took over an expired case lock for {{experimentId}}/{{evalId}} (previously held by pid {{pid}} on {{host}}; its heartbeat went stale) — that run likely died without releasing it; this run now owns dispatching this case.\n",
  "runner.gateLeaseTakenOver":
    "took over an expired concurrency-slot lease for experiment {{experimentId}} (slot {{slot}}, previously held by pid {{pid}} on {{host}}; its heartbeat went stale) — that run likely died without releasing it; this run now owns the slot.\n",
  "runner.gateLeaseWaiting":
    "waiting on another run for experiment {{experimentId}}'s concurrency slots: all {{effectiveN}} in use ({{holders}}). Concurrent runs share this experiment's slots, and the smallest maxConcurrency in play wins — this run declared {{declaredN}}. Nothing dispatches until a slot frees up; the other run's slots release when its attempts finish, or 30s after it dies.\n",
  "runner.dispatchHaltedExperiment": "experiment halted (dispatch-halted): {{message}}\n",
  "runner.dispatchHaltedEval": "eval halted: {{message}}\n",
  "judge.modelMissing":
    "No judge model configured. Set it in the Experiment, Eval, or defineConfig judge config (there is no built-in default model, and no environment variable for it).\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/tutorials/scoring-guide.mdx",
  "loaders.yamlMissing":
    "loadYaml(\"{{path}}\") needs a YAML parser: run `pnpm add yaml` first (or switch to loadJson with a JSON dataset).",
  "loaders.criteriaNoMatch":
    "These loadCriteria patterns matched no files (or everything they matched was excluded by a later `!` pattern): {{patterns}}. They are most likely misspelled, or the criteria files moved — patterns expand from the project root {{root}}, not from the eval file's directory. Check these against the real paths on disk, and drop the pattern if it is no longer needed; the other patterns having matches is no excuse, because letting this pass silently narrows the criteria, and narrowed criteria let an eval that should re-run keep carrying its old verdict.",
  "loaders.criteriaOutsideRoot":
    "loadCriteria matched \"{{path}}\", which lands outside the project root (it resolves to {{resolved}}): a criteria file's project-root-relative path is its fingerprint key, and that key stops being stable once it points out of the root. Move the tree (or the symlink's target) inside the project root {{root}}, or exclude that link with a `!` pattern.",
  "loaders.privateNoMatch":
    "These loadPrivate patterns matched no files (or everything they matched was excluded by a later `!` pattern): {{patterns}}. They are most likely misspelled, or the private files moved — patterns expand from the project root {{root}}, not from the eval file's directory. Check these against the real paths on disk; letting this pass silently would drop hidden inputs from the leak gate and the fingerprint.",
  "loaders.outsideDiscovery":
    "Read of \"{{path}}\" happened outside discovery: loaders may only be called at the module top level of an eval file (while discovery evaluates that module), which is the only point early enough for the file's content to enter this eval's fingerprint. Move the read to the module top level and keep the result in a constant that test(t) uses; loaders cannot be called at run time from test(t) or from lifecycle hooks.",
  "loaders.nonFileUrl":
    "A URL passed to a loader must use the file: protocol, but got {{protocol}} ({{url}}). Pass new URL(relativePath, import.meta.url) instead, or use a plain project-root-relative string path.",
  "cli.flag.parseError": "{{message}}\nRun `niceeval --help` for usage.\n",
  "cli.command.unknown": "Unknown command \"{{command}}\".\nRun `niceeval --help` for usage.\n",
  "cli.help":
    "niceeval — agent-native evals\n\n" +
    "Usage:\n" +
    "  niceeval exp [path|experiment] [eval-id-prefix…]    run experiments\n" +
    "      --teardown   recover a killed run: run only the selected experiments'\n" +
    "        teardown (no attempts, no setup); combining it with eval id prefixes is an error\n" +
    "  niceeval show [eval-id-prefix… | @<locator>]        read results in the terminal\n" +
    "      no evidence flag: leaderboard scoped to the matched evals (bare show, an\n" +
    "        eval id prefix, or a single --exp all land here); two or more --exp\n" +
    "        compares those conditions eval by eval instead\n" +
    "      @<locator>  exactly one attempt: no flag -> compact overview;\n" +
    "        with a flag -> that evidence slice\n" +
    "      --source      the Eval source captured when this attempt ran,\n" +
    "        assertions mapped back to source lines\n" +
    "      --execution   this attempt's execution event stream (messages/thinking/\n" +
    "        Skill loads/tool calls); OTel adds timing to the same node when present\n" +
    "      --execution --grep <pattern>   only matching cards, plus a cross-attempt\n" +
    "        match summary; --execution --expand <t<n>.c<n>|cmd<n>>   one full card\n" +
    "        (mutually exclusive with each other; range must be one attempt for --expand)\n" +
    "      --timing      unified timing tree for the attempt (phases + hooks/commands/turns + per-turn OTel)\n" +
    "      --diff[=file] sandbox workspace file-change summary; =file expands one file\n" +
    "      evidence flags accept any range: a range with more than one attempt\n" +
    "        renders one section per attempt (experimentId, evalId, attempt order)\n" +
    "      --history   per experiment × eval execution timeline (mutually exclusive with --report)\n" +
    "      --usage     UsageTable per attempt in range, sectioned by experiment with totals\n" +
    "      --stats     eval x experiment stability matrix over all historical executions\n" +
    "        (mutually exclusive with @<locator> and --report)\n" +
    "      --json      structured form of any slice: one JSON document on stdout, same\n" +
    "        selection as the text form (mutually exclusive with --report and --expand)\n" +
    "      --record <dir>    pin a record root     --exp <id>   repeatable; 2+ compares conditions\n" +
    "      --report <file>   custom report    --page <id>   pick the initial page (multi-page\n" +
    "        reports render it, then list the rest as a page index with copyable commands)\n" +
    "      --fresh   only count freshly executed attempts (excludes carried-over and\n" +
    "        historical stitched-in attempts); excluded evals show up as placeholder rows\n" +
    "  niceeval list                                       list discovered evals\n" +
    "  niceeval view [eval-id-prefix…] [--out dir] [--port n] [--no-open]\n" +
    "      report pages + evidence rooms; --report <file> swaps in your report\n" +
    "      (same file as show); --page <id> picks the initial page;\n" +
    "      --record <dir> pins a record root; --run <file> opens exactly\n" +
    "      one run; --exp <id> (repeatable) narrows to those experiments;\n" +
    "      --fresh only new executions\n" +
    "      --out <dir> exports a static site: index.html plus the viewer\n" +
    "      artifacts, ready for any static host\n" +
    "  niceeval sandbox list|enter|history|diff|stop  inspect & destroy sandboxes kept by --keep-sandbox\n" +
    "  niceeval sandbox list --orphans / prune         reclaim instances orphaned by a killed run\n" +
    "  niceeval clean                                      delete .niceeval/ artifacts\n" +
    "  niceeval init                                       scaffold config + evals/\n\n" +
    "Flags:\n" +
    "  --attempts n  --max-concurrency n  --timeout ms  --budget usd  --tag t\n" +
    "  --early-exit / --no-early-exit  --strict  --rerun[=failed|all]  --accept[=selector]  --dry\n" +
    "  --json  (machine feed: NDJSON on stdout; default is human text)\n" +
    "  --junit path  --out dir  --port n  --open / --no-open  -h, --help  -v, --version\n\n" +
    "Positional args only select which evals to run (id prefixes); which agent and\n" +
    "how to run come from experiments/ + flags. Resolution: flag > experiment >\n" +
    "eval (timeoutMs / judge only) > niceeval.config.ts > built-in default, where\n" +
    "config is the fallback floor, not an override; --timeout has no built-in default —\n" +
    "with none of the four set, an attempt has no deadline. Configuration has no environment layer;\n" +
    "environment variables hold credentials such as API keys.\n",
  "cli.show.noResults": "No results found under {{root}}. Run `niceeval exp` first, then `niceeval show`.\n",
  "cli.show.runDirMissing": "Record directory not found: {{dir}}\n",
  "cli.show.noEvalMatch": "No results matched: {{pattern}}. Evals with results: {{evals}}\n",
  "cli.show.noExperimentMatch": "No experiment matched --exp {{arg}}. Experiments with results: {{experiments}}\n",
  "cli.show.expAmbiguous":
    "error: --exp {{arg}} matched {{matched}} experiments: {{candidates}}\n  fix: use one of the exact ids above, or a longer prefix — each --exp in a compare must resolve to exactly one experiment\n",
  "cli.show.locatorExpConflict":
    "error: {{locator}} cannot combine with repeated --exp ({{exp}})\n  fix: drop the extra --exp flags — a locator already pins one attempt to one experiment; for a multi-condition comparison, drop the locator and use eval id prefixes with --exp instead\n",
  "cli.show.statsLocatorConflict":
    "error: --stats cannot combine with a locator ({{locator}}) — a single attempt has no stability to measure\n  fix: drop the locator and use eval id prefixes / --exp to select a range for --stats\n",
  "cli.show.statsReportConflict":
    "error: --stats cannot combine with --report ({{report}}) — --stats is a zero-config slice, it does not render a user report tree\n  fix: drop --report to use --stats, or drop --stats and put a StabilityMatrix in your own report file\n",
  "cli.show.grepExpandConflict":
    "error: --grep and --expand cannot combine — --grep scans for matching cards, --expand prints one card in full\n  fix: drop one of the two flags\n",
  "cli.show.grepExecutionOnly":
    "error: --grep only combines with --execution — it narrows that block's text rendering, not a slice of its own\n  fix: add --execution, or drop --grep\n",
  "cli.show.expandExecutionOnly":
    "error: --expand only combines with --execution — it narrows that block's text rendering, not a slice of its own\n  fix: add --execution, or drop --expand\n",
  "cli.show.grepInvalidPattern":
    "error: --grep pattern is not a valid JS regular expression: \"{{pattern}}\" ({{message}})\n  fix: fix the pattern syntax (it is passed to `new RegExp(...)`)\n",
  "cli.show.expandMultiAttempt":
    "error: --expand requires the range to resolve to exactly one attempt, got {{count}}\n  fix: narrow the range to a single attempt — an eval id prefix matching one eval, or @<locator>\n",
  "cli.show.expandNotFound": "error: {{message}}\n  fix: use a handle from a truncated card's own hint (t<turn>.c<card> or cmd<n>), or drop --expand to see the whole attempt\n",
  "cli.show.historyReportConflict":
    "`--history` and `--report` are mutually exclusive: both take over the main output. --history is the host's per-attempt execution timeline; for run-level trends, compose exp.runs inside your report file instead.\n",
  "cli.show.jsonReportConflict":
    "error: --json cannot combine with --report ({{report}}) — a report tree says how to look at the data, --json says what the data is\n  fix: drop --report to use --json, or drop --json and read the report tree as text/HTML\n",
  "cli.show.jsonExpandConflict":
    "error: --json cannot combine with --expand — JSON never truncates cards, there is nothing to expand\n  fix: drop --expand; --json already returns the full untruncated value\n",
  "cli.show.jsonMultiEvidenceConflict":
    "error: --json requires exactly one of --source/--execution/--timing/--diff at a time — the envelope's \"view\" is a single value, there is no combined shape for more than one\n  fix: drop the extra evidence flags, or make one --json call per flag\n",
  "cli.show.locatorMalformed": "{{message}}\n",
  "cli.show.locatorNotFound": "{{message}}\n",
  "cli.eval.noMatch": "No eval matched: {{patterns}}.\n",
  "cli.eval.noMatchHintExperiment": "Hint: \"{{pattern}}\" is an experiment{{kind}}; you probably meant: niceeval exp {{pattern}}\n",
  "cli.eval.noMatchKnown": "Discovered {{count}} evals: {{evals}}\n",
  "cli.exp.agentModelFlagUnsupported": "experiment runs do not support --agent / --model. Add or copy an experiment file and change its model instead.\n",
  "cli.exp.viewerFlagUnsupported": "`{{flag}}` only applies to niceeval {{command}}, not niceeval exp.\n",
  "cli.exp.teardownNoEvalPatterns":
    "--teardown selects experiments only; it does not run any eval, so eval id patterns are not allowed with it. Use `niceeval exp <experiment path> --teardown`.\n",
  "cli.exp.teardownDone": "teardown done: {{experimentId}}\n",
  "cli.exp.teardownFailed": "teardown failed: {{experimentId}}: {{message}}\n",
  "cli.experiment.noMatch":
    "No experiment matched: {{arg}}. Available paths: {{experiments}}.\n" +
    "Run `niceeval exp <path> --dry` to preview a plan.\n",
  "cli.experiment.viewerCommandHint": "Did you mean: niceeval {{command}}{{args}}\n",
  "cli.experiment.noEvalPrefixMatch":
    "No eval matched prefix: {{pattern}} in experiments selected by {{selection}}.\n" +
    "Positional args after the first select eval id prefixes. To run another experiment,\n" +
    "run it as its own command: niceeval exp {{pattern}}\n",
  "cli.experiment.noEvalsSelected":
    "No evals selected: {{selection}} matched 0 evals. Available eval prefixes: {{experiments}}.\n" +
    "Run `niceeval exp {{selection}} --dry` to see what it covers, or drop the eval filter to run every eval selected by those experiments.\n",
  "cli.experiment.strictOnPoints":
    "All {{count}} evals selected by experiment \"{{experimentId}}\" are points-based (defineScoreEval), and `--strict` does nothing for them:\n" +
    "the flag only promotes soft assertions that carry a threshold into gates, while a points eval's verdict comes solely from a `.gate()` prerequisite abort — losing points never changes it.\n" +
    "Drop `--strict` and re-run; to tighten a points eval, write the must-hold checks as `.gate()` prerequisites.\n",
  "cli.experimentGroup": " path",
  "cli.fallbackCleanupTimeout": "\ngraceful cleanup timed out; force-cleaning sandboxes...\n",
  "cli.forceCleanupExit": "\nForce-cleaning sandboxes and exiting...\n",
  "cli.init.done": "Ready: evals/, niceeval.config.ts, and the niceeval agent-rules block in AGENTS.md (points coding agents at node_modules/niceeval/docs-site/zh).\n",
  "cli.init.esmHint":
    "tip: this project's package.json has no \"type\": \"module\". niceeval runs either way, but CommonJS mode disallows top-level await in config/eval files — add \"type\": \"module\" to package.json for the smoothest path.\n",
  "cli.interruptCleanup": "\nInterrupted; cleaning up sandbox containers... (press again to force cleanup and exit)\n",
  "cli.list.header": "Discovered {{count}} evals:\n",
  "cli.noAgent": "No agent specified (use --agent <name>).\n",
  "cli.none": "(none)",
  "cli.pressCtrlC": "Press Ctrl+C to exit.\n",
  "cli.resultsPath": "Structured results: {{path}} (run.json + per-attempt result.json / events.json / trace.json / diff.json)\n",
  "cli.run.experimentRequired":
    "Run evals through an experiment: use `niceeval exp [path|config] [eval id prefix]`.\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/tutorials/write-experiment.mdx\n",
  "cli.run.experimentRequiredHint": "Hint: \"{{pattern}}\" is an experiment{{kind}}; you probably meant: niceeval exp {{pattern}}\n",
  "cli.run.experimentRequiredKnown": "Discovered experiments: {{experiments}}\n",
  "cli.view.exportedDir": "Exported static report site: {{out}} (serve the whole directory with any static host; opening index.html via file:// cannot fetch artifacts)\n",
  "cli.view.incompatible": "{{dir}}: written by niceeval {{producer}} (schemaVersion {{schemaVersion}}); this CLI reads schemaVersion {{supported}}.\nRun `{{command}}` to view it.\n",
  "cli.view.noResults": "No results found under {{root}}. Run `niceeval exp` first, then `niceeval view`.\n",
  "cli.view.incompatibleForeign": "{{dir}}: written by {{name}} {{version}} (schemaVersion {{schemaVersion}}); this CLI reads schemaVersion {{supported}}.\nOpen this report with the tool that produced it.\n",
  "cli.view.url": "niceeval view: {{url}}\n",
  "context.capabilityMissing":
    "Agent \"{{agent}}\" is not sandbox-backed (built with defineSandboxAgent), so t.{{method}} is unavailable. Use an agent built with defineSandboxAgent, or drop this assertion.\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/tutorials/sandbox-agent.mdx",
  "context.skipEmpty": "skip() requires a non-empty reason.",
  "define.agentNameRequired": "defineDirectAgent requires name.",
  "define.evalIdRejected": "defineEval does not accept id; ids are derived from file paths.",
  "define.evalEnvironmentEmpty": "defineEval environment must be a non-empty profile id when provided.",
  "define.evalTestRequired": "defineEval requires an async test(t) function.",
  "define.evalEvaluationKindRejected": "defineEval does not accept evaluationKind; it is always set to \"pass\" (pass eval kind). Use defineScoreEval for the points kind.",
  "define.evalConfigHashRejected": "defineEval does not accept configHash; configHash is computed during run planning.",
  "define.scoreEvalIdRejected": "defineScoreEval does not accept id; ids are derived from file paths.",
  "define.scoreEvalEnvironmentEmpty": "defineScoreEval environment must be a non-empty profile id when provided.",
  "define.scoreEvalTestRequired": "defineScoreEval requires an async test(t) function.",
  "define.scoreEvalEvaluationKindRejected": "defineScoreEval does not accept evaluationKind; it is always set to \"points\" (points eval kind). Use defineEval for the pass kind.",
  "define.scoreEvalConfigHashRejected": "defineScoreEval does not accept configHash; configHash is computed during run planning.",
  "define.experimentAgentRequired": "defineExperiment requires agent.",
  "define.experimentFlagNotJson": "experiment.flags.{{key}} is not JSON-serializable (functions / undefined / cycles / bigint are not allowed); flags are persisted verbatim into result runs and must be plain JSON.",
  "define.experimentLabelInvalid": "experiment.labels.{{key}} must be a string or a finite number; labels are report-side grouping coordinates persisted verbatim into result runs.",
  "define.experimentSetupNotFunction": "experiment.setup must be a function ((ctx) => void); use experiment.teardown for cleanup; to prepare the in-sandbox environment per experiment, chain .setup() hooks on the sandbox spec instead.",
  "define.experimentClassifyFailureNotFunction": "experiment.classifyFailure must be a function ((failure) => FailureClass | undefined); it classifies failures that surface as third-party errors and must return undefined for anything it does not recognize.",
  "define.experimentIdRejected": "defineExperiment does not accept id; ids are derived from file paths.",
  "define.sandboxAgentNameRequired": "defineSandboxAgent requires name.",
  "define.sandboxAgentEnsureRequired": "defineSandboxAgent requires an ensure declaration.",
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
  "feedback.human.compare": "Compare: niceeval view",
  "feedback.human.counts":
    "{{total}} total · {{reused}} reused · {{running}} running · {{queued}} queued · {{passed}} passed · {{failed}} failed · {{errored}} errored · {{skipped}} skipped",
  "feedback.human.diffHint": "Diff:    niceeval show {{locator}} --diff",
  "feedback.human.evalHint": "Eval:    niceeval show {{locator}} --source",
  "feedback.human.failuresHeader": "FAILURES",
  "feedback.human.heartbeat": "{{elapsed}} elapsed · {{counts}}",
  "feedback.human.inspect": "Inspect: niceeval show {{locator}}",
  "feedback.human.keptSandboxesHeader": "KEPT SANDBOXES",
  "feedback.human.moreActive": "… {{count}} more active",
  "feedback.human.nextHeader": "NEXT",
  "feedback.human.plan": "{{total}} attempts · {{evals}} evals × {{configs}} configs · concurrency {{concurrency}}",
  "feedback.human.planHeader": "PLAN",
  "feedback.human.resultFailed": "FAILED",
  "feedback.human.resultIncomplete": "INCOMPLETE",
  "feedback.human.resultInterrupted": "INTERRUPTED",
  "feedback.human.resultPassed": "PASSED",
  "feedback.human.resultsHeader": "RESULTS",
  "feedback.human.resultsMore": "… {{count}} more",
  "feedback.human.reuse": "{{reused}} of {{total}} carried in from cache · {{toRun}} to run",
  "feedback.human.summaryLine": "{{passed}} passed · {{failed}} failed · {{errored}} errored  ({{reused}} reused)",
  "feedback.human.summaryAllReusedLine": "{{passed}} passed · {{failed}} failed · {{errored}} errored  (all {{reused}} reused)",
  "feedback.human.suppressedFailures": "… {{count}} more failures suppressed",
  "feedback.human.trace": "Trace:   niceeval show {{locator}} --execution",
  "feedback.phase.agentSetup": "agent setup",
  "feedback.phase.agentEnsure": "ensuring agent",
  "feedback.phase.stateLoad": "loading experiment state",
  "feedback.phase.stateSave": "saving experiment state",
  "feedback.phase.evalRun": "running eval",
  "feedback.phase.sandboxCreate": "creating sandbox",
  "feedback.phase.sandboxQueue": "queued for sandbox",
  "feedback.phase.experimentSetup": "experiment setup",
  "feedback.phase.experimentTeardown": "experiment teardown",
  "feedback.phase.judgePrecheck": "judge precheck",
  "feedback.human.hookDone": "done",
  "feedback.human.hookFailed": "failed",
  "feedback.human.precheckJudge": "prechecking judge config",
  "feedback.human.precheckJudgeDone": "judge config ok",
  "feedback.human.precheckJudgeFailed": "judge precheck failed",
  "feedback.human.planExperimentConcurrency": "{{experimentId}} ≤{{limit}}",
  "feedback.human.countsWithElsewhere":
    "{{total}} total · {{reused}} reused · {{running}} running · {{elsewhere}} elsewhere · {{queued}} queued · {{passed}} passed · {{failed}} failed · {{errored}} errored · {{skipped}} skipped",
  "feedback.human.waitingOnAnotherRun": "waiting on another run",
  "feedback.human.lockWaitDetail": "{{count}} evals · pid {{pid}}",
  "feedback.human.lockWaitStarted": "waiting on another run · {{experimentId}} ({{count}} evals, pid {{pid}})",
  "feedback.human.lockWaitResolved": "lock wait resolved · {{experimentId}} ({{summary}}, {{elapsed}})",
  "feedback.human.lockWaitCarried": "{{count}} carried",
  "feedback.human.lockWaitDispatched": "{{count}} to run",
  "feedback.human.lockedRowSuffix": "locked",
  "feedback.phase.sandboxPrepare": "preparing sandbox",
  "feedback.phase.scoring": "scoring",
  "feedback.phase.teardown": "cleaning up",
  "feedback.phase.telemetryCollect": "collecting trace",
  "feedback.phase.telemetryConfigure": "configuring telemetry",
  "feedback.phase.workspaceBaseline": "preparing workspace",
  "feedback.phase.workspaceDiff": "capturing diff",
  "feedback.rendererError": "  · [feedback] renderer failed while handling {{context}} (ignored): {{message}}\n",
  "hitl.answerNeedsOptionOrText": "The object form of t.respond needs exactly one of optionId or text.",
  "hitl.invalidOption": "Answer \"{{optionId}}\" is not an option of request {{requestId}} ({{options}}).",
  "hitl.noOptions": "this request has no options",
  "hitl.requestMissingId": "This input.requested request has no stable id, so a response cannot be built — the adapter must give every pending request a stable id.",
  "hitl.respondAllEmpty": "There is no pending input.requested request; respond() / respondAll() cannot work. Confirm the turn parked with t.parked(), then answer via t.requireInputRequest() or t.respond().",
  "hitl.respondEmpty": "t.respond(...) requires at least one answer.",
  "hitl.stringAmbiguous": "There are {{count}} pending input requests; a plain-string answer cannot be matched to one. Use the { request, optionId } or { request, text } object form to name it explicitly.",
  "judge.apiKeyMissing": "judge is missing an API key: set NICEEVAL_JUDGE_KEY, or point judge.apiKeyEnv at another environment variable.",
  "judge.httpError": "judge HTTP {{status}}: {{body}}",
  "judge.probeFailed": "judge precheck failed: {{endpoint}} ({{model}}): {{error}}",
  "judge.probeTimeout": "judge precheck failed: {{endpoint}} ({{model}}) timed out {{attempts}} times ({{seconds}}s each) — the endpoint accepts connections but never answers; first check whether other traffic on the same account is saturating the gateway's concurrency, then verify the judge baseUrl (NICEEVAL_JUDGE_BASE)",
  "judge.probeMissingKey": "judge model {{model}} is missing an API key; configure {{envHint}}",
  "live.more": "… {{hidden}} more ({{running}} running · {{waiting}} waiting · {{done}} done)",
  "live.running": "  Running {{totalRuns}} attempts ({{evals}} evals × {{configs}} configs, concurrency {{concurrency}})       {{completed}}/{{total}} done",
  "live.runningUnknown": "  Running...  {{completed}}/{{total}} done",
  "live.waiting": "waiting for a slot...",
  "local.commandTimeout": "Command timed out after {{timeoutMs}}ms",
  "local.dirMissing":
    "local sandbox directory does not exist: {{dir}}. Create it first, or point localSandbox({ dir }) at an existing directory.",
  "local.dirNotWritable": "local sandbox directory is not writable: {{dir}} ({{message}})",
  "local.notARepo":
    "the current directory (and its parents) is not inside a git repository, so localSandbox() has no deterministic root to run in. cd into the repository you want to evaluate, or pass an explicit directory: localSandbox({ dir: \"/path/to/repo\" }).",
  "local.rootUnsupported":
    "the local sandbox provider does not support { root: true } — niceeval does not escalate privileges on your machine. Use a container provider (docker / e2b / vercel) for steps that need root.",
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
  "report.table.evalTitle": "Eval Record:",
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
  "runner.otlpInSandbox": "OTLP in-sandbox collector -> {{endpoint}}{{proto}}",
  "runner.otlpOverride": "OTLP receiver (host override) -> {{endpoint}}",
  "runner.otlpReceiver": "OTLP receiver -> {{endpoint}}{{proto}}",
  "runner.otlpShared": "OTLP shared receiver (run-scoped) -> {{endpoint}}",
  "runner.providerExclusiveSerial":
    "  · [sandbox] the \"{{provider}}\" provider forces attempts to run one at a time (exclusive); concurrency stays at 1 for it regardless of --max-concurrency {{concurrency}}\n",
  "runner.remoteSandboxUnavailable": "remote agents do not have sandbox.{{method}}; use a sandbox agent or remove workspace assertions.",
  "runner.reporterDiagnostic": "  · [diagnostic] {{stage}} failed (ignored): {{message}}\n",
  "runner.skip": "skip: {{reason}}",
  "runner.startAgentSetup": "agent setup (install CLI / write config)...",
  "runner.startAgentEnsure": "agent ensure (probe / install / recheck)...",
  "runner.startAgentTracing": "agent tracing (write OTEL export config)...",
  "runner.startSandbox": "starting sandbox...",
  "runner.startSandboxSetup": "sandbox setup (environment provisioning hooks)...",
  "runner.startSandboxTeardown": "sandbox teardown (environment provisioning hooks)...",
  "runner.timeout": "attempt timed out ({{timeoutMs}}ms, from {{source}})\nRecent progress:\n{{recentLogs}}",
  "runner.traceSelected": " -> kept {{count}} semantic spans",
  "runner.useRemoteAgent": "using remote agent (no sandbox created)...",
  "sandbox.deadlineExceedsSession":
    "error: this attempt's timeout ({{timeoutMs}}ms) is longer than what a single {{provider}} session lives ({{limitMs}}ms); the sandbox would be reclaimed mid-attempt.\n" +
    "  fix: lower timeoutMs below {{limitMs}}ms, or declare a longer lifetimeMs on the sandbox spec if your plan allows it.\n",
  "sandbox.providerNotImplemented": "{{provider}} sandbox provider is not implemented; use docker, vercel, e2b, or local",
  "sandbox.missingSpec":
    "sandbox agent needs a sandbox, but none was given. niceeval no longer picks a default — set `sandbox` in defineExperiment()/defineConfig() to dockerSandbox() / vercelSandbox() / e2bSandbox() (import from \"niceeval/sandbox\").\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/tutorials/sandbox-providers.mdx",
  "sandbox.dependencyMissing.docker": "Docker sandbox requires 'dockerode'. Install it with: pnpm add dockerode @types/dockerode",
  "sandbox.dependencyMissing.e2b": "E2B sandbox requires 'e2b'. Install it with: pnpm add e2b",
  "sandbox.dependencyMissing.vercel": "Vercel sandbox requires '@vercel/sandbox'. Install it with: pnpm add @vercel/sandbox",
  "sandbox.forceCleanup": "  · [sandbox] force-cleaning {{count}} sandboxes...\n",
  "sandbox.provisionReconcileFailed": "  · [sandbox] provision reconcile failed, aborting retry (a possibly-created instance could not be verified/killed): {{error}}\n",
  "sandbox.provisionRetry": "  · [sandbox] provisioning rate-limited, retrying in {{delayMs}}ms (attempt {{attempt}}/{{maxAttempts}})...\n",
  "sandbox.stopFailed": "  · [sandbox] failed to stop sandbox {{id}} (ignored; it keeps running, and billing, until this provider's own timeout — if it has one — reclaims it): {{message}}\n",
  "sandbox.stopTimeout": "stop timed out ({{timeoutMs}}ms)",
  "sandbox.transferTimeout":
    "{{provider}} {{operation}} timed out transferring {{object}}. This is the provider SDK / HTTP round trip timing out, not the attempt's timeoutMs budget — raising --timeout will not help. " +
    "fix: split the transfer into smaller batches, bake large fixtures into the image/template, or download them inside the sandbox instead.",
  "o11y.sandboxTempNotWritable":
    "the in-sandbox OTLP collector cannot write {{path}}: the system temp directory is not writable by the sandbox's run user. This is an image environment defect, not an eval or niceeval configuration problem — " +
    "a provider's writability guarantee must cover more than workdir, since the runner puts the collector and the change ledger outside it. " +
    "fix: make /tmp writable for the run user (`chmod 1777 /tmp` in the image, or pick an image/user that does not mount /tmp read-only), then rerun — finished attempts carry over.",
  "scoring.evalError": "evaluation error: {{error}}",
  "scoring.pointsInvalid": ".points({{n}}) is invalid; points must be a positive finite number (n > 0).",
  "scoring.scoreInvalid": "t.score({{label}}, {{n}}) is invalid; points must be a non-negative finite number (n >= 0).",
  "session.fileFallback": "[file]",
  "session.tools": "{{count}} tools",
  "session.turn.primary": "turn {{turn}}",
  "session.turn.secondary": "session {{session}} · turn {{turn}}",
  "session.turnRetry": "turn retry {{attempt}}/{{maxAttempts}} ({{reason}}) — waiting {{seconds}}s",
  "session.turnRetryBudgetExhausted": " · attempt retry budget exhausted ({{maxRetries}} retries, {{reason}})",
  "session.turnRetrySendExhausted": " · retries exhausted ({{maxAttempts}} attempts, {{reason}})",
  "util.requiredEnv": "Missing required environment variable {{name}} (configure it in .env).",
  "vercel.fileNotFound": "File not found: {{path}}",
  "vercel.rotateFailed": "[VercelSandbox] session rotate failed ({{seconds}}s): {{error}}",
  "vercel.rotated": "[VercelSandbox] session rotated after {{seconds}}s -> {{sessionId}}",
} satisfies Messages;
