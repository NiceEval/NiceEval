import { Effect } from "effect";
import { defineSandboxAgent } from "../define.ts";
import { getEnv, requireEnv } from "../util.ts";
import type { Agent, EvidenceCoverage, StreamEvent } from "../types.ts";
import { makeSendFailure } from "../context/send-failures.ts";
import { shared } from "./shared.ts";
import { createNpmCliInstaller, resolveAgentBinEffect } from "./npm-staged.ts";
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

  return defineSandboxAgent({
    name: "deepseek-harness",
    evidenceCoverage: DSH_EVIDENCE_COVERAGE,
    ensure: install.ensure,
    installers: [install.installer],

    async setup(sb, ctx) {
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

    send: (input, ctx) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
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
    })), { signal: ctx.signal }),
  });
}

export default deepSeekHarnessAgent;
