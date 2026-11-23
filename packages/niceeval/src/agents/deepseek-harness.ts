import { knownSensitiveValues, redactSensitiveEvidence, redactSensitiveText } from "../sandbox/redaction.ts";
import { Effect } from "effect";
import { makeSandboxAgent } from "../define.ts";
import { getEnv, requireEnv } from "../util.ts";
import type { Agent, EvidenceCoverage, TurnEvidenceCoverage } from "../types.ts";
import { makeSendFailure, normalizeSendFailure } from "../context/send-failures.ts";
import { shared } from "./shared.ts";
import { createNpmCliInstaller, resolveAgentBinEffect } from "./npm-staged.ts";
import { shell } from "../sandbox/commands.ts";
import { shellQuote } from "../sandbox/shell.ts";
import type { AgentInstall, AgentInstaller } from "./types.ts";
import { exactNpmPluginRevision, normalizeExactNpmPlugins, type ExactNpmPlugin } from "./exact-npm-plugins.ts";
import { AGENT_BASELINE_RECIPE_REVISION, DEFAULT_DEEPSEEK_HARNESS_CLI_VERSION } from "./coding-cli-versions.ts";
import { parseDeepSeekHarnessRun } from "./deepseek-harness-transcript.ts";

const DSH_EVIDENCE_COVERAGE: EvidenceCoverage = {
  events: { status: "partial", reason: "DSH headless JSON projects selected events from the main Session." },
  actions: { status: "partial", reason: "DSH headless JSON projects tool lifecycles from the main Session." },
  messages: { status: "complete" },
  usage: { status: "partial", reason: "DSH headless JSON reports model step usage from the main Session." },
  status: { status: "complete" },
  data: { status: "unavailable", reason: "DSH headless mode does not expose a separate Turn.data value." },
};

export interface DeepSeekHarnessConfig {
  /** DeepSeek-compatible API key. Defaults to DSH_API_KEY, then DEEPSEEK_API_KEY. */
  apiKey?: string | undefined;
  /** DeepSeek-compatible endpoint. Defaults to DSH_BASE_URL, then DEEPSEEK_BASE_URL. */
  baseUrl?: string | undefined;
  /** Exact npm version of `@deepseek-ai/dsh`. */
  version?: string | undefined;
  /** Native DSH bundles as exact npm package@version declarations. */
  plugins?: readonly string[] | undefined;
}

const DSH_PNPM_VERSION = "10.17.1";
const DSH_RUN_PATCH = "niceeval.patch.yml";

