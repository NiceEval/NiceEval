import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join, parse } from "node:path";
import type { Readable } from "node:stream";
import { Data, Effect, Schema, type Scope } from "effect";
import type { BeforeCacheStep } from "../backend.ts";
import { normalizeExternalCause, type ExternalCause } from "../../shared/external-cause.ts";
import type { JsonValue } from "../../shared/types.ts";
import { digestOf } from "../identity.ts";
import { sandboxState } from "../action.ts";
import { indexDockerProfiles, resolveDockerProfile, type ResolvedDockerProfileEntry } from "./registry.ts";
import {
  DOCKER_PROFILE_BEFORE_CACHE_CONTROL_PROTOCOL,
  type DockerExecutionProfileV1,
  type DockerProfileBeforeCacheFullCopyCapabilityV1,
} from "./schema.ts";

export const DOCKER_PROFILE_REGISTRY_DIR = "/etc/niceeval/docker-profiles";

export interface DockerProfileRuntimeBinding {
  readonly alias: string;
  readonly profile: DockerExecutionProfileV1;
  readonly descriptorDigest: string;
  readonly daemonGeneration: string;
  readonly daemonId: string;
  readonly dockerSocketPath: string;
  readonly controlSocketPath: string;
  readonly platform: string;
}

export interface DockerProfileLease {
  readonly binding: DockerProfileRuntimeBinding;
  readonly invocationId: string;
  readonly leaseToken: string;
  readonly stopHeartbeat: () => Promise<void>;
}

// 第三方控制协议边界：原样解码宿主 control service 的精确可选字段。
export interface DockerProfileReservation {
  readonly reservationId: string;
  readonly provisionToken: string;
  readonly state: "queued" | "blocked" | "granted" | "provisioning" | "committed" | "releasing" | "quarantined";
  readonly containerId?: string;
  readonly networkId?: string;
  readonly locator?: string;
  readonly buildTerminated?: boolean;
  readonly buildError?: string;
  readonly slotId?: string;
  readonly slotGeneration?: number;
}

export class DockerProfileCapacityBlockedError extends Data.TaggedError("DockerProfileCapacityBlockedError")<{}> {
  readonly code: "CAPACITY_BLOCKED" | "CAPACITY_QUEUE_TIMEOUT";
  constructor(policy: "blocked" | "doctor-timeout" = "blocked") {
    super();
    this.name = "Error";
    this.message =
      policy === "doctor-timeout"
        ? "Docker profile capacity queue timed out after 30 seconds"
        : "Docker profile capacity is blocked";
    this.code = policy === "doctor-timeout" ? "CAPACITY_QUEUE_TIMEOUT" : "CAPACITY_BLOCKED";
  }
}

export class DockerProfileReservationStateError extends Data.TaggedError("DockerProfileReservationStateError")<{}> {
  readonly code = "RESERVATION_NOT_GRANTED";
  readonly state: DockerProfileReservation["state"];
  constructor(state: DockerProfileReservation["state"]) {
    super();
    this.state = state;
    this.name = "Error";
    this.message = `Docker profile reservation cannot run from non-granted state ${JSON.stringify(state)}`;
  }
}

/**
 * Runner-owned permits that must not be retained while a profile reservation is
 * waiting in the control service's fair queue. The Effect values are stateful
 * and idempotent at their owner; this boundary only brackets the wait.
 */
export interface DockerProfileReservationWaitSlot {
  readonly release: Effect.Effect<void>;
  readonly reacquire: Effect.Effect<void>;
}

/** Provider-neutral admission notifications supplied by the Sandbox runtime. */
export interface DockerProfileReservationAdmission {
  readonly queued: Effect.Effect<void>;
  readonly granted: Effect.Effect<void>;
  readonly slot: DockerProfileReservationWaitSlot | undefined;
}

/**
 * Scope-owned reservation. `release` is shared by the Scope finalizer and the
 * provider's normal after-stop path, so either path may win without double
 * disposal or leaving a grant-to-install ownership gap. Queued/blocked owners
 * cancel; capacity-owning states release.
 */
export interface DockerProfileReservationOwner {
  readonly reservation: DockerProfileReservation;
  readonly release: () => Promise<void>;
}

interface MutableDockerProfileReservationOwner extends DockerProfileReservationOwner {
  readonly update: (reservation: DockerProfileReservation) => void;
}

// 第三方控制协议边界：键省略决定 control service 的默认容器配置。
export interface DockerProfileContainerCreateInput {
  readonly image: string;
  readonly attemptId: string;
  readonly command?: readonly string[];
  readonly entrypoint?: string;
  readonly environment?: readonly string[];
  readonly workingDir?: string;
  readonly user?: string;
  readonly tmpfs?: Readonly<Record<string, string>>;
}

export type DockerProfileContainerIntent =
  | { readonly intent: "workload"; readonly create: DockerProfileContainerCreateInput }
  | { readonly intent: "diagnostic" };

export interface DockerProfileContainerCreateResult {
  readonly containerId: string;
  readonly networkId: string;
  readonly state: "active";
}

// 第三方控制协议边界：键省略决定 control service 的默认构建配置。
export interface DockerProfileBuildCreateInput {
  readonly buildKey: string;
  readonly platform: string;
  readonly dockerfile: string;
  readonly buildArgs?: Readonly<Record<string, string>>;
  readonly target?: string;
  readonly retention?: "cache" | "ephemeral";
}

// 第三方控制协议边界：保留 control service 返回的精确可选字段。
export interface DockerProfileBuildCreateResult {
  readonly locator: string;
  readonly state: "terminated";
  readonly cleanupProven?: boolean;
}

export interface DockerProfileBeforeCacheArtifactIdentityV1 {
  readonly requiredState: "dockerData";
  readonly copyProtocol: DockerProfileBeforeCacheFullCopyCapabilityV1["copyProtocol"];
  readonly copyRevision: string;
  /** Provider-neutral identifier; it is not a Docker image id or a raw-filesystem digest slot. */
  readonly artifactId: string;
  readonly sizeBytes: number;
}

interface DockerProfileBeforeCacheReceiptV1 {
  readonly daemonGeneration: string;
  readonly slotGeneration: number;
  readonly requiredState: "dockerData";
  readonly beforeCacheKey: string;
  readonly declarationDigest: string;
  readonly artifact: DockerProfileBeforeCacheArtifactIdentityV1;
}

export interface DockerProfileBeforeCacheCaptureResultV1 extends DockerProfileBeforeCacheReceiptV1 {
  readonly state: "captured" | "already-published";
}

export interface DockerProfileBeforeCacheRestoreResultV1 extends DockerProfileBeforeCacheReceiptV1 {
  readonly state: "restored" | "already-restored";
}

export type DockerProfileControlFailure =
  | { readonly _tag: "ArtifactMiss" }
  | { readonly _tag: "OperationCancelled" }
  | { readonly _tag: "OperationCancelFenced" }
  | { readonly _tag: "ControlRejected" };

function controlFailure(code: string): DockerProfileControlFailure {
  switch (code) {
    case "before-cache-miss":
      return { _tag: "ArtifactMiss" };
    case "before-cache-operation-cancelled":
      return { _tag: "OperationCancelled" };
    case "before-cache-operation-cancel-fenced":
      return { _tag: "OperationCancelFenced" };
    default:
      return { _tag: "ControlRejected" };
  }
}

export class DockerProfileControlError extends Data.TaggedError("DockerProfileControlError")<{
  readonly reason: DockerProfileControlFailure;
}> {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  constructor(code: string, message: string, details?: Readonly<Record<string, unknown>>) {
    super({ reason: controlFailure(code) });
    this.code = code;
    this.details = details;
    this.message = `${code}: ${message}`;
    this.name = "DockerProfileControlError";
  }
}

/** The publish outcome is unknown after transport loss; callers must inspect
 * terminal rather than treating this as a cache miss or ordinary domain error. */
