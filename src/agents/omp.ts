import { Effect } from "effect";
import { defineSandboxAgent } from "../define.ts";
import { getEnv, requireEnv } from "../util.ts";
import type { Agent, EvidenceCoverage, StreamEvent } from "../types.ts";
import { makeSendFailure, sendAcceptanceFromEvents } from "../context/send-failures.ts";
import { shared } from "./shared.ts";
import { createPiAgentEventStream, type PiAgentEventLike } from "./sdk-streams.ts";
import { normalizeToolName } from "../o11y/tool-names.ts";
import { notCommandProjection, opaqueCommandProjection } from "../o11y/command-projection.ts";
import { createNpmCliInstaller, resolveAgentBinEffect } from "./npm-staged.ts";
import {
  AGENT_BASELINE_RECIPE_REVISION,
  DEFAULT_BUN_VERSION,
  DEFAULT_OMP_CLI_VERSION,
} from "./coding-cli-versions.ts";
import type { AgentArtifactPlatform } from "./types.ts";

const COMPAT_PROVIDER = "niceeval-compat";
const API_KEY_ENV = "NICEEVAL_OMP_API_KEY";

const OMP_EVIDENCE_COVERAGE: EvidenceCoverage = {
  events: { status: "complete" },
  actions: { status: "complete" },
  messages: { status: "complete" },
  usage: { status: "complete" },
  status: { status: "complete" },
  data: { status: "unavailable", reason: "OMP print mode does not expose a separate Turn.data value." },
};

export interface OmpConfig {
  /** OpenAI-compatible API key. Defaults to OMP_API_KEY, then OPENAI_API_KEY. */
  apiKey?: string;
  /** OpenAI-compatible endpoint. Defaults to OMP_BASE_URL, then OPENAI_BASE_URL. */
  baseUrl?: string;
  /** Exact npm version of `@oh-my-pi/pi-coding-agent`. */
  version?: string;
  /** Exact Bun runtime version used by the fallback installer. */
  bunVersion?: string;
}

function resolveApiKey(config?: OmpConfig): string {
  return config?.apiKey ?? getEnv("OMP_API_KEY") ?? requireEnv("OPENAI_API_KEY");
}

function resolveBaseUrl(config?: OmpConfig): string | undefined {
  return config?.baseUrl ?? getEnv("OMP_BASE_URL") ?? getEnv("OPENAI_BASE_URL");
}

function bunPlatformPackage(
  version: string,
  platform: AgentArtifactPlatform,
): { spec: string; binPath: string } | undefined {
  if (platform.os === "linux") {
    const arch = platform.arch === "arm64" ? "aarch64" : platform.arch;
    if (arch !== "x64" && arch !== "aarch64") return undefined;
    const musl = platform.libc === "musl" ? "-musl" : "";
    return { spec: `@oven/bun-linux-${arch}${musl}@${version}`, binPath: "bin/bun" };
  }
  if (platform.os === "darwin") {
    const arch = platform.arch === "arm64" ? "aarch64" : platform.arch;
    if (arch !== "x64" && arch !== "aarch64") return undefined;
    return { spec: `@oven/bun-darwin-${arch}@${version}`, binPath: "bin/bun" };
  }
  return undefined;
}

function parseJsonl(raw: string): PiAgentEventLike[] {
  return raw.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (cause) {
      throw new Error(`OMP emitted invalid JSONL at line ${index + 1}`, { cause });
    }
    if (typeof value !== "object" || value === null || typeof (value as { type?: unknown }).type !== "string") {
      throw new Error(`OMP emitted an invalid event at line ${index + 1}`);
    }
    return value as PiAgentEventLike;
  });
}

function enrichOmpEvent(event: StreamEvent): StreamEvent {
  if (event.type !== "operation.started" || event.operation.kind !== "tool") return event;
  const tool = normalizeToolName(event.operation.name);
  return {
    ...event,
    operation: {
      ...event.operation,
      tool,
      command: tool === "shell"
        ? opaqueCommandProjection("unsupported-protocol")
        : notCommandProjection(),
    },
  };
}

