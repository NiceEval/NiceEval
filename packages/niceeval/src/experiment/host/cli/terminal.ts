import { Context, Layer } from "effect";

import type { FeedbackIO } from "../../../runner/feedback/io.ts";
import { createNodeFeedbackIO } from "../../../runner/feedback/io.ts";
import type { InputGuardStdin } from "../../../runner/feedback/input-guard.ts";
import { createNodeInputGuardStdin } from "../../../runner/feedback/input-guard.ts";

/** Terminal resources used exclusively by the Experiment feedback surface. */
export interface ExperimentCliTerminalService {
  readonly feedback: FeedbackIO;
  readonly stdin: InputGuardStdin;
}

export class ExperimentCliTerminal extends Context.Service<ExperimentCliTerminal, ExperimentCliTerminalService>()(
  "niceeval/experiment/cli/Terminal",
) {}

/** Node composition layer; constructing it does not read input or start timers. */
export const NodeExperimentCliTerminalLive = Layer.sync(
  ExperimentCliTerminal,
  () => Object.freeze({
    feedback: createNodeFeedbackIO(),
    stdin: createNodeInputGuardStdin(),
  }),
);
