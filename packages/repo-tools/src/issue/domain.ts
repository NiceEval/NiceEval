import { createHash, randomUUID } from "node:crypto";
import { Context, Effect } from "effect";

import { IssueCreateConflict, IssueInputError, IssuePlanConsumed, IssuePlanCorrupt, IssuePlanDrifted, IssuePlanExpired, IssuePlanIoError, IssuePlanNotPlanned, type IssueError } from "./errors.js";
import type { CreateIdentity, IssueIdentity, IssueMutationResult, IssueOperation, IssuePayload, IssuePlanReceipt, IssueRepository, RemoteIssue } from "./model.js";

const receiptLifetimeMillis = 5 * 60_000;
const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const sameRepository = (left: IssueRepository, right: IssueRepository) => left.host === right.host && left.repository === right.repository;
const issueSnapshot = (issue: RemoteIssue) => ({ number: issue.number, title: issue.title, body: issue.body, state: issue.state, labels: [...issue.labels].sort(), isPullRequest: issue.isPullRequest });

/** The only remote boundary. Its implementation may use gh or GitHub HTTP. */
export interface IssueRemoteService {
  /** Must paginate to exhaustion and include Issue bodies; Pull Requests remain flagged. */
  readonly list: (repository: IssueRepository, state: "open" | "closed") => Effect.Effect<readonly RemoteIssue[], IssueError>;
  readonly get: (identity: IssueIdentity) => Effect.Effect<RemoteIssue, IssueError>;
  readonly mutate: (repository: IssueRepository, identity: IssueIdentity | CreateIdentity, payload: IssuePayload) => Effect.Effect<IssueMutationResult, IssueError>;
}

export class IssueRemote extends Context.Service<IssueRemote, IssueRemoteService>()("@niceeval/repo-tools/issue/Remote") {}

export interface IssuePlanStoreService {
  readonly plan: (receipt: IssuePlanReceipt) => Effect.Effect<void, IssuePlanCorrupt | IssuePlanIoError>;
  readonly consume: (receipt: IssuePlanReceipt, now: number) => Effect.Effect<void, IssuePlanConsumed | IssuePlanExpired | IssuePlanNotPlanned | IssuePlanCorrupt | IssuePlanIoError>;
}

export class IssuePlanStore extends Context.Service<IssuePlanStore, IssuePlanStoreService>()("@niceeval/repo-tools/issue/PlanStore") {}

export const planIssueMutation = (
  identity: IssueIdentity | CreateIdentity,
  operation: IssueOperation,
  payload: IssuePayload,
  remotePreimageDigest: string,
  now: number,
): IssuePlanReceipt => ({
  format: "niceeval.issue-plan/v1",
  id: randomUUID(),
  schema: 1,
  plannedAt: now,
  expiresAt: now + receiptLifetimeMillis,
  operation,
  repository: { host: identity.host, repository: identity.repository },
  identity,
  remotePreimageDigest,
  payloadDigest: digest(payload),
  payload,
});

export const remoteIssueDigest = (issue: RemoteIssue): string => digest(issueSnapshot(issue));
export const remoteCreateDigest = (issues: readonly RemoteIssue[]): string => digest(issues.filter((issue) => !issue.isPullRequest).map(issueSnapshot).sort((a, b) => a.number - b.number));

export const listIssues = Effect.fn("Issue.list")((repository: IssueRepository) =>
  Effect.service(IssueRemote).pipe(Effect.flatMap((remote) => Effect.all([remote.list(repository, "open"), remote.list(repository, "closed")])), Effect.map(([open, closed]) => [...open, ...closed])));

export const showIssue = Effect.fn("Issue.show")((identity: IssueIdentity) =>
  Effect.service(IssueRemote).pipe(Effect.flatMap((remote) => remote.get(identity))));