export class DockerProfileControlAmbiguityError extends Data.TaggedError("DockerProfileControlAmbiguityError")<{}> {
  readonly operationId: string;
  readonly terminal: "cancel-fenced" | "unresolved";
  constructor(operationId: string, terminal: "cancel-fenced" | "unresolved", message: string) {
    super();
    this.operationId = operationId;
    this.terminal = terminal;
    this.message = message;
    this.name = "DockerProfileControlAmbiguityError";
  }
}

export class DockerProfileControlCancellationError extends Data.TaggedError(
  "DockerProfileControlCancellationError",
)<{}> {
  readonly operationId: string;
  constructor(operationId: string, message: string) {
    super();
    this.operationId = operationId;
    this.message = message;
    this.name = "DockerProfileControlCancellationError";
  }
}

export class DockerProfileTransportError extends Data.TaggedError("DockerProfileTransportError")<{
  readonly cause: ExternalCause;
}> {
  constructor(cause: ExternalCause) {
    super({ cause });
    this.name = cause._tag === "ThrownValue" ? "Error" : cause.name;
    this.message = cause.message;
  }
}

export type DockerProfileRequestError =
  | DockerProfileControlError
  | DockerProfileControlAmbiguityError
  | DockerProfileControlCancellationError
  | DockerProfileTransportError;

export class DockerProfileDisposalError extends AggregateError {
  readonly _tag = "DockerProfileDisposalError";
  declare readonly errors: DockerProfileOperationError[];
  constructor(errors: readonly DockerProfileOperationError[], message: string) {
    super(errors, message);
  }
}

export type DockerProfileOperationError =
  | DockerProfileRequestError
  | DockerProfileCapacityBlockedError
  | DockerProfileReservationStateError
  | DockerProfileDisposalError;

/** Decode a socket/SDK throwable once before entering the control Effect channel. */
export function dockerProfileRequestError(cause: unknown): DockerProfileRequestError {
  if (cause instanceof DockerProfileControlError) return cause;
  if (cause instanceof DockerProfileControlAmbiguityError) return cause;
  if (cause instanceof DockerProfileControlCancellationError) return cause;
  if (cause instanceof DockerProfileTransportError) return cause;
  return new DockerProfileTransportError(normalizeExternalCause(cause));
}

function dockerProfileOperationError(cause: unknown): DockerProfileOperationError {
  if (cause instanceof DockerProfileCapacityBlockedError) return cause;
  if (cause instanceof DockerProfileReservationStateError) return cause;
  if (cause instanceof DockerProfileDisposalError) return cause;
  return dockerProfileRequestError(cause);
}

// 按键枚举边界：release receipt 校验精确字段集合。
interface DockerProfileReleaseReceipt {
  readonly released: true;
  readonly cleanupProven?: true;
}

interface DockerProfileCancelReceipt {
  readonly cancelled: true;
}

// 第三方控制协议边界：保留 control service 返回的精确可选字段。
interface DockerProfileCleanupStatusReceipt {
  readonly profileId: string;
  readonly generation: string;
  readonly leases: readonly {
    readonly invocationId: string;
    readonly daemonGeneration: string;
  }[];
  readonly reservations: readonly {
    readonly reservationId: string;
    readonly invocationId: string;
  }[];
  readonly queue: readonly {
    readonly reservationId: string;
    readonly invocationId: string;
  }[];
  readonly slots: readonly {
    readonly slotId: string;
    readonly invocationId?: string;
    readonly reservationId?: string;
    readonly state: string;
  }[];
  readonly degraded: readonly string[];
}

type DockerProfileLeaseDrainState = "draining" | "recovered";

const DOCKER_PROFILE_DRAIN_RECONCILE_TIMEOUT_MS = 60_000;
const DOCKER_PROFILE_DRAIN_RECONCILE_INTERVAL_MS = 200;

function validateLeaseDrainReceipt(value: unknown): DockerProfileLeaseDrainState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Docker profile lease drain receipt is not an object");
  }
  const receipt = value as Readonly<Record<string, unknown>>;
  if (Object.keys(receipt).length !== 1 || !("state" in receipt)) {
    throw new Error("Docker profile lease drain receipt fields changed");
  }
  if (receipt.state !== "draining" && receipt.state !== "recovered") {
    throw new Error("Docker profile lease drain did not reach a cleanup-owned state");
  }
  return receipt.state;
}

function validateReleaseReceipt(value: unknown): DockerProfileReleaseReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Docker profile reservation release receipt is not an object");
  }
  const receipt = value as Readonly<Record<string, unknown>>;
  const fields = Object.keys(receipt).sort();
  if (
    receipt.released !== true ||
    (receipt.cleanupProven !== undefined && receipt.cleanupProven !== true) ||
    (fields.length !== 1 && !(fields.length === 2 && fields[0] === "cleanupProven" && fields[1] === "released")) ||
    (fields.length === 1 && fields[0] !== "released")
  ) {
    throw new Error("Docker profile reservation release receipt is not exact or does not prove release");
  }
  return {
    released: true,
    ...(receipt.cleanupProven === true ? { cleanupProven: true as const } : {}),
  };
}

function validateCancelReceipt(value: unknown): DockerProfileCancelReceipt {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    (value as Readonly<Record<string, unknown>>).cancelled !== true
  ) {
    throw new Error("Docker profile reservation cancel receipt is not exact or does not prove cancellation");
  }
  return { cancelled: true };
}

function validateCleanupStatusReceipt(value: unknown): DockerProfileCleanupStatusReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Docker profile cleanup status receipt is not an object");
  }
  const receipt = value as Readonly<Record<string, unknown>>;
  if (
    typeof receipt.profileId !== "string" ||
    typeof receipt.generation !== "string" ||
    !Array.isArray(receipt.leases) ||
    !Array.isArray(receipt.reservations) ||
    !Array.isArray(receipt.queue) ||
    !Array.isArray(receipt.slots) ||
    !Array.isArray(receipt.degraded)
  ) {
    throw new Error("Docker profile cleanup status receipt is missing ownership fields");
  }
  const leases = receipt.leases.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      typeof item.invocationId !== "string" ||
      typeof item.daemonGeneration !== "string"
    )
      throw new Error("Docker profile cleanup status lease identity is invalid");
    return { invocationId: item.invocationId, daemonGeneration: item.daemonGeneration };
  });
  const reservations = receipt.reservations.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      typeof item.reservationId !== "string" ||
      typeof item.invocationId !== "string"
    )
      throw new Error("Docker profile cleanup status reservation identity is invalid");
    return { reservationId: item.reservationId, invocationId: item.invocationId };
  });
  const queue = receipt.queue.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      typeof item.reservationId !== "string" ||
      typeof item.invocationId !== "string"
    )
      throw new Error("Docker profile cleanup status queue ownership is invalid");
    return { reservationId: item.reservationId, invocationId: item.invocationId };
  });
  const slots = receipt.slots.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      typeof item.slotId !== "string" ||
      typeof item.state !== "string" ||
      (item.invocationId !== undefined && typeof item.invocationId !== "string") ||
      (item.reservationId !== undefined && typeof item.reservationId !== "string")
    )
      throw new Error("Docker profile cleanup status slot ownership is invalid");
    return {
      slotId: item.slotId,
      state: item.state,
      ...(item.invocationId === undefined ? {} : { invocationId: item.invocationId }),
      ...(item.reservationId === undefined ? {} : { reservationId: item.reservationId }),
    };
  });
  if (!receipt.degraded.every((item) => typeof item === "string")) {
    throw new Error("Docker profile cleanup status diagnostics are invalid");
  }
  return {
    profileId: receipt.profileId,
    generation: receipt.generation,
    leases,
    reservations,
    queue,
    slots,
    degraded: receipt.degraded,
  };
}

function leaseCleanupProven(
  receipt: DockerProfileCleanupStatusReceipt,
  binding: DockerProfileRuntimeBinding,
  invocationId: string,
): boolean {
  return (
    receipt.profileId === binding.profile.profileId &&
    receipt.generation === binding.daemonGeneration &&
    !receipt.leases.some((item) => item.invocationId === invocationId) &&
    !receipt.reservations.some((item) => item.invocationId === invocationId) &&
    !receipt.queue.some((item) => item.invocationId === invocationId) &&
    !receipt.slots.some((item) => item.invocationId === invocationId)
  );
}