/** Oh My Pi sandbox adapter backed by `omp --print --mode json`. */
export function ompAgent(config?: OmpConfig): Agent {
  const version = config?.version ?? DEFAULT_OMP_CLI_VERSION;
  const bunVersion = config?.bunVersion ?? DEFAULT_BUN_VERSION;
  const ompInstall = createNpmCliInstaller({
    identity: { agent: "omp", version, revision: String(AGENT_BASELINE_RECIPE_REVISION.omp) },
    packageName: "@oh-my-pi/pi-coding-agent",
    bin: "omp",
  });
  const bunInstall = createNpmCliInstaller({
    identity: { agent: "bun", version: bunVersion, revision: "1" },
    packageName: "bun",
    bin: "bun",
    platformPackage: (platform) => bunPlatformPackage(bunVersion, platform),
  });
  const configDirs = new Map<string, string>();

  return defineSandboxAgent({
    name: "omp",
    evidenceCoverage: OMP_EVIDENCE_COVERAGE,
    ensure: [bunInstall.ensure, ompInstall.ensure],
    installers: [bunInstall.installer, ompInstall.installer],

    async setup(sb, ctx) {
      const homeResult = await sb.runShell('test -n "$HOME" && printf "%s" "$HOME"');
      const home = homeResult.stdout.trim();
      if (homeResult.exitCode !== 0 || !home.startsWith("/")) {
        throw new Error("OMP setup requires an absolute sandbox HOME directory");
      }
      const dir = `${home}/.niceeval-omp`;
      configDirs.set(sb.sandboxId, dir);
      const baseUrl = resolveBaseUrl(config);
      const model = ctx.model ?? "deepseek-v4-flash";
      const models = {
        providers: {
          [COMPAT_PROVIDER]: {
            ...(baseUrl ? { baseUrl } : {}),
            api: "openai-completions",
            apiKey: API_KEY_ENV,
            models: [{ id: model, name: model, contextWindow: 1_000_000, maxTokens: 64_000 }],
          },
        },
      };
      await shared.writeFile(sb, `${dir}/models.yml`, JSON.stringify(models, null, 2));
    },

    send: (input, ctx) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const ompBin = yield* resolveAgentBinEffect(ctx.sandbox, "omp");
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const apiKey = resolveApiKey(config);
          const dir = configDirs.get(ctx.sandbox.sandboxId);
          if (!dir) throw new Error("OMP setup state is unavailable");
          const model = ctx.model ?? "deepseek-v4-flash";
          const env: globalThis.Record<string, string> = {
            [API_KEY_ENV]: apiKey,
            PI_CODING_AGENT_DIR: dir,
            ...ctx.telemetry?.env,
          };
          const args = [
            "--print",
            "--mode", "json",
            "--model", `${COMPAT_PROVIDER}/${model}`,
            "--approval-mode", "yolo",
            "--no-pty",
            "--no-title",
            input.text,
          ];
          const res = await ctx.sandbox.runCommand(ompBin, args, {
            env,
            sensitiveValues: [apiKey],
            stream: true,
            signal,
          });

          let nativeEvents: PiAgentEventLike[];
          try {
            nativeEvents = parseJsonl(res.stdout);
          } catch (cause) {
            throw makeSendFailure({
              acceptance: "unknown",
              message: cause instanceof Error ? cause.message : "OMP transcript could not be parsed",
              process: res,
            });
          }
          const stream = createPiAgentEventStream();
          const events: StreamEvent[] = nativeEvents.flatMap((event) => stream.add(event)).map(enrichOmpEvent);
          const terminal = nativeEvents.filter((event) =>
            event.type === "agent_end" &&
            (event as { isTerminal?: unknown }).isTerminal !== false &&
            Array.isArray((event as { messages?: unknown }).messages)
          );
          if (res.exitCode !== 0 || terminal.length !== 1) {
            throw makeSendFailure({
              acceptance: sendAcceptanceFromEvents(events),
              message: res.exitCode !== 0
                ? shared.diagnoseFailure(res, events, res.stdout)
                : `OMP produced ${terminal.length} valid terminal agent_end events; expected exactly one.`,
              events,
              usage: stream.usage,
              process: res,
            });
          }
          return {
            events,
            usage: stream.usage,
            status: stream.failed ? "failed" as const : "completed" as const,
          };
        },
        catch: (cause) => cause,
      });
    })), { signal: ctx.signal }),
  });
}

export default ompAgent;
