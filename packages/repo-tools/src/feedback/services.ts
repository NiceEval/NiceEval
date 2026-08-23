import { Context, type Effect, Layer } from "effect";
import type { FeedbackDocument } from "./codec.js";
import type { FeedbackError } from "./errors.js";
import { feedbackEffect, FeedbackRepository, type FeedbackCheckReceipt } from "./repository.js";
import type { FeedbackClosure, FeedbackEnvelopeV1, FeedbackMemoryRelation, FeedbackV1 } from "./schema.js";

export interface FeedbackStoreService {
  readonly list: () => Effect.Effect<readonly FeedbackDocument[], FeedbackError>;
  readonly read: (id: string) => Effect.Effect<FeedbackDocument, FeedbackError>;
  readonly create: (document: FeedbackDocument, dryRun: boolean) => Effect.Effect<FeedbackV1, FeedbackError>;
  readonly importEnvelope: (
    envelope: FeedbackEnvelopeV1,
    artifactRoot: string,
    reportedAt: string,
    dryRun: boolean,
  ) => Effect.Effect<FeedbackV1, FeedbackError>;
  readonly link: (id: string, relation: FeedbackMemoryRelation, dryRun: boolean) => Effect.Effect<FeedbackV1, FeedbackError>;
  readonly close: (id: string, closure: FeedbackClosure, dryRun: boolean) => Effect.Effect<FeedbackV1, FeedbackError>;
  readonly reopen: (id: string, dryRun: boolean) => Effect.Effect<FeedbackV1, FeedbackError>;
  readonly check: () => Effect.Effect<FeedbackCheckReceipt, FeedbackError>;
}

export class FeedbackStore extends Context.Tag("@niceeval/repo-tools/feedback/Store")<
  FeedbackStore,
  FeedbackStoreService
>() {}

/** Node filesystem adapter; applications provide it once at their composition edge. */
export const NodeFeedbackStoreLive = (root: string) =>
  Layer.succeed(FeedbackStore, (() => {
    const repository = new FeedbackRepository({ root });
    return {
      list: () => feedbackEffect("list", () => repository.list()),
      read: (id) => feedbackEffect("read", () => repository.read(id)),
      create: (document, dryRun) => feedbackEffect("add", () => repository.create(document, [], dryRun)),
      importEnvelope: (envelope, artifactRoot, reportedAt, dryRun) => feedbackEffect("import", () =>
        repository.importEnvelope(envelope, artifactRoot, reportedAt, dryRun)),
      link: (id, relation, dryRun) => feedbackEffect("link", () => repository.link(id, relation, dryRun)),
      close: (id, closure, dryRun) => feedbackEffect("close", () => repository.close(id, closure, dryRun)),
      reopen: (id, dryRun) => feedbackEffect("reopen", () => repository.reopen(id, dryRun)),
      check: () => feedbackEffect("check", () => repository.check()),
    } satisfies FeedbackStoreService;
  })());
