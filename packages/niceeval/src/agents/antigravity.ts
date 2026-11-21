import { CurrentAttemptCredentials } from "../context/attempt-sensitive-values.ts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { makeSendFailure, normalizeSendFailure } from "../context/send-failures.ts";
import { makeSandboxAgent } from "../define.ts";
import { unclassifiedToolActionsCoverage } from "../o11y/command-projection.ts";
import { knownSensitiveValues, redactSensitiveEvidence } from "../sandbox/redaction.ts";
import type {
  AgentInstallationManifest,
  EvidenceCoverage,
  Sandbox,
  SandboxAgent,
  SkillSpec,
  TurnEvidenceCoverage,
} from "../types.ts";
import { getEnv, requireEnv } from "../util.ts";
import { ANTIGRAVITY_VERSION_ENV, antigravityInstall } from "./antigravity-install.ts";
import { parseAntigravityPrint } from "./antigravity-print.ts";
import { DEFAULT_ANTIGRAVITY_CLI_VERSION } from "./coding-cli-versions.ts";
import { assertMcpServers, isHttpMcp, mcpManifestEntries } from "./mcp.ts";
import { resolveAgentBinEffect } from "./npm-staged.ts";
import { shared } from "./shared.ts";
import { excludeFromDiff, installSkills } from "./skills.ts";
import type { McpHttpServer, McpStdioServer } from "./types.ts";
import { UnrecognizedAgentEvents } from "./unrecognized-events.ts";

const MCP_PATH = ".agents/mcp_config.json";
const SKILL_DIR = ".agents/skills";
const EVIDENCE: EvidenceCoverage = {
  events: { status: "partial", reason: "Antigravity print does not expose all native steps or context events." },
  actions: { status: "partial", reason: "Antigravity print does not expose all native action lifecycles." },
  messages: { status: "partial", reason: "Antigravity print does not expose internal user messages." },
  usage: { status: "complete" },
  status: { status: "complete" },
  data: { status: "unavailable", reason: "Antigravity print is configured for text responses." },
};

/**
 * 配置 {@link antigravityAgent} 在 Sandbox 中使用的 CLI 版本、Gemini 鉴权和扩展。
 * 模型和推理档位由 Experiment 指定。
 */
export interface AntigravityConfig {
  /** Gemini API key，省略时读取 `GEMINI_API_KEY`。 */
  apiKey?: string | undefined;
  /** Gemini 兼容端点，省略时读取 `GOOGLE_GEMINI_BASE_URL`。 */
  baseUrl?: string | undefined;
  /** Antigravity CLI 的精确版本，默认为 `1.5.13`。 */
  version?: string | undefined;
  /** 安装到 `.agents/skills/<name>/` 的 Skills。 */
  skills?: readonly SkillSpec[] | undefined;
  /** 写入 `.agents/mcp_config.json` 的 stdio 或 Streamable HTTP 服务。stdio 可指定工作目录。 */
  mcpServers?: readonly (McpHttpServer | (McpStdioServer & { cwd?: string | undefined }))[] | undefined;
}

interface AttemptState {
  readonly home: string;
  readonly appData: string;
  readonly apiKey: string;
  readonly baseUrl: string | undefined;
  readonly unknownEvents: UnrecognizedAgentEvents;
  readonly sensitiveValues: readonly string[];
}

async function installMcp(sandbox: Sandbox, servers: NonNullable<AntigravityConfig["mcpServers"]>): Promise<void> {
  if (await sandbox.pathExists(MCP_PATH)) {
    throw new Error(`Antigravity MCP config already exists at ${MCP_PATH}. Declare MCP servers in one place.`);
  }
  const entries = servers.map((server) => [
    server.name,
    isHttpMcp(server)
      ? { serverUrl: server.url, headers: server.headers }
      : { command: server.command, args: server.args, env: server.env, cwd: server.cwd },
  ]);
  await sandbox.writeText(MCP_PATH, JSON.stringify({ mcpServers: Object.fromEntries(entries) }, null, 2));
  await excludeFromDiff(sandbox, [MCP_PATH]);
}

