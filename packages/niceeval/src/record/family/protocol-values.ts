/** Canonical finite protocol vocabularies shared by current receipt owners and projections. */
export const AGENT_TURN_OUTCOME = Object.freeze({
  completed: "completed" as const,
  failed: "failed" as const,
  cancelled: "cancelled" as const,
  interrupted: "interrupted" as const,
});
export const AGENT_TURN_OUTCOMES = [
  AGENT_TURN_OUTCOME.completed,
  AGENT_TURN_OUTCOME.failed,
  AGENT_TURN_OUTCOME.cancelled,
  AGENT_TURN_OUTCOME.interrupted,
] as const;
export type AgentTurnOutcome = (typeof AGENT_TURN_OUTCOMES)[number];

export const RUNNER_PHASE = Object.freeze({
  attemptSetup: "attempt.setup" as const,
  sandboxPrepare: "sandbox.prepare" as const,
  agentEnsure: "agent.ensure" as const,
  evalRun: "eval.run" as const,
  agentSend: "agent.send" as const,
  sandboxCommand: "sandbox.command" as const,
  assertionEvaluate: "assertion.evaluate" as const,
  verdictFold: "verdict.fold" as const,
  attemptTeardown: "attempt.teardown" as const,
  runSetup: "run.setup" as const,
  runDiscovery: "run.discovery" as const,
  runPlan: "run.plan" as const,
  runDispatch: "run.dispatch" as const,
  runTeardown: "run.teardown" as const,
  collection: "collection" as const,
});
export const ATTEMPT_ACTIVITY_PHASES = [
  RUNNER_PHASE.attemptSetup, RUNNER_PHASE.sandboxPrepare, RUNNER_PHASE.agentEnsure,
  RUNNER_PHASE.evalRun, RUNNER_PHASE.agentSend, RUNNER_PHASE.sandboxCommand,
  RUNNER_PHASE.assertionEvaluate, RUNNER_PHASE.verdictFold, RUNNER_PHASE.attemptTeardown,
] as const;
export const ATTEMPT_NON_AGENT_ACTIVITY_PHASES = [
  RUNNER_PHASE.attemptSetup, RUNNER_PHASE.sandboxPrepare, RUNNER_PHASE.agentEnsure,
  RUNNER_PHASE.evalRun, RUNNER_PHASE.sandboxCommand, RUNNER_PHASE.assertionEvaluate,
  RUNNER_PHASE.verdictFold, RUNNER_PHASE.attemptTeardown,
] as const;
export const RUN_ACTIVITY_PHASES = [
  RUNNER_PHASE.runSetup, RUNNER_PHASE.runDiscovery, RUNNER_PHASE.runPlan,
  RUNNER_PHASE.runDispatch, RUNNER_PHASE.runTeardown,
] as const;
export const DIAGNOSTIC_PROJECTION_PHASES = [RUNNER_PHASE.collection] as const;
export const ATTEMPT_DIAGNOSTIC_PHASES = [
  ...ATTEMPT_ACTIVITY_PHASES,
  ...DIAGNOSTIC_PROJECTION_PHASES,
] as const;
export const RUN_DIAGNOSTIC_PHASES = [
  ...RUN_ACTIVITY_PHASES,
  ...DIAGNOSTIC_PROJECTION_PHASES,
] as const;
export const SANDBOX_COMMAND_PHASES = [
  RUNNER_PHASE.attemptSetup, RUNNER_PHASE.sandboxPrepare, RUNNER_PHASE.agentEnsure,
  RUNNER_PHASE.evalRun, RUNNER_PHASE.sandboxCommand, RUNNER_PHASE.attemptTeardown,
] as const;

export const ACTIVITY_OUTCOME = Object.freeze({
  ...AGENT_TURN_OUTCOME,
  unknown: "unknown" as const,
});
export const ACTIVITY_OUTCOMES = [
  ACTIVITY_OUTCOME.completed,
  ACTIVITY_OUTCOME.failed,
  ACTIVITY_OUTCOME.cancelled,
  ACTIVITY_OUTCOME.interrupted,
  ACTIVITY_OUTCOME.unknown,
] as const;
export const COMMAND_TERMINATION_REASON = Object.freeze({
  timeout: "timeout" as const,
  cancelled: "cancelled" as const,
  transportLost: "transport-lost" as const,
});
export const COMMAND_TERMINATION_REASONS = [
  COMMAND_TERMINATION_REASON.timeout,
  COMMAND_TERMINATION_REASON.cancelled,
  COMMAND_TERMINATION_REASON.transportLost,
] as const;
export const COMMAND_NOT_STARTED_REASON = Object.freeze({
  spawnFailed: "spawn-failed" as const,
  cancelledBeforeStart: "cancelled-before-start" as const,
});
export const COMMAND_NOT_STARTED_REASONS = [
  COMMAND_NOT_STARTED_REASON.spawnFailed,
  COMMAND_NOT_STARTED_REASON.cancelledBeforeStart,
] as const;
