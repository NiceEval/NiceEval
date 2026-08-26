import {
  isAttemptReferenceTarget,
  isRunReferenceTarget,
  referenceTargetKey,
  type AttemptObservabilityFamilySchemaId,
  type AttemptReferenceTarget,
  type AttemptReferencesForFamily,
  type CommandReferenceTarget,
  type CommandId,
  type ObservabilityReferenceTarget,
  type RunObservabilityFamilySchemaId,
  type RunReferenceTarget,
  type RunReferencesForFamily,
} from "../../record/family/source-receipt/model.ts";

const attemptObservabilityCaptureIdentityTypeId: unique symbol = Symbol(
  "@niceeval/o11y/AttemptObservabilityCaptureIdentity",
);
const runObservabilityCaptureIdentityTypeId: unique symbol = Symbol(
  "@niceeval/o11y/RunObservabilityCaptureIdentity",
);
const attemptObservabilityEntityRefTypeId: unique symbol = Symbol(
  "@niceeval/o11y/AttemptObservabilityEntityRef",
);
const runObservabilityEntityRefTypeId: unique symbol = Symbol(
  "@niceeval/o11y/RunObservabilityEntityRef",
);
const registeredCommandCaptureTypeId: unique symbol = Symbol(
  "@niceeval/o11y/RegisteredCommandCapture",
);

/**
 * Internal capture authority. The opaque identity is deliberately separate
 * from a durable Attempt/Run owner identity: no owner ID, path, or blob handle
 * is ever placed in a cross-family reference.
 */
export interface AttemptObservabilityCaptureIdentity {
  readonly [attemptObservabilityCaptureIdentityTypeId]: () => void;
}

export interface RunObservabilityCaptureIdentity {
  readonly [runObservabilityCaptureIdentityTypeId]: () => void;
}

/** The only ref an Attempt capture API may accept from a caller. */
export interface AttemptObservabilityEntityRef {
  readonly [attemptObservabilityEntityRefTypeId]: () => void;
}

/** The Run equivalent cannot be supplied to an Attempt capture API. */
export interface RunObservabilityEntityRef {
  readonly [runObservabilityEntityRefTypeId]: () => void;
}

/** A command result is accepted only through the manifest's registered handle. */
export interface RegisteredCommandCapture extends AttemptObservabilityEntityRef {
  readonly [registeredCommandCaptureTypeId]: () => void;
}

export interface AttemptCapturedObservabilityEntity<
  Target extends AttemptReferenceTarget = AttemptReferenceTarget,
> {
  readonly ref: AttemptObservabilityEntityRef;
  /** @internal The collector uses this immutable durable triple while sealing. */
  readonly target: Target;
}

export interface RunCapturedObservabilityEntity<
  Target extends RunReferenceTarget = RunReferenceTarget,
> {
  readonly ref: RunObservabilityEntityRef;
  /** @internal The collector uses this immutable durable triple while sealing. */
  readonly target: Target;
}

interface CaptureRuntime {
  readonly owner: "attempt" | "run";
  sealed: boolean;
  readonly targets: Map<string, ObservabilityReferenceTarget>;
  readonly registeredCommands: Map<string, RegisteredCommandRuntime>;
}

interface EntityRefRuntime {
  readonly capture: CaptureRuntime;
  readonly target: ObservabilityReferenceTarget;
}

interface RegisteredCommandRuntime {
  readonly capture: CaptureRuntime;
  readonly target: CommandReferenceTarget;
  resultRecorded: boolean;
}

const captures = new WeakMap<object, CaptureRuntime>();
const attemptEntityRefs = new WeakMap<object, EntityRefRuntime>();
const runEntityRefs = new WeakMap<object, EntityRefRuntime>();
const registeredCommands = new WeakMap<object, RegisteredCommandRuntime>();

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function freezeTarget<Target extends ObservabilityReferenceTarget>(target: Target): Target {
  return Object.freeze({
    family: target.family,
    kind: target.kind,
    id: target.id,
  }) as Target;
}

function makeCaptureRuntime(owner: "attempt" | "run"): CaptureRuntime {
  return {
    owner,
    sealed: false,
    targets: new Map(),
    registeredCommands: new Map(),
  };
}

function captureRuntime(value: unknown): CaptureRuntime | undefined {
  return isObject(value) ? captures.get(value) : undefined;
}

function attemptEntityRuntime(value: unknown): EntityRefRuntime | undefined {
  return isObject(value) ? attemptEntityRefs.get(value) : undefined;
}

