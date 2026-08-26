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
  "e2b.listNextItemsNotArray":
    "e2b Sandbox.list() paginator nextItems() returned a non-array ({{type}}), not the SandboxInfo[] promised by the SDK type contract",
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
  "cli.debug.usage":
    "error: niceeval debug expects exactly one Experiment selector and one Eval selector\n" +
    "  fix: niceeval debug <experiment> <eval> [--json]\n",
  "cli.debug.flagUnsupported":
    "error: {{flag}} is not valid with niceeval debug\n" +
    "  fix: pass only <experiment> <eval>, optionally --json\n",
  "cli.debug.experimentNoMatch":
    "error: Experiment selector \"{{selector}}\" matched nothing\n" +
    "  exact candidates: {{candidates}}\n",
  "cli.debug.experimentAmbiguous":
    "error: Experiment selector \"{{selector}}\" is ambiguous\n" +
    "  exact candidates: {{candidates}}\n",
  "cli.debug.evalNoMatch":
    "error: Eval selector \"{{selector}}\" matched nothing in Experiment \"{{experimentId}}\"\n" +
    "  exact candidates: {{candidates}}\n",
  "cli.debug.evalAmbiguous":
    "error: Eval selector \"{{selector}}\" is ambiguous in Experiment \"{{experimentId}}\"\n" +
    "  exact candidates: {{candidates}}\n",
  "cli.accept.choiceHeader": "previous-result  {{selector}}{{change}}  ({{evals}} evals)\n",
  "cli.accept.prompt": "  reuse these results? [y/N] ",
  "cli.accept.nothingToAccept":
    "No difference in this plan can be accepted (nothing is blocked by the fingerprint gate).\n" +
    "Running as planned.\n",
  "cli.accept.equivalent": "equivalent command:  {{command}}\n",
  "cli.accept.noneChosen": "Nothing accepted; running as planned.\n",
  "cli.accept.usage":
    "error: niceeval accept expects one or more locators in the form @<locator>...\n" +
    "  fix: copy an explicit locator from `niceeval exp --dry`, then run `niceeval accept @<locator>...`\n",
  "cli.accept.flagUnsupported":
    "error: {{flag}} is not valid with niceeval accept\n" +
    "  fix: pass only @<locator> (and optionally --record <dir>)\n",
  "cli.accept.failed": "error: could not accept result: {{error}}\n",
  "cli.accept.done":
    "Accepted source Attempt {{sourceLocator}} into new Run {{runId}}. Result locator remains {{locator}}. Current fingerprint: {{fingerprint}}\n",
  "cli.rename.usage":
    "error: niceeval exp rename expects exactly two arguments: an old id and a new id\n" +
    "  fix: niceeval exp rename <oldId> <newId> [--dry] [--json]\n",
  "cli.rename.flagUnsupported":
    "error: {{flag}} is not valid with niceeval exp rename\n" +
    "  fix: pass only <oldId> <newId>, optionally --dry / --json\n",
  "cli.rename.previewHeader": "exp rename preview: {{oldId}} -> {{newId}}\n",
  "cli.rename.blocked": "  blocked (nothing will be written): {{reason}}\n",
  "cli.rename.migratingHeader": "  {{count}} terminal results will migrate:\n",
  "cli.rename.migratingRow": "    {{evalId}}  {{sourceLocator}} -> {{newId}}\n",
  "cli.rename.excludedHeader": "  {{count}} excluded (not migrated, does not block):\n",
  "cli.rename.excludedRow": "    {{evalId}}  {{reason}}\n",
  "cli.rename.doneHeader":
    "exp rename done: rebound {{count}} terminal results from {{oldId}} to {{newId}}.\n",
  "cli.rename.snapshotPath": "  new snapshot: {{path}}\n",
  "cli.rename.doneRow": "    {{evalId}}  {{sourceLocator}} -> {{locator}}\n",
  "cli.rename.error.sourceEmpty":
    "error: {{oldId}} has no readable terminal history to migrate to {{newId}}.\n" +
    "  fix: restore and verify {{oldId}}'s real results before retrying; with no old results, run `niceeval exp {{newId}}` and do not rename.\n" +
    "       exp rename does not move experiment source, nor delete or rewrite the old result tree.\n",
  "cli.rename.error.targetNotFound":
    "error: new id \"{{newId}}\" is not discovered under this project's experiments/.\n" +
    "  fix: create or rename the experiment in experiments/ first (e.g. `git mv experiments/{{oldId}}.ts experiments/{{newId}}.ts`), then rerun.\n",
  "cli.rename.error.targetHasResults":
    "error: {{newId}} already has terminal results for these evals; rename never overwrites existing results.\n" +
    "  fix: keep the target results, or explicitly clean the target history and re-preview; the command deletes nothing itself.\n",
  "cli.rename.error.sourceUnreadable":
    "error: the Record for {{oldId}} is unreadable; cannot migrate to {{newId}}.\n" +
    "  fix: view this record with a niceeval version that reads its schemaVersion.\n",
  "cli.rename.error.artifactUnavailable":
    "error: source evidence cannot be preserved ({{evalId}}); nothing will be written.\n" +
    "  fix: make the artifact reference and source locator readable, or rerun this eval.\n",
  "cli.rename.error.nothingToMigrate":
    "error: nothing to migrate under {{oldId}}: no terminal passed/failed still selected by {{newId}}, or all excluded.\n" +
    "  fix: check that {{newId}}'s evals selector covers the old experiment's results.\n",
  "cli.rename.conflicting": "  conflicting evals: {{evals}}\n",
  "cli.rename.failed": "error: exp rename failed: {{error}}\n",
  "cli.error": "niceeval error: {{error}}\n",
  "cli.flag.acceptNeedsSelector":
    "error: --accept needs a selector, for example --accept config:judge.model\n" +
    "  fix: run `niceeval exp <selection> --dry` first; every `previous-result` line prints the selectors it can accept, copy one verbatim\n" +
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
  "cli.flag.strictRemoved":
    "Unknown option: --strict\nExpress required facts with t.check(...) or await t.check(...).orStop() in the Eval source.\n",
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
  "runner.coordinationRecovered":
    "recovered expired coordination state for {{experimentId}}; this run continues. Further recoveries are summarized at completion.\n",
  "runner.sharedStateWaiting":
    "waiting for sharedState key {{key}} to be released; this Invocation will not take it over automatically.\n",
  "runner.sharedStateRecoveryRequired":
    "sharedState key {{key}} requires explicit recovery before another Invocation can use it. Inspect immutable owner evidence with `niceeval exp <selector> --teardown --recover-shared-state <key>`.\n",
  "runner.sharedStateExplicitRecovered":
    "explicitly recovered sharedState key {{key}} for experiment {{experimentId}}.\n",
  "cli.exp.sharedStateRecoveryFlags":
    "sharedState recovery requires `--teardown --recover-shared-state <key> --owner-token <token> --confirm-owner-terminated --confirm-remote-quiesced`.\n",
  "cli.exp.sharedStateRecoveryJsonUnsupported":
    "error: explicit sharedState recovery does not support --json. Retry without --json; this recovery flow has a human-only interface.\n",
  "cli.exp.sharedStateRecoveryTeardownRequired":
    "error: sharedState recovery requires the selected Experiment {{experimentId}} to declare teardown as a function. The active generation was left unchanged.\n",
  "cli.exp.sharedStateRecoveryTarget":
    "sharedState recovery target:\n  key: {{key}}\n  experiment: {{experimentId}}\n  owner token: {{ownerToken}}\n  host: {{host}}\n  PID: {{pid}}\n  process identity: {{processIdentity}}\n  heartbeat: {{heartbeatAt}}\n",
  "cli.exp.sharedStateRecoveryAlreadyReleased":
    "sharedState key {{key}} was already released after its cleanup; its immutable recovery generation is already complete.\n",
  "cli.exp.sharedStateRecoveryRegistrationFailed":
    "error: sharedState recovery for {{key}} could not clear the exact interrupted teardown registration: {{message}}. The recovery generation remains closed.\n",
  "cli.exp.sharedStateRecoveryAlreadyReleasedRegistrationFailed":
    "error: sharedState key {{key}} was already released, but NiceEval could not clear the exact stale teardown registration: {{message}}. It did not rerun teardown.\n",
  "runner.dispatchHaltedExperiment": "experiment halted (dispatch-halted): {{message}}\n",
  "runner.dispatchHaltedEval": "eval halted: {{message}}\n",
  "judge.modelMissing":
    "No judge model configured. Set it in the Experiment, Eval, or defineConfig judge config (there is no built-in default model, and no environment variable for it).\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/tutorials/evaluation-kinds.mdx",
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
  "cli.command.missing": "No command specified.\nRun `niceeval --help` for usage.\n",
  "cli.command.unknown": "Unknown command \"{{command}}\".\nRun `niceeval --help` for usage.\n",
  "cli.help":
    "niceeval — agent-native evals\n\n" +
    "Usage:\n" +
    "  niceeval <command> [options]\n\n" +
    "Application options:\n" +
    "  -h, --help       print this command index\n" +
    "  -v, --version    print the installed version\n" +
    "\nRun `niceeval <command> --help` for command-specific usage.\n",
  "cli.record.snapshot.created": "Created RecordSnapshot: {{path}} ({{sealedRunCount}} sealed Runs)\n",
  "cli.record.snapshot.outputRequired": "error: niceeval record snapshot requires --output <snapshot>",
  "cli.record.snapshot.usage": "error: usage: niceeval record snapshot --output <snapshot>",
  "cli.state.migrate.allRequired": "error: niceeval state migrate requires --all",
  "cli.state.migrate.complete": "State migrations complete: {{path}}\n",
  "cli.state.migrate.usage": "error: usage: niceeval state migrate --all",
  "cli.eval.noMatch": "No eval matched: {{patterns}}.\n",
  "cli.eval.noMatchHintExperiment": "Hint: \"{{pattern}}\" is an experiment{{kind}}; you probably meant: niceeval exp {{pattern}}\n",
  "cli.eval.noMatchKnown": "Discovered {{count}} evals: {{evals}}\n",
  "cli.exp.agentModelFlagUnsupported": "experiment runs do not support --agent / --model. Add or copy an experiment file and change its model instead.\n",
  "cli.exp.forceUnsupported": "experiment runs do not support --force; use --rerun all.\n",
  "cli.check.recordUnsupported": "`--record` only applies to niceeval exp, not niceeval check.\n",
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
  "cli.experimentGroup": " path",
  "cli.fallbackCleanupTimeout": "\ngraceful cleanup timed out; force-cleaning sandboxes...\n",
  "cli.forceCleanupExit": "\nForce-cleaning sandboxes and exiting...\n",
  "cli.init.done": "Ready: evals/, niceeval.config.ts, and the niceeval agent-rules block in AGENTS.md (tells coding agents to read the bundled docs before writing evals).\n",
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
  "cli.view.incompatible": "{{dir}}: written by niceeval {{producer}} (schemaVersion {{schemaVersion}}); this CLI reads schemaVersion {{supported}}.\nRun `{{command}}` to view it.\n",
  "cli.view.noResults": "No results found under {{root}}. Run `niceeval exp` first, then `niceeval view`.\n",
  "cli.view.incompatibleForeign": "{{dir}}: written by {{name}} {{version}} (schemaVersion {{schemaVersion}}); this CLI reads schemaVersion {{supported}}.\nOpen this report with the tool that produced it.\n",
  "cli.view.urls": "niceeval view — open in a browser:\n{{urls}}\n",
  "codex.envPathManaged":
    "codexAgent config.env.PATH is not supported: PATH is a Sandbox-managed variable, so silently dropping or overriding it would break hooks and child processes without any error. " +
    "Prepend directories to it with the Sandbox factory's pathPrepend option instead (see docs/feature/sandbox/library.md).",
  "context.capabilityMissing":
    "Agent \"{{agent}}\" is not sandbox-backed (built with defineSandboxAgent), so t.{{method}} is unavailable. Use an agent built with defineSandboxAgent, or drop this assertion.\n" +
    "  Docs: node_modules/niceeval/docs-site/zh/tutorials/sandbox-agent.mdx",
  "context.skipEmpty": "skip() requires a non-empty reason.",
  "define.agentNameRequired": "defineAgent requires name.",
  "define.evalIdRejected": "defineEval does not accept id; ids are derived from file paths.",
  "define.evalEnvironmentEmpty": "defineEval environment must be a non-empty profile id when provided.",
  "define.evalTestRequired": "defineEval requires an async test(t) function.",
  "define.evalEvaluationKindRejected": "defineEval does not accept evaluationKind; it is always set to \"pass\" (pass eval kind). Use defineScoreEval for the score kind.",
  "define.evalConfigHashRejected": "defineEval does not accept configHash; configHash is computed during run planning.",
  "define.scoreEvalIdRejected": "defineScoreEval does not accept id; ids are derived from file paths.",
  "define.scoreEvalEnvironmentEmpty": "defineScoreEval environment must be a non-empty profile id when provided.",
  "define.scoreEvalTestRequired": "defineScoreEval requires an async test(t) function.",
  "define.scoreEvalEvaluationKindRejected": "defineScoreEval does not accept evaluationKind; it is always set to \"score\" (score eval kind). Use defineEval for the pass kind.",
  "define.scoreEvalConfigHashRejected": "defineScoreEval does not accept configHash; configHash is computed during run planning.",
  "define.experimentAgentRequired": "defineExperiment requires agent.",
  "define.experimentFlagNotJson": "experiment.flags.{{key}} is not JSON-serializable (functions / undefined / cycles / bigint are not allowed); flags are persisted verbatim into result runs and must be plain JSON.",
  "define.experimentLabelInvalid": "experiment.labels.{{key}} must be a string or a finite number; labels are report-side grouping coordinates persisted verbatim into result runs.",
  "define.experimentSharedStateInvalid": "experiment.sharedState must be exactly { key }, where key is a stable, non-secret string matching [a-z0-9][a-z0-9._/-]{0,127}.",
  "define.experimentSetupNotFunction": "experiment.setup must be a function ((ctx) => void); use experiment.teardown for cleanup; to prepare the in-sandbox environment per experiment, chain .setup() hooks on the sandbox spec instead.",
  "define.experimentTeardownNotFunction": "Experiment teardown must be a function ((ctx) => void); use a function-valued paired lifecycle hook so normal cleanup and explicit sharedState recovery can both execute it.",
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
  "feedback.human.diffHint": "Diff:    niceeval view {{locator}}",
  "feedback.human.evalHint": "Eval:    niceeval view {{locator}}",
  "feedback.human.exampleLocator": "e.g. {{locator}}",
  "feedback.human.failuresHeader": "FAILURES",
  "feedback.human.failuresSoFar": "{{count}} so far",
  "feedback.human.failuresTotalKinds": "{{total}} total · {{kinds}} kinds",
  "feedback.human.heartbeat": "{{elapsed}} elapsed · {{counts}}",
  "feedback.human.inspect": "Inspect: niceeval view {{locator}}",
  "feedback.human.keptSandboxesHeader": "KEPT SANDBOXES",
  "feedback.human.moreActive": "… {{count}} more active",
  "feedback.human.moreFailureKinds": "+{{count}} more kinds — niceeval view",
  "feedback.human.nextHeader": "NEXT",
  "feedback.human.plan": "{{total}} attempts · {{evals}} evals × {{configs}} configs · concurrency {{concurrency}}",
  "feedback.human.planHeader": "PLAN",
  "feedback.human.resultFailed": "FAILED",
  "feedback.human.resultIncomplete": "INCOMPLETE",
  "feedback.human.resultInterrupted": "INTERRUPTED",
  "feedback.human.resultPassed": "PASSED",
  "feedback.human.resultScored": "SCORED",
  "feedback.human.resultErrored": "ERRORED",
  "feedback.human.resultCompleted": "COMPLETED",
  "feedback.human.recoveryHeader": "RECOVERY",
  "feedback.human.unit.caseLock": "case lock",
  "feedback.human.unit.caseLocks": "case locks",
  "feedback.human.resultsHeader": "RESULTS",
  "feedback.human.errorsHeader": "ERRORS",
  "feedback.human.resultsMore": "… {{count}} more",
  "feedback.human.scoreSummaryLine": "{{scored}} scored · {{skipped}} skipped · {{errored}} errored  ({{reused}} reused)",
  "feedback.human.reuse": "{{reused}} of {{total}} carried in from cache · {{toRun}} to run",
  "feedback.human.summaryLine": "{{passed}} passed · {{failed}} failed · {{errored}} errored  ({{reused}} reused)",
  "feedback.human.summaryIncompleteLine":
    "{{passed}} passed · {{failed}} failed · {{errored}} errored · {{unstarted}} unstarted  ({{reused}} reused)",
  "feedback.human.summaryAllReusedLine": "{{passed}} passed · {{failed}} failed · {{errored}} errored  (all {{reused}} reused)",
  "feedback.human.suppressedFailures": "… {{count}} more failures suppressed",
  "feedback.human.trace": "Trace:   niceeval view {{locator}}",
  "feedback.human.warningsHeader": "WARNINGS",
  "feedback.phase.agentSetup": "agent setup",
  "feedback.phase.agentEnsure": "preparing agent",
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
  "feedback.human.setupPrefixLookup":
    "checking sandbox setup cache · {{provider}} · {{actionCount}} {{actionWord}} · {{attempts}} {{attemptWord}}",
  "feedback.human.setupPrefixMaterialize":
    "creating sandbox setup builder · {{provider}} · action {{actionIndex}}/{{actionCount}} · {{attempts}} {{attemptWord}}",
  "feedback.human.setupPrefixAction":
    "preparing sandbox setup · {{actionId}} · action {{actionIndex}}/{{actionCount}} · {{attempts}} {{attemptWord}}",
  "feedback.human.setupPrefixCapture":
    "publishing sandbox setup · {{actionId}} · action {{actionIndex}}/{{actionCount}} · {{attempts}} {{attemptWord}}",
  "feedback.human.setupPrefixProvider":
    "preparing sandbox setup · {{detail}} · action {{actionIndex}}/{{actionCount}} · {{attempts}} {{attemptWord}}",
  "feedback.human.setupPrefixHit":
    "sandbox setup cache hit · {{provider}} · {{actionCount}} {{actionWord}} · {{attempts}} {{attemptWord}}",
  "feedback.human.setupPrefixPrepared":
    "sandbox setup prepared · {{provider}} · {{actionCount}} {{actionWord}} · {{attempts}} {{attemptWord}}",
  "feedback.human.setupPrefixFailed":
    "sandbox setup failed · {{provider}} · {{actionCount}} {{actionWord}} · {{attempts}} {{attemptWord}}",
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
  "feedback.phase.assertions": "evaluating assertions",
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
  "hitl.respondAllEmpty": "There is no pending input.requested request; respond() / respondAll() cannot work. Confirm the turn has status waiting, then answer via t.requireInputRequest() or t.respond().",
  "hitl.respondEmpty": "t.respond(...) requires at least one answer.",
  "hitl.stringAmbiguous": "There are {{count}} pending input requests; a plain-string answer cannot be matched to one. Use the { request, optionId } or { request, text } object form to name it explicitly.",
  "judge.apiKeyMissing": "judge is missing an API key: set NICEEVAL_JUDGE_KEY, or point judge.apiKeyEnv at another environment variable.",
  "judge.httpError": "judge HTTP {{status}}: {{body}}",
  "judge.probeFailed": "judge precheck failed: {{endpoint}} ({{model}}): {{error}}",
  "judge.probeTimeout": "judge precheck failed: {{endpoint}} ({{model}}) timed out {{attempts}} times ({{seconds}}s each) — the endpoint accepts connections but never answers; first check whether other traffic on the same account is saturating the gateway's concurrency, then verify judge.baseUrl",
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
  "runner.directAgentSandboxUnavailable": "Direct Agents do not have sandbox.{{method}}; use a Sandbox Agent or remove workspace assertions.",
  "runner.reporterDiagnostic": "  · [diagnostic] {{stage}} failed (ignored): {{message}}\n",
  "runner.skip": "skip: {{reason}}",
  "runner.startAgentSetup": "agent setup (install CLI / write config)...",
  "runner.startAgentEnsure": "preparing agent...",
  "runner.startAgentTracing": "agent tracing (write OTEL export config)...",
  "runner.startSandbox": "starting sandbox...",
  "runner.startSandboxSetup": "sandbox setup (environment provisioning hooks)...",
  "runner.startSandboxTeardown": "sandbox teardown (environment provisioning hooks)...",
  "runner.timeout": "attempt timed out ({{timeoutMs}}ms, from {{source}})\nRecent progress:\n{{recentLogs}}",
  "runner.traceSelected": " -> kept {{count}} semantic spans",
  "runner.useDirectAgent": "using Direct Agent (no Sandbox created)...",
  "sandbox.deadlineExceedsSession":
    "error: this attempt's timeout ({{timeoutMs}}ms) is longer than what a single {{provider}} session lives ({{limitMs}}ms); the sandbox would be reclaimed mid-attempt.\n" +
    "  fix: lower timeoutMs below {{limitMs}}ms, or declare a longer lifetimeMs on the sandbox spec if your plan allows it.\n",
  "sandbox.providerNotImplemented": "{{provider}} sandbox provider is not implemented; use docker, vercel, or e2b",
  "sandbox.missingSpec":
    "sandbox agent needs a template-bearing SandboxLayer, but neither the Eval nor Experiment declared one — use dockerSandbox({ source: { type: \"image\", image } }), dockerSandbox({ source: { type: \"dockerfile\", context } }), dockerComposeSandbox({ file, workspaceService }), vercelSandbox({ snapshotId }), or e2bSandbox({ template }) from \"niceeval/sandbox\".\n" +
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
  "assertions.evaluationError": "assertion evaluation error: {{error}}",
  "assertions.scoreInvalid": "t.score({{label}}, {{n}}) is invalid; points must be a non-negative finite number (n >= 0).",
  "session.rerunOriginal": "rerun the original command",
  "session.nextRerunOriginal": "NEXT rerun the original command",
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
  "vercel.userUnsupported":
    'the Vercel Sandbox provider only supports { user: "root" } (mapped to sudo: true) at the command level, got { user: "{{user}}" }. Use a container provider (docker / e2b) for other identities.',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = globalThis.Record<MessageKey, string>;