export function lookupDockerProfileBuild(
  binding: DockerProfileRuntimeBinding,
  buildKey: string,
): Promise<{ readonly hit: boolean; readonly locator: string }> {
  return dockerProfileControlRequest(binding.controlSocketPath, {
    kind: "build.lookup",
    profileId: binding.profile.profileId,
    daemonGeneration: binding.daemonGeneration,
    buildKey,
  });
}

function modeOf(value: number): number {
  return value & 0o7777;
}

async function parentModes(path: string): Promise<number[]> {
  const result: number[] = [];
  const root = parse(path).root;
  let current = dirname(path);
  while (true) {
    result.push(modeOf((await stat(current)).mode));
    if (current === root) break;
    current = dirname(current);
  }
  return result;
}

/** Production registry location is fixed; tests may exercise descriptor I/O at an explicit directory. */
export async function loadDockerProfileRegistryAt(
  registryDir: string,
): Promise<ReturnType<typeof indexDockerProfiles>> {
  const names = (await readdir(registryDir))
    .filter(
      (name) =>
        name.endsWith(".json") &&
        !name.endsWith(".host.json") &&
        !name.endsWith(".daemon.json") &&
        !/^assets-v[1-9]\d*\.json$/.test(name),
    )
    .sort();
  const entries = await Promise.all(
    names.map(async (name) => {
      const source = join(registryDir, name);
      const facts = await lstat(source);
      return {
        alias: name.slice(0, -".json".length),
        profile: JSON.parse(await readFile(source, "utf8")) as unknown,
        source,
        fileFacts: {
          isSymlink: facts.isSymbolicLink(),
          ownerUid: facts.uid,
          mode: modeOf(facts.mode),
          parentModes: await parentModes(source),
        },
      };
    }),
  );
  return indexDockerProfiles(entries, { expectedOwnerUid: 0 });
}

export async function loadDockerProfileRegistry(): Promise<ReturnType<typeof indexDockerProfiles>> {
  return loadDockerProfileRegistryAt(DOCKER_PROFILE_REGISTRY_DIR);
}

const ReservationSchema = Schema.Struct({
  reservationId: Schema.String,
  provisionToken: Schema.String,
  state: Schema.Literals(["queued", "blocked", "granted", "provisioning", "committed", "releasing", "quarantined"]),
  containerId: Schema.optionalKey(Schema.String),
  networkId: Schema.optionalKey(Schema.String),
  locator: Schema.optionalKey(Schema.String),
  buildTerminated: Schema.optionalKey(Schema.Boolean),
  buildError: Schema.optionalKey(Schema.String),
  slotId: Schema.optionalKey(Schema.String),
  slotGeneration: Schema.optionalKey(Schema.Number),
});
const ContainerCreateSchema = Schema.Struct({
  containerId: Schema.String,
  networkId: Schema.String,
  state: Schema.Literals(["active"]),
});
const BuildCreateSchema = Schema.Struct({
  locator: Schema.String,
  state: Schema.Literals(["terminated"]),
  cleanupProven: Schema.optionalKey(Schema.Boolean),
});
const ControlStatusSchema = Schema.StructWithRest(
  Schema.Struct({
    journal: Schema.optionalKey(
      Schema.Struct({
        state: Schema.optionalKey(Schema.String),
        durableTransitions: Schema.optionalKey(Schema.Boolean),
      }),
    ),
    assets: Schema.optionalKey(
      Schema.Struct({
        state: Schema.optionalKey(Schema.String),
        images: Schema.optionalKey(
          Schema.Array(
            Schema.Struct({
              reference: Schema.optionalKey(Schema.String),
              present: Schema.optionalKey(Schema.Boolean),
            }),
          ),
        ),
      }),
    ),
  }),
  [Schema.Record(Schema.String, Schema.MutableJson)],
);
const controlResultSchemas = {
  challenge: Schema.Struct({
    protocol: Schema.String,
    profileId: Schema.String,
    descriptorDigest: Schema.String,
    hostMachineIdentity: Schema.String,
    backendMachineIdentity: Schema.String,
    daemonGeneration: Schema.String,
    clientNonce: Schema.String,
  }),
  "lease.create": Schema.Struct({ leaseToken: Schema.String }),
  "lease.heartbeat": Schema.MutableJson,
  "lease.drain": Schema.MutableJson,
  status: ControlStatusSchema,
  "reservation.acquire": ReservationSchema,
  "reservation.get": ReservationSchema,
  "reservation.release": Schema.MutableJson,
  "reservation.cancel": Schema.MutableJson,
  "container.create": ContainerCreateSchema,
  "build.lookup": Schema.Struct({ hit: Schema.Boolean, locator: Schema.String }),
  "build.create": BuildCreateSchema,
  "build.cancel": Schema.MutableJson,
  "before-cache.capture": Schema.MutableJson,
  "before-cache.capture.publish": Schema.MutableJson,
  "before-cache.restore": Schema.MutableJson,
};
type ControlOperation = keyof typeof controlResultSchemas;
type ControlResult = { [Operation in ControlOperation]: (typeof controlResultSchemas)[Operation]["Type"] };
type ControlRequest<Operation extends ControlOperation> = Readonly<Record<string, unknown>> & {
  readonly kind: Operation;
};
// Control replies may be displayed or used as exact receipt material. Validate
// their shape while preserving the original keys, order and extension fields.
function controlResultDecoder<S extends Schema.Constraint>(schema: S) {
  return Schema.decodeUnknownSync(Schema.declare<S["Type"]>(Schema.is(schema)));
}
const controlResultDecoders: { [Operation in ControlOperation]: (input: unknown) => ControlResult[Operation] } = {
  challenge: controlResultDecoder(controlResultSchemas.challenge),
  "lease.create": controlResultDecoder(controlResultSchemas["lease.create"]),
  "lease.heartbeat": controlResultDecoder(controlResultSchemas["lease.heartbeat"]),
  "lease.drain": controlResultDecoder(controlResultSchemas["lease.drain"]),
  status: controlResultDecoder(controlResultSchemas.status),
  "reservation.acquire": controlResultDecoder(ReservationSchema),
  "reservation.get": controlResultDecoder(ReservationSchema),
  "reservation.release": controlResultDecoder(controlResultSchemas["reservation.release"]),
  "reservation.cancel": controlResultDecoder(controlResultSchemas["reservation.cancel"]),
  "container.create": controlResultDecoder(ContainerCreateSchema),
  "build.lookup": controlResultDecoder(controlResultSchemas["build.lookup"]),
  "build.create": controlResultDecoder(BuildCreateSchema),
  "build.cancel": controlResultDecoder(controlResultSchemas["build.cancel"]),
  "before-cache.capture": controlResultDecoder(controlResultSchemas["before-cache.capture"]),
  "before-cache.capture.publish": controlResultDecoder(controlResultSchemas["before-cache.capture.publish"]),
  "before-cache.restore": controlResultDecoder(controlResultSchemas["before-cache.restore"]),
};
const decodeControlReply = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      ok: Schema.optionalKey(Schema.Boolean),
      result: Schema.optionalKey(Schema.MutableJson),
      error: Schema.optionalKey(
        Schema.StructWithRest(
          Schema.Struct({
            code: Schema.optionalKey(Schema.String),
            message: Schema.optionalKey(Schema.String),
          }),
          [Schema.Record(Schema.String, Schema.MutableJson)],
        ),
      ),
    }),
  ),
);

