import { createHash, randomBytes } from "node:crypto";

import { Effect, Either, Schema } from "effect";

import type { SealedAttemptAssertions } from "../../assertions/api.ts";
import {
  createAssertionsAttachmentProducer,
  encodeSealedAssertionEntry,
  type AssertionsAttachmentCapture,
  type AssertionSourceSiteInput,
} from "../../assertions/record/attachment.ts";
import {
  createFileChangesCaptureAttachment,
  type FileChangesAttachmentBuild,
} from "../../assertions/record/diff.ts";
import type { AssertionsProducerError } from "../../assertions/record/producer.ts";
import type { AssertionEntryId } from "../../assertions/identity.ts";
import { RecordExactParseOptions } from "../../record/codec/core.ts";
import {
  ArtifactsAttachmentSchema,
  ArtifactsLimits,
  type ArtifactsAttachment,
} from "../../record/family/artifacts.ts";
import type { AssertionSourceSite } from "../../record/family/assertions/definition.ts";
import type { RecordAttachmentSessionBuilder } from "../../record/writer/current-attachment.ts";
import { runnerAttemptFileChangesCaptureForResult } from "../sandbox-record-producer.ts";
import {
  createAttemptSourceReceiptAttachments,
  createRunSourceReceiptAttachments,
  type AttemptSourceReceiptAttachments,
  type RunSourceReceiptAttachments,
} from "../source-receipts/attachment-writes.ts";
import {
  createRunnerAttemptSourceReceiptsCapture,
  createRunnerRunSourceReceiptsCapture,
} from "../source-receipts/runtime.ts";
import type { RunnerAssertionSourceSitesBuild } from "../source-producer.ts";
import type { AgentRun, EvalResult } from "../types.ts";

export interface RunnerAssertionsAttachmentInvalid {
  readonly code: "runner-record-assertions-invalid";
  readonly issue: AssertionsProducerError;
}

export interface RunnerObservabilityAttachmentInvalid {
  readonly code: "runner-record-observability-invalid";
  readonly owner: "attempt" | "run";
  readonly stage: "capture" | "attachment";
}

export interface RunnerArtifactsAttachmentInvalid {
  readonly code: "runner-record-artifacts-invalid";
  readonly owner: "attempt" | "run";
  readonly reason: "trace-serialization-failed" | "attachment-closure-invalid";
}

export interface PreparedAssertionsAttachment {
  readonly attachment: AssertionsAttachmentCapture<never, never>;
  readonly entryIds: readonly AssertionEntryId[];
}

function assertionsInvalid(issue: AssertionsProducerError): RunnerAssertionsAttachmentInvalid {
  return Object.freeze({ code: "runner-record-assertions-invalid" as const, issue });
}

function buildAssertionsCapture(
  sealed: SealedAttemptAssertions,
  input: {
    readonly entryIds?: readonly AssertionEntryId[];
    readonly sourceSites?: readonly AssertionSourceSiteInput[];
  },
): Either.Either<PreparedAssertionsAttachment, RunnerAssertionsAttachmentInvalid> {
  let entryIndex = 0;
  const entryIds: AssertionEntryId[] = [];
  const producer = createAssertionsAttachmentProducer<never, never>({
    entryIds: {
      next: () => input.entryIds?.[entryIndex++] ?? `ae_${randomBytes(10).toString("hex")}`,
    },
  });
  for (const entry of sealed.entries) {
    const appended = producer.append(encodeSealedAssertionEntry(entry));
    if (Either.isLeft(appended)) return Either.left(assertionsInvalid(appended.left));
    entryIds.push(appended.right);
  }
  const attachment = producer.seal({ sourceSites: input.sourceSites });
  return Either.isLeft(attachment)
    ? Either.left(assertionsInvalid(attachment.left))
    : Either.right(Object.freeze({
        attachment: attachment.right,
        entryIds: Object.freeze(entryIds),
      }));
}

function sourceSiteInputs(
  sites: readonly AssertionSourceSite[],
): readonly AssertionSourceSiteInput[] {
  return Object.freeze(sites.map((site) => Object.freeze({
    entryId: site.entryId,
    sourceOrder: site.sourceOrder,
    role: site.role,
    sourceItemId: site.source.value.sourceItemId,
    sha256: site.source.value.sha256,
    start: site.start,
    end: site.end,
  })));
}

/**
 * Creates stable Assertion entry ids now, while deferring every content and
 * Sources reference token until the Attempt owner Session invokes the callback.
 */
export function createRunnerAssertionsAttachment(
  sealed: SealedAttemptAssertions,
  input: {
    readonly entryIds?: readonly AssertionEntryId[];
    readonly sourceSites?: RunnerAssertionSourceSitesBuild;
  } = {},
): Either.Either<PreparedAssertionsAttachment, RunnerAssertionsAttachmentInvalid> {
  const preflight = buildAssertionsCapture(sealed, { entryIds: input.entryIds });
  if (Either.isLeft(preflight)) return preflight;
  const buildSourceSites = input.sourceSites;
  if (buildSourceSites === undefined) return preflight;

  const attachment: AssertionsAttachmentCapture<never, never> = (build) => {
    const built = buildAssertionsCapture(sealed, {
      entryIds: preflight.right.entryIds,
      sourceSites: sourceSiteInputs(buildSourceSites(build)),
    });
    if (Either.isLeft(built)) {
      throw new Error("Assertions capture violated its sealed source-site budget");
    }
    return built.right.attachment(build);
  };
  return Either.right(Object.freeze({
    attachment,
    entryIds: preflight.right.entryIds,
  }));
}