function runEntityRuntime(value: unknown): EntityRefRuntime | undefined {
  return isObject(value) ? runEntityRefs.get(value) : undefined;
}

export function makeAttemptObservabilityCaptureIdentity(): AttemptObservabilityCaptureIdentity {
  const capture = {
    [attemptObservabilityCaptureIdentityTypeId]: () => undefined,
  } as AttemptObservabilityCaptureIdentity;
  const frozen = Object.freeze(capture);
  captures.set(frozen, makeCaptureRuntime("attempt"));
  return frozen;
}

export function makeRunObservabilityCaptureIdentity(): RunObservabilityCaptureIdentity {
  const capture = {
    [runObservabilityCaptureIdentityTypeId]: () => undefined,
  } as RunObservabilityCaptureIdentity;
  const frozen = Object.freeze(capture);
  captures.set(frozen, makeCaptureRuntime("run"));
  return frozen;
}

export function isAttemptObservabilityCaptureOpen(
  capture: AttemptObservabilityCaptureIdentity,
): boolean {
  const runtime = captureRuntime(capture);
  return runtime !== undefined && runtime.owner === "attempt" && !runtime.sealed;
}

export function isRunObservabilityCaptureOpen(
  capture: RunObservabilityCaptureIdentity,
): boolean {
  const runtime = captureRuntime(capture);
  return runtime !== undefined && runtime.owner === "run" && !runtime.sealed;
}

/** Once closed, a capture cannot mint entities, accept refs, or register a result. */
export function sealAttemptObservabilityCaptureIdentity(
  capture: AttemptObservabilityCaptureIdentity,
): boolean {
  const runtime = captureRuntime(capture);
  if (runtime === undefined || runtime.owner !== "attempt" || runtime.sealed) return false;
  runtime.sealed = true;
  return true;
}

/** Once closed, a capture cannot mint entities or accept direct refs. */
export function sealRunObservabilityCaptureIdentity(
  capture: RunObservabilityCaptureIdentity,
): boolean {
  const runtime = captureRuntime(capture);
  if (runtime === undefined || runtime.owner !== "run" || runtime.sealed) return false;
  runtime.sealed = true;
  return true;
}

export function mintAttemptObservabilityEntity<Target extends AttemptReferenceTarget>(
  capture: AttemptObservabilityCaptureIdentity,
  target: Target,
): AttemptCapturedObservabilityEntity<Target> | undefined {
  const runtime = captureRuntime(capture);
  if (
    runtime === undefined ||
    runtime.owner !== "attempt" ||
    runtime.sealed ||
    !isAttemptReferenceTarget(target)
  ) {
    return undefined;
  }
  const frozenTarget = freezeTarget(target);
  const key = referenceTargetKey(frozenTarget);
  if (runtime.targets.has(key)) return undefined;

  const ref = {
    [attemptObservabilityEntityRefTypeId]: () => undefined,
  } as AttemptObservabilityEntityRef;
  const frozenRef = Object.freeze(ref);
  runtime.targets.set(key, frozenTarget);
  attemptEntityRefs.set(
    frozenRef,
    Object.freeze({ capture: runtime, target: frozenTarget }),
  );
  return Object.freeze({ ref: frozenRef, target: frozenTarget });
}

export function mintRunObservabilityEntity<Target extends RunReferenceTarget>(
  capture: RunObservabilityCaptureIdentity,
  target: Target,
): RunCapturedObservabilityEntity<Target> | undefined {
  const runtime = captureRuntime(capture);
  if (
    runtime === undefined ||
    runtime.owner !== "run" ||
    runtime.sealed ||
    !isRunReferenceTarget(target)
  ) {
    return undefined;
  }
  const frozenTarget = freezeTarget(target);
  const key = referenceTargetKey(frozenTarget);
  if (runtime.targets.has(key)) return undefined;

  const ref = {
    [runObservabilityEntityRefTypeId]: () => undefined,
  } as RunObservabilityEntityRef;
  const frozenRef = Object.freeze(ref);
  runtime.targets.set(key, frozenTarget);
  runEntityRefs.set(frozenRef, Object.freeze({ capture: runtime, target: frozenTarget }));
  return Object.freeze({ ref: frozenRef, target: frozenTarget });
}

/**
 * Converts an opaque same-Attempt handle to the exact durable triple. A
 * different capture, copied object, closed capture, same-family target, or
 * forged type assertion is rejected as `undefined` before payload assembly.
 */
export function resolveAttemptDirectReference<
  SourceFamily extends AttemptObservabilityFamilySchemaId,