export function dockerProfileControlRequest<Operation extends ControlOperation>(
  path: string,
  request: ControlRequest<Operation>,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<ControlResult[Operation]> {
  return new Promise<ControlResult[Operation]>((resolve, reject) => {
    let frame: string;
    let socket: ReturnType<typeof connect>;
    try {
      frame = `${JSON.stringify(request)}\n`;
      socket = connect(path);
    } catch (cause) {
      reject(dockerProfileRequestError(cause));
      return;
    }
    let response = "";
    let settled = false;
    const settle = (outcome: { value: ControlResult[Operation] } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      if ("value" in outcome) resolve(outcome.value);
      else reject(dockerProfileRequestError(outcome.error));
    };
    const abort = () =>
      socket.destroy(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("Docker profile control request aborted", "AbortError"),
      );
    socket.on("error", (error) => settle({ error }));
    socket.on("close", () => {
      if (settled) return;
      try {
        const parsed = decodeControlReply(response);
        if (parsed.ok !== true || parsed.result === undefined) {
          settle({
            error: new DockerProfileControlError(
              parsed.error?.code ?? "control-error",
              parsed.error?.message ?? "invalid control reply",
              parsed.error,
            ),
          });
        } else settle({ value: controlResultDecoders[request.kind](parsed.result) });
      } catch (error) {
        settle({ error });
      }
    });
    try {
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      socket.setTimeout(timeoutMs);
      socket.on("connect", () => socket.end(frame));
      socket.on("data", (chunk: Buffer) => {
        response += chunk.toString();
      });
      socket.on("timeout", () => socket.destroy(new Error(`Docker profile control timeout: ${path}`)));
    } catch (cause) {
      settle({ error: cause });
    }
  });
}

function controlRequestEffect<Operation extends ControlOperation>(
  path: string,
  request: ControlRequest<Operation>,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Effect.Effect<ControlResult[Operation], DockerProfileRequestError> {
  return Effect.tryPromise({
    try: (fiberSignal) =>
      dockerProfileControlRequest(
        path,
        request,
        signal ? AbortSignal.any([signal, fiberSignal]) : fiberSignal,
        timeoutMs,
      ),
    catch: dockerProfileRequestError,
  });
}

function beforeCacheCapability(lease: DockerProfileLease): DockerProfileBeforeCacheFullCopyCapabilityV1 {
  const capability = lease.binding.profile.backend.filesystem.beforeCache;
  if (capability === undefined) {
    throw new Error("Docker profile descriptor does not declare before-cache full-copy capability");
  }
  if (
    capability.protocol !== DOCKER_PROFILE_BEFORE_CACHE_CONTROL_PROTOCOL ||
    capability.coverage !== sandboxState.dockerData ||
    capability.requiredState !== sandboxState.dockerData ||
    lease.binding.profile.backend.filesystem.dockerDataPool.attestation !== capability.slotAttestation ||
    lease.binding.profile.backend.filesystem.dockerDataPool.bytesPerAllocation !== capability.filesystemSizeBytes
  ) {
    throw new Error("Docker profile before-cache capability is not backed by independent fixed-filesystem slots");
  }
  return capability;
}

function beforeCacheExpectedWire(
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: BeforeCacheStep,
): Readonly<Record<string, unknown>> {
  const capability = beforeCacheCapability(lease);
  return {
    protocol: capability.protocol,
    requiredState: capability.requiredState,
    descriptorDigest: lease.binding.descriptorDigest,
    beforeCacheKey: input.declaration.beforeCacheKey,
    declarationDigest: input.declaration.declarationDigest,
    providerIdentity: capability.providerIdentity,
    baseIdentity: input.declaration.baseIdentity,
    executionDomain: capability.executionDomain,
    helperRevision: capability.helperRevision,
    copyProtocol: capability.copyProtocol,
    copyRevision: capability.copyRevision,
    quiesceRevision: capability.quiesceRevision,
    publicationRevision: capability.publicationRevision,
    recoveryRevision: capability.recoveryRevision,
    manifestSchema: capability.manifestSchema,
    filesystemSizeBytes: capability.filesystemSizeBytes,
    filesystemFeatures: capability.filesystemFeatures,
    daemonGeneration: lease.binding.daemonGeneration,
    slotGeneration: reservation.slotGeneration,
  };
}

function beforeCacheControlFrame<
  Operation extends "before-cache.capture" | "before-cache.capture.publish" | "before-cache.restore",
>(
  kind: Operation,
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: BeforeCacheStep,
): ControlRequest<Operation> {
  if (!Number.isSafeInteger(reservation.slotGeneration) || reservation.slotGeneration! < 0) {
    throw new Error("Docker profile reservation has no attested private slot generation");
  }
  const manifestDigest = digestOf(input.declaration.declarationMetadata as JsonValue);
  if (
    input.declaration.requiredState !== sandboxState.dockerData ||
    input.declaration.beforeCacheKey !== `prefix:${manifestDigest}` ||
    input.declaration.declarationDigest !== `sha256:${manifestDigest}`
  ) {
    throw new Error("Docker profile before-cache key is not bound to its complete canonical manifest identity");
  }
  if (
    input.operationId.length === 0 ||
    input.operationId.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(input.operationId)
  ) {
    throw new Error("Docker profile before-cache operationId is invalid");
  }
  return {
    kind,
    invocationId: lease.invocationId,
    leaseToken: lease.leaseToken,
    reservationId: reservation.reservationId,
    operationId: input.operationId,
    ...beforeCacheExpectedWire(lease, reservation, input),
  };
}

function beforeCacheWireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Docker profile before-cache control response is not an object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function validateExactBeforeCacheFields(
  value: Readonly<Record<string, unknown>>,
  expectedFields: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new Error(
      `Docker profile before-cache ${label} fields changed: ` +
        `expected ${expected.join(", ")}; received ${actual.join(", ")}`,
    );
  }
}

function validateBeforeCacheArtifactIdentity(
  value: unknown,
  lease: DockerProfileLease,
  expected?: DockerProfileBeforeCacheArtifactIdentityV1,
): DockerProfileBeforeCacheArtifactIdentityV1 {
  const artifact = beforeCacheWireRecord(value);
  validateExactBeforeCacheFields(
    artifact,
    ["requiredState", "copyProtocol", "copyRevision", "artifactId", "sizeBytes"],
    "artifact receipt",
  );
  const capability = beforeCacheCapability(lease);
  if (artifact.requiredState !== capability.requiredState) {
    throw new Error("Docker profile before-cache artifact requiredState does not match the descriptor");
  }
  if (artifact.copyProtocol !== capability.copyProtocol) {
    throw new Error("Docker profile before-cache artifact copyProtocol does not match the descriptor");
  }
  if (artifact.copyRevision !== capability.copyRevision) {
    throw new Error("Docker profile before-cache artifact copyRevision does not match the descriptor");
  }
  if (
    typeof artifact.artifactId !== "string" ||
    artifact.artifactId.length === 0 ||
    artifact.artifactId.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(artifact.artifactId)
  ) {
    throw new Error("Docker profile before-cache artifactId is not a bounded provider identity");
  }
  if (!Number.isSafeInteger(artifact.sizeBytes) || (artifact.sizeBytes as number) < 0) {
    throw new Error("Docker profile before-cache artifact sizeBytes is invalid");
  }
  if ((artifact.sizeBytes as number) > capability.seedLimitBytes) {
    throw new Error("Docker profile before-cache artifact exceeds descriptor seedLimitBytes");
  }
  if (capability.copyProtocol === "raw-image/v1" && artifact.sizeBytes !== capability.filesystemSizeBytes) {
    throw new Error("Docker profile raw-image artifact does not cover the complete fixed Docker data filesystem");
  }
  const identity: DockerProfileBeforeCacheArtifactIdentityV1 = {
    requiredState: capability.requiredState,
    copyProtocol: capability.copyProtocol,
    copyRevision: capability.copyRevision,
    artifactId: artifact.artifactId,
    sizeBytes: artifact.sizeBytes as number,
  };
  if (
    expected !== undefined &&
    (identity.copyProtocol !== expected.copyProtocol ||
      identity.copyRevision !== expected.copyRevision ||
      identity.requiredState !== expected.requiredState ||
      identity.artifactId !== expected.artifactId ||
      identity.sizeBytes !== expected.sizeBytes)
  ) {
    throw new Error("Docker profile before-cache restored artifact identity changed after capture");
  }
  return identity;
}

function wireValueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => actual[index] === value)
    );
  }
  return actual === expected;
}