export const prepareIssue = Effect.fn("Issue.prepare")((identity: IssueIdentity | CreateIdentity, operation: IssueOperation, payload: IssuePayload, now: number) =>
  Effect.gen(function*() {
    if (payload.operation !== operation) return yield* Effect.fail(new IssueInputError({ message: "operation and payload disagree" }));
    if ("number" in identity) {
      const receipt = planIssueMutation(identity, operation, payload, remoteIssueDigest(yield* showIssue(identity)), now);
      const store = yield* Effect.service(IssuePlanStore);
      yield* store.plan(receipt);
      return receipt;
    }
    if (payload.operation !== "create") return yield* Effect.fail(new IssueInputError({ message: "create identity requires a create payload" }));
    const issues = yield* listIssues(identity);
    if (identity.kind === "machine-origin") {
      if (identity.originKey === undefined) return yield* Effect.fail(new IssueInputError({ message: "machine-origin create requires originKey" }));
      const declaredDigest = /payload-sha256:\s*([0-9a-f]{64})\s*$/mu.exec(payload.body)?.[1];
      if (declaredDigest === undefined) return yield* Effect.fail(new IssueInputError({ message: "machine-origin create body lacks payload-sha256 marker" }));
      yield* requireUnseenMachineOrigin(issues, identity.originKey, declaredDigest);
    }
    const receipt = planIssueMutation(identity, operation, payload, remoteCreateDigest(issues), now);
    const store = yield* Effect.service(IssuePlanStore);
    yield* store.plan(receipt);
    return receipt;
  }));

/** execute assumes the caller has already obtained current explicit authorization. */
export const executeIssuePlan = Effect.fn("Issue.executePlan")((receipt: IssuePlanReceipt, now: number) =>
  Effect.gen(function*() {
    if (receipt.format !== "niceeval.issue-plan/v1" || receipt.schema !== 1 || receipt.payloadDigest !== digest(receipt.payload)) {
      return yield* Effect.fail(new IssueInputError({ message: "invalid issue plan receipt" }));
    }
    if (!sameRepository(receipt.repository, receipt.identity)) return yield* Effect.fail(new IssueInputError({ message: "receipt repository and identity disagree" }));
    const store = yield* Effect.service(IssuePlanStore);
    yield* store.consume(receipt, now);
    const current = "number" in receipt.identity
      ? remoteIssueDigest(yield* showIssue(receipt.identity))
      : remoteCreateDigest(yield* listIssues(receipt.identity));
    if (current !== receipt.remotePreimageDigest) return yield* Effect.fail(new IssuePlanDrifted({ receiptId: receipt.id, expected: receipt.remotePreimageDigest, actual: current }));
    const remote = yield* Effect.service(IssueRemote);
    return yield* remote.mutate(receipt.repository, receipt.identity, receipt.payload);
  }));

export const prepareCreate = (identity: CreateIdentity, title: string, body: string, now: number) => prepareIssue(identity, "create", { operation: "create", title, body }, now);
export const prepareBodySet = (identity: IssueIdentity, body: string, now: number) => prepareIssue(identity, "body-set", { operation: "body-set", body }, now);
export const prepareLabelsAdd = (identity: IssueIdentity, labels: readonly string[], now: number) => prepareIssue(identity, "labels-add", { operation: "labels-add", labels }, now);
export const prepareLabelsRemove = (identity: IssueIdentity, labels: readonly string[], now: number) => prepareIssue(identity, "labels-remove", { operation: "labels-remove", labels }, now);
export const prepareCommentAdd = (identity: IssueIdentity, body: string, now: number) => prepareIssue(identity, "comment-add", { operation: "comment-add", body }, now);
export const prepareClose = (identity: IssueIdentity, reason: "completed" | "not_planned" | undefined, now: number) => prepareIssue(identity, "close", { operation: "close", ...(reason === undefined ? {} : { reason }) }, now);
export const prepareReopen = (identity: IssueIdentity, now: number) => prepareIssue(identity, "reopen", { operation: "reopen" }, now);

/** Validates the complete machine-origin scan before a create plan can exist. */
export const requireUnseenMachineOrigin = (issues: readonly RemoteIssue[], originKey: string, payloadDigest: string): Effect.Effect<void, IssueCreateConflict> => {
  const matches = issues.filter((issue) => !issue.isPullRequest && new RegExp(`origin-key: ${escapeRegExp(originKey)}\\s*$`, "mu").test(issue.body));
  if (matches.length === 0) return Effect.void;
  if (matches.length > 1) return Effect.fail(new IssueCreateConflict({ message: `multiple Issues have origin-key ${originKey}` }));
  const marker = /payload-sha256:\s*([0-9a-f]{64})\s*$/mu.exec(matches[0]!.body)?.[1];
  return Effect.fail(new IssueCreateConflict({ message: marker === payloadDigest ? "machine origin already exists" : "machine origin exists with a different payload" }));
};
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
