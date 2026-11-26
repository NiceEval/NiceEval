import { isSandboxAction, sandboxActionDataOf, type SandboxAction } from "../sandbox/action.ts";
import { isStatePath } from "./paths.ts";

const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const cohortPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

declare const stateDefinitionBrand: unique symbol;
declare const stateBindingBrand: unique symbol;

/** Declares the Sandbox file trees that an Eval Group can restore and save across Runs. */
export interface StateInput {
  /** Project-wide name of the State, using lowercase alphanumeric segments separated by hyphens. */
  readonly name: string;
  /** Change this version to start a new lineage when the State layout or meaning changes. */
  readonly version: string;
  /** One or more distinct absolute Sandbox paths or paths relative to the Sandbox user's home (`~/`). */
  readonly paths: readonly [string, ...string[]];
  /** A built-in declarative Sandbox action run once on a fresh instance when the lineage has no checkpoint. */
  readonly initialize?: SandboxAction;
}

/** A validated State definition created by {@link defineState}. */
export interface StateDefinition {
  readonly [stateDefinitionBrand]: true;
  /** The project's name for this State. */
  readonly name: string;
  /** Select a cohort and return a binding for an Experiment or Plugin. */
  bind(options: { readonly cohort: string }): StateBinding;
}

/** An opaque State and cohort selection created by {@link StateDefinition.bind}. */
export interface StateBinding {
  readonly [stateBindingBrand]: true;
}

export class StateDefinitionError extends TypeError {
  readonly code:
    | "eval-group-incompatible"
    | "state-invalid"
    | "state-duplicate"
    | "state-requires-eval-group"
    | "state-provider-unsupported"
    | "state-path-in-workdir"
    | "state-path-conflict";

  constructor(code: StateDefinitionError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const allowedInitializers = new Set([
  "niceeval.sandbox.command",
  "niceeval.sandbox.shell",
  "niceeval.sandbox.write-text",
  "niceeval.sandbox.write-bytes",
  "niceeval.sandbox.upload-file",
  "niceeval.sandbox.upload-directory",
  "niceeval.sandbox.git-checkout",
]);

export interface StateBindingData {
  readonly name: string;
  readonly version: string;
  readonly cohort: string;
  readonly paths: readonly string[];
  readonly initialize: SandboxAction | undefined;
  readonly initializeIdentity: string | undefined;
}

const bindings = new WeakMap<StateBinding, StateBindingData>();

export function stateBindingData(binding: StateBinding): StateBindingData {
  const data = bindings.get(binding);
  if (data === undefined)
    throw new StateDefinitionError("state-invalid", "State bindings must be created by defineState().bind().");
  return data;
}

export function normalizeStateBindings(value: unknown): readonly StateBinding[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item): item is StateBinding => bindings.has(item))) {
    throw new StateDefinitionError("state-invalid", "State must be an array of defineState().bind() values.");
  }
  return value.length === 0 ? undefined : Object.freeze([...value]);
}

/** Validate and freeze a reusable Sandbox State definition. Call `bind` to choose a cohort. */
export function defineState(input: StateInput): StateDefinition {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.name !== "string" ||
    !namePattern.test(input.name) ||
    typeof input.version !== "string" ||
    !versionPattern.test(input.version)
  ) {
    throw new StateDefinitionError("state-invalid", "State name or version is invalid.");
  }
  if (
    !Array.isArray(input.paths) ||
    input.paths.length === 0 ||
    input.paths.some((path) => typeof path !== "string" || !isStatePath(path)) ||
    new Set(input.paths).size !== input.paths.length
  ) {
    throw new StateDefinitionError(
      "state-invalid",
      "State paths must be unique non-root Sandbox absolute paths or ~/ paths.",
    );
  }
  const { name, version, initialize } = input;
  let initializeIdentity: string | undefined;
  if (initialize !== undefined) {
    if (!isSandboxAction(initialize)) {
      throw new StateDefinitionError(
        "state-invalid",
        "State initialize requires a supported declarative Sandbox action.",
      );
    }
    const { metadata, plan } = sandboxActionDataOf(initialize);
    if (
      !allowedInitializers.has(plan.family) ||
      plan.steps.length !== 1 ||
      metadata.dependsOn.length + metadata.requires.length + metadata.provides.length !== 0
    ) {
      throw new StateDefinitionError(
        "state-invalid",
        "State initialize must be one built-in Sandbox action without dependencies or capabilities.",
      );
    }
    initializeIdentity = plan.fingerprint.combined;
  }
  const paths = Object.freeze([...input.paths].sort());
  return Object.freeze({
    name,
    bind(options: { readonly cohort: string }) {
      if (typeof options?.cohort !== "string" || !cohortPattern.test(options.cohort)) {
        throw new StateDefinitionError("state-invalid", "State cohort is invalid.");
      }
      const binding = Object.freeze({}) as StateBinding;
      bindings.set(
        binding,
        Object.freeze({ name, version, paths, initialize, initializeIdentity, cohort: options.cohort }),
      );
      return binding;
    },
  }) as StateDefinition;
}
