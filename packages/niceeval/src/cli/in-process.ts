/** Repository test entry for the Node CLI. Importing it does not start the CLI. */
import { Cause, Effect, Exit, Layer } from "effect";
import { resolve } from "node:path";
import { ExperimentCliTerminal } from "../experiment/host/cli/terminal.ts";
import {
  NodeProjectFileSystemLive,
  NodeProjectManifestFactsLive,
  nodeProjectProcessFactsLayer,
} from "../project/node.ts";
import { createNodeInputGuardStdin } from "../runner/feedback/input-guard.ts";
import { createNodeFeedbackIO } from "../runner/feedback/io.ts";
import { CliInterruption } from "./application.ts";
import { nodeCliInvocationLayer, type NodeCliInvocation } from "./node-application.ts";
import { cliApplication } from "./node-program.ts";
import { renderCliFailure } from "./program.ts";
import { projectCredentialsLayer } from "./project-configuration.ts";

export async function runCliInProcess(options: NodeCliInvocation): Promise<number> {
  const cwd = resolve(options.cwd);
  const env = { ...options.env };
  const abort = new AbortController();
  const application = cliApplication({
    project: Layer.mergeAll(
      NodeProjectFileSystemLive,
      NodeProjectManifestFactsLive,
      nodeProjectProcessFactsLayer(() => cwd, env),
    ),
    invocation: nodeCliInvocationLayer({ ...options, cwd, env }),
    terminal: Layer.succeed(ExperimentCliTerminal, {
      feedback: createNodeFeedbackIO(options.stdout, options.stderr, env),
      stdin: createNodeInputGuardStdin(options.stdin),
    }),
    interruption: Layer.succeed(CliInterruption, {
      invocationSignal: abort.signal,
      enterGracefulDispatch: () => true,
      requestInterrupt: () => abort.abort(),
    }),
    credentials: projectCredentialsLayer(env),
  }).pipe(
    Effect.catch((failure) =>
      Effect.sync(() => {
        options.stderr.write(renderCliFailure(failure));
        return failure.exitCode;
      }),
    ),
  );
  const exit = await Effect.runPromiseExit(application);
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) return 130;
  throw Cause.squash(exit.cause);
}
