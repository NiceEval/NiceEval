import {
  isAttemptReferenceTargetV1,
  isRunReferenceTargetV1,
  referenceTargetKeyV1,
  type AttemptObservabilityFamilySchemaIdV1,
  type AttemptReferenceTargetV1,
  type AttemptReferencesForFamilyV1,
  type CommandReferenceTargetV1,
  type CommandIdV1,
  type ObservabilityReferenceTargetV1,
  type RunObservabilityFamilySchemaIdV1,
  type RunReferenceTargetV1,
  type RunReferencesForFamilyV1,
} from "./model.ts";

const attemptObservabilityCaptureIdentityTypeId: unique symbol = Symbol(
  "@niceeval/o11y/AttemptObservabilityCaptureIdentityV1",
);
const runObservabilityCaptureIdentityTypeId: unique symbol = Symbol(
  "@niceeval/o11y/RunObservabilityCaptureIdentityV1",
);
const attemptObservabilityEntityRefTypeId: unique symbol = Symbol(
  "@niceeval/o11y/AttemptObservabilityEntityRefV1",
);
const runObservabilityEntityRefTypeId: unique symbol = Symbol(
  "@niceeval/o11y/RunObservabilityEntityRefV1",
);
const registeredCommandCaptureTypeId: unique symbol = Symbol(
  "@niceeval/o11y/RegisteredCommandCaptureV1",
);

/**
 * Internal capture authority. The opaque identity is deliberately separate
 * from a durable Attempt/Run owner identity: no owner ID, path, or blob handle
 * is ever placed in a cross-family reference.
 */
export interface AttemptObservabilityCaptureIdentityV1 {
  readonly [attemptObservabilityCaptureIdentityTypeId]: () => void;
}

export interface RunObservabilityCaptureIdentityV1 {
  readonly [runObservabilityCaptureIdentityTypeId]: () => void;
}

/** The only ref an Attempt capture API may accept from a caller. */
export interface AttemptObservabilityEntityRefV1 {
  readonly [attemptObservabilityEntityRefTypeId]: () => void;
}

/** The Run equivalent cannot be supplied to an Attempt capture API. */
export interface RunObservabilityEntityRefV1 {
  readonly [runObservabilityEntityRefTypeId]: () => void;
}

/** A command result is accepted only through the manifest's registered handle. */
export interface RegisteredCommandCaptureV1 extends AttemptObservabilityEntityRefV1 {
  readonly [registeredCommandCaptureTypeId]: () => void;
}

export interface AttemptCapturedObservabilityEntityV1<
  Target extends AttemptReferenceTargetV1 = AttemptReferenceTargetV1,
> {
  readonly ref: AttemptObservabilityEntityRefV1;
  /** @internal The collector uses this immutable durable triple while sealing. */
  readonly target: Target;
}

export interface RunCapturedObservabilityEntityV1<
  Target extends RunReferenceTargetV1 = RunReferenceTargetV1,
> {
  readonly ref: RunObservabilityEntityRefV1;
  /** @internal The collector uses this immutable durable triple while sealing. */
  readonly target: Target;
}

interface CaptureRuntime {
  readonly owner: "attempt" | "run";
  sealed: boolean;
  readonly targets: Map<string, ObservabilityReferenceTargetV1>;
  readonly registeredCommands: Map<string, RegisteredCommandRuntime>;
}

interface EntityRefRuntime {
  readonly capture: CaptureRuntime;
  readonly target: ObservabilityReferenceTargetV1;
}

interface RegisteredCommandRuntime {
  readonly capture: CaptureRuntime;
  readonly target: CommandReferenceTargetV1;
  resultRecorded: boolean;
}