interface ArtifactCapture {
  readonly mediaType: string;
  readonly label: string;
  readonly bytes: Uint8Array;
}

export type ArtifactsAttachmentBuild = (
  build: RecordAttachmentSessionBuilder,
) => ArtifactsAttachment;

function artifactsAttachment(input: {
  readonly artifacts: readonly ArtifactCapture[];
  readonly omittedAtLeast?: number;
}): ArtifactsAttachmentBuild {
  const captures = Object.freeze(input.artifacts.map((artifact) => {
    const bytes = new Uint8Array(artifact.bytes);
    return Object.freeze({
      artifactId: `art_${randomBytes(10).toString("hex")}`,
      mediaType: artifact.mediaType,
      label: artifact.label,
      bytes,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }).sort((left, right) => left.artifactId.localeCompare(right.artifactId)));

  return (build) => {
    const candidate = Object.freeze({
      collection: input.omittedAtLeast === undefined
        ? Object.freeze({ state: "complete" as const, limitations: [] as const })
        : Object.freeze({
            state: "partial" as const,
            limitations: Object.freeze([Object.freeze({
              code: "unsupported-input" as const,
              omittedAtLeast: input.omittedAtLeast,
            })]),
          }),
      artifacts: Object.freeze(captures.map((artifact) => Object.freeze({
        artifactId: artifact.artifactId,
        mediaType: artifact.mediaType,
        label: artifact.label,
        byteLength: artifact.byteLength,
        sha256: artifact.sha256,
        content: build.content.bytes(artifact.bytes),
      }))),
    });
    const decoded = Schema.validateEither(
      ArtifactsAttachmentSchema,
      RecordExactParseOptions,
    )(candidate);
    if (Either.isLeft(decoded)) {
      throw new Error("Artifacts collector produced an invalid current logical value");
    }
    return decoded.right;
  };
}

export function createAttemptArtifactsAttachment(
  result: EvalResult,
): ArtifactsAttachmentBuild | undefined {
  const captures: ArtifactCapture[] = [];
  let omittedAtLeast = 0;
  const appendJson = (label: string, value: unknown): void => {
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(value);
    } catch {
      omittedAtLeast += 1;
      return;
    }
    if (encoded === undefined) {
      omittedAtLeast += 1;
      return;
    }
    const bytes = new TextEncoder().encode(encoded);
    if (bytes.byteLength > ArtifactsLimits.maximumContentBytes) {
      omittedAtLeast += 1;
      return;
    }
    captures.push(Object.freeze({ mediaType: "application/json", label, bytes }));
  };

  if (result.agentSetup !== undefined) appendJson("agent-setup.json", result.agentSetup);
  if (captures.length === 0 && omittedAtLeast === 0) return undefined;
  return artifactsAttachment({
    artifacts: Object.freeze(captures),
    ...(omittedAtLeast === 0 ? {} : { omittedAtLeast }),
  });
}

export function createRunArtifactsAttachment(): ArtifactsAttachmentBuild {
  return artifactsAttachment({ artifacts: Object.freeze([]) });
}

export function createAttemptObservabilityAttachments(input: {
  readonly result: EvalResult;
  readonly sealed: SealedAttemptAssertions;
}): Effect.Effect<AttemptSourceReceiptAttachments, RunnerObservabilityAttachmentInvalid> {
  return Effect.gen(function* () {
    const capture = yield* createRunnerAttemptSourceReceiptsCapture(input).pipe(
      Effect.mapError(() => Object.freeze({
        code: "runner-record-observability-invalid" as const,
        owner: "attempt" as const,
        stage: "capture" as const,
      })),
    );
    const attachments = createAttemptSourceReceiptAttachments(capture);
    if (Either.isLeft(attachments)) {
      return yield* Effect.fail(Object.freeze({
        code: "runner-record-observability-invalid" as const,
        owner: "attempt" as const,
        stage: "attachment" as const,
      }));
    }
    return attachments.right;
  });
}

export function createRunObservabilityAttachments(
  run: AgentRun,
): Effect.Effect<RunSourceReceiptAttachments, RunnerObservabilityAttachmentInvalid> {
  return Effect.gen(function* () {
    const capture = yield* createRunnerRunSourceReceiptsCapture({ run }).pipe(
      Effect.mapError(() => Object.freeze({
        code: "runner-record-observability-invalid" as const,
        owner: "run" as const,
        stage: "capture" as const,
      })),
    );
    const attachments = createRunSourceReceiptAttachments(capture);
    if (Either.isLeft(attachments)) {
      return yield* Effect.fail(Object.freeze({
        code: "runner-record-observability-invalid" as const,
        owner: "run" as const,
        stage: "attachment" as const,
      }));
    }
    return attachments.right;
  });
}

export function createAttemptFileChangesAttachment(
  result: EvalResult,
): FileChangesAttachmentBuild | undefined {
  const capture = runnerAttemptFileChangesCaptureForResult(result);
  return capture === undefined ? undefined : createFileChangesCaptureAttachment(capture);
}

export function recordAttemptOutcome(
  result: EvalResult,
): "completed" | "errored" | "cancelled" {
  switch (result.verdict) {
    case "passed":
    case "failed":
      return "completed";
    case "errored":
      return "errored";
    case "skipped":
      return "cancelled";
  }
}