function validateBeforeCacheWireBinding(
  receipt: Readonly<Record<string, unknown>>,
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: BeforeCacheStep,
  label: string,
): void {
  const expected = beforeCacheExpectedWire(lease, reservation, input);
  for (const [field, value] of Object.entries(expected)) {
    if (!wireValueMatches(receipt[field], value)) {
      throw new Error(`Docker profile before-cache ${label} ${field} changed`);
    }
  }
}

function validateBeforeCacheReceipt(
  value: unknown,
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: BeforeCacheStep,
  expectedArtifact?: DockerProfileBeforeCacheArtifactIdentityV1,
): DockerProfileBeforeCacheReceiptV1 & { readonly status: Readonly<Record<string, unknown>> } {
  const response = beforeCacheWireRecord(value);
  validateExactBeforeCacheFields(
    response,
    [...Object.keys(beforeCacheExpectedWire(lease, reservation, input)), "artifact", "status"],
    "success receipt",
  );
  validateBeforeCacheWireBinding(response, lease, reservation, input, "response");
  const status = beforeCacheWireRecord(response.status);
  validateExactBeforeCacheFields(status, ["state", "capacity"], "success status");
  beforeCacheWireRecord(status.capacity);
  return {
    daemonGeneration: response.daemonGeneration as string,
    slotGeneration: response.slotGeneration as number,
    requiredState: response.requiredState as "dockerData",
    beforeCacheKey: response.beforeCacheKey as string,
    declarationDigest: response.declarationDigest as string,
    artifact: validateBeforeCacheArtifactIdentity(response.artifact, lease, expectedArtifact),
    status,
  };
}

function validateBeforeCacheControlError(
  cause: unknown,
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: BeforeCacheStep,
): void {
  if (!(cause instanceof DockerProfileControlError)) return;
  try {
    const details = beforeCacheWireRecord(cause.details);
    validateExactBeforeCacheFields(
      details,
      ["code", "message", ...Object.keys(beforeCacheExpectedWire(lease, reservation, input)), "artifact", "status"],
      "failure receipt",
    );
    validateBeforeCacheWireBinding(details, lease, reservation, input, "failure receipt");
    if (
      typeof details.code !== "string" ||
      details.code.length === 0 ||
      details.code !== cause.code ||
      typeof details.message !== "string" ||
      details.message.length === 0 ||
      details.message.length > 65_536
    ) {
      throw new Error("Docker profile before-cache failure code or message identity is invalid");
    }
    const artifact = beforeCacheWireRecord(details.artifact);
    validateExactBeforeCacheFields(artifact, ["artifactId"], "failure artifact receipt");
    if (artifact.artifactId !== null) {
      throw new Error("Docker profile before-cache terminal failure must not claim an artifact identity");
    }
    const status = beforeCacheWireRecord(details.status);
    validateExactBeforeCacheFields(status, ["state", "diagnostic"], "failure status");
    if (status.state !== "failed" || status.diagnostic !== cause.code) {
      throw new Error("Docker profile before-cache failure status does not match its diagnostic");
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error), { cause });
  }
}

export function captureDockerProfileBeforeCache(
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: BeforeCacheStep,
  signal?: AbortSignal,
  controlTimeoutMs = 120_000,
): Effect.Effect<DockerProfileBeforeCacheCaptureResultV1, DockerProfileRequestError> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* Effect.try({ try: () => beforeCacheCapability(lease), catch: dockerProfileRequestError });
      const frame = yield* Effect.try({
        try: () => beforeCacheControlFrame("before-cache.capture", lease, reservation, input),
        catch: dockerProfileRequestError,
      });
      const rawResponse = yield* restore(
        controlRequestEffect(lease.binding.controlSocketPath, frame, signal, controlTimeoutMs),
      ).pipe(
        Effect.catch((cause) =>
          Effect.try({
            try: () => validateBeforeCacheControlError(cause, lease, reservation, input),
            catch: dockerProfileRequestError,
          }).pipe(Effect.andThen(Effect.fail(cause))),
        ),
      );
      let response = yield* Effect.try({
        try: () => validateBeforeCacheReceipt(rawResponse, lease, reservation, input),
        catch: dockerProfileRequestError,
      });
      let state = response.status.state;
      if (state === "prepared") {
        // Copy/prepare may legitimately use the caller's long control budget. Publish is
        // only a journal transition, so response-loss reconciliation owns a separate,
        // short budget. It must also outlive caller abort: once prepare succeeded, only
        // the Host can prove published or cancel-fenced for this operation identity.
        const publishReconciliationDeadline = Date.now() + 30_000;
        let published = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const reconcileController = new AbortController();
          const reconcileTimeoutMs = Math.max(1, Math.min(10_000, publishReconciliationDeadline - Date.now()));
          const reconcileTimer = setTimeout(() => reconcileController.abort(), reconcileTimeoutMs);
          const outcome = yield* Effect.gen(function* () {
            const publishFrame = yield* Effect.try({
              try: () => beforeCacheControlFrame("before-cache.capture.publish", lease, reservation, input),
              catch: dockerProfileRequestError,
            });
            const publishedResponse = yield* controlRequestEffect(
              lease.binding.controlSocketPath,
              publishFrame,
              reconcileController.signal,
              reconcileTimeoutMs,
            );
            return yield* Effect.try({
              try: () => validateBeforeCacheReceipt(publishedResponse, lease, reservation, input),
              catch: dockerProfileRequestError,
            });
          }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(reconcileTimer))), Effect.result);
          if (outcome._tag === "Success") {
            response = outcome.success;
            published = true;
            break;
          } else {
            const cause = outcome.failure;
            yield* Effect.try({
              try: () => validateBeforeCacheControlError(cause, lease, reservation, input),
              catch: dockerProfileRequestError,
            });
            if (
              cause._tag === "DockerProfileControlError" &&
              (cause.reason._tag === "OperationCancelled" || cause.reason._tag === "OperationCancelFenced")
            ) {
              return yield* new DockerProfileControlCancellationError(
                input.operationId,
                "before-cache capture was fenced and scrubbed",
              );
            }
            if (attempt === 2) break;
            yield* Effect.sleep(100 * (attempt + 1));
          }
        }
        if (!published) {
          return yield* new DockerProfileControlAmbiguityError(
            input.operationId,
            "unresolved",
            "before-cache publish outcome is ambiguous; retry/reconcile is exhausted",
          );
        }
        state = response.status.state;
      }
      if (state !== "captured" && state !== "already-published") {
        return yield* new DockerProfileTransportError(
          normalizeExternalCause(
            new Error(`Docker profile before-cache capture returned invalid state ${JSON.stringify(state)}`),
          ),
        );
      }
      return {
        daemonGeneration: response.daemonGeneration,
        slotGeneration: response.slotGeneration,
        requiredState: response.requiredState,
        beforeCacheKey: response.beforeCacheKey,
        declarationDigest: response.declarationDigest,
        state,
        artifact: response.artifact,
      };
    }),
  );
}

export function restoreDockerProfileBeforeCache(
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: BeforeCacheStep,
  expected?: DockerProfileBeforeCacheArtifactIdentityV1,
  signal?: AbortSignal,
  controlTimeoutMs = 120_000,
): Effect.Effect<DockerProfileBeforeCacheRestoreResultV1, DockerProfileRequestError> {
  return Effect.gen(function* () {
    yield* Effect.try({ try: () => beforeCacheCapability(lease), catch: dockerProfileRequestError });
    const frame = yield* Effect.try({
      try: () => beforeCacheControlFrame("before-cache.restore", lease, reservation, input),
      catch: dockerProfileRequestError,
    });
    const rawResponse = yield* controlRequestEffect(
      lease.binding.controlSocketPath,
      frame,
      signal,
      controlTimeoutMs,
    ).pipe(
      Effect.catch((cause) =>
        Effect.try({
          try: () => validateBeforeCacheControlError(cause, lease, reservation, input),
          catch: dockerProfileRequestError,
        }).pipe(Effect.andThen(Effect.fail(cause))),
      ),
    );
    const response = yield* Effect.try({
      try: () => validateBeforeCacheReceipt(rawResponse, lease, reservation, input, expected),
      catch: dockerProfileRequestError,
    });
    const state = response.status.state;
    if (state !== "restored" && state !== "already-restored") {
      return yield* new DockerProfileTransportError(
        normalizeExternalCause(
          new Error(`Docker profile before-cache restore returned invalid state ${JSON.stringify(state)}`),
        ),
      );
    }
    return {
      daemonGeneration: response.daemonGeneration,
      slotGeneration: response.slotGeneration,
      requiredState: response.requiredState,
      beforeCacheKey: response.beforeCacheKey,
      declarationDigest: response.declarationDigest,
      state,
      artifact: response.artifact,
    };
  });
}