const captures = new WeakMap<object, CaptureRuntime>();
const attemptEntityRefs = new WeakMap<object, EntityRefRuntime>();
const runEntityRefs = new WeakMap<object, EntityRefRuntime>();
const registeredCommands = new WeakMap<object, RegisteredCommandRuntime>();

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function freezeTarget<Target extends ObservabilityReferenceTargetV1>(target: Target): Target {
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

export function makeAttemptObservabilityCaptureIdentityV1(): AttemptObservabilityCaptureIdentityV1 {
  const capture = {
    [attemptObservabilityCaptureIdentityTypeId]: () => undefined,
  } as AttemptObservabilityCaptureIdentityV1;
  const frozen = Object.freeze(capture);
  captures.set(frozen, makeCaptureRuntime("attempt"));
  return frozen;
}

export function makeRunObservabilityCaptureIdentityV1(): RunObservabilityCaptureIdentityV1 {
  const capture = {
    [runObservabilityCaptureIdentityTypeId]: () => undefined,
  } as RunObservabilityCaptureIdentityV1;
  const frozen = Object.freeze(capture);
  captures.set(frozen, makeCaptureRuntime("run"));
  return frozen;
}

export function isAttemptObservabilityCaptureOpenV1(
  capture: AttemptObservabilityCaptureIdentityV1,
): boolean {
  const runtime = captureRuntime(capture);
  return runtime !== undefined && runtime.owner === "attempt" && !runtime.sealed;
}

export function isRunObservabilityCaptureOpenV1(
  capture: RunObservabilityCaptureIdentityV1,
): boolean {
  const runtime = captureRuntime(capture);
  return runtime !== undefined && runtime.owner === "run" && !runtime.sealed;
}

/** Once closed, a capture cannot mint entities, accept refs, or register a result. */
export function sealAttemptObservabilityCaptureIdentityV1(
  capture: AttemptObservabilityCaptureIdentityV1,
): boolean {
  const runtime = captureRuntime(capture);
  if (runtime === undefined || runtime.owner !== "attempt" || runtime.sealed) return false;
  runtime.sealed = true;
  return true;
}

/** Once closed, a capture cannot mint entities or accept direct refs. */
export function sealRunObservabilityCaptureIdentityV1(
  capture: RunObservabilityCaptureIdentityV1,
): boolean {
  const runtime = captureRuntime(capture);
  if (runtime === undefined || runtime.owner !== "run" || runtime.sealed) return false;
  runtime.sealed = true;
  return true;
}

export function mintAttemptObservabilityEntityV1<Target extends AttemptReferenceTargetV1>(
  capture: AttemptObservabilityCaptureIdentityV1,
  target: Target,
): AttemptCapturedObservabilityEntityV1<Target> | undefined {
  const runtime = captureRuntime(capture);
  if (
    runtime === undefined ||
    runtime.owner !== "attempt" ||
    runtime.sealed ||
    !isAttemptReferenceTargetV1(target)
  ) {
    return undefined;
  }
  const frozenTarget = freezeTarget(target);
  const key = referenceTargetKeyV1(frozenTarget);
  if (runtime.targets.has(key)) return undefined;

  const ref = {
    [attemptObservabilityEntityRefTypeId]: () => undefined,
  } as AttemptObservabilityEntityRefV1;
  const frozenRef = Object.freeze(ref);
  runtime.targets.set(key, frozenTarget);
  attemptEntityRefs.set(
    frozenRef,
    Object.freeze({ capture: runtime, target: frozenTarget }),
  );
  return Object.freeze({ ref: frozenRef, target: frozenTarget });
}

export function mintRunObservabilityEntityV1<Target extends RunReferenceTargetV1>(
  capture: RunObservabilityCaptureIdentityV1,
  target: Target,
): RunCapturedObservabilityEntityV1<Target> | undefined {
  const runtime = captureRuntime(capture);
  if (
    runtime === undefined ||
    runtime.owner !== "run" ||
    runtime.sealed ||
    !isRunReferenceTargetV1(target)
  ) {
    return undefined;
  }
  const frozenTarget = freezeTarget(target);
  const key = referenceTargetKeyV1(frozenTarget);
  if (runtime.targets.has(key)) return undefined;

  const ref = {
    [runObservabilityEntityRefTypeId]: () => undefined,
  } as RunObservabilityEntityRefV1;
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
export function resolveAttemptDirectReferenceV1<
  SourceFamily extends AttemptObservabilityFamilySchemaIdV1,
>(
  capture: AttemptObservabilityCaptureIdentityV1,
  sourceFamily: SourceFamily,
  ref: AttemptObservabilityEntityRefV1,
): AttemptReferencesForFamilyV1<SourceFamily> | undefined {
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
  return freezeTarget(entityState.target) as AttemptReferencesForFamilyV1<SourceFamily>;
}

/** Same owner/capture validation for the two Run-owned families. */
export function resolveRunDirectReferenceV1<
  SourceFamily extends RunObservabilityFamilySchemaIdV1,
>(
  capture: RunObservabilityCaptureIdentityV1,
  sourceFamily: SourceFamily,
  ref: RunObservabilityEntityRefV1,
): RunReferencesForFamilyV1<SourceFamily> | undefined {
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
  return freezeTarget(entityState.target) as RunReferencesForFamilyV1<SourceFamily>;
}

/**
 * The commands family uses this common registration gate. It is deliberately
 * separate from `mint...`: a command entity may be represented in a sealed
 * payload only after its manifest has been registered before process launch.
 */
export function registerCommandCaptureV1(
  capture: AttemptObservabilityCaptureIdentityV1,
  entity: AttemptCapturedObservabilityEntityV1<CommandReferenceTargetV1>,
): RegisteredCommandCaptureV1 | undefined {
  const captureState = captureRuntime(capture);
  const entityState = attemptEntityRuntime(entity.ref);
  if (
    captureState === undefined ||
    captureState.owner !== "attempt" ||
    captureState.sealed ||
    entityState === undefined ||
    entityState.capture !== captureState ||
    entityState.target.family !== "niceeval.commands/v1" ||
    entityState.target.kind !== "command"
  ) {
    return undefined;
  }
  const target = entityState.target as CommandReferenceTargetV1;
  const key = referenceTargetKeyV1(target);
  if (captureState.registeredCommands.has(key)) return undefined;
  const registered = {
    [attemptObservabilityEntityRefTypeId]: () => undefined,
    [registeredCommandCaptureTypeId]: () => undefined,
  } as RegisteredCommandCaptureV1;
  const frozen = Object.freeze(registered);
  const runtime: RegisteredCommandRuntime = {
    capture: captureState,
    target,
    resultRecorded: false,
  };
  captureState.registeredCommands.set(key, runtime);
  // RegisteredCommandCaptureV1 extends the ordinary entity ref capability, so
  // it remains usable as a direct cross-family target while the capture is open.
  attemptEntityRefs.set(frozen, entityState);
  registeredCommands.set(frozen, runtime);
  return frozen;
}

export type CommandResultRegistrationV1 =
  | { readonly state: "recorded" }
  | { readonly state: "capture-sealed" }
  | { readonly state: "not-registered" }
  | { readonly state: "already-recorded"; readonly commandId: CommandIdV1 };

/**
 * Pure state transition shared by the commands collector. The collector maps
 * its result to the public, documented ObservabilityCaptureError union.
 */
export function recordRegisteredCommandResultV1(
  capture: AttemptObservabilityCaptureIdentityV1,
  command: RegisteredCommandCaptureV1,
): CommandResultRegistrationV1 {
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
export function registeredCommandIdV1(
  command: RegisteredCommandCaptureV1,
): CommandIdV1 | undefined {
  const runtime = isObject(command) ? registeredCommands.get(command) : undefined;
  return runtime?.target.id;
}