function turnCoverage(parsed: ReturnType<typeof parseAntigravityPrint>): TurnEvidenceCoverage {
  const hasUnrecognizedEvents = Object.keys(parsed.unrecognizedEvents).length !== 0;
  const traceGap = { status: "partial", reason: "Antigravity emitted unrecognized events or steps." } as const;
  const usage =
    parsed.usage === undefined
      ? ({ status: "unavailable", reason: "Antigravity did not report per-step model usage." } as const)
      : parsed.missingUsage
        ? ({ status: "partial", reason: "Some Antigravity model steps did not report all usage buckets." } as const)
        : undefined;
  return {
    ...(hasUnrecognizedEvents
      ? { events: traceGap, actions: traceGap }
      : parsed.missingToolLifecycle
        ? { actions: { status: "partial", reason: "Antigravity did not emit both states of a tool step." } }
        : unclassifiedToolActionsCoverage(parsed.events)),
    ...(usage === undefined ? {} : { usage }),
  };
}

/** 在 Sandbox 内用 Antigravity CLI 运行 Gemini 模型。 */
// @concord-code
// @concord-implements docs/feature/adapters/library/sdk/agy/README.md
export function antigravityAgent(config?: AntigravityConfig): SandboxAgent {
  const { install, installer } = antigravityInstall(config?.version ?? DEFAULT_ANTIGRAVITY_CLI_VERSION);
  const attempts = new Map<string, AttemptState>();
  return makeSandboxAgent({
    name: "agy",
    evidenceCoverage: EVIDENCE,
    install,
    installers: [installer],
    before: (sandbox, ctx) =>
      Effect.flatMap(CurrentAttemptCredentials, (remember) =>
        Effect.tryPromise({
          try: async (signal) => {
            const apiKey = config?.apiKey ?? requireEnv("GEMINI_API_KEY");
            if (!apiKey) throw new Error("Antigravity requires a non-empty Gemini API key.");
            const baseUrl = config?.baseUrl ?? getEnv("GOOGLE_GEMINI_BASE_URL");
            const servers = config?.mcpServers ?? [];
            assertMcpServers(servers);
            const sensitiveValues = knownSensitiveValues(
              apiKey,
              ...servers.flatMap((server) => Object.values((isHttpMcp(server) ? server.headers : server.env) ?? {})),
            );
            remember(...sensitiveValues);
            const created = await sandbox.runCommandOrThrow("mktemp", ["-d", "/tmp/niceeval-agy.XXXXXXXX"], { signal });
            const home = created.stdout.trim();
            const appData = `${home}/.gemini/antigravity-cli`;
            attempts.set(ctx.attempt?.id ?? sandbox.sandboxId, {
              home,
              appData,
              apiKey,
              baseUrl,
              unknownEvents: new UnrecognizedAgentEvents(),
              sensitiveValues,
            });
            await sandbox.writeText(`${appData}/settings.json`, JSON.stringify({ modelProvider: "gemini" }));
            const manifest: AgentInstallationManifest = { skills: [] };
            if (servers.length) {
              await installMcp(sandbox, servers);
              manifest.mcpServers = mcpManifestEntries(servers);
            }
            if (config?.skills?.length) {
              manifest.skills = await installSkills(sandbox, config.skills, { dir: SKILL_DIR });
            }
            if (manifest.skills.length || manifest.mcpServers?.length) ctx.reportInstallation(manifest);
          },
          catch: (cause) => cause,
        }),
      ),
    after: (sandbox, ctx) =>
      Effect.gen(function* () {
        const attemptId = ctx.attempt?.id ?? sandbox.sandboxId;
        const state = attempts.get(attemptId);
        if (state === undefined) return;
        attempts.delete(attemptId);
        state.unknownEvents.report((diagnostic) => ctx.diagnostic(diagnostic));
        yield* Effect.tryPromise({
          try: (signal) => sandbox.runCommandOrThrow("rm", ["-rf", "--", state.home], { signal }),
          catch: (cause) => cause,
        });
      }),
    send: (input, ctx) =>
      Effect.gen(function* () {
        if (input.files?.length || input.responses?.length) {
          return yield* Effect.fail(
            makeSendFailure({ acceptance: "rejected", message: "Antigravity print accepts text prompts only." }),
          );
        }
        const sandbox = ctx.sandbox;
        const state = attempts.get(ctx.attempt?.id ?? sandbox.sandboxId);
        if (state === undefined) {
          return yield* Effect.fail(
            makeSendFailure({ acceptance: "rejected", message: "Antigravity was not configured for this Attempt." }),
          );
        }
        const bin = yield* resolveAgentBinEffect(sandbox, "agy").pipe(Effect.mapError(normalizeSendFailure));
        const args = [
          "--print",
          input.text,
          "--output-format",
          "stream-json",
          "--dangerously-skip-permissions",
          "--disable-slash-commands",
        ];
        if (ctx.session.id !== undefined) args.push("--conversation", ctx.session.id);
        if (ctx.model !== undefined) args.push("--model", ctx.model);
        if (ctx.reasoningEffort !== undefined) args.push("--effort", ctx.reasoningEffort);
        const stdout: string[] = [];
        const stderr: string[] = [];
        const execution = yield* Effect.tryPromise({
          try: (signal) =>
            sandbox.runCommand(bin, args, {
              signal: AbortSignal.any([ctx.signal, signal]),
              env: {
                ...ANTIGRAVITY_VERSION_ENV,
                HOME: state.home,
                XDG_CONFIG_HOME: `${state.home}/.config`,
                XDG_DATA_HOME: `${state.home}/.local/share`,
                XDG_CACHE_HOME: `${state.home}/.cache`,
                ANTIGRAVITY_APP_DATA_DIR: state.appData,
                GEMINI_API_KEY: state.apiKey,
                ...(state.baseUrl === undefined ? {} : { GOOGLE_GEMINI_BASE_URL: state.baseUrl }),
              },
              sensitiveValues: state.sensitiveValues,
              onStdout: (chunk) => {
                stdout.push(chunk);
              },
              onStderr: (chunk) => {
                stderr.push(chunk);
              },
            }),
          catch: normalizeSendFailure,
        }).pipe(Effect.result);
        const parsed = parseAntigravityPrint(Result.isSuccess(execution) ? execution.success.stdout : stdout.join(""));
        if (parsed.sessionId !== undefined) ctx.session.capture(parsed.sessionId);
        state.unknownEvents.observe(redactSensitiveEvidence(parsed.unrecognizedEvents, state.sensitiveValues));
        const evidence = { events: parsed.events, usage: parsed.usage };
        const acceptance = parsed.accepted ? "started" : "unknown";
        if (Result.isFailure(execution)) {
          const failure = makeSendFailure({
            ...execution.failure,
            ...evidence,
            acceptance,
            process: { stdout: stdout.join(""), stderr: stderr.join(""), ...execution.failure.process },
          });
          return yield* Effect.fail(redactSensitiveEvidence(failure, state.sensitiveValues));
        }
        const result = execution.success;
        const failureMessage =
          result.exitCode !== 0
            ? shared.diagnoseFailure(result, parsed.events, result.stdout || undefined)
            : parsed.malformedLine !== undefined
              ? `Antigravity emitted an invalid NDJSON frame at line ${parsed.malformedLine}.`
              : parsed.terminal?.status === "SUCCESS"
                ? undefined
                : parsed.terminal === undefined
                  ? "Antigravity exited without a terminal result."
                  : `Antigravity reported terminal status ${parsed.terminal.status}.`;
        if (failureMessage !== undefined) {
          return yield* Effect.fail(
            redactSensitiveEvidence(
              makeSendFailure({ ...evidence, acceptance, message: failureMessage, process: result }),
              state.sensitiveValues,
            ),
          );
        }
        return {
          ...evidence,
          events: redactSensitiveEvidence(evidence.events, state.sensitiveValues),
          status: "completed",
          evidenceCoverage: turnCoverage(parsed),
        };
      }),
  });
}

export default antigravityAgent();