async function socketFact(path: string, expectedUid: number): Promise<void> {
  const value = await lstat(path);
  if (!value.isSocket()) throw new Error(`Docker profile endpoint is not a Unix socket: ${path}`);
  if (value.uid !== expectedUid)
    throw new Error(`Docker profile endpoint ${path} owner is ${value.uid}, expected ${expectedUid}`);
  if ((modeOf(value.mode) & 0o002) !== 0) throw new Error(`Docker profile endpoint is world-writable: ${path}`);
}

function rootlessSecurityOptions(info: { readonly SecurityOptions?: readonly string[] }): boolean {
  return (info.SecurityOptions ?? []).some((option: string) => option.toLowerCase().includes("rootless"));
}

async function attestEntry(entry: ResolvedDockerProfileEntry): Promise<DockerProfileRuntimeBinding> {
  const profile = entry.profile;
  await Promise.all([
    socketFact(profile.transport.dockerSocket.path, profile.transport.dockerSocket.peerUid),
    socketFact(profile.transport.controlSocket.path, profile.transport.controlSocket.peerUid),
  ]);
  const nonce = randomUUID();
  const challenge = await dockerProfileControlRequest(profile.transport.controlSocket.path, {
    kind: "challenge",
    clientNonce: nonce,
  });
  if (
    challenge.protocol !== profile.transport.controlSocket.protocol ||
    challenge.profileId !== profile.profileId ||
    challenge.descriptorDigest !== entry.descriptorDigest ||
    challenge.clientNonce !== nonce ||
    challenge.hostMachineIdentity !== profile.transport.hostMachineIdentity ||
    challenge.backendMachineIdentity !== profile.backend.machineIdentity
  ) {
    throw new Error(`Docker profile ${entry.alias} control attestation does not match its descriptor`);
  }
  // dockerode 是 optional peer；只有用户实际使用 Docker profile 时才加载。
  // 保持这里为热路径动态 import，避免不使用 Docker 的最小安装仅因 CLI 启动就崩溃。
  const { default: Docker } = await import("dockerode");
  const docker = new Docker({ socketPath: profile.transport.dockerSocket.path });
  const info = await docker.info();
  if (profile.securityLevel !== "raw-dind-storage/v1" && !rootlessSecurityOptions(info)) {
    throw new Error(`Docker profile ${entry.alias} daemon is not rootless`);
  }
  if (info.DockerRootDir !== profile.backend.filesystem.dockerRootDir) {
    throw new Error(`Docker profile ${entry.alias} DockerRootDir does not match descriptor`);
  }
  if (String(info.CgroupVersion) !== "2" || info.CgroupDriver !== "systemd") {
    throw new Error(`Docker profile ${entry.alias} requires cgroup v2 with the systemd driver`);
  }
  const os = info.OSType || "linux";
  const arch = info.Architecture || "amd64";
  if (typeof info.ID !== "string" || info.ID === "")
    throw new Error(`Docker profile ${entry.alias} daemon ID is missing`);
  return {
    alias: entry.alias,
    profile,
    descriptorDigest: entry.descriptorDigest,
    daemonGeneration: challenge.daemonGeneration,
    daemonId: info.ID,
    dockerSocketPath: profile.transport.dockerSocket.path,
    controlSocketPath: profile.transport.controlSocket.path,
    platform: `${os}/${arch}`,
  };
}

export async function attestDockerProfile(alias: string): Promise<DockerProfileRuntimeBinding> {
  return attestEntry(resolveDockerProfile(await loadDockerProfileRegistry(), alias));
}

export async function createDockerProfileLease(binding: DockerProfileRuntimeBinding): Promise<DockerProfileLease> {
  const invocationId = randomUUID();
  const created = await dockerProfileControlRequest(binding.controlSocketPath, {
    kind: "lease.create",
    profileId: binding.profile.profileId,
    daemonGeneration: binding.daemonGeneration,
    invocationId,
  });
  let stopped = false;
  let heartbeatEnabled = true;
  let drainInFlight: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const heartbeat = async () => {
    if (!heartbeatEnabled) return;
    await dockerProfileControlRequest(binding.controlSocketPath, {
      kind: "lease.heartbeat",
      invocationId,
      leaseToken: created.leaseToken,
    });
  };
  timer = setInterval(() => {
    void heartbeat().catch(() => {});
  }, 5_000);
  timer.unref();
  return {
    binding,
    invocationId,
    leaseToken: created.leaseToken,
    stopHeartbeat: async () => {
      if (stopped) return;
      heartbeatEnabled = false;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      if (drainInFlight !== undefined) return await drainInFlight;
      const draining = (async () => {
        const deadline = Date.now() + DOCKER_PROFILE_DRAIN_RECONCILE_TIMEOUT_MS;
        let lastError: DockerProfileRequestError | undefined;
        while (true) {
          try {
            validateLeaseDrainReceipt(
              await dockerProfileControlRequest(binding.controlSocketPath, {
                kind: "lease.drain",
                invocationId,
                leaseToken: created.leaseToken,
              }),
            );
          } catch (error) {
            // A lost drain reply is not cleanup proof; retry the same idempotent drain and inspect its ledger.
            lastError = dockerProfileRequestError(error);
          }
          try {
            const status = validateCleanupStatusReceipt(
              await dockerProfileControlRequest(binding.controlSocketPath, { kind: "status" }),
            );
            if (leaseCleanupProven(status, binding, invocationId)) {
              stopped = true;
              return;
            }
            lastError = dockerProfileRequestError(
              new Error(`Docker profile lease ${invocationId} remains visible after drain reconciliation`),
            );
          } catch (error) {
            lastError = dockerProfileRequestError(error);
          }
          if (Date.now() >= deadline) {
            throw new Error(
              `Docker profile lease ${invocationId} did not reach recovered state within ` +
                `${DOCKER_PROFILE_DRAIN_RECONCILE_TIMEOUT_MS}ms`,
              lastError === undefined ? undefined : { cause: lastError },
            );
          }
          await new Promise((resolve) => setTimeout(resolve, DOCKER_PROFILE_DRAIN_RECONCILE_INTERVAL_MS));
        }
      })();
      drainInFlight = draining;
      try {
        await draining;
      } finally {
        if (!stopped && drainInFlight === draining) drainInFlight = undefined;
      }
    },
  };
}

function nonGrantedReservationError(
  reservation: DockerProfileReservation,
): DockerProfileCapacityBlockedError | DockerProfileReservationStateError {
  return reservation.state === "blocked"
    ? new DockerProfileCapacityBlockedError()
    : new DockerProfileReservationStateError(reservation.state);
}