>(
  capture: AttemptObservabilityCaptureIdentity,
  sourceFamily: SourceFamily,
  ref: AttemptObservabilityEntityRef,
): AttemptReferencesForFamily<SourceFamily> | undefined {
  const captureState = captureRuntime(capture);
  const entityState = attemptEntityRuntime(ref);
  if (
    captureState === undefined ||
    captureState.owner !== "attempt" ||
    captureState.sealed ||
    entityState === undefined ||
    entityState.capture !== captureState ||
    entityState.target.family === sourceFamily
  ) {
    return undefined;
  }
  return freezeTarget(entityState.target) as AttemptReferencesForFamily<SourceFamily>;
}

/** Same owner/capture validation for the two Run-owned families. */
export function resolveRunDirectReference<
  SourceFamily extends RunObservabilityFamilySchemaId,
>(
  capture: RunObservabilityCaptureIdentity,
  sourceFamily: SourceFamily,
  ref: RunObservabilityEntityRef,
): RunReferencesForFamily<SourceFamily> | undefined {
  const captureState = captureRuntime(capture);
  const entityState = runEntityRuntime(ref);
  if (
    captureState === undefined ||
    captureState.owner !== "run" ||
    captureState.sealed ||
    entityState === undefined ||
    entityState.capture !== captureState ||
    entityState.target.family === sourceFamily
  ) {
    return undefined;
  }
  return freezeTarget(entityState.target) as RunReferencesForFamily<SourceFamily>;
}

/**
 * The commands family uses this common registration gate. It is deliberately
 * separate from `mint...`: a command entity may be represented in a sealed
 * payload only after its manifest has been registered before process launch.
 */
export function registerCommandCapture(
  capture: AttemptObservabilityCaptureIdentity,
  entity: AttemptCapturedObservabilityEntity<CommandReferenceTarget>,
): RegisteredCommandCapture | undefined {
  const captureState = captureRuntime(capture);
  const entityState = attemptEntityRuntime(entity.ref);
  if (
    captureState === undefined ||
    captureState.owner !== "attempt" ||
    captureState.sealed ||
    entityState === undefined ||
    entityState.capture !== captureState ||
    entityState.target.family !== "niceeval.sandbox-commands" ||
    entityState.target.kind !== "command"
  ) {
    return undefined;
  }
  const target = entityState.target as CommandReferenceTarget;
  const key = referenceTargetKey(target);
  if (captureState.registeredCommands.has(key)) return undefined;
  const registered = {
    [attemptObservabilityEntityRefTypeId]: () => undefined,
    [registeredCommandCaptureTypeId]: () => undefined,
  } as RegisteredCommandCapture;
  const frozen = Object.freeze(registered);
  const runtime: RegisteredCommandRuntime = {
    capture: captureState,
    target,
    resultRecorded: false,
  };
  captureState.registeredCommands.set(key, runtime);
  // RegisteredCommandCapture extends the ordinary entity ref capability, so
  // it remains usable as a direct cross-family target while the capture is open.
  attemptEntityRefs.set(frozen, entityState);
  registeredCommands.set(frozen, runtime);
  return frozen;
}

export type CommandResultRegistration =
  | { readonly state: "recorded" }
  | { readonly state: "capture-sealed" }
  | { readonly state: "not-registered" }
  | { readonly state: "already-recorded"; readonly commandId: CommandId };

/**
 * Pure state transition shared by the commands collector. The collector maps
 * its result to the public, documented ObservabilityCaptureError union.
 */
export function recordRegisteredCommandResult(
  capture: AttemptObservabilityCaptureIdentity,
  command: RegisteredCommandCapture,
): CommandResultRegistration {
  const captureState = captureRuntime(capture);
  const commandState = isObject(command) ? registeredCommands.get(command) : undefined;
  if (
    captureState === undefined ||
    captureState.owner !== "attempt" ||
    commandState === undefined ||
    commandState.capture !== captureState
  ) {
    return Object.freeze({ state: "not-registered" as const });
  }
  if (captureState.sealed) return Object.freeze({ state: "capture-sealed" as const });
  if (commandState.resultRecorded) {
    return Object.freeze({
      state: "already-recorded" as const,
      commandId: commandState.target.id,
    });
  }
  commandState.resultRecorded = true;
  return Object.freeze({ state: "recorded" as const });
}

/** @internal Lets commands map a valid registered handle to its durable ID. */
export function registeredCommandId(
  command: RegisteredCommandCapture,
): CommandId | undefined {
  const runtime = isObject(command) ? registeredCommands.get(command) : undefined;
  return runtime?.target.id;
}