function dshPluginLayer(
  cliVersion: string,
  plugins: readonly ExactNpmPlugin[],
): { install: AgentInstall; installer: AgentInstaller } {
  const identity = {
    agent: "deepseek-harness-plugins",
    version: cliVersion,
    revision: exactNpmPluginRevision(plugins),
  };
  // DSH derives the initial bundle order from pnpm's sorted dependency keys.
  const checkProfile = `node -e ${shellQuote(`
const fs = require("node:fs");
const path = require("node:path");
const expected = ${JSON.stringify(plugins)};
const root = path.join(process.env.DSH_HOME, "profiles", "headless");
const manifest = path.join(root, "package.json");
const profile = JSON.parse(fs.readFileSync(manifest, "utf8"));
const deps = profile.dependencies ?? {};
const builtin = new Set(["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]);
const bundles = profile.dsh?.profile?.bundles ?? [];
const external = bundles.filter((name) => !builtin.has(name));
if (Object.keys(deps).length !== expected.length || external.length !== expected.length) process.exit(1);
for (const { name, version } of expected) {
  if (deps[name] !== version || !external.includes(name)) process.exit(1);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8"));
  if (pkg.name !== name || pkg.version !== version || !pkg.dsh?.bundle) process.exit(1);
}
const ordered = expected.map(({ name }) => name);
if (external.some((name, index) => name !== ordered[index])) {
  if (process.argv[1] !== "order") process.exit(1);
  let index = 0;
  profile.dsh.profile.bundles = bundles.map((name) => builtin.has(name) ? name : ordered[index++]);
  const pending = manifest + ".niceeval";
  fs.writeFileSync(pending, JSON.stringify(profile, null, 2) + "\\n");
  fs.renameSync(pending, manifest);
}
`)}`;
  const probeScript = `DSH_HOME="$HOME/.niceeval-dsh" ${checkProfile}`;
  return {
    install: { identity, probe: shell(probeScript) },
    installer: {
      identity,
      installMode: "sandbox-network",
      install: async (sandbox, context) => {
        const specs = plugins.map((plugin) => shellQuote(plugin.spec)).join(" ");
        const script = `set -eu
export DSH_HOME="$HOME/.niceeval-dsh"
rm -rf "$DSH_HOME/profiles/headless"
wrapper_dir="$HOME/.niceeval-dsh/.niceeval-bin"
mkdir -p "$wrapper_dir"
printf '%s\n' '#!/bin/sh' 'exec corepack pnpm@${DSH_PNPM_VERSION} "$@"' > "$wrapper_dir/pnpm"
chmod +x "$wrapper_dir/pnpm"
PATH="$wrapper_dir:$PATH" dsh plugin --profile headless add ${specs} &&
  ${checkProfile} order &&
  dsh --profile headless --dump-config-schema >/dev/null &&
  ${checkProfile} || {
  status=$?
  rm -rf "$DSH_HOME/profiles/headless"
  exit "$status"
}`;
        await sandbox.runShellOrThrow(script, { signal: context.signal });
      },
    },
  };
}

function resolveApiKey(config?: DeepSeekHarnessConfig): string {
  return config?.apiKey ?? getEnv("DSH_API_KEY") ?? requireEnv("DEEPSEEK_API_KEY");
}

function resolveBaseUrl(config?: DeepSeekHarnessConfig): string | undefined {
  return config?.baseUrl ?? getEnv("DSH_BASE_URL") ?? getEnv("DEEPSEEK_BASE_URL");
}

function pluginActivationWarnings(stderr: string, plugins: readonly ExactNpmPlugin[]): string[] {
  const warnings: string[] = [];
  let remaining = 0;
  for (const line of stderr.split(/\r?\n/u)) {
    if (line.startsWith("dsh: ")) {
      const summary = /^dsh: warning: (\d+) entr(?:y|ies) did not activate$/u.exec(line);
      remaining = Number(summary?.[1] ?? 0);
      if (
        line.startsWith("dsh: disabling profile plugin ") ||
        plugins.some(({ name }) => line.startsWith(`dsh: skipping profile bundle "${name}": `))
      ) {
        warnings.push(line);
      }
    } else if (remaining > 0 && /^\S.* \([^)]+\): /u.test(line)) {
      // A bundle can supply entries whose module names differ from the declared bundle package.
      warnings.push(line);
      remaining--;
    }
  }
  return warnings;
}

/** DeepSeek Harness sandbox adapter backed by its one-shot headless profile. */
// @concord-code
// @concord-implements docs/feature/adapters/README.md
// @concord-implements docs/feature/adapters/library/sdk/deepseek-harness/README.md
export function deepSeekHarnessAgent(config?: DeepSeekHarnessConfig): Agent {
  const version = config?.version ?? DEFAULT_DEEPSEEK_HARNESS_CLI_VERSION;
  const plugins = normalizeExactNpmPlugins(config?.plugins, "deepSeekHarnessAgent plugins");
  const install = createNpmCliInstaller({
    identity: {
      agent: "deepseek-harness",
      version,
      revision: String(AGENT_BASELINE_RECIPE_REVISION["deepseek-harness"]),
    },
    packageName: "@deepseek-ai/dsh",
    bin: "dsh",
  });
  const homes = new Map<string, string>();

  const pluginLayer = plugins.length === 0 ? undefined : dshPluginLayer(version, plugins);
  return makeSandboxAgent({
    name: "deepseek-harness",
    evidenceCoverage: DSH_EVIDENCE_COVERAGE,
    install: pluginLayer === undefined ? install.install : [install.install, pluginLayer.install],
    installers: pluginLayer === undefined ? [install.installer] : [install.installer, pluginLayer.installer],

    before: (sb, ctx) =>
      Effect.tryPromise({
        try: async () => {
          const homeResult = await sb.runShell('test -n "$HOME" && printf "%s" "$HOME"');
          const home = homeResult.stdout.trim();
          if (homeResult.exitCode !== 0 || !home.startsWith("/")) {
            throw new Error("DeepSeek Harness setup requires an absolute sandbox HOME directory");
          }
          const dshHome = `${home}/.niceeval-dsh`;
          const patch = [
            {
              id: "agent-default-model",
              config: {
                provider: "deepseek-official",
                model: ctx.model ?? "deepseek-v4-flash",
              },
            },
          ];
          await sb.writeText(`${dshHome}/${DSH_RUN_PATCH}`, JSON.stringify(patch, null, 2));
          homes.set(sb.sandboxId, dshHome);
        },
        catch: (cause) => cause,
      }),

    send: (input, ctx) =>
      Effect.gen(function* () {
        const dshBin = yield* resolveAgentBinEffect(ctx.sandbox, "dsh").pipe(Effect.mapError(normalizeSendFailure));
        const apiKey = yield* Effect.try({ try: () => resolveApiKey(config), catch: normalizeSendFailure });
        const dshHome = homes.get(ctx.sandbox.sandboxId);
        if (!dshHome) {
          return yield* Effect.fail(normalizeSendFailure(new Error("DeepSeek Harness setup state is unavailable")));
        }
        const env: globalThis.Record<string, string> = {
          ...ctx.telemetry?.env,
          DEEPSEEK_API_KEY: apiKey,
          DSH_HOME: dshHome,
          DSH_PERMISSION_MODE: "danger-full-access",
        };
        const baseUrl = resolveBaseUrl(config);
        if (baseUrl) env.DEEPSEEK_BASE_URL = baseUrl;
        const sensitiveValues = knownSensitiveValues(apiKey, baseUrl);
        const args = ["--profile", "headless", "--patch", `${dshHome}/${DSH_RUN_PATCH}`, "--json", "--", input.text];
        const res = yield* Effect.tryPromise({
          try: (signal) =>
            ctx.sandbox.runCommand(dshBin, args, {
              env,
              sensitiveValues,
              stream: true,
              signal,
            }),
          catch: normalizeSendFailure,
        });
        if (pluginLayer !== undefined) {
          for (const warning of pluginActivationWarnings(res.stderr, plugins)) {
            ctx.diagnostic({
              code: "dsh-plugin-activation-failed",
              level: "warning",
              message: redactSensitiveText(warning, sensitiveValues),
            });
          }
        }
        const run = parseDeepSeekHarnessRun(res.stdout, res.exitCode);
        if (run.status === undefined) {
          return yield* Effect.fail(
            redactSensitiveEvidence(
              makeSendFailure({
                acceptance: run.accepted ? "started" : "unknown",
                message:
                  res.exitCode === 0
                    ? "DeepSeek Harness exited without a valid completed result and final assistant message."
                    : shared.diagnoseFailure(res, run.events, res.stdout || undefined),
                events: run.events,
                usage: run.usage,
                process: res,
              }),
              sensitiveValues,
            ),
          );
        }
        const evidenceCoverage: TurnEvidenceCoverage = {
          ...(run.protocolGap
            ? { messages: { status: "partial", reason: "DSH headless JSON contained truncated or incomplete frames." } }
            : {}),
          ...(run.usage === undefined
            ? { usage: { status: "unavailable", reason: "DSH headless JSON contained no measured model steps." } }
            : run.usageGap
              ? { usage: { status: "partial", reason: "DSH headless JSON omitted usage for some main Session steps." } }
              : {}),
        };
        if (run.sessionId !== undefined) ctx.session.capture(redactSensitiveText(run.sessionId, sensitiveValues));
        return {
          events: redactSensitiveEvidence(run.events, sensitiveValues),
          status: run.status,
          usage: run.usage,
          evidenceCoverage,
        };
      }),
    after: () => Effect.void,
  });
}

export default deepSeekHarnessAgent;