export async function acquireDockerProfileReservation(
  lease: DockerProfileLease,
  reservationKind: "container" | "build",
  resources: Readonly<Record<string, number>>,
  signal?: AbortSignal,
): Promise<DockerProfileReservation> {
  const reservationId = randomUUID();
  // This entry is shared by the ordinary build path (which always
  // supplies its Attempt signal) and `docker profile doctor`. Only doctor owns
  // the explicit 30-second diagnostic policy; normal builds have no queue TTL.
  const doctorDeadline = signal === undefined ? Date.now() + 30_000 : undefined;
  let reservation: DockerProfileReservation | undefined;
  try {
    reservation = await dockerProfileControlRequest(
      lease.binding.controlSocketPath,
      {
        kind: "reservation.acquire",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
        reservationKind,
        resources,
      },
      signal,
    );
    while (reservation.state === "queued") {
      if (doctorDeadline !== undefined && Date.now() >= doctorDeadline) {
        throw new DockerProfileCapacityBlockedError("doctor-timeout");
      }
      if (signal?.aborted)
        throw dockerProfileRequestError(
          signal.reason ?? new DOMException("Docker profile reservation aborted", "AbortError"),
        );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, 100);
        const abort = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          reject(signal?.reason ?? new DOMException("Docker profile reservation aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
      });
      reservation = await dockerProfileControlRequest(
        lease.binding.controlSocketPath,
        {
          kind: "reservation.get",
          invocationId: lease.invocationId,
          leaseToken: lease.leaseToken,
          reservationId,
        },
        signal,
      );
      if (signal?.aborted)
        throw dockerProfileRequestError(
          signal.reason ?? new DOMException("Docker profile reservation aborted", "AbortError"),
        );
    }
    if (reservation.state !== "granted") {
      if (reservation.state === "blocked" && doctorDeadline !== undefined) {
        throw new DockerProfileCapacityBlockedError("doctor-timeout");
      }
      throw nonGrantedReservationError(reservation);
    }
  } catch (error) {
    if (reservation !== undefined) {
      try {
        await relinquishDockerProfileReservation(lease, reservationId, reservation);
      } catch (releaseError) {
        throw new DockerProfileDisposalError(
          [dockerProfileOperationError(error), dockerProfileOperationError(releaseError)],
          `Docker profile reservation ${reservationId} acquisition and disposal both failed`,
        );
      }
    }
    throw error;
  }
  return reservation;
}

function profileControlEffect(
  lease: DockerProfileLease,
  request: ControlRequest<"reservation.acquire" | "reservation.get">,
  signal?: AbortSignal,
): Effect.Effect<DockerProfileReservation, DockerProfileRequestError> {
  return Effect.tryPromise({
    try: (runtimeSignal) =>
      dockerProfileControlRequest(
        lease.binding.controlSocketPath,
        request,
        signal === undefined ? runtimeSignal : AbortSignal.any([signal, runtimeSignal]),
      ),
    catch: dockerProfileRequestError,
  });
}

function profileQueueDelay(milliseconds: number, signal?: AbortSignal): Effect.Effect<void, DockerProfileRequestError> {
  return Effect.tryPromise({
    try: (runtimeSignal) => {
      const combined = signal === undefined ? runtimeSignal : AbortSignal.any([signal, runtimeSignal]);
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          combined.removeEventListener("abort", abort);
          resolve();
        }, milliseconds);
        const abort = () => {
          clearTimeout(timer);
          combined.removeEventListener("abort", abort);
          reject(
            combined.reason instanceof Error
              ? combined.reason
              : new DOMException("Docker profile reservation aborted", "AbortError"),
          );
        };
        if (combined.aborted) abort();
        else combined.addEventListener("abort", abort, { once: true });
      });
    },
    catch: dockerProfileRequestError,
  });
}

function makeDockerProfileReservationOwner(
  lease: DockerProfileLease,
  reservationId: string,
  initial: DockerProfileReservation,
): MutableDockerProfileReservationOwner {
  let current = initial;
  type ReleaseState =
    | { readonly _tag: "Idle" }
    | { readonly _tag: "Releasing"; readonly done: Promise<void> }
    | { readonly _tag: "Released" };
  let state: ReleaseState = { _tag: "Idle" };
  return {
    get reservation() {
      return current;
    },
    update(next) {
      current = next;
    },
    async release() {
      if (state._tag === "Released") return;
      if (state._tag === "Releasing") return await state.done;
      const done = relinquishDockerProfileReservation(lease, reservationId, current).then(() => {
        state = { _tag: "Released" };
      });
      state = { _tag: "Releasing", done };
      try {
        await done;
      } finally {
        if (state._tag === "Releasing" && state.done === done) state = { _tag: "Idle" };
      }
    },
  };
}

function releaseReservationOwner(owner: DockerProfileReservationOwner): Effect.Effect<void> {
  return Effect.tryPromise({ try: () => owner.release(), catch: dockerProfileOperationError }).pipe(Effect.orDie);
}

/**
 * Effect-native reservation acquisition used by the Sandbox runtime. A queued
 * reservation is still owned by the control service, while runner permits are
 * explicitly released before polling. A successful grant may interruptibly
 * reacquire them; cancellation during polling or reacquisition falls through
 * to the semaphore owners' own finalizers and the reservation Scope finalizer.
 */
export function acquireDockerProfileReservationEffect(
  lease: DockerProfileLease,
  reservationKind: "container" | "build",
  resources: Readonly<Record<string, number>>,
  admission: DockerProfileReservationAdmission,
  signal?: AbortSignal,
): Effect.Effect<DockerProfileReservationOwner, DockerProfileOperationError, Scope.Scope> {
  const reservationId = randomUUID();
  const request = (frame: ControlRequest<"reservation.acquire" | "reservation.get">, requestSignal = signal) =>
    profileControlEffect(lease, frame, requestSignal);

  return Effect.gen(function* () {
    // Effect 3.22.1 acquireRelease runs acquire and finalizer registration in
    // one uninterruptible region. Once acquire returns the first reservation
    // object, every later poll/grant/reacquire interruption is Scope-owned.
    const owner = yield* Effect.acquireRelease(
      request({
        kind: "reservation.acquire",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
        reservationKind,
        resources,
      }).pipe(Effect.map((initial) => makeDockerProfileReservationOwner(lease, reservationId, initial))),
      (owned) => releaseReservationOwner(owned),
    );

    if (owner.reservation.state !== "granted") yield* admission.queued;
    if (owner.reservation.state === "queued") {
      const awaitGrant = Effect.gen(function* () {
        while (owner.reservation.state === "queued") {
          yield* profileQueueDelay(100, signal);
          owner.update(
            yield* request({
              kind: "reservation.get",
              invocationId: lease.invocationId,
              leaseToken: lease.leaseToken,
              reservationId,
            }),
          );
        }
        return owner;
      });
      if (admission.slot === undefined) {
        yield* awaitGrant;
      } else {
        const slot = admission.slot;
        // Release queue-held permits explicitly. Effect.acquireRelease masks
        // its acquisition in v4, so reopen interruption only for this wait:
        // the reservation owner is already Scope-owned and can be released
        // before provider materialization ever reaches container.create.
        yield* Effect.uninterruptible(slot.release);
        const granted = yield* awaitGrant;
        if (granted.reservation.state !== "granted") {
          return yield* Effect.fail(nonGrantedReservationError(granted.reservation));
        }
        yield* Effect.interruptible(slot.reacquire);
      }
    }
    if (owner.reservation.state !== "granted") {
      return yield* Effect.fail(nonGrantedReservationError(owner.reservation));
    }
    yield* admission.granted;
    return owner;
  });
}

async function writeControlFrame(socket: import("node:net").Socket, bytes: Buffer): Promise<void> {
  if (socket.write(bytes)) return;
  await once(socket, "drain");
}

function controlBuildRequest(
  path: string,
  request: ControlRequest<"build.create">,
  context: Readable,
  signal?: AbortSignal,
): Promise<DockerProfileBuildCreateResult> {
  return new Promise<DockerProfileBuildCreateResult>((resolve, reject) => {
    const socket = connect(path);
    let response = "";
    let settled = false;
    const settle = (outcome: { value: DockerProfileBuildCreateResult } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if ("value" in outcome) resolve(outcome.value);
      else {
        context.destroy(outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error)));
        reject(outcome.error);
      }
    };
    const abort = () =>
      socket.destroy(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("Docker profile build aborted", "AbortError"),
      );
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    socket.setTimeout(15 * 60_000);
    socket.on("connect", () => {
      void (async () => {
        await writeControlFrame(socket, Buffer.from(`${JSON.stringify(request)}\n`));
        for await (const value of context) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          if (chunk.length === 0) continue;
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length);
          await writeControlFrame(socket, length);
          await writeControlFrame(socket, chunk);
        }
        const end = Buffer.alloc(4);
        socket.end(end);
      })().catch((error: unknown) => socket.destroy(error instanceof Error ? error : new Error(String(error))));
    });
    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString();
    });
    socket.on("timeout", () => socket.destroy(new Error(`Docker profile build control timeout: ${path}`)));
    socket.on("error", (error) => settle({ error }));
    socket.on("close", () => {
      if (settled) return;
      try {
        const parsed = decodeControlReply(response);
        if (parsed.ok !== true || parsed.result === undefined) {
          settle({
            error: new Error(
              `${parsed.error?.code ?? "control-error"}: ${parsed.error?.message ?? "invalid control reply"}`,
            ),
          });
        } else settle({ value: controlResultDecoders["build.create"](parsed.result) });
      } catch (error) {
        settle({ error });
      }
    });
  });
}

