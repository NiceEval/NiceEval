import { Effect } from "effect";
import { defineSandboxAgent } from "../define.ts";
import { getEnv, requireEnv } from "../util.ts";
import type { Agent, EvidenceCoverage, StreamEvent } from "../types.ts";
import { makeSendFailure } from "../context/send-failures.ts";
import { shared } from "./shared.ts";
import { createNpmCliInstaller, resolveAgentBinEffect } from "./npm-staged.ts";
import { shell } from "../sandbox/commands.ts";
import { shellQuote } from "../sandbox/shell.ts";
import type { AgentEnsure, AgentInstaller } from "./types.ts";
import {
  exactNpmPluginRevision,
  normalizeExactNpmPlugins,
  type ExactNpmPlugin,
} from "./exact-npm-plugins.ts";
import {
  AGENT_BASELINE_RECIPE_REVISION,
  DEFAULT_DEEPSEEK_HARNESS_CLI_VERSION,
} from "./coding-cli-versions.ts";

const DSH_EVIDENCE_COVERAGE: EvidenceCoverage = {
  events: { status: "unavailable", reason: "DSH headless mode exposes only the final assistant text." },
  actions: { status: "unavailable", reason: "DSH headless mode does not expose tool lifecycle events." },
  messages: { status: "complete" },
  usage: { status: "unavailable", reason: "DSH headless mode does not expose token usage." },
  status: { status: "complete" },
  data: { status: "unavailable", reason: "DSH headless mode does not expose a separate Turn.data value." },
};

export interface DeepSeekHarnessConfig {
  /** DeepSeek-compatible API key. Defaults to DSH_API_KEY, then DEEPSEEK_API_KEY. */
  apiKey?: string;
  /** DeepSeek-compatible endpoint. Defaults to DSH_BASE_URL, then DEEPSEEK_BASE_URL. */
  baseUrl?: string;
  /** Exact npm version of `@deepseek-ai/dsh`. */
  version?: string;
  /** Native DSH bundles as exact npm package@version declarations. */
  plugins?: readonly string[];
}

const DSH_PNPM_VERSION = "10.17.1";

function dshPluginLayer(
  cliVersion: string,
  plugins: readonly ExactNpmPlugin[],
): { ensure: AgentEnsure; installer: AgentInstaller } {
  const identity = {
    agent: "deepseek-harness-plugins",
    version: cliVersion,
    revision: exactNpmPluginRevision(plugins),
  };
  const expected = JSON.stringify(plugins);
  const verify = `const fs=require("node:fs"),path=require("node:path");` +
    `const expected=${expected},root=process.env.DSH_HOME+"/profiles/headless";` +
    `const profile=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));` +
    `const deps=profile.dependencies||{},names=Object.keys(deps);` +
    `if(JSON.stringify(names)!==JSON.stringify(expected.map(x=>x.name)))process.exit(1);` +
    `const bundles=profile.dsh?.profile?.bundles||[];` +
    `const external=bundles.filter(x=>x!=="@deepseek-ai/dsh-base"&&x!=="@deepseek-ai/dsh-headless");` +
    `if(JSON.stringify(external)!==JSON.stringify(expected.map(x=>x.name)))process.exit(1);` +
    `for(const x of expected){if(deps[x.name]!==x.version)process.exit(1);` +
    `const p=JSON.parse(fs.readFileSync(path.join(root,"node_modules",x.name,"package.json"),"utf8"));` +
    `if(p.name!==x.name||p.version!==x.version||!p.dsh?.bundle)process.exit(1);}`;
  const probeScript = `DSH_HOME="$HOME/.niceeval-dsh" node -e ${shellQuote(verify)}`;
  return {
    ensure: { identity, probe: shell(probeScript) },
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
PATH="$wrapper_dir:$PATH" dsh plugin --profile headless add ${specs}
DSH_HOME="$DSH_HOME" dsh --profile headless --dump-config >/dev/null`;
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

/** DeepSeek Harness sandbox adapter backed by its one-shot headless profile. */
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
  return defineSandboxAgent({
    name: "deepseek-harness",
    evidenceCoverage: DSH_EVIDENCE_COVERAGE,
    ensure: pluginLayer === undefined ? install.ensure : [install.ensure, pluginLayer.ensure],
    installers: pluginLayer === undefined
      ? [install.installer]
      : [install.installer, pluginLayer.installer],

    setup: (sb, ctx) => Effect.tryPromise({
      try: async () => {
      const homeResult = await sb.runShell('test -n "$HOME" && printf "%s" "$HOME"');
      const home = homeResult.stdout.trim();
      if (homeResult.exitCode !== 0 || !home.startsWith("/")) {
        throw new Error("DeepSeek Harness setup requires an absolute sandbox HOME directory");
      }
      const dshHome = `${home}/.niceeval-dsh`;
      homes.set(sb.sandboxId, dshHome);
      const settings = {
        "agent-default-model": {
          provider: "deepseek-official",
          model: ctx.model ?? "deepseek-v4-flash",
        },
        permission: {
          defaultPreset: "danger-full-access",
        },
      };
      await shared.writeFile(sb, `${dshHome}/settings.yaml`, JSON.stringify(settings, null, 2));

      },
      catch: (cause) => cause,
    }),

    send: (input, ctx) => Effect.gen(function* () {
      const dshBin = yield* resolveAgentBinEffect(ctx.sandbox, "dsh");
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const apiKey = resolveApiKey(config);
          const dshHome = homes.get(ctx.sandbox.sandboxId);
          if (!dshHome) throw new Error("DeepSeek Harness setup state is unavailable");
          const env: globalThis.Record<string, string> = {
            DEEPSEEK_API_KEY: apiKey,
            DSH_HOME: dshHome,
            ...ctx.telemetry?.env,
          };
          const baseUrl = resolveBaseUrl(config);
          if (baseUrl) env.DEEPSEEK_BASE_URL = baseUrl;
          const res = await ctx.sandbox.runCommand(dshBin, ["--profile", "headless", input.text], {
            env,
            sensitiveValues: [apiKey],
            stream: true,
            signal,
          });
          const text = res.stdout.trim();
          if (res.exitCode !== 0 || !text) {
            throw makeSendFailure({
              acceptance: "unknown",
              message: res.exitCode !== 0
                ? shared.diagnoseFailure(res, [], undefined)
                : "DeepSeek Harness exited successfully without a final assistant message.",
              process: res,
            });
          }
          const events: StreamEvent[] = [{ type: "message", role: "assistant", text }];
          return { events, status: "completed" as const };
        },
        catch: (cause) => cause,
      });
    }),
  });
}

export default deepSeekHarnessAgent;