export async function createDockerProfileContainer(
  lease: DockerProfileLease,
  reservationId: string,
  request: DockerProfileContainerCreateInput | DockerProfileContainerIntent,
  signal?: AbortSignal,
): Promise<DockerProfileContainerCreateResult> {
  const create = "intent" in request ? request : { intent: "workload" as const, create: request };
  try {
    return await dockerProfileControlRequest(
      lease.binding.controlSocketPath,
      {
        kind: "container.create",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
        create,
      },
      signal,
    );
  } catch (error) {
    // A lost reply can leave the journal committed. Recover the control-owned IDs instead of
    // issuing a second create or asking DockerSandbox's legacy reconciler to remove them.
    const reservation = await dockerProfileControlRequest(
      lease.binding.controlSocketPath,
      {
        kind: "reservation.get",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
      },
      signal,
    ).catch(() => undefined);
    if (
      reservation?.state === "committed" &&
      reservation.containerId !== undefined &&
      reservation.networkId !== undefined
    ) {
      return { containerId: reservation.containerId, networkId: reservation.networkId, state: "active" };
    }
    throw error;
  }
}

export async function createDockerProfileBuild(
  lease: DockerProfileLease,
  reservationId: string,
  build: DockerProfileBuildCreateInput,
  context: Readable,
  signal?: AbortSignal,
): Promise<DockerProfileBuildCreateResult> {
  const cancelBuild = async () => {
    await dockerProfileControlRequest(lease.binding.controlSocketPath, {
      kind: "build.cancel",
      invocationId: lease.invocationId,
      leaseToken: lease.leaseToken,
      reservationId,
    }).catch(() => undefined);
  };
  try {
    return await controlBuildRequest(
      lease.binding.controlSocketPath,
      {
        kind: "build.create",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
        build,
        contextEncoding: "tar-chunked/v1",
      },
      context,
      signal,
    );
  } catch (error) {
    // The operation survives a client-side reply loss. Its durable reservation is
    // the recovery handle; never retry a build under a second provision token.
    if (signal?.aborted) {
      await cancelBuild();
      throw error;
    }
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (signal?.aborted) {
        await cancelBuild();
        throw error;
      }
      const reservation = await dockerProfileControlRequest(
        lease.binding.controlSocketPath,
        {
          kind: "reservation.get",
          invocationId: lease.invocationId,
          leaseToken: lease.leaseToken,
          reservationId,
        },
        signal,
      ).catch(() => undefined);
      if (signal?.aborted) {
        await cancelBuild();
        throw error;
      }
      if (reservation?.state === "committed" && reservation.buildTerminated === true) {
        if (reservation.buildError === undefined && !signal?.aborted && reservation.locator !== undefined) {
          return { locator: reservation.locator, state: "terminated" };
        }
        break;
      }
      if (reservation?.state === "quarantined") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw error;
  }
}

export async function releaseDockerProfileReservation(
  lease: DockerProfileLease,
  reservationId: string,
  proof?: Pick<DockerProfileReservation, "slotId">,
): Promise<DockerProfileReleaseReceipt> {
  const release = async (): Promise<DockerProfileReleaseReceipt> =>
    validateReleaseReceipt(
      await dockerProfileControlRequest(lease.binding.controlSocketPath, {
        kind: "reservation.release",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
      }),
    );
  try {
    return await release();
  } catch (primary) {
    // A reply can be lost after the durable release.  Treat that as success
    // only after the same profile generation confirms every owned handle is
    // absent and no reservation-specific recovery uncertainty remains.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      // Before cache copy work can outlive a cancelled client socket. The host
      // rejects release while that journaled operation is active; retry until
      // it publishes/rolls back, then perform the same verified scrub release.
      const retried = await release().catch(() => undefined);
      if (retried !== undefined) return retried;
      const status = await dockerProfileControlRequest(lease.binding.controlSocketPath, { kind: "status" })
        .then(validateCleanupStatusReceipt)
        .catch(() => undefined);
      if (
        status?.profileId === lease.binding.profile.profileId &&
        status.generation === lease.binding.daemonGeneration
      ) {
        const reservationAbsent = !status.reservations.some((item) => item.reservationId === reservationId);
        const queueAbsent = !status.queue.some((item) => item.reservationId === reservationId);
        const leaseIdentitySafe =
          !status.leases.some((item) => item.invocationId === lease.invocationId) ||
          status.leases.some(
            (item) =>
              item.invocationId === lease.invocationId && item.daemonGeneration === lease.binding.daemonGeneration,
          );
        const slot =
          proof?.slotId === undefined ? undefined : status.slots.find((item) => item.slotId === proof.slotId);
        const slotFree = proof?.slotId === undefined || (slot?.state === "free" && slot.reservationId === undefined);
        const uncertain = status.degraded.some((item) => item.includes(reservationId));
        if (reservationAbsent && queueAbsent && leaseIdentitySafe && slotFree && !uncertain) {
          return { released: true, cleanupProven: true };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw primary;
  }
}

async function cancelDockerProfileReservation(lease: DockerProfileLease, reservationId: string): Promise<void> {
  try {
    validateCancelReceipt(
      await dockerProfileControlRequest(lease.binding.controlSocketPath, {
        kind: "reservation.cancel",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
      }),
    );
  } catch (primary) {
    // A successful cancellation can outlive a lost client reply. Accept that
    // only when the attested generation proves every reservation handle gone.
    const status = await dockerProfileControlRequest(lease.binding.controlSocketPath, { kind: "status" })
      .then(validateCleanupStatusReceipt)
      .catch(() => undefined);
    const absent =
      status?.profileId === lease.binding.profile.profileId &&
      status.generation === lease.binding.daemonGeneration &&
      !status.reservations.some((item) => item.reservationId === reservationId) &&
      !status.queue.some((item) => item.reservationId === reservationId) &&
      !status.slots.some((item) => item.reservationId === reservationId) &&
      !status.degraded.some((item) => item.includes(reservationId));
    if (absent) return;
    throw primary;
  }
}

async function relinquishDockerProfileReservation(
  lease: DockerProfileLease,
  reservationId: string,
  reservation: DockerProfileReservation,
): Promise<void> {
  if (reservation.state !== "queued" && reservation.state !== "blocked") {
    await releaseDockerProfileReservation(lease, reservationId, reservation);
    return;
  }
  try {
    await cancelDockerProfileReservation(lease, reservationId);
    return;
  } catch (cancelError) {
    // Capacity may become available between the last poll and cancellation.
    // Once granted, the reservation owns provider capacity and must use the
    // release path instead of pretending the failed cancel disposed it.
    let current: DockerProfileReservation;
    try {
      current = await dockerProfileControlRequest(lease.binding.controlSocketPath, {
        kind: "reservation.get",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
      });
    } catch (refreshError) {
      throw new DockerProfileDisposalError(
        [dockerProfileOperationError(cancelError), dockerProfileOperationError(refreshError)],
        `Docker profile reservation ${reservationId} cancellation state could not be reconciled`,
      );
    }
    if (current.state === "queued" || current.state === "blocked") throw cancelError;
    try {
      await releaseDockerProfileReservation(lease, reservationId, current);
    } catch (releaseError) {
      throw new DockerProfileDisposalError(
        [dockerProfileOperationError(cancelError), dockerProfileOperationError(releaseError)],
        `Docker profile reservation ${reservationId} raced from cancellation to release and both failed`,
      );
    }
  }
}
